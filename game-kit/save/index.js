/* Сохранения: локально, с областью площадки и облачной копией.
 *
 * Три вещи, которые каждая игра иначе пишет заново и каждый раз забывает одну
 * из них:
 *
 *   ОБЛАСТЬ. ВКонтакте и Одноклассники открывают игру с ОДНОГО адреса, а
 *   localStorage привязан к адресу: без разделения игрок ВК и игрок ОК в одном
 *   браузере видят общий прогресс. Одноклассники требуют обратного прямо в
 *   правилах. Область объявляет бутстрап площадки (window.__SAVE_SCOPE), здесь
 *   её только уважают.
 *
 *   ПРИВАТНЫЙ РЕЖИМ. localStorage может бросать на запись, и игра, которая этого
 *   не ждёт, падает на первом же сохранении — у игрока, который ничего не делал
 *   не так. Все обращения обёрнуты.
 *
 *   ОБЛАКО. Площадка хранит прогресс у себя, и это единственный способ не
 *   потерять его при смене устройства. Отдаём наружу через крючок: сам вызов
 *   площадки — дело бутстрапа, который знает про её лимиты и дебаунс.
 *
 * Чего здесь НЕТ намеренно: что именно сохранять. Снимок состояния — про игру.
 */

/** Ключ с областью площадки. Область добавляет бутстрап; нет её — ключ прежний,
 *  и старые сохранения остаются на месте. */
export const scoped = (key) => key + ((typeof window !== 'undefined' && window.__SAVE_SCOPE) || '');

const storage = () => {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch (e) { return null; }
};

/** Отдать значение площадке. Ставит бутстрап; нет его — молча ничего. */
const cloud = (key, value) => {
  try { window.__cloudPut && window.__cloudPut(key, value); } catch (e) { }
};

/** Прочитать. Ничего нет или мусор — вернём запасное значение, а не бросим:
 *  испорченное сохранение не должно мешать играть заново. */
export function read(key, fallback = null) {
  const ls = storage();
  if (!ls) return fallback;
  try {
    const raw = ls.getItem(scoped(key));
    return raw === null ? fallback : JSON.parse(raw);
  } catch (e) { return fallback; }
}

/** Записать локально и отдать площадке. */
export function write(key, value) {
  const ls = storage();
  const data = JSON.stringify(value);
  try { ls && ls.setItem(scoped(key), data); } catch (e) { /* приватный режим — не беда */ }
  cloud(key, data);
  return value;
}

/** Стереть. Площадке тоже говорим — иначе облачная копия воскресит стёртое при
 *  следующем запуске, и «начать заново» окажется невыполнимым. */
export function drop(key) {
  const ls = storage();
  try { ls && ls.removeItem(scoped(key)); } catch (e) { }
  cloud(key, null);
}

export function has(key) {
  const ls = storage();
  if (!ls) return false;
  try { return ls.getItem(scoped(key)) !== null; } catch (e) { return false; }
}

/**
 * Дождаться площадки перед первым чтением.
 *
 * Бутстрап тянет облачную копию и кладёт её в localStorage ДО старта игры. Если
 * начать читать раньше, игрок на новом устройстве увидит пустое прохождение, а
 * через секунду поверх него приедет настоящее — и что из этого сохранится,
 * зависит от того, кто успел записать последним.
 *
 * Промис обязан разрешаться всегда: нет площадки — играем на локальном.
 */
export function ready() {
  try {
    if (typeof window !== 'undefined' && window.__PLATFORM_READY) return window.__PLATFORM_READY;
  } catch (e) { }
  return Promise.resolve(false);
}
