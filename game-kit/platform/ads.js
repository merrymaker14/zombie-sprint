/* Общий слой рекламы: то, что одинаково у всех площадок.
 *
 * Драйверы (drivers.js) знают только про свой SDK. Всё остальное — сторожа,
 * одноразовость ответа, пауза игры, баннер, сигнал готовности — живёт здесь и
 * не должно писаться заново в каждой игре: каждая строчка тут оплачена отказом
 * на живой площадке.
 *
 * Четыре правила, каждое из которых стоило отказа:
 *
 *   СТОРОЖА. Площадка может не ответить вовсе. До начала показа ждём короткое
 *   окно, после начала — три минуты: заведомо больше любого ролика и заведомо
 *   меньше «навсегда». Без заднего рубежа игра, поставленная на паузу перед
 *   роликом, остаётся на ней навсегда.
 *
 *   ОТВЕТ ОДИН РАЗ. SDK может позвать колбэк дважды, а сторож — сработать
 *   одновременно с ответом. Двойной вызов означает двойную награду.
 *
 *   НАГРАДА ТОЛЬКО ЗА ДОСМОТР. Выдаём по событию площадки, а не по факту
 *   закрытия окна. Закрыл на середине — награды нет. Единственное исключение:
 *   межстраничная, у которой «ролик пошёл» уже означает показ.
 *
 *   ИГРА СТОИТ. Пока идёт ролик, ввод не принимается и площадке не говорят
 *   «идёт геймплей». Пауза таймеров сама по себе не мешает игроку нажимать —
 *   это чинили отдельно, уже после отказа.
 *
 * Чего здесь НЕТ: планировщика показов — того, что решает, КОГДА показывать
 * межстраничную. Обкатанный живёт в самой игре (у «Попаданца» это AdPacer в
 * src/q8.js). Вынесенная копия здесь была и удалена: её не звал никто, и
 * непроверенная копия рядом с обкатанным оригиналом — заготовка на то, что в
 * следующий раз возьмут не ту.
 */
/* Драйверы: единственное место, где упоминаются чужие SDK. */
import { createDrivers, AD_BACKSTOP } from './drivers.js';
import { offPlatform } from './index.js';

const PLATFORM = (typeof window !== 'undefined' && window.__PLATFORM__) || 'none';

const focusFns = new Set();
/** Подписка на «игру свернули/развернули». Без неё музыка играет в свёрнутой игре. */
export const onAppFocus = (fn) => { focusFns.add(fn); return () => focusFns.delete(fn); };

const muteFns = new Set();
/** Подписка на кнопку звука САМОЙ площадки (CrazyGames: settings.muteAudio).
 *  Драйвер привязку platformMute получал, но хозяину её никто не отдавал —
 *  и музыка «Нулевого пациента» играла поверх выключенного площадкой звука. */
export const onPlatformMute = (fn) => { muteFns.add(fn); return () => muteFns.delete(fn); };

/* Три вещи, которые драйверам даёт хозяин. */
const { DRIVERS, state } = createDrivers({
  /* «Мы вне площадки»: локальный файл, localhost, GitHub Pages. Разбор общий для
     всех наших игр и лежит в том же game-kit — там же написано, почему одной
     метки сборки для этого мало. */
  offPlatform,
  /* Адрес SDK подставляет сборка. Держать его строкой в коде нельзя: в архиве
     для Яндекса лежал бы адрес CrazyGames, а площадки проверяют готовый файл на
     посторонние загрузки. */
  sdkUrl: () => window.__SDK_URL || '',
  /* Сворачивание игры в мобильных приложениях ВК и ОК приходит событием Bridge,
     а не visibilitychange. Слушателей ставит интерфейс. */
  appFocus: (on) => { for (const f of focusFns) { try { f(on); } catch (e) {} } },
  /* Язык игрока, известный площадке (Яндекс — environment.i18n.lang). Кладём в
     тот же глобальный крючок, что и бутстрап ВК: у игры одно место, откуда она
     узнаёт подсказку языка, независимо от площадки. Без этого драйвер Яндекса
     язык читал и выбрасывал — hostLang никто не передавал.
     Это ПОДСКАЗКА, а не приказ: выбор игрока сильнее (см. i18n/index.js). */
  platformLang: (code) => {
    window.__LANG_HINT = code;
    try { window.__platformLang && window.__platformLang(code); } catch (e) {}
  },
  /* Баннера на экране нет, хотя мы его просили. Без этого bannerShown остаётся
     поднятым навсегда: слой считает баннер стоящим и второй попытки не делает.
     Причина важна. 'fail' — площадка отказала (нет заполнения, ошибка), тут
     уместно попробовать ещё, но не бесконечно. 'closed' — игрок нажал крестик на
     самом баннере, и возвращать рекламу после этого нельзя. */
  bannerState: (on, why) => { bannerShown = !!on;
    if (on) return;
    if (why === 'closed') bannerGiveUp = true;
    else if (++bannerFails >= 3) bannerGiveUp = true; },
  /* Площадка остановила игру сама (преролл GameDistribution). Поднимаем те же
     слушатели, что и на собственный показ: под чужой рекламой игра обязана стоять. */
  platformPause: (on) => { busy = !!on; emit();
    /* Чужая пауза — та же остановка геймплея, что и свой ролик: game_api_pause
       Яндекса и SDK_GAME_PAUSE GD обязаны размечаться stop/start, иначе площадка
       считает сессию непрерывной. Ставим не «идёт игра» вслепую, а то, чем игрок
       занят на самом деле (меню и экран итога — не геймплей). */
    gameplay(!on && !!isPlaying()); },
  platformMute: (on) => { for (const f of muteFns) { try { f(!!on); } catch (e) {} } }
});

