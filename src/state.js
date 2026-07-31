const fs = require("fs");
const path = require("path");

function loadState(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    return {
      sites: parsed.sites || {},
      lastDailySummaryDate: parsed.lastDailySummaryDate || null,
    };
  } catch {
    // Файла ещё нет (первый запуск) или он повреждён — начинаем с чистого состояния.
    return { sites: {}, lastDailySummaryDate: null };
  }
}

function saveState(filePath, state) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2) + "\n", "utf-8");
}

module.exports = { loadState, saveState };