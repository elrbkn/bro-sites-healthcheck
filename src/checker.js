const { config } = require("./config");
const { getProxyConfig } = require("./proxy");

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