let drv = DRIVERS[PLATFORM] || DRIVERS.none;

let ok = false;              // SDK поднялся
let bannerCap = false;       // площадка умеет баннер
let bannerShown = false;
// отказы площадки по баннеру и решение больше не пробовать (крестик игрока или три отказа подряд)
let bannerFails = 0, bannerGiveUp = false;
let readyDone = false, wantReady = false;
let playing = null;          // что мы в последний раз сказали площадке про геймплей
let busy = false;            // идёт ролик

const listeners = new Set();
const emit = () => { for (const f of listeners) { try { f(busy); } catch (e) {} } };

/** Идёт ли сейчас ролик. Читают и интерфейс, и машина сюжета. */
export const adBusy = () => busy;
/** Подписка на «ролик начался/кончился» — интерфейс по ней блокирует ввод. */
export const onAdBusy = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const adReady = () => ok;
export const adPlatform = () => PLATFORM;
/** Есть ли у площадки предзагруженный ролик за награду. Честно отвечает только
 *  ВК; у остальных остаётся false и ни на что не влияет. Интерфейс по этому
 *  флагу решает, показывать ли кнопку «посмотреть рекламу» — так просит
 *  документация ВК. */
export const rewardWarm = () => state.rewardWarm;

/** Что считать «идёт игра» после ролика. Ставит хозяин: только он знает, чем
 *  игрок был занят — сценой, меню или экраном концовки. Не поставил — считаем,
 *  что игра идёт: это прежнее поведение, и оно хотя бы не молчит. */
let isPlaying = () => true;
export function bindPlaying(fn) { if (typeof fn === 'function') isPlaying = fn; }

/**
 * Одноразовый ответ со сторожами.
 *
 * @param {boolean} shownOnBackstop чем разрешить показ, если после «ролик пошёл»
 *   площадка так и не сообщила о закрытии. Для МЕЖСТРАНИЧНОЙ это true: ролик
 *   начался, значит показ был, и следующий показ обязан отодвинуться. Для
 *   РОЛИКА ЗА НАГРАДУ — false: награда только за досмотр.
 *
 * Раньше здесь стояло false для обоих. Для межстраничной это значило, что
 * показанный ролик считается неудачей: пейсер не сдвигает время последнего
 * показа, откат назначает повтор — и на ближайшем шве едет второй ролик подряд.
 * «Два ролика подряд» — отдельный пункт отказа.
 */
function guarded(run, waitBefore, shownOnBackstop) {
  return new Promise((resolve) => {
    let done = false;
    let watch = setTimeout(() => finish(false), waitBefore);
    function finish(v) {
      if (done) return;
      done = true;
      clearTimeout(watch);
      busy = false; emit();
      /* Не «идёт игра» безусловно, а то, чем игрок занят на самом деле: ролик
         мог кончиться на экране концовки или в меню, и площадка получила бы
         gameplayStart там, где игры нет. По этим вызовам считают длину сессии. */
      gameplay(!!isPlaying());
      resolve(v);
    }
    const started = () => {
      clearTimeout(watch);
      /* Показ пошёл — дальше ролик закрывает игрок, ждём долго. */
      watch = setTimeout(() => finish(!!shownOnBackstop), AD_BACKSTOP);
    };
    busy = true; emit();
    gameplay(false);
    try { run(finish, started); } catch (e) { finish(false); }
  });
}

