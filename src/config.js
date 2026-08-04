require("dotenv").config();

function bool(val, def) {
  if (val === undefined || val === "") return def;
  return String(val).toLowerCase() === "true";
}

function int(val, def) {
  const n = parseInt(val, 10);
  return Number.isFinite(n) ? n : def;
}

const config = {
  soax: {
    host: process.env.SOAX_HOST,
    port: process.env.SOAX_PORT,
    loginPrefix: process.env.SOAX_LOGIN_PREFIX,
    loginSuffix: process.env.SOAX_LOGIN_SUFFIX,
    password: process.env.SOAX_PASSWORD,
    country: (process.env.PROXY_COUNTRY || "de").toLowerCase(),
    rotateSession: bool(process.env.PROXY_ROTATE_SESSION, true),
  },
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    chatId: process.env.TELEGRAM_CHAT_ID,
    proxyUrl: process.env.TELEGRAM_PROXY_URL || "",
  },
  check: {
    pageTimeoutMs: int(process.env.PAGE_TIMEOUT_MS, 30000),
    retryCount: int(process.env.RETRY_COUNT, 1),
    concurrency: int(process.env.CONCURRENCY, 1),
    minContentLength: int(process.env.MIN_CONTENT_LENGTH, 50),
    mobileCheckEnabled: bool(process.env.MOBILE_CHECK_ENABLED, true),
  },
  notify: {
    stateFilePath: process.env.STATE_FILE_PATH || "state/last-status.json",
    dailySummaryHour: int(process.env.DAILY_SUMMARY_HOUR, 11),
    timezone: process.env.REPORT_TIMEZONE || "Europe/Riga",
  },
};

function validate() {
  const missing = [];
  if (!config.soax.host) missing.push("SOAX_HOST");
  if (!config.soax.port) missing.push("SOAX_PORT");
  if (!config.soax.loginPrefix) missing.push("SOAX_LOGIN_PREFIX");
  if (!config.soax.loginSuffix) missing.push("SOAX_LOGIN_SUFFIX");
  if (!config.soax.password) missing.push("SOAX_PASSWORD");
  if (!config.telegram.botToken) missing.push("TELEGRAM_BOT_TOKEN");
  if (!config.telegram.chatId) missing.push("TELEGRAM_CHAT_ID");

  if (missing.length) {
    throw new Error(
      `Не заданы обязательные переменные окружения: ${missing.join(", ")}. Проверьте файл .env`
    );
  }
}

module.exports = { config, validate };
