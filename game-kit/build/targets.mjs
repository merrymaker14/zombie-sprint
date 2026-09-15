/* Собрать vite-игру под площадки.
 *
 *   import { buildTargets } from 'game-kit/build';
 *   await buildTargets({ root: process.cwd(), libs: { vkok: [[из, во]] } });
 *
 * Что делает: гоняет обычную сборку vite один раз, а потом раскладывает её по
 * каталогам dist-<площадка>, вставляя в <head> нужную голову и проверяя ГОТОВЫЙ
 * файл перед подачей.
 *
 * Зачем в общем слое. Игра без этого шага работает и при этом не является игрой
 * для площадки: window.__PLATFORM__ остаётся 'none', поднимается драйвер-
 * пустышка, и нет ни рекламы, ни сохранений площадки, ни сигнала готовности. Это
 * не заметно ни в браузере, ни в тестах — заметно на модерации.
 *
 * Три вещи, каждая из которых стоила отказа или чёрного экрана, и все три
 * проверяются здесь:
 *
 *   ОТНОСИТЕЛЬНЫЕ ПУТИ. vite по умолчанию ставит /assets/…; в APK и на площадке,
 *   где игра лежит в подкаталоге, это чёрный экран без единой ошибки в консоли —
 *   худший вид поломки, потому что искать нечего. В конфиге нужен base:'./'.
 *
 *   МЕТКА ГОЛОВЫ. Нет метки — нет SDK. Собранная без него игра выглядит рабочей.
 *   Поэтому отсутствие метки роняет сборку, а не собирает молча.
 *
 *   ПРОВЕРКА СОБРАННОГО, а не намерения: посторонние загрузки, http://,
 *   неподставленная площадка, пробел или кириллица в именах файлов.
 */
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { TARGETS, HEAD_MARK, auditBuild } from '../platform/targets.js';

const rmrf = (p) => fs.rmSync(p, { recursive: true, force: true });

function copyDir(from, to) {
  if (!fs.existsSync(from)) return;
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, e.name), b = path.join(to, e.name);
    if (e.isDirectory()) copyDir(a, b); else fs.copyFileSync(a, b);
  }
}

/** Все файлы каталога относительными путями — их проверяет аудит имён. */
export function listFiles(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory()
    ? listFiles(path.join(dir, e.name), base)
    : [path.relative(base, path.join(dir, e.name)).split(path.sep).join('/')]));
}

/**
 * @param {object}   o
 * @param {string}   o.root      корень игры (там, где node_modules и package.json)
 * @param {string}   [o.appDir]  каталог с шаблоном и public/, по умолчанию корень
 * @param {string|null} [o.vitePath] что передать vite аргументом. По умолчанию —
 *                       appDir. null означает «ничего не передавать»: корень
 *                       задаёт сам конфиг игры, и аргумент его перебьёт, отправив
 *                       сборку не туда.
 * @param {string}   [o.dist]    куда vite кладёт сборку, по умолчанию <appDir>/dist
 * @param {string[]} [o.only]    какие площадки собирать; по умолчанию все
 * @param {object}   [o.libs]    доп. файлы по площадкам: { vkok: [[откуда, как назвать]] }
 * @param {string[]} [o.cloudKeys] ключи, которые возить в облако площадки
 * @param {string[]} [o.localKeys] ключи, которые скоупить, но в облако не возить
 * @param {string}   [o.gdId]    идентификатор игры в GameDistribution
 * @param {Function} [o.before]  что сделать до vite (сценарий, словари, музыка)
 * @param {Function} [o.log]     куда печатать
 * @returns {{ built: string[], failed: string[] }}
 */