export function initAds() {
  try {
    drv.init((cap) => {
      ok = true; bannerCap = !!cap;
      /* The game can reach its first playable state before a platform SDK
         finishes initializing. Replay the latest state now that the driver
         has a live SDK instance; otherwise the first gameplayStart() is lost
         and CrazyGames keeps First gameplay start at No. */
      if (playing !== null) {
        try { drv.gameplay(playing); } catch (e) {}
      }
      if (wantReady) adsGameReady();
    });
  } catch (e) { /* вне площадки — молча, игра работает без рекламы */ }
}

/** «Игрок может начать играть» — по первому кадру, а не по загрузке скрипта:
 *  площадки мерят по этому событию время до старта. */
export function adsGameReady() {
  wantReady = true;
  if (!ok || readyDone) return;
  readyDone = true;
  try { drv.ready(); } catch (e) {}
}

/** Идёт собственно игра или меню/реклама/концовка. Дубли игнорируем: площадки
 *  считают их повторным стартом сессии. */
export function gameplay(on) {
  if (busy) on = false;               // под роликом геймплея нет по определению
  if (on === playing) return;
  playing = on;
  try { drv.gameplay(on); } catch (e) {}
}

export function interstitial() {
  if (!ok) return Promise.resolve(false);
  if (busy) return Promise.resolve(false);
  /* true на заднем рубеже: ролик пошёл — значит показ был. */
  return guarded((fin, started) => drv.interstitial(fin, started), drv.waitShort || 12000, true);
}

/** Ролик за награду. Только по явному нажатию игрока — иначе площадки снимают
 *  игру с публикации. Повторное нажатие игнорируется: ролик едет не мгновенно,
 *  а каждый лишний запрос площадка считает накруткой показов. */
export function rewarded() {
  if (!ok) return Promise.resolve(true);   // вне площадки награда выдаётся сразу
  if (busy) return Promise.resolve(false);
  /* false на заднем рубеже: награда только за досмотр, о котором площадка
     сообщила. Молчание площадки — не досмотр. */
  return guarded((fin, started) => drv.rewarded(fin, started), drv.waitLong || 40000, false);
}

/* ---- необязательное: то, что площадка либо умеет, либо нет ----
 *
 * Зовутся вслепую: не умеет — метода у драйвера просто нет, и ничего не
 * происходит. Так игре не приходится знать, где она запущена, а новая площадка
 * подхватывается сама.
 *
 * ВСЕ ТРИ ЗВАТЬ ТОЛЬКО ПОСЛЕ ПРОЖИТОГО. Окно «оцените игру» на старте игрок
 * закрывает не глядя, и второй раз его уже не покажешь: площадки показывают
 * такое ограниченное число раз. Правильный момент — финал или заметное
 * достижение. */

/** «Сейчас игроку хорошо». CrazyGames считает по этим вызовам вовлечённость. */
export function delight() { if (ok) try { drv.delight && drv.delight(); } catch (e) {} }
/** Предложить оценить игру. Как часто показывать — решает площадка. */
export function askReview() { if (ok) try { drv.askReview && drv.askReview(); } catch (e) {} }
/** Предложить вынести ярлык или добавить в избранное. */
export function addShortcut() { if (ok) try { drv.addShortcut && drv.addShortcut(); } catch (e) {} }

/** Счёт в таблицу рекордов площадки — если драйвер умеет (сейчас только Яндекс,
 *  таблицу с этим именем заводит консоль площадки). Тихо: без входа в аккаунт
 *  отказ штатный, игра его не видит. */
export function setScore(board, value) { if (ok) try { drv.setScore && drv.setScore(board, value); } catch (e) {} }

/** Поделиться картинкой (история ВК). Умеет ли площадка — canShare(); без
 *  умения share() честно отвечает false, и игра не показывает кнопку. */
export const canShare = () => ok && typeof drv.share === 'function';
export function share(dataUrl) {
  if (!canShare()) return Promise.resolve(false);
  try { return Promise.resolve(drv.share(dataUrl)).then((r) => r !== false).catch(() => false); } catch (e) { return Promise.resolve(false); }
}

/** Больше не просить баннер: игрок закрыл его крестиком или площадка отказала трижды. */
export const bannerAbandoned = () => bannerGiveUp;

export function banner(show) {
  if (!ok || !bannerCap || show === bannerShown) return;
  if (show && bannerGiveUp) return;
  /* ПОКАЗАТЬ под роликом нельзя, а СКРЫТЬ — обязательно: у ВК баннер рисуется
     поверх игры, и на время ролика его требуется убирать. Прежнее условие
     гасило любой вызов под роликом, включая скрытие, — то есть делало ровно
     обратное тому, что нужно. */
  if (busy && show) return;
  bannerShown = show;
  try { drv.showBanner(show); } catch (e) {}
}
