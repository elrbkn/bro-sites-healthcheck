// Список сайтов для проверки.
// name - человекочитаемое имя (будет в отчёте)
// url  - адрес для открытия (если протокол не указан, автоматически подставляется https://)

module.exports = [
  { name: "App Heroes", url: "https://appsheroes.store/", expectedText: ["ЗАПУСТИ ТРАФИК НА IOS, ANDROID и PWA"] },
  { name: "Research", url: "http://igamingresearch.ru", expectedText: ["Research by CPA BRO"] },
  { name: "Digitalbosses", url: "http://digitalbosses.ru/", expectedText: ["BlackMedia"] },
  { name: "Say Play", url: "http://sayplay.ru/", expectedText: ["ЗАБРОНИРОВАТЬ"] },
  { name: "Insider", url: "http://ignews.com/", expectedText: ["igaming insider"] },
  { name: "BRO agency", url: "https://broagency.io/", expectedText: ["START WITH US"] },
  { name: "AI Tech", url: "http://aitechmedia.co/", expectedText: ["AI TECH MEDIA"] },
  { name: "Press Aff com", url: "http://pressaff.com/", expectedText: ["Каталог ПП", "Глоссарий"] },
  { name: "Press Aff ru", url: "http://pressaff.ru/", expectedText: ["Статьи", "СММ"] },
  { name: "Портал Chocopay", url: "https://portal.chocopay.io/", expectedText: ["Виртуальные карты иностранных банков"] },
  { name: "Личный кабинет Chocopay", url: "cabinet.chocopay.io", expectedText: ["Почта", "Пароль"], allowDomainChange: true },
  { name: "Личный кабинет Bratik", url: "http://cabinet.bratik.club/", expectedText: ["Введите email и пароль"] },
  { name: "Портал CPA Bro", url: "cpabro.vip", expectedText: ["CPA BRO", "LOG IN"] },
  { name: "Личный кабинет CPA Bro", url: "cabinet.h1m1.space", expectedText: ["cpabro.vip", "Войти"] },
  { name: "l1l.pw линка", url: "https://l1l.pw/1j2qrjt", allowDomainChange: true },
];