export function buildTargets(o) {
  const root = o.root;
  const appDir = o.appDir ? path.resolve(root, o.appDir) : root;
  const dist = o.dist ? path.resolve(root, o.dist) : path.join(appDir, 'dist');
  const log = o.log || console.log;
  const libs = o.libs || {};

  if (o.before) o.before();

  rmrf(dist);
  const vite = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
  if (!fs.existsSync(vite)) throw new Error('не найден vite в ' + root);
  const vitePath = o.vitePath === undefined ? (path.relative(root, appDir) || '.') : o.vitePath;
  execFileSync(process.execPath, [vite, 'build', ...(vitePath ? [vitePath] : [])],
    { stdio: 'inherit', cwd: root });

  const indexPath = path.join(dist, 'index.html');
  if (!fs.existsSync(indexPath)) throw new Error('vite не собрал ' + indexPath);
  const baseHtml = fs.readFileSync(indexPath, 'utf8');
  if (!baseHtml.includes(HEAD_MARK)) {
    throw new Error(`в шаблоне пропала метка ${HEAD_MARK} — площадке некуда вставлять SDK.\n`
      + 'Без неё собралась бы игра без интеграции: она выглядит рабочей и получает отказ.');
  }

  /* Языки объявляет сама сборка. Угадывать в рантайме нельзя: отсутствие
     словаря должно означать отсутствие языка, а не 404 у игрока. */
  const langsDir = path.join(appDir, 'public', 'assets', 'text');
  const langs = fs.existsSync(langsDir)
    ? fs.readdirSync(langsDir).filter((f) => /^[a-z]{2}(-[A-Z]{2})?\.json$/.test(f)).map((f) => f.replace('.json', ''))
    : [];

  const built = [], failed = [];
  for (const name of (o.only && o.only.length ? o.only : Object.keys(TARGETS))) {
    const t = TARGETS[name];
    if (!t) { log(`✗ неизвестная площадка: ${name}`); failed.push(name); continue; }

    /* Рядом с обычной сборкой, а не внутри каталога с шаблоном: у игры, где
       корень vite лежит в src/, каталоги площадок иначе оказываются внутри
       исходников — и попадают то в сборку, то в поиск по коду. */
    const out = path.join(path.dirname(dist), 'dist-' + name);
    rmrf(out);
    copyDir(dist, out);

    /* Что объявляет сборка ДО скриптов площадки: языки и ключи сохранений.
       Ключи нужны бутстрапу ВК раньше, чем он исполнится, — он читает их сразу
       при запуске. Угадать их он не может: это единственное, что в нём про
       конкретную игру. */
    const decls = ['window.__LANGS=' + JSON.stringify(langs)];
    if (o.cloudKeys) decls.push('window.__CLOUD_KEYS=' + JSON.stringify(o.cloudKeys));
    if (o.localKeys) decls.push('window.__LOCAL_KEYS=' + JSON.stringify(o.localKeys));
    /* Запасной путь для ссылки на игру (приглашения, «поделиться»), если
       vk_app_id вдруг не пришёл в URL. Площадка сама подставляет его при
       обычном открытии — это только страховка от кривых внешних ссылок. */
    if (name === 'vkok' && o.vkAppId) decls.push('window.__VK_APP_ID=' + JSON.stringify(o.vkAppId));
    const head = '<script>' + decls.join(';') + ';</script>\n'
      + t.head.replace('@GD_ID@', o.gdId || '');
    fs.writeFileSync(path.join(out, 'index.html'), baseHtml.replace(HEAD_MARK, head));

    let libOk = true;
    for (const [from, as] of (libs[name] || [])) {
      const src = path.resolve(root, from);
      if (!fs.existsSync(src)) { log(`✗ ${name}: нет ${from}`); libOk = false; continue; }
      fs.mkdirSync(path.join(out, 'libs'), { recursive: true });
      fs.copyFileSync(src, path.join(out, 'libs', as));
    }

    const files = listFiles(out);
    const html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
    /* Код бандла — тоже часть подаваемого архива, и посторонние загрузки живут
       чаще всего именно в нём, а не в разметке. */
    const code = files.filter((f) => /\.(js|mjs|css)$/.test(f))
      .map((f) => fs.readFileSync(path.join(out, f), 'utf8')).join('\n');
    const problems = auditBuild(html, name, files, code);
    if (/(?:src|href)="\/(?!\/)/.test(html)) {
      problems.push('абсолютные пути к файлам — в APK это чёрный экран (нужен base:"./" в конфиге vite)');
    }
    if (!libOk) problems.push('не хватает файлов площадки');

    if (problems.length) {
      log(`✗ ${name}: ${problems.join('; ')}`);
      failed.push(name);
    } else {
      const size = files.reduce((a, f) => a + fs.statSync(path.join(out, f)).size, 0);
      log(`✔ ${name}: ${files.length} файлов, ${(size / 1048576).toFixed(1)} МБ → dist-${name}`);
      built.push(name);
    }
  }
  return { built, failed };
}
