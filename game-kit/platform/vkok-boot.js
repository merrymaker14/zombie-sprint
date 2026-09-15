/* Бутстрап площадки VK Games (ВКонтакте + Одноклассники).
 *
 * Подключается сборкой в <head> ДО модуля игры и решает ровно две задачи:
 *   1. поднимает VK Bridge (VKWebAppInit), чтобы драйвер площадки в игре нашёл готовый мост;
 *   2. поднимает облачные сейвы в localStorage — игра читает их синхронно и об облаке не знает.
 *
 * Почему облако вообще нужно. На хостинге статики ВК адрес игры меняется после каждой
 * заливки, а localStorage привязан к домену — на новом адресе прогресс игрока пуст.
 * Об этом прямо сказано в документации VKWebAppStorageSet.
 *
 * Чего облако НЕ умеет, и что из этого следует:
 *   • В Одноклассниках VK Storage работает только в приложении для Android. На ok.ru,
 *     m.ok.ru и в приложении для iOS его нет — там остаётся один localStorage.
 *   • Значение обрезается до 4096 символов (2236 для сериализованной строки).
 *     Поэтому в облако уходят только маленькие ключи, а профили героев с их
 *     PNG-аватарами — никогда: они на порядок больше лимита.
 * Пока игра лежит на постоянном адресе, обе оговорки безобидны: localStorage не теряется,
 * а облако работает как второй экземпляр прогресса и переносит его между устройствами.
 *
 * Игра ждёт window.__PLATFORM_READY. Промис ОБЯЗАН разрешиться в любом случае:
 * недоступный SDK не должен оставить игрока перед чёрным экраном.
 */
