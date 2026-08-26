const axios = require("axios");
const { HttpsProxyAgent } = require("https-proxy-agent");
const { config } = require("./config");

const TELEGRAM_MESSAGE_LIMIT = 4096;

function buildAxiosClient() {
  const opts = {};
  if (config.telegram.proxyUrl) {
    const agent = new HttpsProxyAgent(config.telegram.proxyUrl);
    opts.httpAgent = agent;
    opts.httpsAgent = agent;
  }
  return axios.create(opts);
}

function splitMessage(text, limit = TELEGRAM_MESSAGE_LIMIT) {
  if (text.length <= limit) return [text];

  const chunks = [];
  let current = "";
  for (const line of text.split("\n")) {
    if ((current + line + "\n").length > limit) {
      chunks.push(current);
      current = "";
    }
    current += line + "\n";
  }
  if (current) chunks.push(current);
  return chunks;
}

/**
 * Отправляет текстовое сообщение в конкретный Telegram-чат, разбивая на части при необходимости.
 * @param {string} text
 * @param {number|string} chatId — если не передан, используется TELEGRAM_CHAT_ID из .env (обратная совместимость).
 */
async function sendTelegramMessage(text, chatId = config.telegram.chatId) {
  const client = buildAxiosClient();
  const url = `https://api.telegram.org/bot${config.telegram.botToken}/sendMessage`;
  const chunks = splitMessage(text);

  for (const chunk of chunks) {
    await client.post(url, {
      chat_id: chatId,
      text: chunk,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    });
  }
}

/**
 * Рассылает одно и то же сообщение списку получателей. Ошибка у одного
 * получателя (например, заблокировал бота) не мешает отправке остальным.
 * @returns {Promise<Array<{chatId, ok: boolean, error?: string}>>}
 */
async function broadcastTelegramMessage(text, chatIds) {
  const results = [];
  for (const chatId of chatIds) {
    try {
      await sendTelegramMessage(text, chatId);
      results.push({ chatId, ok: true });
    } catch (err) {
      results.push({
        chatId,
        ok: false,
        error: err.response?.data?.description || err.message,
      });
    }
  }
  return results;
}

/**
 * Опрашивает Telegram на предмет новых сообщений с прошлого раза (getUpdates
 * с offset) и находит тех, кто прислал боту /start — это и есть новые
 * подписчики. offset сдвигает "курсор", чтобы Telegram не присылал одни и
 * те же обновления повторно при каждом запуске.
 * @param {number} sinceUpdateId — последний обработанный update_id (0 при первом запуске)
 * @returns {Promise<{newChatIds: Array<number>, maxUpdateId: number}>}
 */
async function fetchNewStarts(sinceUpdateId) {
  const client = buildAxiosClient();
  const url = `https://api.telegram.org/bot${config.telegram.botToken}/getUpdates`;
  const res = await client.get(url, {
    params: { offset: sinceUpdateId + 1, timeout: 0 },
  });

  const updates = res.data.result || [];
  const newChatIds = new Set();
  let maxUpdateId = sinceUpdateId;

  for (const upd of updates) {
    if (upd.update_id > maxUpdateId) maxUpdateId = upd.update_id;
    const msg = upd.message;
    const text = msg && msg.text ? msg.text.trim().toLowerCase() : "";
    if (text.startsWith("/start") && msg.chat && msg.chat.id != null) {
      newChatIds.add(msg.chat.id);
    }
  }

  return { newChatIds: [...newChatIds], maxUpdateId };
}

module.exports = { sendTelegramMessage, broadcastTelegramMessage, fetchNewStarts };