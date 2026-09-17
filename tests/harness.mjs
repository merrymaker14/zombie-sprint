/* Общее для браузерных проверок: запуск Chromium, страница «на площадке» с
 * подделанным SDK, замер звука на выходе движка.
 *
 * Площадку изображает хост вида crazy.localhost: Chrome резолвит *.localhost в
 * 127.0.0.1 сам, а offPlatform() такой хост локальным НЕ считает — значит,
 * драйвер поднимает SDK так же, как на живой площадке. Адрес SDK перехватывается
 * и отдаётся заглушка, которой тест управляет сам.
 */
import { createRequire } from 'module';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    const from = process.env.PLAYWRIGHT_FROM;
    if (!from) throw new Error('playwright не найден: установите его или укажите PLAYWRIGHT_FROM=<путь к package.json рядом с ним>');
    return createRequire(from)('playwright');
  }
}

export function arg(name, fallback = '') {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

export async function launch() {
  const { chromium } = await loadPlaywright();
  return chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
}

let failed = 0;
export function ok(name, cond, extra = '') {
  console.log((cond ? '  ✔ ' : '  ✗ ') + name + (extra ? '  — ' + extra : ''));
  if (!cond) failed++;
  return !!cond;
}
export const failures = () => failed;

/* ------------------------------------------------------------ SDK stubs */

const CRAZY_SDK = `
(function () {
  var cfg = window.__cgCfg || {};
  var log = window.__sdkLog = window.__sdkLog || [];
  function L(n) { var g = window.__zombieSprint; log.push({ n: n, t: Math.round(performance.now()), s: g ? g.currentState : null }); }
  window.__cg = { ads: [], settings: [] };
  window.CrazyGames = { SDK: {
    init: function () { L('init'); return new Promise(function (r) { setTimeout(r, cfg.initDelay || 100); }); },
    user: { systemInfo: { locale: cfg.locale || 'en-US' }, addAuthListener: function () {} },
    game: {
      settings: { muteAudio: !!cfg.muteAudio, disableChat: false },
      addSettingsChangeListener: function (f) { window.__cg.settings.push(f); },
      loadingStart: function () { L('loadingStart'); }, loadingStop: function () { L('loadingStop'); },
      gameplayStart: function () { L('gameplayStart'); }, gameplayStop: function () { L('gameplayStop'); },
      happytime: function () {}
    },
    ad: { requestAd: function (type, cb) { L('requestAd:' + type); window.__cg.ads.push(cb); } },
    banner: { requestResponsiveBanner: function () { L('requestBanner'); return Promise.resolve(); } },
    data: { getItem: function () { return null; }, setItem: function () {}, removeItem: function () {} }
  } };
  window.__cgSettings = function (v) { window.__cg.settings.forEach(function (f) { f(v); }); };
  window.__cgAd = function (what) { var cb = window.__cg.ads[window.__cg.ads.length - 1]; L('ad:' + what); cb && cb[what] && cb[what](); };
})();`;

const YANDEX_SDK = `
(function () {
  var cfg = window.__yaCfg || {};
  var log = window.__sdkLog = window.__sdkLog || [];
  function L(n) { var g = window.__zombieSprint; log.push({ n: n, t: Math.round(performance.now()), s: g ? g.currentState : null }); }
  var on = {};
  var ysdk = {
    environment: { i18n: { lang: cfg.lang || 'ru' } },
    getFlags: function () { return Promise.resolve({}); },
    on: function (n, f) { (on[n] = on[n] || []).push(f); },
    features: {
      LoadingAPI: { ready: function () { L('LoadingAPI.ready'); } },
      GameplayAPI: { start: function () { L('GameplayAPI.start'); }, stop: function () { L('GameplayAPI.stop'); } }
    },
    adv: {
      showFullscreenAdv: function (o) { L('showFullscreenAdv'); window.__yaAdCb = o.callbacks || {}; },
      showBannerAdv: function () { L('showBannerAdv'); return Promise.resolve({ stickyAdvIsShowing: true }); },
      hideBannerAdv: function () { L('hideBannerAdv'); return Promise.resolve({}); }
    }
  };
  window.__yaFire = function (n) { L(n); (on[n] || []).forEach(function (f) { f(); }); };
  // initDelay: a real SDK answers YaGames.init() only after a round trip to the host page.
  window.YaGames = { init: function () { L('YaGames.init'); return new Promise(function (res) { setTimeout(function () { res(ysdk); }, cfg.initDelay || 0); }); } };
})();`;

const GD_SDK = `
(function () {
  var log = window.__sdkLog = window.__sdkLog || [];
  function L(n) { var g = window.__zombieSprint; log.push({ n: n, t: Math.round(performance.now()), s: g ? g.currentState : null }); }
  window.gdsdk = {
    preloadAd: function () { return Promise.resolve(); },
    showAd: function (type) { L('showAd:' + (type || 'interstitial')); return new Promise(function (res) { window.__gdResolve = res; }); }
  };
  window.__gdFire = function (n) { L(n); window.GD_OPTIONS.onEvent({ name: n }); };
  setTimeout(function () { window.GD_OPTIONS.onEvent({ name: 'SDK_READY' }); }, 0);
})();`;

const PLATFORMS = {
  crazy: { url: 'https://sdk.crazygames.com/crazygames-sdk-v3.js', body: CRAZY_SDK, cfg: '__cgCfg' },
  yandex: { url: 'https://yandex.ru/games/sdk/v2', body: YANDEX_SDK, cfg: '__yaCfg' },
  gamedist: { url: 'https://html5.api.gamedistribution.com/main.min.js', body: GD_SDK, cfg: '__gdCfg' },
};

/**
 * Открыть игру.
 *   platform  'crazy' | 'yandex' | 'gamedist' | null (без площадки, localhost)
 *   head      true — сборка сама объявляет площадку в <head> (dist-*), init-скрипт её не ставит
 */
export async function openGame(browser, base, { platform = null, cfg = {}, storage = null, head = false, query = '' } = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    if (/GL Driver Message|WebSocket|\[vite\]|favicon/i.test(text)) return;
    errors.push('console.error: ' + text);
  });
  const p = platform ? PLATFORMS[platform] : null;
  await page.addInitScript(({ platform, p, cfg, storage, head }) => {
    if (platform && !head) {
      window.__PLATFORM__ = platform;
      window.__SDK_URL = p.url;
      if (platform === 'gamedist') window.GD_OPTIONS = { gameId: 'test', onEvent: function () {} };
    }
    if (p) window[p.cfg] = cfg;
    if (storage && !sessionStorage.getItem('__seeded')) {
      sessionStorage.setItem('__seeded', '1');
      for (const [k, v] of Object.entries(storage)) localStorage.setItem(k, v);
    }
    // First moment the menu is on screen and usable (checked every frame from page start).
    window.__firstInteractive = null;
    const watchMenu = () => {
      const g = window.__zombieSprint;
      if (g && g.currentState === 'title' && !document.querySelector('.boot-splash')) window.__firstInteractive = performance.now();
      else requestAnimationFrame(watchMenu);
    };
    requestAnimationFrame(watchMenu);
    const realNow = Date.now.bind(Date);
    window.__skew = 0;
    Date.now = () => realNow() + window.__skew;
  }, { platform, p, cfg, storage, head });
  if (p) await page.route(p.url + '**', (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: p.body }));
  const host = platform ? `${platform}.localhost` : 'localhost';
  const url = base.replace('://localhost', '://' + host) + query;
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__zombieSprint && window.__zombieSprint.currentState === 'title', null, { timeout: 90000 });
  return { context, page, errors, url };
}

