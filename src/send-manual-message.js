const { config } = require("./config");
const { loadSubscribers } = require("./subscribers");
const { broadcastTelegramMessage } = require("./telegram");

// node src/send-manual-message.js "текст сообщения"
const messageText = process.argv[2];
if (!messageText) {
  console.error('Использование: node src/send-manual-message.js "текст сообщения"');
  process.exit(1);
}

(async () => {
  if (!config.telegram.botToken) {
    console.error("TELEGRAM_BOT_TOKEN не задан");
    process.exit(1);
  }

  const { chatIds } = loadSubscribers(config.notify.subscribersFilePath);

  const recipients = [
    ...new Set([...chatIds.map(String), ...(config.telegram.chatId ? [String(config.telegram.chatId)] : [])]),
  ];

  if (recipients.length === 0) {
    console.warn("⚠️ Список получателей пуст — сообщение не отправлено");
    return;
  }

  const text = `<b>ℹ️ Уведомление от команды</b>\n\n${messageText}`;
  console.log(`Рассылаем сообщение ${recipients.length} получателям...`);

  const results = await broadcastTelegramMessage(text, recipients);
  const failed = results.filter((r) => !r.ok);
  console.log(`✅ Разослано ${results.length - failed.length}/${results.length}.`);
  for (const f of failed) {
    console.error(`❌ Не удалось отправить ${f.chatId}: ${f.error}`);
  }
})();