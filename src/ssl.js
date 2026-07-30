const tls = require("tls");

const SSL_WARNING_DAYS = 7;

function checkSsl(hostname, port = 443, timeoutMs = 8000) {
  return new Promise((resolve) => {
    let settled = false;
    const socket = tls.connect(
      { host: hostname, port, servername: hostname, timeout: timeoutMs, rejectUnauthorized: false },
      () => {
        if (settled) return;
        settled = true;
        const cert = socket.getPeerCertificate();
        const authorized = socket.authorized;
        const authError = socket.authorizationError;
        socket.end();

        if (!cert || !cert.valid_to) {
          return resolve({ ok: false, error: "Не удалось получить сертификат" });
        }

        const validTo = new Date(cert.valid_to);
        const daysLeft = Math.floor((validTo.getTime() - Date.now()) / 86400000);

        if (!authorized) {
          return resolve({
            ok: false,
            error: `Сертификат недействителен: ${authError || "unknown"}`,
            daysLeft,
            validTo: cert.valid_to,
          });
        }

        if (daysLeft < 0) {
          return resolve({
            ok: false,
            error: `Сертификат истёк ${Math.abs(daysLeft)} дн. назад`,
            daysLeft,
            validTo: cert.valid_to,
          });
        }

        resolve({
          ok: true,
          daysLeft,
          validTo: cert.valid_to,
          warning: daysLeft < SSL_WARNING_DAYS,
          authorized,
        });
      }
    );

    socket.on("error", (err) => {
      if (settled) return;
      settled = true;
      resolve({ ok: false, error: `Ошибка TLS-соединения: ${err.message}` });
    });

    socket.on("timeout", () => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ ok: false, error: "Таймаут TLS-соединения" });
    });
  });
}

module.exports = { checkSsl, SSL_WARNING_DAYS };