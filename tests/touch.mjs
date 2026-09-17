/* Игра на телефоне: меню тапами, экранные кнопки в гонке, мультитач, пауза, портрет.
 *
 *   node tests/touch.mjs --url=http://localhost:5190/
 *
 * Касания идут через CDP Input.dispatchTouchEvent — как настоящие пальцы:
 * браузер сам делает из них pointer-события с pointerType touch.
 */
import { arg, loadPlaywright, sleep } from './harness.mjs';

const URL = arg('url', 'http://localhost:5190/') + '?lang=ru';
const { chromium } = await loadPlaywright();
const results = [];
const ok = (name, cond, extra = '') => { results.push({ name, cond, extra }); };

{
  const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ viewport: { width: 740, height: 360 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__zombieSprint?.currentState === 'title', null, { timeout: 90000 });
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map((p, i) => ({ x: p[0], y: p[1], id: p[2] ?? i })) });
  const center = async (sel) => { const b = await page.locator(sel).first().boundingBox(); return b ? [b.x + b.width / 2, b.y + b.height / 2] : null; };
  const tapAt = async (pt) => { await touch('touchStart', [pt]); await sleep(60); await touch('touchEnd', []); };

  // Menu by taps.
  await tapAt([370, 300]);
  await sleep(900);
  const panel1 = await page.evaluate(() => window.__zombieSprint.mainMenu.panel);
  ok('тап по титулу открывает выбор гонщика', panel1 === 'characterSelect', panel1);
  const release = await center('[data-action="release-horde"]');
  ok('кнопка «Выпустить орду» видна на 740x360', !!release && release[1] < 360, JSON.stringify(release));
  if (release) await tapAt(release);
  await sleep(900);
  const panel2 = await page.evaluate(() => window.__zombieSprint.mainMenu.panel);
  ok('тап по «Выпустить орду» открывает выбор трассы', panel2 === 'trackSelect', panel2);
  const start = await center('[data-action="start-run"]');
  ok('кнопка старта видна', !!start && start[1] < 360, JSON.stringify(start));
  if (start) await tapAt(start);
  await page.waitForFunction(() => window.__zombieSprint.currentState === 'countdown', null, { timeout: 60000 });
  ok('тап по старту запускает гонку', true);

  const touchMode = await page.evaluate(() => document.documentElement.classList.contains('touch-mode'));
  ok('тач-режим включён', touchMode);
  const visible = await page.evaluate(() => getComputedStyle(document.querySelector('.touch-controls')).display !== 'none');
  ok('кнопки видны на отсчёте', visible);
  await sleep(1000);
  const cdThrottle = await page.evaluate(() => window.__zombieSprint.race.karts[0].input.throttle);
  ok('на отсчёте автогаза нет (нет фальстарта)', cdThrottle === 0, String(cdThrottle));
  await page.waitForFunction(() => window.__zombieSprint.currentState === 'racing', null, { timeout: 30000 });
  await sleep(1500);
  const steerPt = await page.locator('.tc-steer').boundingBox();
  const driftPt = await center('.tc-drift');
  const k0 = () => page.evaluate(() => { const k = window.__zombieSprint.race.karts[0]; return { speed: k.state.speed, heading: k.state.heading, steer: k.input.steer, drift: k.input.drift, throttle: k.input.throttle }; });
  const before = await k0();
  ok('автогаз в гонке разгоняет карт', before.speed > 3 && before.throttle === 1, JSON.stringify(before));
  // Steer right and hold drift at the same time (two fingers).
  await touch('touchStart', [[steerPt.x + steerPt.width * 0.8, steerPt.y + steerPt.height / 2, 1], [driftPt[0], driftPt[1], 2]]);
  await sleep(700);
  const during = await k0();
  ok('мультитач: руль вправо и дрифт одновременно', during.steer > 0.5 && during.drift === true, JSON.stringify(during));
  // Slide the steering finger to the left half without lifting.
  await touch('touchMove', [[steerPt.x + steerPt.width * 0.2, steerPt.y + steerPt.height / 2, 1], [driftPt[0], driftPt[1], 2]]);
  await sleep(500);
  const slid = await k0();
  ok('палец скользит на «влево» без отрыва', slid.steer < -0.5, JSON.stringify(slid));
  await touch('touchEnd', []);
  await sleep(300);
  const after = await k0();
  ok('отпустили — руль в центре, дрифт снят', Math.abs(after.steer) < 0.05 && after.drift === false, JSON.stringify(after));
  ok('карт повернул за время касаний', Math.abs(after.heading - before.heading) > 0.05, `${before.heading.toFixed(3)} → ${after.heading.toFixed(3)}`);

  const brakePt = await center('.tc-brake');
  await touch('touchStart', [[brakePt[0], brakePt[1], 3]]);
  await sleep(300);
  const braking = await k0();
  ok('тормоз снимает автогаз', braking.throttle === 0, JSON.stringify(braking));
  await touch('touchEnd', []);

  const pausePt = await center('.tc-pause');
  await tapAt(pausePt);
  await sleep(500);
  const st = await page.evaluate(() => window.__zombieSprint.currentState);
  ok('кнопка паузы ставит игру на паузу', st === 'paused', st);
  const hiddenOnPause = await page.evaluate(() => getComputedStyle(document.querySelector('.touch-controls')).display === 'none');
  ok('на паузе кнопки гонки скрыты', hiddenOnPause);

  await page.setViewportSize({ width: 360, height: 740 });
  await sleep(600);
  const rotate = await page.evaluate(() => getComputedStyle(document.querySelector('.rotate-device')).display !== 'none');
  ok('в портрете просьба повернуть устройство', rotate);
  ok('без ошибок в консоли', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
}
for (const r of results) console.log(`  ${r.cond ? '✔' : '✘'} ${r.name}${r.extra ? '  — ' + r.extra : ''}`);
const failed = results.filter((r) => !r.cond).length;
console.log(failed ? `\n${failed} проверок управления с телефона не прошли` : '\nуправление с телефона в порядке');
process.exit(failed ? 1 : 0);
