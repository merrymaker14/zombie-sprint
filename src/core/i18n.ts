/**
 * Small, synchronous UI localisation layer.
 *
 * The game keeps stable ids for characters/tracks and stores only the selected
 * language in localStorage.  This means a language switch never touches race
 * settings or progress.  Platform bootstraps may provide __LANG_HINT and
 * __PLATFORM before the game module starts, just like the other html games.
 */
export type Language = 'ru' | 'en';

type Values = Record<string, string | number>;

const STORAGE_KEY = 'zs_language';

const TEXT: Record<Language, Record<string, string>> = {
  en: {
    'language.label': 'LANGUAGE',
    'language.ru': 'РУ',
    'language.en': 'EN',
    'brand.subtitle': 'ZOMBIE CHAMPIONSHIP',
    'menu.pressStart': 'PRESS ENTER / CLICK TO RUN',
    'menu.pressStartTouch': 'TAP TO RUN',
    'menu.chapter1': 'CHAPTER 1 / 2 · ZOMBIE RACERS',
    'menu.chapter2': 'CHAPTER 2 / 2 · ZOMBIE CHAMPIONSHIP',
    'menu.chooseZombie': 'CHOOSE YOUR ZOMBIE',
    'menu.chooseRoute': 'CHOOSE A ROUTE',
    'menu.back': '← BACK',
    'menu.release': 'RELEASE THE HORDE →',
    'menu.startRun': 'START RUN',
    'menu.threatLevel': 'THREAT LEVEL',
    'menu.zombieClass': 'Friendly zombie class',
    'menu.laps': '{count} LAPS',
    'menu.rookie': 'ROOKIE',
    'menu.pro': 'PRO',
    'menu.expert': 'EXPERT',
    'controls.sprint': 'Sprint',
    'controls.brake': 'Brake / Reverse',
    'controls.steer': 'Steer',
    'controls.drift': 'Hop · Drift',
    'controls.power': 'Use power (hold BRAKE to throw back)',
    'controls.lookBack': 'Look back',
    'controls.pause': 'Pause',
    'controls.mute': 'Mute',
    'touch.brake': 'BRAKE',
    'touch.drift': 'DRIFT',
    'touch.item': 'POWER',
    'touch.pause': 'Pause',
    'stats.speed': 'SPD',
    'stats.acceleration': 'ACC',
    'stats.handling': 'HND',
    'stats.weight': 'WGT',
    'stats.miniTurbo': 'MT',
    'weight.light': 'LIGHT',
    'weight.medium': 'MEDIUM',
    'weight.heavy': 'HEAVY',
    'difficulty.easy': 'EASY',
    'difficulty.normal': 'NORMAL',
    'difficulty.hard': 'HARD',
    'difficulty.easyBlurb': 'Sleepy rivals, forgiving catch-up.',
    'difficulty.normalBlurb': 'The standard friendly zombie championship.',
    'difficulty.hardBlurb': 'Fast rivals, clean lines, no scary stuff.',
    'theme.grassland': 'GRASSLAND',
    'theme.desert': 'DESERT',
    'theme.snow': 'SNOW',
    'theme.neon': 'NEON',
    'hud.lap': 'LAP',
    'hud.speedUnit': 'km/h',
    'hud.wrongWay': 'WRONG WAY',
    'hud.go': 'GO! KEEP IT TOGETHER!',
    'hud.finalLap': 'FINAL LAP!',
    'hud.lapFlash': 'LAP {lap}',
    'hud.finish': 'FINISH',
    'hud.place': '{place} PLACE',
    'hud.position': '{place}',
    'hud.positionUp': '▲ {place} — LEGS STILL WORK!',
    'hud.positionDown': '▼ {place} — BLAME THE WOBBLY KNEES!',
    'item.slimeTrap': 'SLIME TRAP',
    'item.slimeTriple': 'SLIME ×3',
    'item.toxicOrb': 'TOXIC ORB',
    'item.toxicTriple': 'TOXIC ×3',
    'item.homingOrb': 'HOMING ORB',
    'item.homingTriple': 'HOMING ×3',
    'item.frostOrb': 'FROST ORB',
    'item.speedBite': 'SPEED BITE',
    'item.speedTriple': 'SPEED ×3',
    'item.goldenSpeed': 'GOLDEN SPEED',
    'item.rageStar': 'RAGE STAR',
    'item.shockwave': 'SHOCKWAVE',
    'item.scrapBomb': 'SCRAP BOMB',
    'pause.kicker': 'HORDE BREAK',
    'pause.title': 'PAUSED',
    'pause.resume': 'RESUME',
    'pause.restart': 'RESTART RUN',
    'pause.quit': 'MAIN MENU',
    'pause.hint': 'ESC / P  resume   ·   ↑↓  navigate   ·   ENTER  select',
    'results.kicker': 'ZOMBIE RUN COMPLETE',
    'results.champion': 'HORDE CHAMPION!',
    'results.place': '{place} PLACE',
    'results.untouchable': 'Untouchable. The friendly horde goes wild.',
    'results.podium': 'Podium finish. The snacks are on ice.',
    'results.solid': 'Solid run. The crown is within reach.',
    'results.rough': 'Rough run. Time to rise again.',
    'results.runAgain': 'RUN AGAIN',
    'results.changeRoute': 'CHANGE ROUTE',
    'results.menu': 'HORDE MENU',
    'results.you': 'YOU',
    'results.dnf': 'DNF',
    'loading.kicker': 'THE FRIENDLY HORDE IS GATHERING',
    'loading.tip': 'TIP',
    'loading.laps': '{count} LAPS',
    'fatal.webglTitle': 'WEBGL2 REQUIRED',
    'fatal.webglBody': 'Zombie Sprint needs a browser with WebGL 2 and hardware acceleration enabled. Try the latest Chrome, Edge, Firefox or Safari.',
    'fatal.reload': 'RELOAD',
    'fatal.startTitle': 'FAILED TO START',
    'fatal.startBody': 'Something went wrong while starting Zombie Sprint. Reload the game and try again.',
    'game.muted': '🔇 MUTED',
    'game.softwareGraphics': 'Hardware acceleration is off, so the graphics are simplified.',
    'game.rotateTitle': 'TURN YOUR DEVICE',
    'game.rotateBody': 'The race runs in landscape. On a computer, just make the window wider.',
    'error.buildRace': 'Could not build the race. Please try another route.',
    'error.noTracks': 'No zombie routes are available yet.',
    'error.runtime': 'Something went wrong. If the game misbehaves, reload it.',
    'character.zippy.name': 'Grave Sprinter',
    'character.zippy.tagline': 'The fastest zombie on the starting line.',
    'character.pixel.name': 'Neon Ghoul',
    'character.pixel.tagline': 'Small, slippery, and impossible to catch.',
    'character.fennec.name': 'Howler',
    'character.fennec.tagline': 'A friendly howl in every corner.',
    'character.max.name': 'Rotter Ace',
    'character.max.tagline': 'The balanced champion of the horde.',
    'character.juno.name': 'Voltage Zombie',
    'character.juno.tagline': 'Charges every drift with undead energy.',
    'character.kai.name': 'Swamp Walker',
    'character.kai.tagline': 'Slow, steady, and covered in silly slime.',
    'character.bram.name': 'Bone Crusher',
    'character.bram.tagline': 'Heavy footsteps. Heavier collisions.',
    'character.rosa.name': 'Grave Queen',
    'character.rosa.tagline': 'The final boss of the starting grid.',
    'track.sunny_circuit.name': 'Graveyard Loop',
    'track.sunny_circuit.description': 'A crooked cemetery route with tombstone slaloms and one playful hairpin.',
    'track.dune_drift.name': 'Doomsday Highway',
    'track.dune_drift.description': 'Race through ash dunes and broken overpasses before the horde catches up.',
    'track.frostbite_falls.name': 'Frozen Outbreak',
    'track.frostbite_falls.description': 'A slippery ice run past abandoned shelters and a frozen-lake shortcut.',
    'track.neon_nexus.name': 'Neon Quarantine',
    'track.neon_nexus.description': 'Lockdown lights, rooftop jumps, and three big corners for brave racers.',
    // Trackside signs painted on canvas textures.
    'sign.title': 'ZOMBIE SPRINT',
    'sign.startFinish': 'START · FINISH',
    'sign.restInSpeed': 'REST IN SPEED',
    'sign.cautionHorde': 'CAUTION: HORDE',
    'sign.hordeAhead': 'HORDE AHEAD',
    'sign.nextExit': 'NEXT EXIT: NOWHERE',
    'sign.quarantine': 'QUARANTINE',
    'sign.quarantineZone': 'QUARANTINE ZONE',
    'sign.keepFrozen': 'KEEP ZOMBIES FROZEN',
    'sign.zoneClosed': 'ZONE CLOSED',
    'sign.zombieCrossing': 'ZOMBIE CROSSING',
  },
  ru: {
    'language.label': 'ЯЗЫК',
    'language.ru': 'РУ',
    'language.en': 'EN',
    'brand.subtitle': 'ЧЕМПИОНАТ ЗОМБИ',
    'menu.pressStart': 'НАЖМИ ENTER / КЛИКНИ, ЧТОБЫ БЕЖАТЬ',
    'menu.pressStartTouch': 'КОСНИСЬ ЭКРАНА, ЧТОБЫ БЕЖАТЬ',
    'menu.chapter1': 'ГЛАВА 1 / 2 · ЗОМБИ-ГОНЩИКИ',
    'menu.chapter2': 'ГЛАВА 2 / 2 · ЧЕМПИОНАТ ЗОМБИ',
    'menu.chooseZombie': 'ВЫБЕРИ ЗОМБИ',
    'menu.chooseRoute': 'ВЫБЕРИ ТРАССУ',
    'menu.back': '← НАЗАД',
    'menu.release': 'ВЫПУСТИТЬ ОРДУ →',
    'menu.startRun': 'НАЧАТЬ ЗАЕЗД',
    'menu.threatLevel': 'УРОВЕНЬ УГРОЗЫ',
    'menu.zombieClass': 'Дружелюбный класс зомби',
    'menu.laps': '{count} КРУГА',
    'menu.rookie': 'НОВИЧОК',
    'menu.pro': 'ПРО',
    'menu.expert': 'ЭКСПЕРТ',
    'controls.sprint': 'Бежать вперёд',
    'controls.brake': 'Тормоз / назад',
    'controls.steer': 'Поворот',
    'controls.drift': 'Прыжок · дрифт',
    'controls.power': 'Использовать силу (тормоз — бросить назад)',
    'controls.lookBack': 'Оглянуться',
    'controls.pause': 'Пауза',
    'controls.mute': 'Звук',
    'touch.brake': 'ТОРМОЗ',
    'touch.drift': 'ДРИФТ',
    'touch.item': 'СИЛА',
    'touch.pause': 'Пауза',
    'stats.speed': 'СКР',
    'stats.acceleration': 'РАЗГ',
    'stats.handling': 'УПР',
    'stats.weight': 'ВЕС',
    'stats.miniTurbo': 'ТУРБО',
    'weight.light': 'ЛЁГКИЙ',
    'weight.medium': 'СРЕДНИЙ',
    'weight.heavy': 'ТЯЖЁЛЫЙ',
    'difficulty.easy': 'ЛЕГКО',
    'difficulty.normal': 'НОРМАЛЬНО',
    'difficulty.hard': 'СЛОЖНО',
    'difficulty.easyBlurb': 'Сонные соперники, мягкое отставание.',
    'difficulty.normalBlurb': 'Обычный дружелюбный чемпионат зомби.',
    'difficulty.hardBlurb': 'Быстрые соперники, чистая траектория, без страшилок.',
    'theme.grassland': 'ЛУГ',
    'theme.desert': 'ПУСТЫНЯ',
    'theme.snow': 'СНЕГ',
    'theme.neon': 'НЕОН',
    'hud.lap': 'КРУГ',
    'hud.speedUnit': 'км/ч',
    'hud.wrongWay': 'НЕ ТУДА',
    'hud.go': 'ВПЕРЁД! НЕ РАЗВАЛИСЬ!',
    'hud.finalLap': 'ФИНАЛЬНЫЙ КРУГ!',
    'hud.lapFlash': 'КРУГ {lap}',
    'hud.finish': 'ФИНИШ',
    'hud.place': '{place} МЕСТО',
    'hud.position': '{place}-Е',
    'hud.positionUp': '▲ {place} — НОГИ ЕЩЁ ПОМНЯТ!',
    'hud.positionDown': '▼ {place} — ВИНОВАТЫ ШАТКИЕ КОЛЕНИ!',
    'item.slimeTrap': 'СЛИЗЬ-ЛОВУШКА',
    'item.slimeTriple': 'СЛИЗЬ ×3',
    'item.toxicOrb': 'ТОКСИЧНЫЙ ШАР',
    'item.toxicTriple': 'ТОКСИЧНЫЕ ×3',
    'item.homingOrb': 'ШАР-НАВОДЧИК',
    'item.homingTriple': 'НАВОДЧИКИ ×3',
    'item.frostOrb': 'ЛЕДЯНОЙ ШАР',
    'item.speedBite': 'УКУС СКОРОСТИ',
    'item.speedTriple': 'СКОРОСТЬ ×3',
    'item.goldenSpeed': 'ЗОЛОТАЯ СКОРОСТЬ',
    'item.rageStar': 'ЗВЕЗДА ЗАДИРЫ',
    'item.shockwave': 'УДАРНАЯ ВОЛНА',
    'item.scrapBomb': 'ЖЕСТЯНАЯ БОМБА',
    'pause.kicker': 'ПЕРЕРЫВ ОРДЫ',
    'pause.title': 'ПАУЗА',
    'pause.resume': 'ПРОДОЛЖИТЬ',
    'pause.restart': 'НАЧАТЬ ЗАНОВО',
    'pause.quit': 'В ГЛАВНОЕ МЕНЮ',
    'pause.hint': 'ESC / P  продолжить   ·   ↑↓  выбор   ·   ENTER  подтвердить',
    'results.kicker': 'ЗАЕЗД ЗОМБИ ЗАВЕРШЁН',
    'results.champion': 'ЧЕМПИОН ОРДЫ!',
    'results.place': '{place} МЕСТО',
    'results.untouchable': 'Непобедимо! Дружелюбная орда ликует.',
    'results.podium': 'Подиум! Угощение уже охлаждается.',
    'results.solid': 'Отличный заезд. Корона совсем близко.',
    'results.rough': 'Тяжёлый заезд. Время подняться снова.',
    'results.runAgain': 'ЕЩЁ РАЗ',
    'results.changeRoute': 'СМЕНИТЬ ТРАССУ',
    'results.menu': 'МЕНЮ ОРДЫ',
    'results.you': 'ТЫ',
    'results.dnf': 'НЕ ФИНИШИРОВАЛ',
    'loading.kicker': 'ДРУЖЕЛЮБНАЯ ОРДА СОБИРАЕТСЯ',
    'loading.tip': 'СОВЕТ',
    'loading.laps': '{count} КРУГА',
    'fatal.webglTitle': 'НУЖЕН WEBGL2',
    'fatal.webglBody': 'Zombie Sprint нужен браузер с WebGL 2 и аппаратным ускорением. Попробуй свежие Chrome, Edge, Firefox или Safari.',
    'fatal.reload': 'ПЕРЕЗАГРУЗИТЬ',
    'fatal.startTitle': 'НЕ УДАЛОСЬ ЗАПУСТИТЬ',
    'fatal.startBody': 'При запуске Zombie Sprint что-то пошло не так. Перезагрузи игру и попробуй ещё раз.',
    'game.muted': '🔇 ЗВУК ВЫКЛЮЧЕН',
    'game.softwareGraphics': 'Аппаратное ускорение выключено, поэтому графика упрощена.',
    'game.rotateTitle': 'ПОВЕРНИ УСТРОЙСТВО',
    'game.rotateBody': 'Гонка идёт в горизонтальном режиме. На компьютере просто сделай окно шире.',
    'error.buildRace': 'Не удалось построить трассу. Попробуй другую.',
    'error.noTracks': 'Трассы для зомби пока недоступны.',
    'error.runtime': 'Что-то пошло не так. Если игра ведёт себя странно, перезагрузи её.',
    'character.zippy.name': 'Могильный Спринтер',
    'character.zippy.tagline': 'Самый быстрый зомби на старте.',
    'character.pixel.name': 'Неоновый Упырь',
    'character.pixel.tagline': 'Маленький, скользкий и неуловимый.',
    'character.fennec.name': 'Войкун',
    'character.fennec.tagline': 'Дружелюбный вой на каждом повороте.',
    'character.max.name': 'Ас-Гнилуша',
    'character.max.tagline': 'Сбалансированный чемпион орды.',
    'character.juno.name': 'Зомби-Вольт',
    'character.juno.tagline': 'Заряжает каждый дрифт энергией нежити.',
    'character.kai.name': 'Болотный Ходок',
    'character.kai.tagline': 'Медленный, упорный и в смешной слизи.',
    'character.bram.name': 'Костолом',
    'character.bram.tagline': 'Тяжёлые шаги. Ещё тяжелее столкновения.',
    'character.rosa.name': 'Могильная Королева',
    'character.rosa.tagline': 'Главный босс стартовой решётки.',
    'track.sunny_circuit.name': 'Кладбищенская петля',
    'track.sunny_circuit.description': 'Кривая кладбищенская трасса с надгробиями и весёлой шпилькой.',
    'track.dune_drift.name': 'Шоссе Судного дня',
    'track.dune_drift.description': 'Гонка по пепельным дюнам и сломанным эстакадам.',
    'track.frostbite_falls.name': 'Ледяная Вспышка',
    'track.frostbite_falls.description': 'Скользкий маршрут мимо убежищ и замёрзшего озера.',
    'track.neon_nexus.name': 'Неоновый Карантин',
    'track.neon_nexus.description': 'Огни карантина, прыжки с крыш и три больших поворота.',
    // Trackside signs painted on canvas textures.
    /* Название игры не переводим: в карточке магазина и на обложке оно
       одно — Zombie Sprint, а Яндекс требует, чтобы в самой игре было то же
       (п. 5.1.3). Русский вариант на арке давал второе написание. */
    'sign.title': 'ZOMBIE SPRINT',
    'sign.startFinish': 'СТАРТ · ФИНИШ',
    'sign.restInSpeed': 'ПОКОЙ НАМ ТОЛЬКО СНИТСЯ',
    'sign.cautionHorde': 'ОСТОРОЖНО: ОРДА',
    'sign.hordeAhead': 'ВПЕРЕДИ ОРДА',
    'sign.nextExit': 'СЛЕДУЮЩИЙ СЪЕЗД: НИКУДА',
    'sign.quarantine': 'КАРАНТИН',
    'sign.quarantineZone': 'ЗОНА КАРАНТИНА',
    'sign.keepFrozen': 'ЗОМБИ НЕ РАЗМОРАЖИВАТЬ',
    'sign.zoneClosed': 'ЗОНА ЗАКРЫТА',
    'sign.zombieCrossing': 'ПЕРЕХОД ЗОМБИ',
  },
};

