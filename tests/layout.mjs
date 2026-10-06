/* Вёрстка на телефонах: ничего не накладывается, характеристики гонщиков видны.
 *
 *   node tests/layout.mjs --url=http://localhost:5173/
 *
 * Отказ ВК 29.09.2026: «элементы накладываются друг на друга» (плашка «звук
 * выключен» легла на заголовок паузы в приложении на Android) и «на мобильных
 * устройствах нет возможности посмотреть характеристики гонщиков». Там же в гонке
 * миникарта лежала на кнопках «Сила» и «Дрифт». Глазами на одном экране такое не
 * заметить, поэтому здесь обходятся все экраны на пяти размерах — от низкого окна
 * приложения ВК до компьютера, со звуком выключенным (кнопка меню в гонке тогда
 * шире на значок динамика), — и меряются пересечения прямоугольников тех блоков,
 * что не должны касаться.
 *
 * Отказ ВК 06.10.2026: «нет возврата в главное меню из игрового процесса». Кнопка
 * в гонке была 36 px высотой на телефоне и пропадала после финиша; здесь же
 * проверяется её размер и экран финиша, где она делит верх с надписью «ФИНИШ».
 */
import { arg, failures, launch, ok } from './harness.mjs';

const BASE = arg('url', 'http://localhost:5173/');
const LAYOUTS = [
  { name: 'приложение ВК', width: 780, height: 330, touch: true },
  { name: 'телефон 740×360', width: 740, height: 360, touch: true },
  { name: 'телефон 844×390', width: 844, height: 390, touch: true },
  { name: 'телефон 915×412', width: 915, height: 412, touch: true },
  { name: 'компьютер', width: 1000, height: 600, touch: false },
];
const CHECK = {
  title: ['.logo', '.zombie-joke', '.language-picker', '.sound-picker', '.press-start', '.controls-legend'],
  chars: ['.panel-chars .select-header', '.panel-chars .char-stats', '.panel-chars .select-footer', '.panel-chars .card-grid'],
  tracks: ['.panel-tracks .select-header', '.panel-tracks .card-grid', '.panel-tracks .select-footer'],
  race: ['.tc-pause', '.hud-item', '.hud-place .place-num', '.hud-topright', '.hud-minimap', '.hud-speed', '.tc-item', '.tc-drift', '.tc-brake', '.tc-steer'],
  finished: ['.tc-pause', '.hud-finish', '.hud-item', '.hud-place .place-num', '.hud-topright', '.hud-minimap', '.hud-speed'],
  pause: ['.screen.pause .panel-kicker', '.screen.pause .panel-title', '.screen.pause .actions', '.screen.pause .panel-hint'],
  results: ['.screen.results .panel-title', '.screen.results .results-sub', '.screen.results .results-record', '.screen.results .standings', '.screen.results .actions'],
};