(function () {
  'use strict';

  /* КАКИЕ КЛЮЧИ ВОЗИТЬ В ОБЛАКО — решает игра: она одна знает, что у неё есть и
     что влезет в лимит. Объявляется в <head> ДО этого скрипта, сборкой.
     Не объявила — облака не будет, а разделение областей всё равно заработает:
     это разные вещи, и молча терять область из-за необъявленных ключей нельзя. */
  var CLOUD_KEYS = (window.__CLOUD_KEYS || []).slice(0, 8);
  /* Ключи-МНОЖЕСТВА: для них «кто свежее, тот и прав» — неправильное правило.
     Коллекция открытых финалов на двух устройствах иначе затирает сама себя:
     три финала с телефона против двух других с компьютера — и чьи-то теряются,
     хотя игрок честно открыл все пять. Для множеств правильное правило —
     объединение, и свежесть тут ни при чём. */
  var MERGE_KEYS = (window.__MERGE_KEYS || []);
  function unionInto(key, cloudRaw, stamp) {
    var loc = [], rem = [];
    try { loc = JSON.parse(localStorage.getItem(scoped(key))) || []; } catch (e) {}
    try { rem = JSON.parse(cloudRaw) || []; } catch (e) {}
    if (!Array.isArray(loc)) loc = []; if (!Array.isArray(rem)) rem = [];
    var seen = {}, out = [];
    loc.concat(rem).forEach(function (x) {
      var k = typeof x === 'string' ? x : JSON.stringify(x);
      if (!seen[k]) { seen[k] = 1; out.push(x); }
    });
    try {
      localStorage.setItem(scoped(key), JSON.stringify(out));
      setLocalStamp(key, Math.max(stamp || 0, localStamp(key)));
    } catch (e) {}
  }
  if (!CLOUD_KEYS.length) {
    console.warn('[ВК] не объявлен window.__CLOUD_KEYS — облачных сохранений не будет');
  }
  /* Ключи, которые скоупим, но в облако не возим: они великоваты для лимита. */
  var LOCAL_ONLY = window.__LOCAL_KEYS || [];
  var MAX_VALUE = 2200;        // с запасом от документированных 2236 символов
  var BOOT_TIMEOUT = 2500;     // столько ждём облако, дальше играем на localStorage
  var PUSH_DEBOUNCE = 1500;    // сейв дёргается часто, а лимит — 1000 вызовов в час на игрока

  /* Область сохранений. ВКонтакте и Одноклассники открывают игру с ОДНОГО адреса, а
     localStorage привязан к адресу — без разделения игрок ВК и игрок ОК в одном браузере
     видели бы общий прогресс. Одноклассники требуют обратного: «прогресс пользователя
     в версии приложения для каждой соцсети должен сохраняться отдельно».
     Площадку берём из vk_client (в Одноклассниках он равен ok), игрока — из vk_user_id.
     Нет параметров запуска — нет и области: ключи остаются прежними. */
  var SCOPE = (function () {
    try {
      var q = new URLSearchParams(location.search);
      var site = q.get('vk_client') === 'ok' ? 'ok' : (q.get('vk_app_id') ? 'vk' : '');
      var user = q.get('vk_user_id') || q.get('vk_ok_user_id') || '';
      if (!site || !/^\d+$/.test(user)) return '';
      return '_' + site + user;
    } catch (e) { return ''; }
  })();
  window.__SAVE_SCOPE = SCOPE;

  /* Язык игрока приходит ПАРАМЕТРОМ ЗАПУСКА (vk_language) — читать его можно до
     первого кадра, в отличие от Яндекса, где язык приезжает вместе с SDK. Игрок
     с английским интерфейсом ВК получал русский экран: сборка для ВК прибита к
     русскому, а параметр не читал никто. Отдаём игре той же необязательной
     привязкой, что и у Яндекса: применится, только если игрок не выбрал язык
     сам. */
  try {
    var lang = new URLSearchParams(location.search).get('vk_language');
    if (lang) {
      lang = String(lang).slice(0, 2).toLowerCase();
      /* Бутстрап исполняется ДО модуля игры, и __platformLang в этот момент ещё
         не объявлен. Оставляем метку — игра подберёт её при старте; живой вызов
         на случай, если порядок когда-нибудь окажется обратным. */
      window.__LANG_HINT = lang;
      if (window.__platformLang) window.__platformLang(lang);
    }
  } catch (e) {}

  var scoped = function (key) { return key + SCOPE; };

  /* Перенос прогресса тех, кто играл до появления областей: если по областному ключу
     пусто, а по старому что-то есть — забираем. Старое не стираем: у второй соцсети
     на этом же браузере оно может быть единственным сейвом. */
  if (SCOPE) CLOUD_KEYS.concat(LOCAL_ONLY).forEach(function (k) {
    try {
      if (localStorage.getItem(scoped(k)) === null && localStorage.getItem(k) !== null)
        localStorage.setItem(scoped(k), localStorage.getItem(k));
    } catch (e) {}
  });

  /* Метку времени держим рядом с самим ключом: по ней решаем, чья версия свежее —
     локальная или облачная. Без неё переезд между устройствами затирает прогресс. */
  function stampKey(key) { return scoped(key) + '__t'; }
  function localStamp(key) {
    var v = 0;
    try { v = parseInt(localStorage.getItem(stampKey(key)), 10) || 0; } catch (e) {}
    return v;
  }
  function setLocalStamp(key, t) {
    try { localStorage.setItem(stampKey(key), String(t)); } catch (e) {}
  }

  var bridge = window.vkBridge;
  var ready = false;           // облако ответило и его можно использовать на запись
  var warned = {};

  /* ---- запись в облако ---- */
  var timers = {};
  /* Ключи, записанные локально ПОКА ОБЛАКО ЕХАЛО. Метки у них уже стоят, а в
     облако они не уехали — отправлять было некуда. Догоняем сразу, как облако
     ответит: иначе настройки и партия, начатые в окне ожидания, останутся только
     на этом устройстве. На мобильном интернете это окно доходило до 25 секунд. */
  var pending = {};
  window.__cloudPut = function (key, value) {
    /* Чужой ключ — ни метки, ни отправки: метка нужна ровно тем ключам, у
       которых есть облачный двойник, чтобы было с чем её сравнивать. Профили
       героев сюда не попадают намеренно — они в __LOCAL_KEYS. */
    if (CLOUD_KEYS.indexOf(key) < 0) return;
    /* Значение не передали — читаем сами. Без этого забытый второй аргумент уехал бы
       в облако конвертом без поля v, а гидратация трактует отсутствующее v как
       «ключ удалён» — то есть на другом устройстве прохождение просто исчезло бы.
       Явный null оставляем как есть: это и означает удаление. */
    if (value === undefined) { try { value = localStorage.getItem(scoped(key)); } catch (e) { value = null; } }
    var now = Date.now();
    /* МЕТКА СТАВИТСЯ ВСЕГДА — до всех проверок готовности облака.
       Задний рубеж бутстрапа 2.5 с, а VKWebAppStorageGet на мобильном интернете
       отвечал и на двадцать пятой секунде. Игрок за это время успевает открыть
       настройки и выбрать язык с громкостью; раньше эта запись ложилась БЕЗ
       метки, localStamp равнялся нулю — и приехавшее облако возвращало старые
       ru/80 поверх свежего выбора. Готовность облака решает, отправлять ли, и
       только это; на локальную запись она влиять не должна. */
    setLocalStamp(key, now);
    if (!ready) { pending[key] = now; return; }
    clearTimeout(timers[key]);
    timers[key] = setTimeout(function () {
      var body = JSON.stringify({ t: now, v: value });
      if (body.length > MAX_VALUE) {
        if (!warned[key]) { warned[key] = 1;
          console.warn('[облако] ' + key + ' не помещается в лимит VK Storage (' +
            body.length + ' символов) — этот ключ остаётся только в localStorage'); }
        return;
      }
      try {
        bridge.send('VKWebAppStorageSet', { key: key, value: body })
          .catch(function () {});
      } catch (e) {}
    }, PUSH_DEBOUNCE);
  };

  /* Догнать облако тем, что игрок записал, пока оно ехало. Зовётся один раз, в
     момент готовности облака. Лимит площадки — 1000 вызовов в час на игрока, а
     ключей самое большее восемь: догоняющая пачка в него укладывается с запасом,
     и дебаунс всё равно склеит её с обычными сейвами. */
  function flushPending() {
    var keys = Object.keys(pending);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i], t = pending[key];
      delete pending[key];
      /* Метка успела смениться — значит поверх нашей записи уже легло другое.
         Либо гидратация подняла более свежее облачное (тогда в облаке оно и
         так есть), либо игрок записал ещё раз (эта запись уедет своим
         порядком). Отправлять устаревшее значение нельзя: мы вернули бы в
         облако то, от чего игрок уже ушёл.
         Множества — исключение: объединённый список надо вернуть в облако в
         любом случае, иначе второе устройство не узнает про наши финалы. */
      if (localStamp(key) !== t && MERGE_KEYS.indexOf(key) < 0) continue;
      /* Значение перечитываем из хранилища: у множества там уже ОБЪЕДИНЁННЫЙ
         список, а не то, что игрок записал до приезда облака. */
      window.__cloudPut(key);
    }
  }

  /* ---- чтение из облака при старте ---- */
  function hydrate() {
    return bridge.send('VKWebAppStorageGet', { keys: CLOUD_KEYS }).then(function (data) {
      var list = (data && data.keys) || [];
      for (var i = 0; i < list.length; i++) {
        var row = list[i];
        if (!row || !row.value) continue;
        var env;
        try { env = JSON.parse(row.value); } catch (e) { continue; }
        if (!env || typeof env.t !== 'number') continue;
        /* Множества объединяются ВСЕГДА, независимо от свежести: у них обе
           стороны правы. Сравнение меток — только для одиночных значений. */
        if (MERGE_KEYS.indexOf(row.key) >= 0) { unionInto(row.key, env.v, env.t); continue; }
        if (env.t <= localStamp(row.key)) continue;      // локальная версия свежее — не трогаем
        try {
          /* В облаке ключи без области: там записи и так разложены по игрокам самой
             площадкой. Область появляется только на локальной стороне. */
          if (env.v === null || env.v === undefined) localStorage.removeItem(scoped(row.key));
          else localStorage.setItem(scoped(row.key), env.v);
          setLocalStamp(row.key, env.t);
        } catch (e) {}
      }
      ready = true;
      /* Порядок важен: сперва догоняем облако тем, что игрок записал в окно
         ожидания (гидратация выше уже решила, чья версия свежее), и только
         потом сообщаем игре о приезде. */
      flushPending();
      /* Облако могло приехать позже заднего рубежа: игра к этому моменту уже решила
         судьбу кнопки «Продолжить» — и решила по пустому localStorage. */
      try { window.__cloudArrived && window.__cloudArrived(); } catch (e) {}
    });
  }

  window.__PLATFORM_READY = new Promise(function (resolve) {
    var done = false;
    var finish = function () { if (!done) { done = true; resolve(); } };
    setTimeout(finish, BOOT_TIMEOUT);
    if (!bridge) { finish(); return; }
    try {
      bridge.send('VKWebAppInit')
        .then(function () { return hydrate(); })
        /* Облако может быть недоступно (Одноклассники вне Android) — это не ошибка,
           просто играем на localStorage. Разрешаем промис в любом случае. */
        .catch(function () {})
        .then(finish, finish);
    } catch (e) { finish(); }
  });
})();
