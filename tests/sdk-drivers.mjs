/* Слой рекламы и бутстрап CrazyGames на НАСТОЯЩЕЙ сборке с подделанным SDK.
 *
 *   node tests/sdk-drivers.mjs [--dir=dist-crazy]     (нужна сборка: npm run build:targets)
 *
 * На площадку уезжает архив, а не dev-сервер: здесь в <head> стоят бутстрап и
 * адрес SDK ровно так, как их подставила сборка.
 *   · loadingStart уходит раньше loadingStop, а не в ту же миллисекунду;
 *   · SDK, поднявшийся позже титула, всё равно получает запрос баннера на титуле;
 *   · после ролика баннер возвращается на экран итогов;
 *   · ролик, стартовавший позже сторожа, снова останавливает игру и глушит звук.
 */
import fs from 'fs';
import http from 'http';
import path from 'path';
import {
  arg, attachMeter, failures, finishAll, gesture, launch, level, ok, openGame, sdkLog, sleep, state, waitState,
} from './harness.mjs';

const DIR = path.resolve(arg('dir', 'dist-crazy'));
if (!fs.existsSync(path.join(DIR, 'index.html'))) {
  console.error('нет ' + DIR + ' — сначала npm run build:targets');
  process.exit(1);
}
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const file = path.join(DIR, rel);
  if (!file.startsWith(DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  const send = () => {
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  };
  /* Бандл игры на площадке едет с CDN, а не с диска: без задержки SDK и игра
     стартуют в одну миллисекунду, и порядок загрузки не проверить. */
  if (rel.startsWith('assets/')) setTimeout(send, 700); else send();
}).listen(0);
const BASE = `http://localhost:${server.address().port}/`;
const LOUD = 0.004;
const QUIET = 0.0015;
const browser = await launch();
const allErrors = [];
const lastGameplay = async (page) => (await sdkLog(page)).filter((n) => n.startsWith('gameplay')).at(-1);
const bannerVisible = (page) => page.evaluate(() => {
  const b = document.getElementById('cg-banner');
  return !!b && b.style.display !== 'none';
});

console.log('--- разметка загрузки ---');
{
  const { page, errors, context } = await openGame(browser, BASE, { platform: 'crazy', head: true, cfg: { initDelay: 50 } });
  await page.waitForFunction(() => (window.__sdkLog || []).some((e) => e.n === 'loadingStop'), null, { timeout: 30000 });
  await sleep(500);
  const log = await page.evaluate(() => window.__sdkLog.slice());
  const starts = log.filter((e) => e.n === 'loadingStart');
  const stop = log.find((e) => e.n === 'loadingStop');
  ok('loadingStart отправлен ровно один раз', starts.length === 1, JSON.stringify(starts));
  ok('loadingStart уходит до появления игры, loadingStop — когда игра готова',
    starts.length === 1 && starts[0].s === null && stop && stop.s === 'title' && stop.t - starts[0].t > 50,
    JSON.stringify({ start: starts[0], stop }));
  allErrors.push(...errors);
  await context.close();
}

console.log('--- баннер при медленном SDK ---');
{
  const { page, errors, context } = await openGame(browser, BASE, { platform: 'crazy', head: true, cfg: { initDelay: 2500 } });
  await page.waitForFunction(() => (window.__sdkLog || []).some((e) => e.n === 'loadingStop'), null, { timeout: 30000 });
  await sleep(1500);
  const log = await page.evaluate(() => window.__sdkLog.slice());
  ok('SDK поднялся после титула — баннер на титуле всё равно запрошен',
    log.some((e) => e.n === 'requestBanner' && e.s === 'title') && (await bannerVisible(page)),
    log.map((e) => e.n + '@' + e.s).join(' '));
  allErrors.push(...errors);
  await context.close();
}

console.log('--- ролик на экране итогов ---');
{
  const { page, errors, context } = await openGame(browser, BASE, { platform: 'crazy', head: true });
  await page.waitForFunction(() => (window.__sdkLog || []).some((e) => e.n === 'loadingStop'), null, { timeout: 30000 });
  await gesture(page);
  await attachMeter(page);
  const race = async () => {
    await page.evaluate(() => {
      const g = window.__zombieSprint;
      if (g.currentState === 'results') g.results.onRaceAgain();
      else g.startRace({ characterId: 'zippy', trackId: g.mainMenu.tracks[0].id, difficulty: 'normal', laps: 3 });
    });
    await waitState(page, 'racing');
    await sleep(500);
  };
  await race();
  await finishAll(page);
  await waitState(page, 'results', 15000);
  await page.evaluate(() => { window.__skew = 200000; });
  await race();
  await finishAll(page);
  await sleep(300);
  await page.evaluate(() => window.__cgAd('adStarted'));
  await sleep(2500);
  ok('под роликом баннера нет', !(await bannerVisible(page)));
  await page.evaluate(() => window.__cgAd('adFinished'));
  await waitState(page, 'results', 10000).catch(() => {});
  await sleep(1000);
  ok('после ролика баннер вернулся на экран итогов', (await state(page)) === 'results' && (await bannerVisible(page)),
    'state ' + (await state(page)));

  console.log('--- ролик стартовал позже сторожа ---');
  await page.evaluate(() => { window.__skew = 400000; });
  await race();
  await finishAll(page);
  await sleep(300);
  ok('запрошен midgame', (await sdkLog(page)).filter((n) => n === 'requestAd:midgame').length === 2);
  await sleep(12800);   // сторож до начала показа — 12 с
  ok('сторож вернул управление', !(await page.evaluate(() => document.body.classList.contains('ad-busy'))));
  await waitState(page, 'results', 10000).catch(() => {});
  await race();
  ok('игрок снова в гонке, gameplayStart', (await lastGameplay(page)) === 'gameplayStart');
  await page.keyboard.down('ArrowUp');
  await page.evaluate(() => window.__cgAd('adStarted'));
  await sleep(300);
  const t0 = await page.evaluate(() => window.__zombieSprint.race.raceManager.raceTime);
  await sleep(800);
  const t1 = await page.evaluate(() => window.__zombieSprint.race.raceManager.raceTime);
  ok('поздний adStarted: игра снова стоит (ad-busy)', await page.evaluate(() => document.body.classList.contains('ad-busy')));
  ok('поздний adStarted: gameplayStop', (await lastGameplay(page)) === 'gameplayStop');
  ok('поздний adStarted: гонка не идёт', t1 === t0 && (await state(page)) === 'paused', `${t0} → ${t1}, ${await state(page)}`);
  const lateQuiet = await level(page, 700);
  ok('поздний adStarted: звук заглушён', lateQuiet < QUIET, 'rms ' + lateQuiet);
  await page.keyboard.up('ArrowUp');
  await page.evaluate(() => window.__cgAd('adFinished'));
  await sleep(300);
  ok('после позднего ролика: блокировка снята, звук есть',
    !(await page.evaluate(() => document.body.classList.contains('ad-busy'))) && (await level(page, 700)) > LOUD);
  ok('после позднего ролика игрок в меню паузы, а не в идущей гонке', (await state(page)) === 'paused');
  allErrors.push(...errors);
  await context.close();
}

await browser.close();
server.close();
ok('без ошибок в консоли', allErrors.length === 0, allErrors.slice(0, 5).join(' | '));
if (failures()) { console.error(`\nслой рекламы: ${failures()} проверок не прошли`); process.exit(1); }
console.log('\nслой рекламы в порядке');
