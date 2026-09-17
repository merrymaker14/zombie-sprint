/* Жизненный цикл игры вне площадки: вкладка, фокус, звук, загрузка.
 *
 *   node tests/lifecycle.mjs --url=http://localhost:5173/
 *
 *   · уход со вкладки глушит звук в любом состоянии и ставит гонку на паузу,
 *     возврат возвращает звук, но не гонку (Яндекс 1.3, VK Games);
 *   · фокус, ушедший во время загрузки трассы, не даёт гонке стартовать без игрока;
 *   · системно остановленный звук (iOS: звонок, блокировка) оживает от жеста;
 *   · после «Заново» моторы звучат по весу нового гонщика, на загрузке моторы молчат;
 *   · игрок не видит технических текстов ошибок, чужие ошибки не всплывают вовсе.
 */
import {
  arg, attachMeter, failures, gesture, launch, level, ok, openGame, setHidden, sleep, startRace, state, waitState,
} from './harness.mjs';

const BASE = arg('url', 'http://localhost:5173/');
const LOUD = 0.004;
const QUIET = 0.0015;
const browser = await launch();
const allErrors = [];

{
  const { page, errors, context } = await openGame(browser, BASE, { query: '?lang=ru' });
  await gesture(page);
  await attachMeter(page);
  ok('в меню играет музыка', (await level(page)) > LOUD);

  console.log('--- вкладка ---');
  await setHidden(page, true);
  const menuHidden = await level(page, 800);
  ok('скрытая вкладка в меню: тишина', menuHidden < QUIET, 'rms ' + menuHidden);
  await setHidden(page, false);
  ok('вкладка вернулась: музыка снова играет', (await level(page, 800, 'out', 600)) > LOUD);

  await startRace(page);
  await waitState(page, 'racing');
  await page.keyboard.down('ArrowUp');
  await sleep(1500);
  await setHidden(page, true);
  await sleep(200);
  ok('скрытая вкладка в гонке: пауза', (await state(page)) === 'paused', 'state ' + (await state(page)));
  const raceHidden = await level(page, 800);
  ok('скрытая вкладка в гонке: тишина', raceHidden < QUIET, 'rms ' + raceHidden);
  await setHidden(page, false);
  await page.keyboard.up('ArrowUp');
  ok('вкладка вернулась: звук есть, гонка на паузе',
    (await level(page, 800, 'out', 600)) > LOUD && (await state(page)) === 'paused');
  ok('на паузе моторы молчат', (await level(page, 600, 'engines')) < 0.01);

  console.log('--- голоса после «Заново» ---');
  await page.evaluate(() => { window.__voicesDuringLoading = -1; });
  await page.evaluate(() => window.__zombieSprint.pauseMenu.onRestart());
  await sleep(50);
  const loadingVoices = await page.evaluate(() => ({
    s: window.__zombieSprint.currentState,
    n: window.__zombieSprint.audio.engines.filter(Boolean).length,
  }));
  ok('на загрузке после «Заново» старых моторов нет', loadingVoices.s !== 'loading' || loadingVoices.n === 0, JSON.stringify(loadingVoices));
  await waitState(page, 'racing');
  await sleep(500);
  const voices = await page.evaluate(() => {
    const base = { light: 96, medium: 78, heavy: 62 };
    const g = window.__zombieSprint;
    return g.race.karts.map((k) => {
      const slot = g.audio.engines[k.state.id];
      return { id: k.state.id, want: base[k.state.character.weightClass], got: slot ? slot.voice.baseFreq : null };
    });
  });
  const wrong = voices.filter((v) => v.got !== v.want);
  ok('после «Заново» мотор каждого гонщика по его весу', wrong.length === 0, JSON.stringify(wrong));

  console.log('--- фокус во время загрузки ---');
  await page.keyboard.press('Escape');
  await waitState(page, 'paused', 5000);
  await page.evaluate(() => window.__zombieSprint.pauseMenu.onRestart());
  await waitState(page, 'loading', 5000);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.waitForFunction(() => !['loading'].includes(window.__zombieSprint.currentState), null, { timeout: 60000 });
  await sleep(1500);
  const afterBlur = await page.evaluate(() => ({ s: window.__zombieSprint.currentState, t: window.__zombieSprint.race.raceManager.raceTime }));
  ok('фокус ушёл на загрузке: гонка не стартует без игрока', afterBlur.s === 'paused', JSON.stringify(afterBlur));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));

  console.log('--- системная остановка звука ---');
  await page.evaluate(() => window.__zombieSprint.audio.ctx.suspend());
  await sleep(300);
  await page.mouse.click(8, 8);
  await sleep(600);
  const ctxState = await page.evaluate(() => window.__zombieSprint.audio.ctx.state);
  ok('после системной остановки звук оживает от клика', ctxState === 'running', ctxState);

  console.log('--- ошибки ---');
  await page.evaluate(() => {
    window.dispatchEvent(new ErrorEvent('error', { message: 'Script error.', filename: '' }));
    window.dispatchEvent(new ErrorEvent('error', { message: 'sdk is not defined', filename: 'https://sdk.example.com/sdk.js' }));
  });
  await sleep(300);
  ok('чужие ошибки не показываются игроку', (await page.evaluate(() => document.querySelectorAll('.toast').length)) === 0);
  await page.evaluate(() => { Promise.reject(new Error('No parent to post message')); });
  await sleep(400);
  const toasts = await page.evaluate(() => [...document.querySelectorAll('.toast')].map((t) => t.textContent));
  ok('своя ошибка: тост без технического текста и по-русски',
    toasts.length === 1 && !/Unhandled|No parent|Error|rejection/i.test(toasts[0]) && /[а-я]/i.test(toasts[0]), JSON.stringify(toasts));

  allErrors.push(...errors.filter((e) => !/No parent to post message|sdk is not defined|Script error/.test(e)));
  await context.close();
}

await browser.close();
ok('без ошибок в консоли', allErrors.length === 0, allErrors.slice(0, 5).join(' | '));
if (failures()) { console.error(`\nжизненный цикл: ${failures()} проверок не прошли`); process.exit(1); }
console.log('\nжизненный цикл в порядке');
