/* Перенос рекордов трасс между устройствами — правило ВК 2.3.8.
 *
 *   node tests/vk-sync.mjs        (нужна сборка: node tools/build-targets.mjs)
 *
 * Проверяем не наличие кода, а результат: рекорд, поставленный на одном
 * устройстве, должен появиться на другом. Поэтому здесь независимые браузерные
 * контексты с РАЗНЫМ localStorage и ОДНО общее хранилище на стороне сервера —
 * так же, как VK Storage общий для всех устройств игрока. Заглушка моста только
 * переадресует VKWebAppStorageGet/Set в это хранилище.
 *
 * Что обязано выполняться:
 *   · рекорды с первого устройства видны на втором — и в карточках трасс;
 *   · запись успевает уехать, даже если игру закрыли сразу после заезда;
 *   · возврат на ПЕРВОЕ устройство, когда облако отвечает с опозданием, не
 *     затирает рекорды второго, а поставленное в окне ожидания не пропадает;
 *   · новое устройство со слабым заездом до приезда облака не портит облачный рекорд;
 *   · молчащее облако не отменяет синхронизацию до конца сессии.
 */
import fs from 'fs';
import http from 'http';
import path from 'path';
import { loadPlaywright, sleep } from './harness.mjs';

const DIR = path.resolve('dist-vkok');
let fail = 0;
const ok = (name, cond, extra = '') => {
  console.log((cond ? '  ✔ ' : '  ✗ ') + name + (extra ? '  — ' + extra : ''));
  if (!cond) fail++;
};

if (!fs.existsSync(path.join(DIR, 'index.html'))) {
  console.error('нет dist-vkok — node tools/build-targets.mjs');
  process.exit(1);
}

/* Заглушка моста: всё, что игра говорит VK Storage, уходит на сервер теста.
   keepalive обязателен — иначе запрос, отправленный на выгрузке страницы,
   браузер отменит, и проверка «успели перед закрытием» ничего не измерит. */
const VK_STUB = `
window.__vkTest = { getFails: window.__vkTestFails || 0, getDelay: window.__vkTestGetDelay || 0 };
window.vkBridge = {
  send: function (name, params) {
    switch (name) {
      case 'VKWebAppInit': return Promise.resolve({ result: true });
      case 'VKWebAppGetConfig': return Promise.resolve({ insets: { top: 0, left: 0, right: 0, bottom: 0 } });
      case 'VKWebAppStorageGet':
        if (window.__vkTest.getFails > 0) { window.__vkTest.getFails--; return Promise.reject({ error_type: 'test' }); }
        return new Promise(function (res, rej) {
          setTimeout(function () {
            fetch('/__cloud/get?keys=' + encodeURIComponent((params.keys || []).join(',')))
              .then(function (r) { return r.json(); }).then(res, rej);
          }, window.__vkTest.getDelay);
        });
      case 'VKWebAppStorageSet':
        return fetch('/__cloud/set', { method: 'POST', keepalive: true,
          body: JSON.stringify({ key: params.key, value: params.value }) })
          .then(function () { return { result: true }; });
      default: return Promise.resolve({});
    }
  },
  subscribe: function () {}, unsubscribe: function () {},
  supports: function () { return true; }, isWebView: function () { return false; }
};
window.vkConnect = window.vkBridge;
`;

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const cloud = {};                       // общее хранилище «аккаунта игрока»

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
  if (rel === '__cloud/get') {
    const keys = (url.searchParams.get('keys') || '').split(',').filter(Boolean);
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ keys: keys.map((k) => ({ key: k, value: cloud[k] || '' })) }));
  }
  if (rel === '__cloud/set') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      try {
        const { key, value } = JSON.parse(body);
        if (value) cloud[key] = value; else delete cloud[key];
      } catch (e) { /* мусор от закрытой страницы — не беда */ }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"result":true}');
    });
    return undefined;
  }
  if (rel === 'libs/vk-bridge.min.js') {
    res.writeHead(200, { 'content-type': 'text/javascript' });
    return res.end(VK_STUB);
  }
  const file = path.join(DIR, rel);
  if (!file.startsWith(DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); return res.end('404');
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
  return fs.createReadStream(file).pipe(res);
}).listen(0);

const port = server.address().port;
/* Не localhost: драйверы площадок нарочно не поднимаются на нём. */
const URL_BASE = `http://game.test:${port}/`;
const launchParams = 'vk_app_id=54771434&vk_user_id=42&vk_platform=mobile_android&vk_language=ru';

