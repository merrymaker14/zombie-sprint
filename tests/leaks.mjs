/* Память видеокарты между гонками.
 *
 *   node tests/leaks.mjs --url=http://localhost:5173/
 *
 * Каждая трасса строит сотни геометрий и десятки текстур и обязана вернуть их все,
 * когда игрок уходит в меню. Здесь каждая трасса проезжается дважды (гонка →
 * пауза → главное меню): после второго круга счётчики three.js не должны вырасти.
 *
 * Мерим не наличие кода уборки, а итог: утечка, которую это ловит, сидела вне
 * кода трассы — three.js держит в общем материале теней карту последнего
 * отбрасывающего тень объекта, и меню заново загружало атлас пиктограмм, который
 * трасса только что освободила. Одна текстура 1024² на гонку по трём трассам из
 * четырёх — на телефоне это десятки мегабайт за вечер игры.
 */
import { arg, failures, launch, ok, openGame, sleep, waitState } from './harness.mjs';

const BASE = arg('url', 'http://localhost:5173/');
const browser = await launch();
const { page, errors, context } = await openGame(browser, BASE);
await waitState(page, 'title');

const counts = () => page.evaluate(() => {
  const info = window.__zombieSprint.renderer.info.memory;
  return { geo: info.geometries, tex: info.textures, children: window.__zombieSprint.scene.children.length };
});
const tracks = await page.evaluate(() => window.__zombieSprint.mainMenu.tracks.map((t) => t.id));

async function round() {
  for (const id of tracks) {
    await page.evaluate((tr) => window.__zombieSprint.startRace({ characterId: 'zippy', trackId: tr, difficulty: 'normal', laps: 3 }), id);
    await waitState(page, 'racing');
    await sleep(500);
    await page.evaluate(() => {
      const g = window.__zombieSprint;
      g.pause();
      g.leavePause();
      g.returnToMenu('title');
    });
    await sleep(400);
  }
  return counts();
}

console.log('--- гонка → меню по всем трассам, дважды ---');
const first = await round();
const second = await round();
console.log(`  после первого круга: ${JSON.stringify(first)}, после второго: ${JSON.stringify(second)}`);
ok('геометрии не копятся от гонки к гонке', second.geo <= first.geo, `${first.geo} → ${second.geo}`);
ok('текстуры не копятся от гонки к гонке', second.tex <= first.tex, `${first.tex} → ${second.tex}`);
ok('в сцене меню не остаётся объектов гонки', second.children === first.children, `${first.children} → ${second.children}`);
ok('без ошибок в консоли', errors.length === 0, errors.slice(0, 3).join(' | '));

await context.close();
await browser.close();
if (failures()) { console.error(`\nпамять: ${failures()} проверок не прошли`); process.exit(1); }
console.log('\nгонки не оставляют за собой память видеокарты');