const LOADING_TIPS: Record<Language, readonly string[]> = {
  en: [
    'Hold DRIFT (Space / Shift) through a corner and release for a mini-turbo. Longer drift = bigger boost.',
    'Tap the throttle just as the countdown hits 1 for a rocket start.',
    'Press {power} to use a power. Hold BRAKE with it to throw it backwards.',
    'Press {lookBack} to look behind you before dropping a slime trap.',
    'Boost pads give a free speed burst. Line them up.',
    'Trailing zombies get the rarest powers. Keep racing!',
    'A star makes your zombie invincible and clears hazards.',
    'Staying on the route matters: off-road is much slower.',
    'Use a boost on a long straight or after a friendly bump.',
    'Heavy zombies shove light zombies around. Pick your class wisely.',
    'Hop off jump crests for a small landing boost.',
    'Press M to mute the horde at any time.',
  ],
  ru: [
    'Зажми дрифт (Space / Shift) в повороте и отпусти для мини-турбо.',
    'Нажми газ, когда отсчёт дойдёт до 1, чтобы мощно стартовать.',
    'Сила — клавиша {power}. Зажми с ней тормоз, чтобы бросить силу назад.',
    'Нажми {lookBack} и оглянись перед слизью-ловушкой.',
    'Ускорители дают бесплатный рывок. Проезжай по ним точно.',
    'Отстающим зомби чаще достаются редкие силы. Не сдавайся!',
    'Звезда делает зомби неуязвимым и убирает помехи.',
    'Держись трассы: на траве скорость заметно ниже.',
    'Используй ускорение на прямой или после дружеского толчка.',
    'Тяжёлые зомби расталкивают лёгких. Выбирай класс с умом.',
    'Прыгни на вершине трамплина для бонуса при приземлении.',
    'Нажми M, чтобы в любой момент выключить звук орды.',
  ],
};