const browser = await launch();
const errors = [];
for (const L of LAYOUTS) {
  console.log(`--- ${L.name} ---`);
  const ctx = await browser.newContext({ viewport: { width: L.width, height: L.height }, hasTouch: L.touch, isMobile: L.touch });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${L.name}: ${e.message}`));
  /* Звук выключен до старта: в гонке на кнопке меню появляется значок, она шире всего. */
  await page.addInitScript(() => { try { localStorage.setItem('zs_audio_muted', '1'); } catch (e) { /* нет хранилища */ } });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__zombieSprint && window.__zombieSprint.currentState === 'title', null, { timeout: 90000 });
  await page.waitForTimeout(1000);

  const audit = (screen) => page.evaluate((sels) => {
    const shown = (n) => {
      for (let p = n; p; p = p.parentElement) {
        const cs = getComputedStyle(p);
        if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) return false;
      }
      return true;
    };
    const boxes = [];
    for (const sel of sels) {
      for (const n of document.querySelectorAll(sel)) {
        const r = n.getBoundingClientRect();
        if (r.width < 2 || r.height < 2 || !shown(n)) continue;
        boxes.push({ sel, n, x: r.left, y: r.top, w: r.width, h: r.height });
      }
    }
    const out = [];
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      if (a.sel === b.sel || a.n.contains(b.n) || b.n.contains(a.n)) continue;
      const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (ix > 2 && iy > 2) out.push(`${a.sel} × ${b.sel} (${Math.round(ix)}×${Math.round(iy)})`);
    }
    for (const b of boxes) {
      if (b.x < -1 || b.y < -1 || b.x + b.w > innerWidth + 1 || b.y + b.h > innerHeight + 1) out.push(`${b.sel} за краем экрана`);
    }
    return out;
  }, CHECK[screen]);

  let hits = await audit('title');
  ok(`титул: ничего не накладывается`, hits.length === 0, hits.join('; '));

  await page.evaluate(() => window.__zombieSprint.mainMenu.goTo('characterSelect', false));
  await page.waitForTimeout(800);
  hits = await audit('chars');
  ok(`выбор гонщика: ничего не накладывается`, hits.length === 0, hits.join('; '));
  const stats = await page.evaluate(() => {
    const vis = (n) => !!n && getComputedStyle(n).display !== 'none' && n.getBoundingClientRect().height > 0;
    const inCards = [...document.querySelectorAll('.panel-chars .card .stats')].some(vis);
    const panel = document.querySelector('.panel-chars .char-stats');
    return { inCards, panel: vis(panel), rows: panel ? panel.querySelectorAll('.char-stats-row').length : 0 };
  });
  ok(`выбор гонщика: характеристики видны`, stats.inCards || (stats.panel && stats.rows === 5), JSON.stringify(stats));

  await page.evaluate(() => window.__zombieSprint.mainMenu.goTo('trackSelect', false));
  await page.waitForTimeout(800);
  hits = await audit('tracks');
  ok(`выбор трассы: ничего не накладывается`, hits.length === 0, hits.join('; '));

  await page.evaluate(() => { const g = window.__zombieSprint; g.startRace({ characterId: 'zippy', trackId: g.mainMenu.tracks[3].id, difficulty: 'normal', laps: 3 }); });
  await page.waitForFunction(() => window.__zombieSprint.currentState === 'racing', null, { timeout: 90000 });
  await page.waitForTimeout(1500);
  hits = await audit('race');
  ok(`гонка: ничего не накладывается`, hits.length === 0, hits.join('; '));
  /* Кнопка выхода в меню: на телефоне она была 36 px высотой — модерация ВК её не нашла. */
  const menuBtn = await page.evaluate(() => { const r = document.querySelector('.tc-pause').getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; });
  ok(`гонка: кнопка меню не меньше 44 px`, menuBtn.w >= 44 && menuBtn.h >= 44, JSON.stringify(menuBtn));

  await page.evaluate(() => window.__zombieSprint.pause());
  await page.waitForTimeout(500);
  hits = await audit('pause');
  ok(`пауза: ничего не накладывается`, hits.length === 0, hits.join('; '));

  await page.evaluate(() => window.__zombieSprint.resume());
  await page.waitForTimeout(1000);
  /* Игрок пересёк черту, соперники ещё едут: крупная надпись «ФИНИШ» и кнопка меню
     на одном экране. Надпись входит с увеличением — ждём, пока встанет на место. */
  await page.evaluate(() => {
    const rm = window.__zombieSprint.race.raceManager;
    rm.finish(rm.trackers.find((tr) => tr.kart.state.isPlayer));
  });
  await page.waitForFunction(() => window.__zombieSprint.currentState === 'finished', null, { timeout: 10000 });
  await page.waitForTimeout(1500);
  hits = await audit('finished');
  ok(`финиш: ничего не накладывается`, hits.length === 0, hits.join('; '));
  const finishExit = await page.evaluate(() => {
    const b = document.querySelector('.tc-pause');
    const r = b.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!top && (top === b || b.contains(top));
  });
  ok(`финиш: кнопка меню на экране и не перекрыта`, finishExit);

  await page.evaluate(() => {
    const rm = window.__zombieSprint.race.raceManager;
    for (const tr of rm.trackers) rm.finish(tr);
  });
  await page.waitForFunction(() => window.__zombieSprint.currentState === 'results', null, { timeout: 30000 });
  await page.waitForTimeout(1200);
  hits = await audit('results');
  ok(`итоги: ничего не накладывается`, hits.length === 0, hits.join('; '));
  await ctx.close();
}
await browser.close();
ok('без ошибок в консоли', errors.length === 0, errors.slice(0, 3).join(' | '));
if (failures()) { console.error(`\nвёрстка: ${failures()} проверок не прошли`); process.exit(1); }
console.log('\nна всех экранах ничего не накладывается, характеристики гонщиков видны');
