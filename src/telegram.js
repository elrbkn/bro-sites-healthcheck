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

async function sendTelegramMessage(text) {
  const client = buildAxiosClient();
  const url = `https://api.telegram.org/bot${config.telegram.botToken}/sendMessage`;
  const chunks = splitMessage(text);

  for (const chunk of chunks) {
    await client.post(url, {
      chat_id: config.telegram.chatId,
      text: chunk,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    });
  }
}

module.exports = { sendTelegramMessage };