const ZOMBIE_JOKES: Record<Language, readonly string[]> = {
  en: [
    '🧠 Joke of the day: our zombies never lose their heads — they just misplace them.',
    '🧟 Drift lesson #1: loose knees make very loose corners.',
    '🏁 Last place is still first in the snack line.',
    '⚡ The boost is ready. The brain is loading.',
    '🪦 Graveyard Loop: finally, a route where everyone knows the shortcuts.',
    '😄 Friendly reminder: these zombies race, they do not bite.',
    '👟 Championship strategy: keep your feet, then find the finish.',
    '🌱 No scary stuff — just green racers and questionable driving.',
  ],
  ru: [
    '🧠 Шутка дня: наши зомби не теряют голову — они её просто паркуют.',
    '🧟 Урок дрифта №1: шаткие колени делают шаткие повороты.',
    '🏁 Последнее место — зато первым в очереди за перекусом.',
    '⚡ Ускоритель готов. Мозг загружается.',
    '🪦 Кладбищенская петля: наконец-то трасса, где все знают короткую дорогу.',
    '😄 Дружеское напоминание: эти зомби не кусаются, они обгоняют.',
    '👟 План чемпионата: сохранить ноги, потом найти финиш.',
    '🌱 Никаких страшилок — только зелёные гонщики и сомнительное вождение.',
  ],
};

