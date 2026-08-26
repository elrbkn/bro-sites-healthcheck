const fs = require("fs");
const path = require("path");

function loadSubscribers(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    return {
      chatIds: Array.isArray(parsed.chatIds) ? parsed.chatIds : [],
      lastUpdateId: typeof parsed.lastUpdateId === "number" ? parsed.lastUpdateId : 0,
    };
  } catch {
    // Файла ещё нет (первый запуск) или он повреждён — начинаем с пустого списка.
    return { chatIds: [], lastUpdateId: 0 };
  }
}

function saveSubscribers(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

module.exports = { loadSubscribers, saveSubscribers };