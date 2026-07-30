const { URL } = require("url");
const { config } = require("./config");
const { getProxyConfig } = require("./proxy");
const { checkSsl } = require("./ssl");

const STATIC_RESOURCE_RE = /\.(css|js)(\?.*)?$/i;
const MAX_ACCEPTABLE_REDIRECTS = 3;

function hostnameOf(u) {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * Строит цепочку редиректов от исходного запроса до финального ответа.
 */
function buildRedirectChain(response) {
  const chain = [];
  let req = response.request();
  while (req) {
    chain.unshift(req.url());
    req = req.redirectedFrom();
  }
  return chain;
}

// Фразы, по которым можно распознать "мёртвую"/заблокированную страницу,
// даже если HTTP статус формально 200
const ERROR_PAGE_MARKERS = [
  "404 not found",
  "403 forbidden",
  "502 bad gateway",
  "503 service unavailable",
  "504 gateway timeout",
  "this site can't be reached",
  "this site can’t be reached",
  "err_connection",
  "err_name_not_resolved",
  "access denied",
  "domain is for sale",
  "buy this domain",
  "account suspended",
  "website is currently unavailable",
  "sorry, you have been blocked",
  "attention required! | cloudflare",
];

function normalizeUrl(rawUrl) {
  if (!/^https?:\/\//i.test(rawUrl)) {
    return `https://${rawUrl}`;
  }
  return rawUrl;
}

/**
 * Проверяет один сайт: открывает через прокси DE, ждёт загрузку,
 * проверяет HTTP статус, наличие контента и признаки интерактивности.
 *
 * @param {import('playwright').Browser} browser
 * @param {{name: string, url: string}} site
 * @returns {Promise<object>} результат проверки
 */
async function checkSite(browser, site) {
  const url = normalizeUrl(site.url);
  const startedAt = Date.now();

  let context;
  let page;
  const result = {
    name: site.name,
    url,
    ok: false,
    statusCode: null,
    finalUrl: null,
    loadTimeMs: null,
    error: null,
    warnings: [],
  };

  try {
    context = await browser.newContext({
      proxy: getProxyConfig(),
      ignoreHTTPSErrors: true,
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      viewport: { width: 1366, height: 768 },
      locale: "de-DE",
    });
    context.setDefaultTimeout(config.check.pageTimeoutMs);

    page = await context.newPage();

    // Ловим ответы на CSS/JS ещё до навигации, чтобы поймать всё,
    // что подгружается по ходу рендеринга страницы.
    const staticIssues = [];
    page.on("response", (res) => {
      const resUrl = res.url();
      if (!STATIC_RESOURCE_RE.test(resUrl)) return;
      const status = res.status();
      if (status >= 400) {
        staticIssues.push(`${resUrl} — HTTP ${status}`);
      }
    });

    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: config.check.pageTimeoutMs,
    });

    // Дадим странице чуть подгрузить динамический контент/скрипты.
    // networkidle сам по себе шумная и не очень надёжная метрика (аналитика,
    // чаты, вебсокеты, поллинг никогда не "затихают") — поэтому она НЕ
    // используется как критерий успеха/провала и не попадает в отчёт как
    // предупреждение, а просто тихо ждём, сколько можем, и идём дальше.
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});

    result.finalUrl = page.url();

    if (!response) {
      throw new Error("Не удалось получить HTTP-ответ (нет навигации / редирект в никуда)");
    }

    result.statusCode = response.status();

    if (result.statusCode >= 500) {
      throw new Error(`Сервер вернул ошибку 5xx (HTTP ${result.statusCode})`);
    }
    if (result.statusCode >= 400) {
      throw new Error(`Страница недоступна, HTTP ${result.statusCode}`);
    }

    // --- HTTP-заголовки ---
    const headers = response.headers();
    const contentType = headers["content-type"] || "";
    if (!contentType.includes("text/html")) {
      result.warnings.push(
        `Content-Type: "${contentType || "отсутствует"}" (ожидался text/html) — возможно, отдаётся не страница, а данные/ошибка`
      );
    }
    if (!headers["content-encoding"]) {
      result.warnings.push("Отсутствует Content-Encoding (сжатие ответа не применяется)");
    }

    // --- Редиректы ---
    const redirectChain = buildRedirectChain(response);
    const redirectCount = redirectChain.length - 1;
    result.redirectCount = redirectCount;
    if (redirectCount > 0) {
      const startHost = hostnameOf(url);
      const endHost = hostnameOf(result.finalUrl);
      if (redirectCount > MAX_ACCEPTABLE_REDIRECTS) {
        result.warnings.push(`Длинная цепочка редиректов: ${redirectCount} переходов`);
      }
      if (startHost && endHost && startHost !== endHost && !site.allowDomainChange) {
        result.warnings.push(`Редирект на другой домен: ${startHost} → ${endHost}`);
      }
    }

    // Проверяем реальный контент и интерактивность страницы
    const pageData = await page.evaluate(() => {
      const text = document.body ? document.body.innerText || "" : "";
      const interactiveEls = document.querySelectorAll(
        "a[href], button, input, select, textarea, [onclick], [role='button']"
      ).length;
      return {
        title: document.title || "",
        textLength: text.trim().length,
        interactiveEls,
        html: document.documentElement ? document.documentElement.outerHTML.length : 0,
      };
    });

    const lowerText = (
      pageData.title +
      " " +
      (await page.evaluate(() => document.body?.innerText?.slice(0, 2000) || ""))
    ).toLowerCase();

    const matchedMarker = ERROR_PAGE_MARKERS.find((marker) => lowerText.includes(marker));
    if (matchedMarker) {
      throw new Error(`На странице обнаружены признаки ошибки/блокировки: "${matchedMarker}"`);
    }

    if (pageData.textLength < config.check.minContentLength && pageData.html < 500) {
      throw new Error(
        `Страница загрузилась, но контента почти нет (текста: ${pageData.textLength} символов) — вероятно, пустая страница`
      );
    }

    if (pageData.interactiveEls === 0) {
      result.warnings.push(
        "На странице не найдено интерактивных элементов (ссылок/кнопок/полей) — возможно, страница не полностью функциональна"
      );
    }

    result.pageTitle = pageData.title;
    result.textLength = pageData.textLength;
    result.interactiveEls = pageData.interactiveEls;

    // --- Целостность статики ---
    if (staticIssues.length > 0) {
      result.warnings.push(
        `Не загрузились статические ресурсы (${staticIssues.length}): ${staticIssues.slice(0, 3).join("; ")}`
      );
    }

    // --- SSL-сертификат ---
    const finalHost = hostnameOf(result.finalUrl) || hostnameOf(url);
    if (finalHost && result.finalUrl?.startsWith("https://")) {
      const ssl = await checkSsl(finalHost);
      result.ssl = ssl;
      if (!ssl.ok) {
        result.warnings.push(`SSL: ${ssl.error}`);
      } else if (ssl.warning) {
        result.warnings.push(`SSL-сертификат истекает через ${ssl.daysLeft} дн. (${ssl.validTo})`);
      }
    }

    result.ok = true;
  } catch (err) {
    result.ok = false;
    result.error = err && err.message ? err.message : String(err);
  } finally {
    result.loadTimeMs = Date.now() - startedAt;
    if (page) await page.close().catch(() => {});
    if (context) await context.close().catch(() => {});
  }

  return result;
}

/**
 * Проверяет сайт с повторными попытками при неуспехе (транспортные/таймаут ошибки).
 */
async function checkSiteWithRetries(browser, site) {
  let attempt = 0;
  let lastResult;

  do {
    lastResult = await checkSite(browser, site);
    attempt++;
  } while (!lastResult.ok && attempt <= config.check.retryCount);

  lastResult.attempts = attempt;
  return lastResult;
}

module.exports = { checkSite, checkSiteWithRetries, normalizeUrl };