const listeners = new Set<(language: Language) => void>();

function safeStoredLanguage(): Language | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === 'ru' || saved === 'en' ? saved : null;
  } catch {
    return null;
  }
}

function initialLanguage(): Language {
  const saved = safeStoredLanguage();
  if (saved) return saved;
  const w = window as unknown as { __LANG_HINT?: string; __PLATFORM__?: string };
  const query = new URLSearchParams(location.search).get('lang');
  if (query === 'ru' || query === 'en') return query;
  const hint = String(w.__LANG_HINT || '').slice(0, 2).toLowerCase();
  if (hint === 'ru' || hint === 'en') return hint;
  if (w.__PLATFORM__ === 'crazy' || w.__PLATFORM__ === 'gamedist') return 'en';
  return 'ru';
}

let language: Language = initialLanguage();
/** Set once the player picks a language in this session, even when storage is denied. */
let chosenByPlayer = false;

export function getLanguage(): Language {
  return language;
}

export function setLanguage(next: Language): void {
  if (next !== 'ru' && next !== 'en') return;
  chosenByPlayer = true;
  applyLanguage(next, true);
}

function applyLanguage(next: Language, persist: boolean): void {
  if (language === next) return;
  language = next;
  if (persist) {
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Private browsing or an embedded platform may deny storage; the session still works.
    }
  }
  document.documentElement.lang = next;
  for (const listener of Array.from(listeners)) listener(next);
}