const { chromium } = await loadPlaywright();
const browser = await chromium.launch({
  args: ['--host-resolver-rules=MAP game.test 127.0.0.1', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const errors = [];

async function openGame(ctx, { delay = 0, fails = 0 } = {}) {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  if (delay || fails) await page.addInitScript(`window.__vkTestGetDelay = ${delay}; window.__vkTestFails = ${fails};`);
  await page.goto(URL_BASE + '?' + launchParams);
  await page.waitForFunction(() => window.__zombieSprint && window.__zombieSprint.records, null, { timeout: 60000 });
  return page;
}

/** Окно ожидания облака закрылось. */
const cloudOpen = (page) => page.waitForFunction(() => window.__zombieSprint.records.cloudHold === false, null, { timeout: 45000 });
const saved = () => { try { return JSON.parse(JSON.parse(cloud.zs_records).v); } catch (e) { return null; } };
const cell = (s, track, d) => (s && s[track] && s[track][d]) || null;
const count = (s) => (s ? Object.values(s).reduce((n, row) => n + Object.keys(row).length, 0) : -1);
const submit = (page, track, d, place, time) =>
  page.evaluate(([tr, df, p, tm]) => window.__zombieSprint.records.submit(tr, df, p, tm), [track, d, place, time]);

/* ── 1. Устройство A: рекорды уезжают в облако, и уезжают ДО закрытия игры ── */
console.log('--- первое устройство ---');
const devA = await browser.newContext({ viewport: { width: 1280, height: 720 } });
{
  const page = await openGame(devA);
  await cloudOpen(page);
  await submit(page, 'sunny_circuit', 'normal', 1, 150.5);
  await submit(page, 'dune_drift', 'hard', 3, 200.25);
  await page.close();
  await sleep(1200);
  const s = saved();
  ok('рекорды уехали в облако при закрытии игры', count(s) === 2 && cell(s, 'sunny_circuit', 'normal')?.t === 150.5, JSON.stringify(s));
}

/* ── 2. Устройство B: чистый localStorage, рекорды приезжают из облака ── */
console.log('--- второе устройство ---');
const devB = await browser.newContext({ viewport: { width: 915, height: 412 }, isMobile: true, hasTouch: true });
{
  const page = await openGame(devB);
  const got = await page.waitForFunction(() => window.__zombieSprint.records.get('sunny_circuit', 'normal'), null, { timeout: 30000 })
    .then((h) => h.jsonValue()).catch(() => null);
  ok('на втором устройстве рекорд из облака', !!got && got.place === 1 && got.time === 150.5, JSON.stringify(got));
  const card = await page.evaluate(() => document.querySelector('.track-record')?.textContent || '');
  ok('рекорд виден в карточке трассы', /2:30\.500/.test(card), card);
  /* Играем дальше и уходим в фон, не закрывая игру: в приложении ВК так и бывает. */
  await cloudOpen(page);
  await submit(page, 'sunny_circuit', 'normal', 1, 140);
  await submit(page, 'frostbite_falls', 'easy', 2, 180);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await sleep(1200);
  const s = saved();
  ok('рекорды второго устройства уехали при сворачивании',
    count(s) === 3 && cell(s, 'sunny_circuit', 'normal')?.t === 140, JSON.stringify(s));
  await page.close();
}

/* ── 3. Возврат на устройство A: облако отвечает с опозданием ── */
console.log('--- возврат на первое устройство, облако запаздывает ---');
{
  const page = await openGame(devA, { delay: 3500 });
  /* Ставим рекорд сразу, не дожидаясь облака: именно так прогресс и терялся. */
  await submit(page, 'neon_nexus', 'normal', 4, 210);
  ok('пока облако в пути, запись ждёт его', await page.evaluate(() => window.__zombieSprint.records.cloudHold) === true);
  const got = await page.waitForFunction(() => {
    const r = window.__zombieSprint.records.get('frostbite_falls', 'easy');
    return r ? { frost: r, sunny: window.__zombieSprint.records.get('sunny_circuit', 'normal'), neon: window.__zombieSprint.records.get('neon_nexus', 'normal') } : false;
  }, null, { timeout: 30000 }).then((h) => h.jsonValue()).catch(() => null);
  ok('возврат подтянул рекорды второго устройства и не потерял свой',
    !!got && got.sunny.time === 140 && !!got.neon && got.neon.place === 4, JSON.stringify(got));
  await cloudOpen(page);
  await sleep(2500);
  const s = saved();
  ok('в облаке — слитые рекорды обоих устройств', count(s) === 4 && cell(s, 'sunny_circuit', 'normal')?.t === 140, JSON.stringify(s));
  await page.close();
}
await devA.close();
await devB.close();

/* ── 4. Новое устройство: слабый заезд до приезда облака ── */
console.log('--- новое устройство ---');
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await openGame(ctx, { delay: 3500 });
  await submit(page, 'sunny_circuit', 'normal', 5, 170);
  await sleep(300);
  ok('слабый заезд не ушёл в облако раньше облачного рекорда', cell(saved(), 'sunny_circuit', 'normal')?.t === 140);
  const got = await page.waitForFunction(() => {
    const r = window.__zombieSprint.records.get('sunny_circuit', 'normal');
    return r && r.time === 140 ? r : false;
  }, null, { timeout: 30000 }).then((h) => h.jsonValue()).catch(() => null);
  ok('новое устройство получило облачный рекорд', !!got && got.place === 1, JSON.stringify(got));
  await cloudOpen(page);
  await sleep(2500);
  const s = saved();
  ok('облачный рекорд остался лучшим', cell(s, 'sunny_circuit', 'normal')?.t === 140 && count(s) === 4, JSON.stringify(s));
  await ctx.close();
}

/* ── 5. Молчащее облако: чтение отказало, синхронизация обязана ожить ── */
console.log('--- облако не отвечает на чтение ---');
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await openGame(ctx, { fails: 3 });
  const opened = await cloudOpen(page).then(() => true).catch(() => false);
  ok('после отказов облака игра всё равно начинает писать в него', opened);
  await sleep(2500);
  /* Чтение не удалось — значит, у этого устройства нет ничего нового для облака, и
     пустая таблица не должна уехать поверх рекордов аккаунта. */
  ok('устройство без рекордов не затёрло облако после неудачного чтения', count(saved()) === 4, JSON.stringify(saved()));
  await submit(page, 'dune_drift', 'easy', 1, 99);
  await sleep(2500);
  ok('запись дошла до облака после неудачного чтения', !!cell(saved(), 'dune_drift', 'easy'), JSON.stringify(saved()));
  await ctx.close();
}

await browser.close();
server.close();

if (errors.length) { console.error('ошибки страницы: ' + errors.slice(0, 3).join(' | ')); fail++; }
console.log(fail ? `\n${fail} проверок переноса рекордов не прошли` : '\nперенос рекордов между устройствами работает');
process.exit(fail ? 1 : 0);
