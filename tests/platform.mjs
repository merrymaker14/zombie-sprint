/* Обязательства перед площадками на подделанных SDK.
 *
 *   node tests/platform.mjs --url=http://localhost:5173/
 *
 * За каждым пунктом — правило площадки или чужой отказ:
 *   · CrazyGames: звук глушится по НАЧАЛУ ролика (adStarted), а не по запросу,
 *     и возвращается после; под роликом игра стоит и не принимает ввод,
 *     клавиатуру в том числе;
 *   · CrazyGames: кнопка звука площадки главнее клавиши M, и её события не
 *     снимают выключение, сделанное игроком; индикатор совпадает со звуком;
 *   · язык игрока берётся у площадки, если игрок не выбирал его сам;
 *   · Яндекс game_api_pause и GameDistribution SDK_GAME_PAUSE: тишина, пауза, ввод стоит;
 *   · разметка gameplayStart/gameplayStop по состояниям;
 *   · M работает в русской раскладке, выбор звука переживает перезапуск.
 */
import {
  arg, attachMeter, failures, finishAll, gesture, launch, level, ok, openGame,
  pressCyrillicM, sdkLog, sleep, startRace, state, waitState,
} from './harness.mjs';

const BASE = arg('url', 'http://localhost:5173/');
const LOUD = 0.004;     // музыка меню даёт 0.03–0.1
const QUIET = 0.0015;

const browser = await launch();
const allErrors = [];

const text = (page, sel) => page.evaluate((s) => (document.querySelector(s)?.textContent || '').trim(), sel);
/** Привести звук игрока во «включено», чтобы следующие проверки не зависели от предыдущих. */
const soundOn = async (page) => { if (await page.evaluate(() => window.__zombieSprint.audio.muted)) await page.keyboard.press('KeyM'); };
const indicator = (page) => page.evaluate(() => document.querySelector('.mute-indicator')?.classList.contains('visible') === true);