/**
 * The platform knows the player's language (Yandex environment.i18n.lang,
 * CrazyGames systemInfo.locale) but reports it after the UI is already drawn.
 * Apply it only while the player has not chosen a language, and do not store it
 * as the player's choice. Unsupported languages fall back to English.
 */
(window as unknown as { __platformLang?: (code: string) => void }).__platformLang = (code: string): void => {
  if (chosenByPlayer || safeStoredLanguage()) return;
  const query = new URLSearchParams(location.search).get('lang');
  if (query === 'ru' || query === 'en') return;
  const c = String(code || '').slice(0, 2).toLowerCase();
  applyLanguage(c === 'ru' ? 'ru' : 'en', false);
};

export function onLanguageChange(listener: (language: Language) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function t(key: string, values: Values = {}): string {
  const source = TEXT[language][key] ?? TEXT.en[key] ?? key;
  return source.replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? `{${name}}`));
}

export function languageName(code: Language): string {
  return code === 'ru' ? 'РУССКИЙ' : 'ENGLISH';
}

export function characterName(id: string, fallback: string): string {
  return t(`character.${id}.name`) === `character.${id}.name` ? fallback : t(`character.${id}.name`);
}

export function characterTagline(id: string, fallback: string): string {
  return t(`character.${id}.tagline`) === `character.${id}.tagline` ? fallback : t(`character.${id}.tagline`);
}

