const { URL } = require("url");
const { config } = require("./config");
const { getProxyConfig } = require("./proxy");
const { checkSsl } = require("./ssl");
const { resolveDns } = require("./dns");

const CONSOLE_NOISE_HOSTS = [
  "google-analytics.com",
  "googletagmanager.com",
  "doubleclick.net",
  "facebook.net",
  "connect.facebook.net",
  "hotjar.com",
  "mc.yandex.ru",
  "yandex.ru",
  "sentry.io",
  "clarity.ms",
  "google.com/pagead",
];

function isNoiseHost(hostname) {
  if (!hostname) return false;
  return CONSOLE_NOISE_HOSTS.some((h) => hostname.includes(h));
}

const STATIC_RESOURCE_RE = /\.(css|js)(\?.*)?$/i;
const MAX_ACCEPTABLE_REDIRECTS = 3;
const MOBILE_VIEWPORT = { width: 390, height: 844 };
const MOBILE_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 " +
  "(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

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

/**
 * Контрольная перепроверка смены домена свежей прокси-сессией.
 * Увеличен таймаут для уменьшения ложных срабатываний.
 */
async function verifyDomainChange(browser, url, expectedHost) {
  let context, page;
  try {
    context = await browser.newContext({
      proxy: getProxyConfig(),
      ignoreHTTPSErrors: true,
      locale: "de-DE",
    });
    // Увеличиваем таймаут на 50%, чтобы избежать временных сбоев
    context.setDefaultTimeout(config.check.pageTimeoutMs * 1.5);
    page = await context.newPage();
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: config.check.pageTimeoutMs * 1.5,
    });
    const finalHost = hostnameOf(page.url());
    return { changed: finalHost !== expectedHost, finalHost };
  } catch {
    // Если и контрольная попытка не удалась — не усугубляем ложную тревогу.
    return { changed: false };
  } finally {
    if (page) await page.close().catch(() => {});
    if (context) await context.close().catch(() => {});
  }
}

/**
 * Лёгкая повторная загрузка страницы с мобильным viewport.
 * Теперь учитывает параметры сайта (site) для гибкой настройки.
 */
async function checkMobileViewport(browser, url, site = {}) {
  let context, page;
  try {
    context = await browser.newContext({
      proxy: getProxyConfig(),
      ignoreHTTPSErrors: true,
      userAgent: MOBILE_USER_AGENT,
      viewport: MOBILE_VIEWPORT,
      isMobile: true,
      hasTouch: true,
      locale: "de-DE",
    });
    context.setDefaultTimeout(config.check.pageTimeoutMs);
    page = await context.newPage();

    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: config.check.pageTimeoutMs,
    });

    if (!response) return { ok: false, error: "нет ответа на мобильной версии" };
    const status = response.status();
    if (status >= 400) return { ok: false, error: `мобильная версия вернула HTTP ${status}` };

    // Даём время на динамический рендеринг (увеличено до 20 секунд)
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});

    // 1. Проверяем наличие ожидаемого селектора (если задан)
    if (site.mobileExpectedSelector) {
      try {
        await page.waitForSelector(site.mobileExpectedSelector, { timeout: 10000 });
      } catch {
        return {
          ok: false,
          error: `Не найден ожидаемый селектор: ${site.mobileExpectedSelector}`,
        };
      }
    }

    // 2. Проверяем ожидаемые фразы (если заданы)
    if (site.expectedText && site.expectedText.length > 0) {
      const bodyText = await page.evaluate(() => document.body?.innerText || "");
      const missing = site.expectedText.filter(
        (phrase) => !bodyText.toLowerCase().includes(phrase.toLowerCase())
      );
      if (missing.length > 0) {
        return {
          ok: false,
          error: `На мобильной версии не найдены фразы: ${missing.join(", ")}`,
        };
      }
      // Если все фразы найдены, считаем проверку успешной (даже если текста мало)
      return { ok: true, statusCode: status };
    }

    // 3. Проверка длины текста с учётом персонального порога
    const textLength = await page.evaluate(() => (document.body?.innerText || "").trim().length);
    const minLength = site.mobileMinContentLength ?? config.check.minContentLength;
    if (textLength < minLength) {
      return {
        ok: false,
        error: `мобильная версия почти пустая (текста: ${textLength} симв., порог ${minLength})`,
      };
    }

    return { ok: true, statusCode: status };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  } finally {
    if (page) await page.close().catch(() => {});
    if (context) await context.close().catch(() => {});
  }
}

