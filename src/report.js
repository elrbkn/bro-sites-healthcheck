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

/**
 * Формирует итоговый текстовый отчёт (HTML-разметка для Telegram) по результатам проверок.
 */
function buildReport(results, meta = {}) {
  const ok = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);
  const now = new Date();
  const dateStr = now.toLocaleString("ru-RU", { timeZone: "Europe/Riga" });

  const lines = [];
  lines.push(`<b>🩺 Health Check отчёт</b>`);
  lines.push(`Дата: ${escapeHtml(dateStr)}`);
  lines.push(`Всего сайтов: ${results.length} | ✅ ok: ${ok.length} | ❌ ошибок: ${failed.length}`);
  lines.push("");

  if (failed.length > 0) {
    lines.push(`<b>Проблемные сайты (${failed.length}):</b>`);
    for (const r of failed) {
      const extraWarn =
        r.warnings && r.warnings.length ? `\n   Также: ${escapeHtml(r.warnings.join("; "))}` : "";
      lines.push(
        `❌ <b>${escapeHtml(r.name)}</b>\n` +
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

module.exports = { buildReport };