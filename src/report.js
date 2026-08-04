const { config } = require("./config");

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatDuration(ms) {
  if (ms == null) return "-";
  return `${(ms / 1000).toFixed(1)}с`;
}

function nowStr() {
  return new Date().toLocaleString("ru-RU", { timeZone: config.notify.timezone });
}

// Порядок и состав групп для дневной сводки. Сайты, не попавшие ни в одну
// группу, автоматически уходят в группу "Другое" в конце отчёта.
const GROUP_DEFINITIONS = [
  { title: "CPA Bro", members: ["Портал CPA Bro", "Кабинет CPA Bro", "l1l.pw линка"] },
  { title: "Chocopay", members: ["Портал Chocopay", "Кабинет Chocopay"] },
  { title: "Press Aff", members: ["Press Aff com", "Press Aff ru"] },
  { title: "App Heroes", members: ["App Heroes"] },
  { title: "Say Play", members: ["Say Play"] },
  { title: "Медиа", members: ["Research", "Digitalbosses", "BRO agency", "AI Tech"] },
];

function groupResults(results) {
  const byName = new Map(results.map((r) => [r.name, r]));
  const used = new Set();
  const groups = [];

  for (const def of GROUP_DEFINITIONS) {
    const items = def.members.map((name) => byName.get(name)).filter(Boolean);
    items.forEach((r) => used.add(r.name));
    if (items.length > 0) groups.push({ title: def.title, items });
  }

  const rest = results.filter((r) => !used.has(r.name));
  if (rest.length > 0) groups.push({ title: "Другое", items: rest });

  return groups;
}

function formatSiteLine(r) {
  if (r.ok) {
    const warn = r.warnings && r.warnings.length ? ` ⚠️ ${escapeHtml(r.warnings.join("; "))}` : "";
    return `✅ <b>${escapeHtml(r.name)}</b> — HTTP ${r.statusCode}, ${formatDuration(r.loadTimeMs)}${warn}`;
  }
  const extraWarn =
    r.warnings && r.warnings.length ? `\n   Также: ${escapeHtml(r.warnings.join("; "))}` : "";
  return (
    `❌ <b>${escapeHtml(r.name)}</b>\n` +
    `   ${escapeHtml(r.url)}\n` +
    `   Статус: ${r.statusCode ?? "нет ответа"} | Время: ${formatDuration(r.loadTimeMs)} | Попыток: ${r.attempts ?? 1}\n` +
    `   Причина: ${escapeHtml(r.error || "неизвестная ошибка")}${extraWarn}`
  );
}


/**
 * Формирует итоговый текстовый отчёт (HTML-разметка для Telegram) по результатам проверок.
 * Используется для ЕЖЕДНЕВНОЙ СВОДКИ (все сайты, включая ✅).
 */
function buildReport(results, meta = {}) {
  const ok = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);
  const dateStr = nowStr();

  const lines = [];
  lines.push(`<b>🩺 Health Check — ежедневная сводка</b>`);
  lines.push(`Дата: ${escapeHtml(dateStr)}`);
  lines.push(`Всего сайтов: ${results.length} | ✅ ok: ${ok.length} | ❌ ошибок: ${failed.length}`);

  for (const group of groupResults(results)) {
    lines.push("");
    lines.push(`<b>${escapeHtml(group.title)}</b>`);
    for (const r of group.items) {
      lines.push(formatSiteLine(r));
    }
  }

  return lines.join("\n");
}

/**
 * Формирует короткое уведомление только по сайтам, у которых статус
 * изменился по сравнению с прошлым запуском (упал / восстановился).
 * @param {Array<{name:string, url:string, from:boolean, to:boolean, result:object}>} changes
 */
function buildChangesReport(changes) {
  const brokenNow = changes.filter((c) => c.from && !c.to);
  const recovered = changes.filter((c) => !c.from && c.to);

  const lines = [];
  lines.push(`<b>⚡ Health Check — изменение статуса</b>`);
  lines.push(`Дата: ${escapeHtml(nowStr())}`);
  lines.push("");

  if (brokenNow.length > 0) {
    lines.push(`<b>Упали (${brokenNow.length}):</b>`);
    for (const c of brokenNow) {
      const r = c.result;
      lines.push(
        `🔴 <b>${escapeHtml(c.name)}</b>\n` +
          `   ${escapeHtml(c.url)}\n` +
          `   Статус: ${r.statusCode ?? "нет ответа"} | Причина: ${escapeHtml(r.error || "неизвестная ошибка")}`
      );
    }
    lines.push("");
  }

  if (recovered.length > 0) {
    lines.push(`<b>Восстановились (${recovered.length}):</b>`);
    for (const c of recovered) {
      lines.push(`🟢 <b>${escapeHtml(c.name)}</b> — снова HTTP ${c.result.statusCode}`);
    }
  }

  return lines.join("\n");
}

module.exports = { buildReport, buildChangesReport };