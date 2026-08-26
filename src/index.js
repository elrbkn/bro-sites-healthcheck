const { chromium } = require("playwright");
const { config, validate } = require("./config");
const sites = require("../sites");
const { checkSiteWithRetries } = require("./checker");
const { buildReport, buildChangesReport } = require("./report");
const { broadcastTelegramMessage, fetchNewStarts } = require("./telegram");
const { loadState, saveState } = require("./state");
const { loadSubscribers, saveSubscribers } = require("./subscribers");

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

function todayStr() {
  return new Date().toLocaleDateString("sv-SE", { timeZone: config.notify.timezone });
}

function currentHour() {
  return parseInt(
    new Date().toLocaleString("en-US", { timeZone: config.notify.timezone, hour: "2-digit", hour12: false }),
    10
  );
}

/**
 * Опрашивает Telegram на новые /start, добавляет новых подписчиков
 * в персистентный список и возвращает актуальный список получателей.
 */
async function syncSubscribers() {
  const subscribers = loadSubscribers(config.notify.subscribersFilePath);

  try {
    const { newChatIds, maxUpdateId } = await fetchNewStarts(subscribers.lastUpdateId);
    if (newChatIds.length > 0) {
      console.log(`Новые подписчики через /start: ${newChatIds.join(", ")}`);
    }
    for (const id of newChatIds) {
      if (!subscribers.chatIds.includes(id)) subscribers.chatIds.push(id);
    }
    subscribers.lastUpdateId = maxUpdateId;
    saveSubscribers(config.notify.subscribersFilePath, subscribers);
  } catch (err) {
    console.error("Не удалось опросить Telegram на новых подписчиков:", err.response?.data || err.message);
    // Не валим весь прогон из-за этого — просто рассылаем тем, кто уже есть в списке.
  }

  // TELEGRAM_CHAT_ID (если задан) всегда остаётся получателем — это "затравочный"/админский чат.
  const recipients = new Set(subscribers.chatIds);
  if (config.telegram.chatId) recipients.add(config.telegram.chatId);

  return [...recipients];
}

async function main() {
  validate();

  const state = loadState(config.notify.stateFilePath);
  const recipients = await syncSubscribers();

  if (recipients.length === 0) {
    console.log(
      "Пока нет ни одного получателя: никто не написал боту /start и TELEGRAM_CHAT_ID не задан. " +
        "Отчёты будут только в логе."
    );
  }

  console.log(`Запуск проверки ${sites.length} сайтов через прокси SOAX (DE)...`);

  const browser = await chromium.launch({
    headless: true,
    args: ["--disable-blink-features=AutomationControlled"],
  });

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
  } else if (recipients.length === 0) {
    console.log("\nЕсть что отправить, но получателей нет — пропускаю отправку.");
  } else {
    for (const msg of messagesToSend) {
      const sendResults = await broadcastTelegramMessage(msg, recipients);
      const failed = sendResults.filter((r) => !r.ok);
      console.log(
        `Разослано ${sendResults.length - failed.length}/${sendResults.length} получателям.` +
          (failed.length ? ` Ошибки: ${failed.map((f) => `${f.chatId} — ${f.error}`).join("; ")}` : "")
      );
      if (failed.length === sendResults.length) {
        process.exitCode = 2; // все получатели не получили сообщение — считаем это отказом
      }
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