export function trackName(id: string, fallback: string): string {
  return t(`track.${id}.name`) === `track.${id}.name` ? fallback : t(`track.${id}.name`);
}

export function trackDescription(id: string, fallback: string): string {
  return t(`track.${id}.description`) === `track.${id}.description` ? fallback : t(`track.${id}.description`);
}

export function formatOrdinal(place: number): string {
  if (language === 'ru') return `${place}-е`;
  const mod100 = place % 100;
  const suffix = mod100 >= 11 && mod100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[place % 10] ?? 'th';
  return `${place}${suffix}`;
}

export function formatPlace(place: number): string {
  return t('results.place', { place: formatOrdinal(place) });
}

export function formatLaps(count: number): string {
  if (language === 'ru') return `${count} ${count === 1 ? 'КРУГ' : 'КРУГА'}`;
  return t('menu.laps', { count });
}

export function itemLabel(item: string): string {
  const keys: Record<string, string> = {
    banana: 'item.slimeTrap', triple_banana: 'item.slimeTriple',
    green_shell: 'item.toxicOrb', triple_green_shell: 'item.toxicTriple',
    red_shell: 'item.homingOrb', triple_red_shell: 'item.homingTriple',
    blue_shell: 'item.frostOrb', mushroom: 'item.speedBite',
    triple_mushroom: 'item.speedTriple', golden_mushroom: 'item.goldenSpeed',
    star: 'item.rageStar', lightning: 'item.shockwave', bob_omb: 'item.scrapBomb',
  };
  return keys[item] ? t(keys[item]) : '';
}

/** Tips with key placeholders ({power}, {lookBack}) filled from `values`. */
export function loadingTips(values: Values = {}): readonly string[] {
  return LOADING_TIPS[language].map((tip) => tip.replace(/{(w+)}/g, (_, name: string) => String(values[name] ?? `{${name}}`)));
}

export function zombieJoke(): string {
  const jokes = ZOMBIE_JOKES[language];
  return jokes[Math.floor(Math.random() * jokes.length)] ?? jokes[0];
}

export function difficultyLabel(difficulty: string): string {
  return t(`difficulty.${difficulty}`);
}

export function difficultyBlurb(difficulty: string): string {
  return t(`difficulty.${difficulty}Blurb`);
}

export function weightLabel(weight: string): string {
  return t(`weight.${weight}`);
}

export function themeLabel(theme: string): string {
  return t(`theme.${theme}`);
}

document.documentElement.lang = language;
