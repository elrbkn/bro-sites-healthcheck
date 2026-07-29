const { chromium } = require("playwright");
const { config, validate } = require("./config");
const sites = require("../sites");
const { checkSiteWithRetries } = require("./checker");
const { buildReport } = require("./report");
const { sendTelegramMessage } = require("./telegram");

/**
 * Простой пул с ограничением параллелизма (без внешних зависимостей).
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

async function main() {
  validate();

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

  const report = buildReport(results);
  console.log("\n---- ОТЧЁТ ----\n");
  console.log(report.replace(/<\/?b>/g, ""));

  try {
    await sendTelegramMessage(report);
    console.log("\nОтчёт отправлен в Telegram.");
  } catch (err) {
    console.error(
      "\nНе удалось отправить отчёт в Telegram:",
      err.response?.data || err.message
    );
    process.exitCode = 2;
  }

  const hasFailures = results.some((r) => !r.ok);
  if (hasFailures) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("Критическая ошибка запуска:", err);
  process.exit(1);
});
