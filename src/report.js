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
  lines.push("");

  if (failed.length > 0) {
    lines.push(`<b>Проблемные сайты (${failed.length}):</b>`);
    for (const r of failed) {
      const extraWarn =
        r.warnings && r.warnings.length ? `\n   Также: ${escapeHtml(r.warnings.join("; "))}` : "";
      lines.push(
        `❌ <b>${escapeHtml(r.name)}</b>` +
          `   ${escapeHtml(r.url)}\n` +
          `   Статус: ${r.statusCode ?? "нет ответа"} | Время: ${formatDuration(r.loadTimeMs)} | Попыток: ${r.attempts ?? 1}\n` +
          `   Причина: ${escapeHtml(r.error || "неизвестная ошибка")}${extraWarn}`
      );
    }
    lines.push("");
  }

  lines.push(`<b>Успешно открылись (${ok.length}):</b>`);
  if (ok.length === 0) {
    lines.push("нет");
  } else {
    for (const r of ok) {
      const warn = r.warnings && r.warnings.length ? ` ⚠️ ${escapeHtml(r.warnings.join("; "))}` : "";
      lines.push(
        `✅ <b>${escapeHtml(r.name)}</b> — HTTP ${r.statusCode}, ${formatDuration(r.loadTimeMs)}${warn}`
      );
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
    lines.push(`<bУпали (${brokenNow.length}):</b>`);
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