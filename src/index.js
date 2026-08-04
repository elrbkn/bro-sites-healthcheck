const { chromium } = require("playwright");
const { config, validate } = require("./config");
const sites = require("../sites");
const { checkSiteWithRetries } = require("./checker");
const { buildReport, buildChangesReport } = require("./report");
const { sendTelegramMessage } = require("./telegram");
const { loadState, saveState } = require("./state");

/**
 * Простой пул с ограничением параллелизма.
 */
async function runWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runner() {
    while (nextIndex < items.length) {
      const current = nextIndex++;
      results[current] = await worker(items[current], current);
    }
  }

  const runners = Array.from({ length: Math.min(limit, items.length) }, () => runner());
  await Promise.all(runners);
  return results;
}

function todayStr() {
  // YYYY-MM-DD в нужной таймзоне 
  return new Date().toLocaleDateString("sv-SE", { timeZone: config.notify.timezone });
}

function currentHour() {
  return parseInt(
    new Date().toLocaleString("en-US", { timeZone: config.notify.timezone, hour: "2-digit", hour12: false }),
    10
  );
}

async function main() {
  validate();

  const state = loadState(config.notify.stateFilePath);

  console.log(`Запуск проверки ${sites.length} сайтов через прокси SOAX (DE)...`);

  const browser = await chromium.launch({ headless: true });

  let results;
  try {
    results = await runWithConcurrency(sites, config.check.concurrency, async (site) => {
      console.log(`→ Проверяю: ${site.name} (${site.url})`);
      const res = await checkSiteWithRetries(browser, site);
      console.log(
        `${res.ok ? "✅" : "❌"} ${site.name}: ${res.ok ? `HTTP ${res.statusCode}` : res.error}`
      );
      return res;
    });
  } finally {
    await browser.close();
  }

  // --- Сравниваем с прошлым запуском ---
  const changes = [];
  for (const r of results) {
    const prev = state.sites[r.name];
    const prevOk = prev ? prev.ok : true; // первый запуск: считаем, что "было ок", чтобы не спамить при старте
    if (prev !== undefined && prevOk !== r.ok) {
      changes.push({ name: r.name, url: r.url, from: prevOk, to: r.ok, result: r });
    }
    state.sites[r.name] = { ok: r.ok, statusCode: r.statusCode, checkedAt: new Date().toISOString() };
  }

  const today = todayStr();
  const isDailySummaryTime = currentHour() >= config.notify.dailySummaryHour && state.lastDailySummaryDate !== today;

  console.log("\n---- РЕЗУЛЬТАТ ----\n");
  console.log(buildReport(results).replace(/<\/?b>/g, ""));

  const messagesToSend = [];
  if (changes.length > 0) {
    messagesToSend.push(buildChangesReport(changes));
  }
  if (isDailySummaryTime) {
    messagesToSend.push(buildReport(results));
    state.lastDailySummaryDate = today;
  }

  if (messagesToSend.length === 0) {
    console.log("\nБез изменений и не время дневной сводки — в Telegram ничего не отправлено.");
  } else {
    try {
      for (const msg of messagesToSend) {
        await sendTelegramMessage(msg);
      }
      console.log(`\nОтправлено сообщений в Telegram: ${messagesToSend.length}.`);
    } catch (err) {
    console.error("\nНе удалось отправить отчёт в Telegram:");
    console.error(err);  // выведет полный стек и все детали
    process.exitCode = 2;
  }
  }

  saveState(config.notify.stateFilePath, state);

  const hasFailures = results.some((r) => !r.ok);
  if (hasFailures) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("Критическая ошибка запуска:", err);
  process.exit(1);
});