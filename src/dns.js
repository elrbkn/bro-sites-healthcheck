const dns = require("dns");

/**
 * Быстро проверяет, что домен вообще резолвится, до того как тратить время
 * на полную загрузку страницы в браузере через прокси. Резолвинг идёт
 * средствами самого раннера (не через SOAX) — это независимый от прокси
 * сигнал "домен вообще существует/настроен".
 */
function resolveDns(hostname, timeoutMs = 5000) {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      resolve({ ok: false, error: `DNS: таймаут резолвинга домена (${timeoutMs}мс)` });
    }, timeoutMs);

    dns.lookup(hostname, (err, address) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (err) {
        resolve({ ok: false, error: `DNS: не удалось резолвить домен (${err.code || err.message})` });
      } else {
        resolve({ ok: true, addresses: [address] });
      }
    });
  });
}

module.exports = { resolveDns };