/* ============================ CrazyGames ============================ */
console.log('--- CrazyGames ---');
{
  const { page, errors, context } = await openGame(browser, BASE, { platform: 'crazy', cfg: { locale: 'ru-RU' } });
  await page.waitForFunction(() => (window.__sdkLog || []).some((e) => e.n === 'init'), null, { timeout: 20000 });
  await sleep(600);

  const lang = await page.evaluate(() => ({ html: document.documentElement.lang, saved: localStorage.getItem('zs_language') }));
  ok('язык взят из locale CrazyGames (ru-RU → ru)', lang.html === 'ru', JSON.stringify(lang));
  ok('язык площадки не записан как выбор игрока', lang.saved === null, JSON.stringify(lang));

  await gesture(page);
  await attachMeter(page);
  ok('в меню играет музыка', (await level(page)) > LOUD);

  /* Кнопка звука площадки против клавиши M. */
  await page.evaluate(() => window.__cgSettings({ muteAudio: true, disableChat: false }));
  ok('muteAudio площадки глушит звук', (await level(page)) < QUIET);
  await page.keyboard.press('KeyM');
  ok('M не включает звук, выключенный площадкой', (await level(page)) < QUIET);
  await page.keyboard.press('KeyM');
  await page.evaluate(() => window.__cgSettings({ muteAudio: false, disableChat: false }));
  ok('площадка вернула звук — звук есть', (await level(page)) > LOUD);
  await page.keyboard.press('KeyM');
  ok('M выключил звук, индикатор виден', (await level(page)) < QUIET && (await indicator(page)));
  await page.evaluate(() => window.__cgSettings({ muteAudio: false, disableChat: true }));
  const afterSettings = await level(page);
  ok('событие настроек площадки не снимает выключение игроком', afterSettings < QUIET, 'rms ' + afterSettings);
  ok('индикатор совпадает со звуком после события площадки', (await indicator(page)) === true);
  await pressCyrillicM(page);
  ok('M в русской раскладке (ь / KeyM) включает звук', (await level(page)) > LOUD && !(await indicator(page)));
  await pressCyrillicM(page);
  ok('M в русской раскладке выключает звук', (await level(page)) < QUIET && (await indicator(page)));

  /* Выбор игрока переживает перезапуск. */
  await page.reload({ waitUntil: 'load' });
  await waitState(page, 'title');
  await gesture(page);
  await attachMeter(page);
  await sleep(400);
  const persisted = await level(page);
  ok('выключенный игроком звук остаётся выключенным после перезапуска', persisted < QUIET && (await indicator(page)), 'rms ' + persisted);
  await page.keyboard.press('KeyM');
  ok('после перезапуска M снова включает звук', (await level(page)) > LOUD);

  /* Разметка геймплея. */
  const log0 = (await sdkLog(page)).length;
  await startRace(page);
  await waitState(page, 'racing');
  let log = (await sdkLog(page)).slice(log0);
  ok('gameplayStart на старте заезда', log.includes('gameplayStart'), log.join(' '));
  await page.keyboard.down('ArrowUp');
  await sleep(1500);
  await page.keyboard.press('Escape');
  await sleep(700);
  const enginesPaused = await level(page, 600, 'engines');
  ok('пауза: gameplayStop', (await sdkLog(page)).filter((n) => n.startsWith('gameplay')).at(-1) === 'gameplayStop');
  ok('на паузе моторы замолкают', enginesPaused < 0.01, 'engines rms ' + enginesPaused);
  await page.keyboard.press('Escape');
  await sleep(1200);
  ok('после паузы моторы снова слышны', (await level(page, 600, 'engines')) > 0.01);
  await page.keyboard.up('ArrowUp');

  /* Межстраничная по настоящему пути: вторая гонка, 185 с спустя. */
  await soundOn(page);
  await finishAll(page);
  await waitState(page, 'results', 15000);
  ok('после первой гонки рекламы нет', !(await sdkLog(page)).some((n) => n.startsWith('requestAd')));
  await page.evaluate(() => window.__zombieSprint.results.onRaceAgain());
  await waitState(page, 'racing');
  await page.evaluate(() => { window.__skew = 200000; });
  await sleep(800);
  await finishAll(page);
  await sleep(300);
  ok('после второй гонки запрошен midgame', (await sdkLog(page)).includes('requestAd:midgame'));
  ok('по запросу ролика (до adStarted) звук НЕ глушится', (await level(page, 500)) > LOUD);
  ok('на запрос ролика ушёл gameplayStop', (await sdkLog(page)).filter((n) => n.startsWith('gameplay')).at(-1) === 'gameplayStop');
  await sleep(2200);  // площадка грузит ролик; игра к этому времени ушла бы на итоги
  await page.keyboard.press('Enter');
  await sleep(700);
  const s1 = await state(page);
  ok('пока ролик грузится, Enter не запускает новый заезд', s1 !== 'loading' && s1 !== 'countdown' && s1 !== 'racing', 'state ' + s1);

  await page.evaluate(() => window.__cgAd('adStarted'));
  await sleep(350);
  const under = await level(page, 700);
  ok('adStarted: звук заглушён', under < QUIET, 'rms ' + under);
  const mutedBefore = await page.evaluate(() => window.__zombieSprint.audio.muted);
  await page.keyboard.press('KeyM');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Space');
  await sleep(600);
  const s2 = await state(page);
  ok('под роликом клавиатура не двигает игру', s2 !== 'loading' && s2 !== 'countdown' && s2 !== 'racing', 'state ' + s2);
  ok('под роликом M не переключает звук', (await page.evaluate(() => window.__zombieSprint.audio.muted)) === mutedBefore);
  await page.mouse.click(640, 520);
  await sleep(500);
  const s3 = await state(page);
  ok('под роликом клик не запускает заезд', s3 !== 'loading' && s3 !== 'countdown' && s3 !== 'racing', 'state ' + s3);

  await page.evaluate(() => window.__cgAd('adFinished'));
  await sleep(500);
  ok('adFinished: звук вернулся', (await level(page, 700)) > LOUD);
  ok('adFinished: класс ad-busy снят', !(await page.evaluate(() => document.body.classList.contains('ad-busy'))));
  await waitState(page, 'results', 10000).catch(() => {});
  ok('после ролика игрок видит итоги', (await state(page)) === 'results', 'state ' + (await state(page)));
  log = await sdkLog(page);
  ok('на итогах после ролика нет gameplayStart', log.filter((n) => n.startsWith('gameplay')).at(-1) !== 'gameplayStart', log.slice(-4).join(' '));

  allErrors.push(...errors.map((e) => 'crazy: ' + e));
  await context.close();
}

