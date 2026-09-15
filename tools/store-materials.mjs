/* Generate store screenshots, covers and short trailers from the real game UI. */
import fs from 'fs';
import path from 'path';
import http from 'http';
import { execFileSync, spawn } from 'child_process';
import puppeteer from '../../game-kit/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';

const ROOT = process.cwd();
const PORT = 5197;
const PROMO_LANG = process.env.PROMO_LANG === 'en' ? 'en' : 'ru';
const URL = `http://127.0.0.1:${PORT}/?lang=${PROMO_LANG}`;
const RAW = path.join(ROOT, 'store-assets', '_raw');
const OUT = path.join(ROOT, 'store-assets', PROMO_LANG);
const FONT = 'C\\:/Windows/Fonts/segoeuib.ttf';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const checkServer = () => new Promise((resolve) => {
  const req = http.get(URL, (res) => { res.resume(); resolve(true); });
  req.on('error', () => resolve(false));
  req.setTimeout(1200, () => { req.destroy(); resolve(false); });
});
const ff = (args) => execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args], { stdio: 'inherit' });
const ensure = (dir) => fs.mkdirSync(dir, { recursive: true });
const input = (name) => path.join(RAW, `${name}.png`);
const esc = (value) => value.replace(/'/g, "\\'").replace(/:/g, '\\:');

fs.rmSync(RAW, { recursive: true, force: true });
ensure(RAW);
fs.rmSync(OUT, { recursive: true, force: true });

const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
try {
  let ready = false;
  for (let i = 0; i < 60 && !ready; i++) { ready = await checkServer(); if (!ready) await sleep(500); }
  if (!ready) throw new Error('Vite server did not start');

  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: 'new',
    args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=swiftshader'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });

  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => Boolean(window.__zombieSprint), { timeout: 30000 });
  await sleep(1200);
  await page.screenshot({ path: input('01-title') });

  await page.keyboard.press('Enter');
  await page.waitForSelector('.panel-chars.active', { timeout: 10000 });
  await sleep(500);
  await page.screenshot({ path: input('02-zombies') });

  await page.evaluate(() => {
    const button = document.querySelector('[data-action="release-horde"]');
    button?.click();
  });
  await page.waitForSelector('.panel-tracks.active', { timeout: 10000 });
  await sleep(500);
  await page.screenshot({ path: input('03-routes') });

  await page.evaluate(() => {
    const button = document.querySelector('[data-action="start-run"]');
    button?.click();
  });
  await page.waitForFunction(() => {
    const loading = document.querySelector('.loading');
    const hud = document.querySelector('.hud');
    return Boolean(loading?.classList.contains('hidden') && hud && !hud.classList.contains('hidden'));
  }, { timeout: 30000 });
  await sleep(1800);
  await page.screenshot({ path: input('04-race') });

  await browser.close();
  if (errors.some((error) => !/favicon|404|PCFSoftShadowMap/.test(error))) {
    throw new Error(`Browser errors: ${errors.join(' | ')}`);
  }
} finally {
  vite.kill();
}

const slide = (from, to, width, height) => ff([
  '-i', input(from), '-vf',
  `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1`,
  '-frames:v', '1', to,
]);

const title = (from, to, width, height, kind = 'cover') => {
  const size = kind === 'icon' ? Math.round(width * 0.105) : Math.round(width * 0.075);
  const y = kind === 'icon' ? 'h*0.68' : 'h*0.08';
  const box = kind === 'icon'
    ? `drawbox=x=0:y=ih*0.58:w=iw:h=ih*0.42:color=0x080b1d@0.82:t=fill,`
    : `drawbox=x=0:y=0:w=iw:h=ih*0.27:color=0x080b1d@0.45:t=fill,`;
  ff([
    '-i', input(from), '-vf',
    `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1,${box}`
      + `drawtext=fontfile='${FONT}':text='ZOMBIE SPRINT':fontcolor=white:fontsize=${size}:x=(w-text_w)/2:y=${y}:`
      + 'shadowcolor=0x000000@0.85:shadowx=3:shadowy=3',
    '-frames:v', '1', to,
  ]);
};

const makeScreens = (dir, width, height) => {
  ensure(dir);
  ['01-title', '02-zombies', '03-routes', '04-race'].forEach((name, index) => {
    slide(name, path.join(dir, `screen-${index + 1}-${width}x${height}.png`), width, height);
  });
};