export const state = (page) => page.evaluate(() => window.__zombieSprint.currentState);
export const waitState = (page, s, timeout = 90000) =>
  page.waitForFunction((x) => window.__zombieSprint.currentState === x, s, { timeout });
export const sdkLog = (page) => page.evaluate(() => (window.__sdkLog || []).map((e) => e.n));

/** Жест, который ничего не делает в меню: запускает звук, как первый клик игрока. */
export async function gesture(page) {
  await page.keyboard.press('ShiftLeft');
  await page.waitForFunction(() => window.__zombieSprint.audio.ready, null, { timeout: 15000 });
  await sleep(1200);   // музыка входит плавно
}

/** Анализаторы на выходе движка и на шине моторов. */
export async function attachMeter(page) {
  await page.evaluate(() => {
    const a = window.__zombieSprint.audio;
    const mk = (node) => { const an = a.ctx.createAnalyser(); an.fftSize = 2048; node.connect(an); return an; };
    const buf = new Float32Array(2048);
    const rms = (an) => { an.getFloatTimeDomainData(buf); let s = 0; for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i]; return Math.sqrt(s / buf.length); };
    const an = { out: mk(a.limiter), engines: mk(a.enginesClip) };
    /* Остановленный контекст ничего не выводит, но анализатор отдаёт последний
       буфер. Поэтому «слышно» считаем только у работающего контекста. */
    window.__level = (ms, bus = 'out') => new Promise((res) => {
      let peak = 0; const t0 = performance.now();
      const id = setInterval(() => {
        const running = a.ctx && a.ctx.state === 'running';
        peak = Math.max(peak, running ? rms(an[bus]) : 0);
        if (performance.now() - t0 >= ms) { clearInterval(id); res(+peak.toFixed(4)); }
      }, 30);
    });
  });
}
/** Пиковый уровень за окно ms. Перед замером ждём settle: громкость меняется плавно. */
export async function level(page, ms = 600, bus = 'out', settle = 350) {
  await sleep(settle);
  return page.evaluate(([ms, bus]) => window.__level(ms, bus), [ms, bus]);
}

/** Поставить гонку через меню игры (как «Старт» на выборе трассы). */
export async function startRace(page) {
  await page.evaluate(() => {
    const g = window.__zombieSprint;
    const tr = g.mainMenu.tracks[0];
    g.startRace({ characterId: 'zippy', trackId: tr.id, difficulty: 'normal', laps: 3 });
  });
}

/** Финиш всех картов через настоящий RaceManager: игрок первым. */
export async function finishAll(page) {
  await page.evaluate(() => {
    const rm = window.__zombieSprint.race.raceManager;
    const trs = rm.trackers.slice().sort((a, b) => (b.kart.state.isPlayer ? 1 : 0) - (a.kart.state.isPlayer ? 1 : 0));
    for (const tr of trs) rm.finish(tr);
  });
}

/** Настоящее нажатие клавиши в русской раскладке: символ 'ь' на физической M. */
export async function pressCyrillicM(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'ь', code: 'KeyM', windowsVirtualKeyCode: 77 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'char', key: 'ь', text: 'ь', code: 'KeyM', windowsVirtualKeyCode: 77 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ь', code: 'KeyM', windowsVirtualKeyCode: 77 });
  await cdp.detach();
}

/** Эмуляция ухода со вкладки: headless не переводит видимость сам. */
export async function setHidden(page, hidden) {
  await page.evaluate((hidden) => {
    Object.defineProperty(document, 'hidden', { value: hidden, configurable: true });
    Object.defineProperty(document, 'visibilityState', { value: hidden ? 'hidden' : 'visible', configurable: true });
    if (hidden) window.dispatchEvent(new Event('blur'));
    document.dispatchEvent(new Event('visibilitychange'));
    if (!hidden) window.dispatchEvent(new Event('focus'));
  }, hidden);
}
