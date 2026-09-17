/* Набор проверок игры.
 *
 *   npm test                    поднимает dev-сервер сам и гоняет всё
 *   npm test -- --port=5190     тот же прогон на заданном порту
 *
 * Сначала типы, затем браузерные проверки на dev-сервере, в конце — СВЕЖИЕ
 * сборки площадок и проверка слоя рекламы на настоящем dist-crazy: на площадку
 * уезжает архив, а не dev-сервер.
 *
 * Playwright берётся из node_modules рядом с проектом; если его там нет,
 * укажите PLAYWRIGHT_FROM=<путь к package.json, рядом с которым он установлен>.
 */
import { spawn, spawnSync } from 'child_process';
import http from 'http';
import net from 'net';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const portArg = process.argv.slice(2).find((a) => a.startsWith('--port='));

const freePort = () => new Promise((res) => {
  const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => res(p)); });
});
const PORT = portArg ? Number(portArg.slice(7)) : await freePort();
const URL = `http://localhost:${PORT}/`;

/* Готовность проверяем HTTP-запросом: vite слушает localhost, который на
   Windows разрешается в IPv6, и tcp-проба по числовому адресу молчит зря. */
const up = () => new Promise((res) => {
  const r = http.get(URL, (x) => { x.resume(); res(true); });
  r.on('error', () => res(false));
  r.setTimeout(1500, () => { r.destroy(); res(false); });
});

/* --force: game-kit лежит в node_modules и пре-бандлится; без пересборки кэша
   dev-сервер отдал бы прошлую версию слоя рекламы. */
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(PORT), '--strictPort', '--force'],
  { stdio: 'ignore' });

let ok = false;
for (let i = 0; i < 60 && !ok; i++) { ok = await up(); if (!ok) await wait(500); }
if (!ok) { vite.kill(); console.error('dev-сервер не поднялся'); process.exit(1); }

const steps = [
  ['типы', ['node_modules/typescript/bin/tsc', '--noEmit']],
  ['жизненный цикл', ['tests/lifecycle.mjs', '--url=' + URL]],
  ['обязательства перед площадками', ['tests/platform.mjs', '--url=' + URL]],
  ['игра на телефоне', ['tests/touch.mjs', '--url=' + URL]],
];
const distSteps = [
  ['пересборка всех целей', ['tools/build-targets.mjs']],
  ['слой рекламы на сборке CrazyGames', ['tests/sdk-drivers.mjs', '--dir=dist-crazy']],
];

let failed = 0;
const run = ([name, args]) => {
  console.log('\n=== ' + name + ' ===');
  const r = spawnSync(process.execPath, args, { stdio: 'inherit' });
  if (r.status !== 0) { failed++; console.error('✗ ' + name); }
};
for (const step of steps) run(step);
vite.kill();
for (const step of distSteps) run(step);

console.log(failed ? `\n${failed} проверок не прошли` : '\nвсе проверки пройдены');
process.exit(failed ? 1 : 0);
