const crypto = require("crypto");
const { config } = require("./config");

/**
 * Формирует логин для SOAX прокси вида:
 *   package-346398-country-de-sessionid-XXXXXXXX-opt-lookalike
 * (страна и, опционально, sessionid для получения нового IP из пула DE)
 */
function buildLogin() {
  const { loginPrefix, loginSuffix, country, rotateSession } = config.soax;
  let login = `${loginPrefix}-${country}`;

  if (rotateSession) {
    const sessionId = crypto.randomBytes(4).toString("hex");
    login += `-sessionid-${sessionId}`;
  }

  login += `-${loginSuffix}`;
  return login;
}

/**
 * Возвращает объект proxy, пригодный для playwright browser.newContext({ proxy })
 */
function getProxyConfig() {
  const { host, port, password } = config.soax;
  return {
    server: `http://${host}:${port}`,
    username: buildLogin(),
    password,
  };
}

module.exports = { getProxyConfig, buildLogin };