/* ============================ Яндекс ============================ */
console.log('--- Яндекс Игры ---');
{
  const { page, errors, context } = await openGame(browser, BASE, { platform: 'yandex', cfg: { lang: 'en' } });
  await page.waitForFunction(() => (window.__sdkLog || []).some((e) => e.n === 'YaGames.init'), null, { timeout: 20000 });
  await sleep(600);
  ok('язык взят из environment.i18n.lang (en)', (await page.evaluate(() => document.documentElement.lang)) === 'en',
    await text(page, '.press-start-text'));

  await gesture(page);
  await attachMeter(page);
  await startRace(page);
  await waitState(page, 'racing');
  await page.keyboard.down('ArrowUp');
  await sleep(1200);
  await page.evaluate(() => window.__yaFire('game_api_pause'));
  await sleep(400);
  const t0 = await page.evaluate(() => window.__zombieSprint.race.raceManager.raceTime);
  await sleep(1000);
  const t1 = await page.evaluate(() => window.__zombieSprint.race.raceManager.raceTime);
  ok('game_api_pause: игра встаёт на паузу', (await state(page)) === 'paused', 'state ' + (await state(page)));
  ok('game_api_pause: время гонки стоит', Math.abs(t1 - t0) < 0.01, `${t0.toFixed(2)} → ${t1.toFixed(2)}`);
  const yaQuiet = await level(page, 700);
  ok('game_api_pause: звук заглушён', yaQuiet < QUIET, 'rms ' + yaQuiet);
  ok('game_api_pause: GameplayAPI.stop', (await sdkLog(page)).includes('GameplayAPI.stop'));
  await page.keyboard.press('Escape');
  await sleep(400);
  ok('под паузой площадки Escape не снимает паузу', (await state(page)) === 'paused');
  await page.keyboard.up('ArrowUp');
  const before = (await sdkLog(page)).length;
  await page.evaluate(() => window.__yaFire('game_api_resume'));
  await sleep(500);
  ok('game_api_resume: звук вернулся', (await level(page, 700)) > LOUD);
  ok('game_api_resume: игрок остаётся в меню паузы', (await state(page)) === 'paused', 'state ' + (await state(page)));
  ok('game_api_resume в меню паузы не шлёт GameplayAPI.start', !(await sdkLog(page)).slice(before).includes('GameplayAPI.start'), (await sdkLog(page)).slice(before).join(' '));
  allErrors.push(...errors.map((e) => 'yandex: ' + e));
  await context.close();
}
{
  /* Требование Яндекса 1.19: LoadingAPI.ready ровно тогда, когда меню стало доступно, в том числе
     при медленном SDK. Отказ модерации: меню открывалось сразу, а ready ждал YaGames.init(). */
  const { page, errors, context } = await openGame(browser, BASE, { platform: 'yandex', cfg: { lang: 'en', initDelay: 1500 } });
  await page.waitForFunction(() => (window.__sdkLog || []).some((e) => e.n === 'LoadingAPI.ready'), null, { timeout: 20000 });
  const r = await page.evaluate(() => ({ ready: window.__sdkLog.find((e) => e.n === 'LoadingAPI.ready'), menu: window.__firstInteractive }));
  ok('медленный SDK: меню не открывается раньше LoadingAPI.ready', r.menu !== null && r.ready.t >= r.menu - 20 && r.ready.t - r.menu <= 120 && r.ready.s === 'title',
    `меню ${Math.round(r.menu)} мс, ready ${r.ready.t} мс (${r.ready.s})`);
  allErrors.push(...errors.map((e) => 'yandex-slow: ' + e));
  await context.close();
}
{
  /* Выбор игрока сильнее подсказки площадки. */
  const { page, errors, context } = await openGame(browser, BASE, { platform: 'yandex', cfg: { lang: 'en' }, storage: { zs_language: 'ru' } });
  await page.waitForFunction(() => (window.__sdkLog || []).some((e) => e.n === 'YaGames.init'), null, { timeout: 20000 });
  await sleep(600);
  ok('язык, выбранный игроком, не перетирается площадкой', (await page.evaluate(() => document.documentElement.lang)) === 'ru');
  allErrors.push(...errors.map((e) => 'yandex-saved: ' + e));
  await context.close();
}

/* ============================ GameDistribution ============================ */
console.log('--- GameDistribution ---');
{
  const { page, errors, context } = await openGame(browser, BASE, { platform: 'gamedist' });
  await gesture(page);
  await attachMeter(page);
  ok('в меню играет музыка', (await level(page)) > LOUD);
  await page.evaluate(() => window.__gdFire('SDK_GAME_PAUSE'));
  await sleep(300);
  const gdQuiet = await level(page, 700);
  ok('SDK_GAME_PAUSE: звук заглушён', gdQuiet < QUIET, 'rms ' + gdQuiet);
  await page.keyboard.press('Enter');
  await sleep(500);
  ok('SDK_GAME_PAUSE: Enter не уводит с титула', (await state(page)) === 'title', 'state ' + (await state(page)));
  await page.evaluate(() => window.__gdFire('SDK_GAME_START'));
  await sleep(500);
  ok('SDK_GAME_START: звук вернулся', (await level(page, 700)) > LOUD);
  await page.keyboard.press('Enter');
  await sleep(500);
  ok('SDK_GAME_START: ввод снова работает', (await state(page)) === 'characterSelect', 'state ' + (await state(page)));
  allErrors.push(...errors.map((e) => 'gamedist: ' + e));
  await context.close();
}

await browser.close();
ok('без ошибок в консоли', allErrors.length === 0, allErrors.slice(0, 5).join(' | '));
if (failures()) { console.error(`\nплощадки: ${failures()} проверок не прошли`); process.exit(1); }
console.log('\nобязательства перед площадками соблюдены');