/**
 * ОПЦИОНАЛЬНЫЙ активный клик-тест: кликает по заданному в конфиге сайта
 * селектору и проверяет, что произошла реальная навигация.
 */
async function runClickTest(page, clickTest) {
  const { selector, expectedUrlIncludes } = clickTest;
  const el = await page.$(selector);
  if (!el) return { ok: false, error: `элемент "${selector}" не найден` };

  const beforeUrl = page.url();
  try {
    await el.click({ timeout: 5000 });
  } catch (err) {
    return { ok: false, error: `не удалось кликнуть по "${selector}": ${err.message}` };
  }
  await page.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => {});
  const afterUrl = page.url();

  if (expectedUrlIncludes && !afterUrl.includes(expectedUrlIncludes)) {
    return { ok: false, error: `после клика URL "${afterUrl}" не содержит "${expectedUrlIncludes}"` };
  }
  if (afterUrl === beforeUrl) {
    return { ok: false, error: `URL не изменился после клика по "${selector}"` };
  }
  return { ok: true };
}

// Фразы для распознавания "мёртвых" страниц
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

  // --- Быстрая DNS-проверка ---
  const hostname = hostnameOf(url);
  if (hostname) {
    const dnsResult = await resolveDns(hostname);
    if (!dnsResult.ok) {
      result.error = dnsResult.error;
      result.loadTimeMs = Date.now() - startedAt;
      return result;
    }
  }

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

    // Ловим ответы на CSS/JS
    const staticIssues = [];
    page.on("response", (res) => {
      const resUrl = res.url();
      if (!STATIC_RESOURCE_RE.test(resUrl)) return;
      const status = res.status();
      if (status >= 400) {
        staticIssues.push(`${resUrl} — HTTP ${status}`);
      }
    });

    // --- Консольные ошибки JS ---
    const consoleErrors = [];
    page.on("console", (msg) => {
  if (msg.type() !== "error") return;
  const text = msg.text().slice(0, 150);

  // ---- НОВАЯ ПРОВЕРКА: игнорируем ошибки по списку ----
  if (site.ignoreConsoleErrors && site.ignoreConsoleErrors.some(pattern => text.includes(pattern))) {
    return; 
  }

  const loc = msg.location();
  const errHost = loc && loc.url ? hostnameOf(loc.url) : null;
  if (isNoiseHost(errHost)) return;
  consoleErrors.push(errHost ? `${text} [${errHost}]` : text);
});
    page.on("pageerror", (err) => {
      consoleErrors.push(`Необработанное исключение: ${err.message}`.slice(0, 200));
    });

    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: config.check.pageTimeoutMs,
    });

    // Даём странице подгрузить динамический контент
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
        const verification = await verifyDomainChange(browser, url, startHost);
        if (verification.changed) {
          result.warnings.push(
            `Редирект на другой домен: ${startHost} → ${endHost} (подтверждено повторной проверкой)`
          );
        } else {
          console.log(
            `   ⚠️  ${site.name}: разово увиден редирект на ${endHost}, но при перепроверке — домен корректный (похоже на сбой прокси-сессии, не репортим)`
          );
        }
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

    // --- Проверка ключевых фраз ---
    if (site.expectedText && site.expectedText.length > 0) {
      const bodyText = (await page.evaluate(() => document.body?.innerText || "")).toLowerCase();
      const missing = site.expectedText.filter((phrase) => !bodyText.includes(phrase.toLowerCase()));
      if (missing.length > 0) {
        throw new Error(
          `На странице не найдены ожидаемые фразы: ${missing.map((p) => `"${p}"`).join(", ")} — вероятно, контент не отрендерился или сломался шаблон`
        );
      }
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

    // --- Консольные ошибки JS ---
    if (consoleErrors.length > 0) {
      const uniqueErrors = [...new Set(consoleErrors)].slice(0, 3);
      result.warnings.push(`Ошибки в консоли JS (${consoleErrors.length}): ${uniqueErrors.join(" | ")}`);
    }

    // --- Мобильный viewport (передаём site для гибких настроек) ---
    if (config.check.mobileCheckEnabled && site.mobileCheck !== false) {
      const mobile = await checkMobileViewport(browser, url, site);
      result.mobile = mobile;
      if (!mobile.ok) {
        result.warnings.push(`Мобильная версия: ${mobile.error}`);
      }
    }

    // --- Активный клик-тест ---
    if (site.clickTest && site.clickTest.selector) {
      const click = await runClickTest(page, site.clickTest);
      if (!click.ok) {
        result.warnings.push(`Клик-тест: ${click.error}`);
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
 * Проверяет сайт с повторными попытками при неуспехе.
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