const yandex = path.join(OUT, 'yandex');
const vkok = path.join(OUT, 'vkok');
const crazy = path.join(OUT, 'crazy');
const gamedist = path.join(OUT, 'gamedist');
for (const dir of [yandex, vkok, crazy, gamedist]) ensure(dir);

makeScreens(yandex, 1920, 1080);
makeScreens(crazy, 1920, 1080);
makeScreens(vkok, 1200, 600);

title('04-race', path.join(yandex, 'icon-512.png'), 512, 512, 'icon');
title('04-race', path.join(yandex, 'cover-800x470.png'), 800, 470);

title('04-race', path.join(vkok, 'icon-576-universal.png'), 576, 576, 'icon');
title('04-race', path.join(vkok, 'icon-278-catalog.png'), 278, 278, 'icon');
title('04-race', path.join(vkok, 'icon-150-small.png'), 150, 150, 'icon');
ff(['-i', input('04-race'), '-vf', 'scale=32:32:force_original_aspect_ratio=increase,crop=32:32,eq=saturation=1.2:contrast=1.1', path.join(vkok, 'favicon-32.png')]);
title('04-race', path.join(vkok, 'snippet-1120x630.png'), 1120, 630);

title('04-race', path.join(crazy, 'icon-512.png'), 512, 512, 'icon');
title('04-race', path.join(crazy, 'cover-square-800x800.png'), 800, 800);
title('04-race', path.join(crazy, 'cover-portrait-800x1200.png'), 800, 1200);
title('04-race', path.join(crazy, 'cover-landscape-1920x1080.png'), 1920, 1080);

title('04-race', path.join(gamedist, 'icon-512.png'), 512, 512, 'icon');
title('04-race', path.join(gamedist, 'marketing-1280x720.jpg'), 1280, 720);
title('04-race', path.join(gamedist, 'marketing-1280x550.jpg'), 1280, 550);
title('04-race', path.join(gamedist, 'cover-landscape-1920x1080.png'), 1920, 1080);
ff(['-i', path.join(gamedist, 'icon-512.png'), '-vf', 'scale=512:384:force_original_aspect_ratio=increase,crop=512:384', '-q:v', '2', path.join(gamedist, 'thumb-512x384.jpg')]);
ff(['-i', path.join(gamedist, 'icon-512.png'), '-vf', 'scale=512:512', '-q:v', '2', path.join(gamedist, 'thumb-512x512.jpg')]);
ff(['-i', path.join(gamedist, 'icon-512.png'), '-vf', 'scale=200:120:force_original_aspect_ratio=increase,crop=200:120', '-q:v', '3', path.join(gamedist, 'thumb-200x120.jpg')]);

const slides = ['01-title', '02-zombies', '03-routes', '04-race'];
const videoArgs = [];
slides.forEach((name) => { videoArgs.push('-loop', '1', '-t', '5', '-i', input(name)); });
const filters = slides.map((_, i) => `[${i}:v]scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,setsar=1,fade=t=in:st=0:d=0.25,fade=t=out:st=4.75:d=0.25[v${i}]`).join(';');
const concat = `${filters};${slides.map((_, i) => `[v${i}]`).join('')}concat=n=${slides.length}:v=1:a=0,drawtext=fontfile='${FONT}':text='ZOMBIE SPRINT':fontcolor=white:fontsize=64:x=(w-text_w)/2:y=42:shadowcolor=0x000000@0.75:shadowx=3:shadowy=3[v]`;
const trailer = path.join(OUT, '_trailer-landscape.mp4');
ff([
  ...videoArgs, '-f', 'lavfi', '-t', '20', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000',
  '-filter_complex', concat, '-map', '[v]', '-map', `${slides.length}:a`, '-t', '20',
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-crf', '20',
  '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', trailer,
]);

for (const dir of [yandex, vkok, crazy, gamedist]) fs.copyFileSync(trailer, path.join(dir, 'trailer-en-20s-1280x720.mp4'));
ff(['-i', trailer, '-t', '10', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-movflags', '+faststart', path.join(yandex, 'video-cover.mp4')]);
ff(['-i', trailer, '-filter_complex', '[0:v]split=2[bg][fg];[bg]scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,boxblur=24:2,eq=brightness=-0.06[back];[fg]scale=720:-2[front];[back][front]overlay=(W-w)/2:(H-h)/2[v]', '-map', '[v]', '-map', '0:a?', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '21', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', path.join(crazy, 'trailer-en-20s-720x1280.mp4')]);

fs.rmSync(RAW, { recursive: true, force: true });
fs.rmSync(trailer, { force: true });
console.log('Store materials created in ' + path.relative(ROOT, OUT));
