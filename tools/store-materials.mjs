/* Store screenshots, covers, icons and beat-cut trailers from the real game.
 *
 *   npm run promo                        ru and en
 *   PROMO_LANG=en npm run promo          one language
 *   KEEP_RAW=1 npm run promo             keep store-assets/_raw (clips, contact sheets)
 *
 * Hardware GL only: software rendering drops the game into its low-quality mode.
 * Trailers follow the store rule: raw clips with headroom first, then ffmpeg cuts
 * every shot to a whole number of beats of the race theme (152 bpm) and joins them
 * end to end over the music from its first note. Lengths: ~27 s (VK 30 s cap, GD),
 * ~19 s landscape + portrait (CrazyGames 20 s cap, Yandex 28 s cap), no letterbox
 * bars; real gameplay fills at least 70% of every video and Yandex screenshot.
 */
import fs from 'fs';
import path from 'path';
import http from 'http';
import { execFileSync, spawn } from 'child_process';
import { loadPlaywright, sleep } from '../tests/harness.mjs';

const ROOT = process.cwd();
const PORT = 5197;
const LANGS = process.env.PROMO_LANG ? [process.env.PROMO_LANG] : ['ru', 'en'];
const RAW = path.join(ROOT, 'store-assets', '_raw');
const FONT = 'C\\:/Windows/Fonts/segoeuib.ttf';
const BEAT = 60 / 152;
const FPS = 30;
const SUBTITLE = { ru: 'ЧЕМПИОНАТ ЗОМБИ', en: 'ZOMBIE CHAMPIONSHIP' };
const TRACKS = ['sunny_circuit', 'dune_drift', 'frostbite_falls', 'neon_nexus'];
const HEROES = ['rosa', 'bram', 'juno', 'max', 'fennec', 'kai', 'pixel', 'zippy'];

const ff = (args) => execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args], { stdio: 'inherit' });
const ensure = (dir) => fs.mkdirSync(dir, { recursive: true });
const up = (url) => new Promise((resolve) => {
  const req = http.get(url, (res) => { res.resume(); resolve(true); });
  req.on('error', () => resolve(false));
  req.setTimeout(1500, () => { req.destroy(); resolve(false); });
});

fs.rmSync(RAW, { recursive: true, force: true });
ensure(RAW);

// ------------------------------------------------------------------ capture
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
try {
  let ready = false;
  for (let i = 0; i < 60 && !ready; i++) { ready = await up(`http://localhost:${PORT}/`); if (!ready) await sleep(500); }
  if (!ready) throw new Error('Vite server did not start');
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch({
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
  });
  for (const lang of LANGS) await capture(browser, lang);
  await browser.close();
} finally {
  vite.kill();
}

async function openGame(browser, lang, width, height) {
  const page = await (await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`http://localhost:${PORT}/?lang=${lang}&auto=1`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__zombieSprint?.currentState === 'title', null, { timeout: 90000 });
  await page.evaluate(() => {
    const g = window.__zombieSprint;
    const b = g.backdrop;
    const original = b.update.bind(b);
    // Optional camera override for menu shots: re-applied every frame before the easing.
    window.__promo = { spec: null, angle: null, focusY: null };
    b.update = (dt, cam) => {
      const p = window.__promo;
      if (p.spec) Object.assign(b.cur, p.spec);
      if (p.angle !== null) b.angle = p.angle(dt);
      if (p.focusY !== null) b.focus.y = p.focusY;
      original(dt, cam);
    };
    // Step capture: the real-time loop is paused and the game advances by exactly 1/30 s per
    // frame. Real-time recording dropped frames and let the menu camera jump with uneven dt.
    window.__stepFrames = (count) => {
      const DT = 1 / 30;
      const frames = [];
      let goAt = -1;
      cancelAnimationFrame(g.rafId);
      g.rafId = 0;
      try {
        for (let i = 0; i < count; i++) {
          g.frame(DT, g.input.update());
          if (goAt < 0 && g.currentState === 'racing') goAt = i;
          frames.push(g.renderer.domElement.toDataURL('image/jpeg', 0.93).split(',')[1]);
        }
      } finally {
        g.lastTime = -1;
        g.rafId = requestAnimationFrame(g.loop);
      }
      return { frames, goAt };
    };
  });
  return { page, errors };
}

/** Step-captures `seconds` of the game into an exact 30 fps clip; returns the frame the race started at. */
async function stepClip(page, file, seconds) {
  const dir = `${file}.frames`;
  fs.rmSync(dir, { recursive: true, force: true });
  ensure(dir);
  const { frames, goAt } = await page.evaluate((n) => window.__stepFrames(n), Math.round(seconds * FPS));
  frames.forEach((b64, i) => fs.writeFileSync(path.join(dir, `${String(i).padStart(4, '0')}.jpg`), Buffer.from(b64, 'base64')));
  ff(['-framerate', String(FPS), '-i', path.join(dir, '%04d.jpg'), '-c:v', 'libx264', '-preset', 'fast', '-crf', '14', '-pix_fmt', 'yuv420p', file]);
  fs.rmSync(dir, { recursive: true, force: true });
  return goAt;
}

function save(file, base64) {
  fs.writeFileSync(file, Buffer.from(base64, 'base64'));
}

async function startRace(page, trackId, characterId = 'bram') {
  await page.evaluate(([t, c]) => {
    const g = window.__zombieSprint;
    g.startRace({ characterId: c, trackId: t, difficulty: 'normal', laps: 3 });
  }, [trackId, characterId]);
  await page.waitForFunction(() => window.__zombieSprint.currentState === 'countdown', null, { timeout: 90000 });
}

async function toMenu(page) {
  await page.evaluate(() => window.__zombieSprint.returnToMenu('title'));
  await page.waitForFunction(() => window.__zombieSprint.currentState === 'title', null, { timeout: 30000 });
  await sleep(600);
}

async function lineup(page, on) {
  await page.evaluate(async (show) => {
    const g = window.__zombieSprint;
    const b = g.backdrop;
    if (!show) {
      for (const k of window.__lineup || []) { b.group.remove(k.object); k.dispose(); }
      window.__lineup = [];
      b.kartHolder.visible = true;
      window.__promo = { spec: null, angle: null, focusY: null };
      return;
    }
    const { Kart } = await import('/src/kart/Kart.ts');
    const V3 = g.camera.position.constructor;
    const Q = g.camera.quaternion.constructor;
    const face = new Q(0, 1, 0, 0);
    b.kartHolder.visible = false;
    window.__lineup = g.mainMenu.characters.map((c, i) => {
      const k = new Kart(100 + i, c, false);
      k.setFrozen(true);
      const row = i < 4 ? 0 : 1;
      k.resetTo(new V3(((i % 4) - 1.5) * 1.55 + (row ? 0.4 : 0), 0.32, row ? 0.9 : -0.9), face);
      k.object.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      k.updateVisuals(0);
      b.group.add(k.object);
      return k;
    });
    let a = -0.22;
    window.__promo = { spec: { distance: 8.6, height: 2.1, fov: 30, sx: 0, sy: 0.05 }, angle: (dt) => (a += dt * 0.09), focusY: 0.7 };
  }, on);
  await sleep(500);
}

async function hero(page, id) {
  await page.evaluate((cid) => {
    const g = window.__zombieSprint;
    const b = g.backdrop;
    b.setCharacter(g.mainMenu.characters.find((c) => c.id === cid));
    let a = 0.5;
    b.kartHolder.rotation.y = a + Math.PI - 0.45;
    window.__promo = { spec: { distance: 3.1, height: 0.45, fov: 30, sx: 0, sy: 0.02 }, angle: (dt) => (a += dt * 0.05), focusY: 0.95 };
  }, id);
  await sleep(350);
}

async function capture(browser, lang) {
  const dir = path.join(RAW, lang);
  ensure(dir);
  const log = { lang, start: {} };

  // Screenshots at store size, with the real interface.
  {
    const { page, errors } = await openGame(browser, lang, 1920, 1080);
    await page.keyboard.press('Enter');
    await page.waitForSelector('.panel-chars.active', { timeout: 15000 }).catch(() => {});
    await sleep(900);
    await page.screenshot({ path: path.join(dir, 'shot-zombies.png') });
    await page.evaluate(() => document.querySelector('[data-action="release-horde"]')?.click());
    await sleep(1200);
    await page.screenshot({ path: path.join(dir, 'shot-routes.png') });
    await page.evaluate(() => { document.getElementById('ui').style.visibility = 'hidden'; });
    await toMenu(page);
    await lineup(page, true);
    await sleep(800);
    await page.screenshot({ path: path.join(dir, 'shot-lineup.png') });
    await lineup(page, false);
    for (const id of ['rosa', 'bram']) {
      await hero(page, id);
      await page.evaluate(() => { window.__promo.spec = { distance: 1.9, height: 0.2, fov: 30, sx: 0, sy: 0.12 }; window.__promo.focusY = 1.18; });
      await sleep(500);
      await page.screenshot({ path: path.join(dir, `shot-face-${id}.png`), clip: { x: 420, y: 0, width: 1080, height: 1080 } });
    }
    await page.evaluate(() => { document.getElementById('ui').style.visibility = ''; window.__promo = { spec: null, angle: null, focusY: null }; });
    for (const id of TRACKS) {
      await startRace(page, id, id === 'neon_nexus' ? 'pixel' : id === 'frostbite_falls' ? 'kai' : 'bram');
      await page.waitForFunction(() => window.__zombieSprint.currentState === 'racing', null, { timeout: 30000 });
      await sleep(7500);
      await page.screenshot({ path: path.join(dir, `shot-race-${id}.png`) });
      await toMenu(page);
    }
    if (errors.length) console.warn(`[${lang}] screenshot console errors:`, errors.slice(0, 5));
    await page.context().close();
  }

  // Raw trailer clips (canvas only) and the music bed.
  {
    const { page, errors } = await openGame(browser, lang, 1280, 720);
    await page.evaluate(() => { document.getElementById('ui').style.visibility = 'hidden'; });
    await lineup(page, true);
    await stepClip(page, path.join(dir, 'clip-lineup.mp4'), 6.5);
    await lineup(page, false);
    for (const id of HEROES) {
      await hero(page, id);
      await stepClip(page, path.join(dir, `clip-hero-${id}.mp4`), 1.9);
    }
    for (const id of TRACKS) {
      await startRace(page, id, id === 'neon_nexus' ? 'pixel' : id === 'frostbite_falls' ? 'kai' : 'bram');
      if (id === TRACKS[0]) {
        // Through the countdown; the race start is known to the frame.
        const goFrame = await stepClip(page, path.join(dir, 'clip-start.mp4'), 7);
        log.start.goAt = goFrame >= 0 ? goFrame / FPS : -1;
      }
      await page.waitForFunction(() => window.__zombieSprint.currentState === 'racing', null, { timeout: 30000 });
      await sleep(2500);
      await stepClip(page, path.join(dir, `clip-race-${id}.mp4`), 8);
      await toMenu(page);
    }
    if (lang === LANGS[0]) {
      // Race theme alone: effects, engines and UI buses silenced, master tapped into a recorder.
      await startRace(page, TRACKS[1]);
      const audio = await page.evaluate(async () => {
        const g = window.__zombieSprint;
        const a = g.audio;
        if (!a.ctx) g.onGesture?.();
        for (let i = 0; i < 50 && !a.ctx; i++) await new Promise((r) => setTimeout(r, 100));
        await a.ctx.resume();
        const dest = a.ctx.createMediaStreamDestination();
        a.master.connect(dest);
        const mute = () => { for (const bus of [a.sfxBus, a.enginesBus, a.uiBus]) if (bus) bus.gain.value = 0; };
        mute();
        const keep = setInterval(mute, 100);
        a.playMusic('race');
        const rec = new MediaRecorder(dest.stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 192000 });
        const parts = [];
        rec.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
        const done = new Promise((r) => { rec.onstop = r; });
        rec.start(250);
        await new Promise((r) => setTimeout(r, 42000));
        rec.stop();
        await done;
        clearInterval(keep);
        const buf = await new Blob(parts).arrayBuffer();
        let s = '';
        const bytes = new Uint8Array(buf);
        for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return btoa(s);
      });
      save(path.join(RAW, 'music-race.webm'), audio);
    }
    if (errors.length) console.warn(`[${lang}] clip console errors:`, errors.slice(0, 5));
    await page.context().close();
  }
  fs.writeFileSync(path.join(dir, 'log.json'), JSON.stringify(log, null, 2));
}

// ------------------------------------------------------------------ edit
const music = path.join(RAW, 'music-race.wav');
ff(['-i', path.join(RAW, 'music-race.webm'), '-af', 'silenceremove=start_periods=1:start_threshold=-45dB,loudnorm=I=-15:TP=-1.5:LRA=11', '-ar', '48000', music]);

function shot(src, from, beats, out, text = null) {
  const dur = beats * BEAT;
  // Push-in computed at 4x and scaled down, so zoom and centre steps are sub-pixel instead of 1-2 px jumps.
  const push = `scale=w='2*trunc(5120*(1+0.04*t/${dur.toFixed(4)})/2)':h='2*trunc(2880*(1+0.04*t/${dur.toFixed(4)})/2)':eval=frame:flags=bicubic,crop=5120:2880,scale=1280:720:flags=lanczos,setsar=1`;
  const title = text
    ? `,drawbox=x=0:y=ih*0.62:w=iw:h=ih*0.3:color=0x07091a@0.5:t=fill,drawtext=fontfile='${FONT}':text='ZOMBIE SPRINT':fontcolor=white:fontsize=92:x=(w-text_w)/2:y=h*0.66:shadowcolor=0x000000@0.8:shadowx=4:shadowy=4,drawtext=fontfile='${FONT}':text='${text}':fontcolor=0xb8ff7a:fontsize=40:x=(w-text_w)/2:y=h*0.8:shadowcolor=0x000000@0.8:shadowx=3:shadowy=3`
    : '';
  ff(['-ss', from.toFixed(3), '-i', src, '-t', dur.toFixed(4), '-an', '-vf', `fps=${FPS},${push}${title}`,
    '-c:v', 'libx264', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-crf', '21', '-maxrate', '5M', '-bufsize', '10M', '-r', String(FPS), out]);
  return dur;
}

function cut(lang, name, plan) {
  const dir = path.join(RAW, lang);
  const parts = path.join(dir, `parts-${name}`);
  ensure(parts);
  const list = [];
  const bounds = [];
  let total = 0;
  plan.forEach((p, i) => {
    const out = path.join(parts, `${String(i).padStart(2, '0')}.mp4`);
    bounds.push(total + (p.beats * BEAT) / 2);
    total += shot(path.join(dir, p.clip), p.from, p.beats, out, p.title ? SUBTITLE[lang] : null);
    list.push(`file '${out.replace(/\\/g, '/')}'`);
  });
  const listFile = path.join(parts, 'list.txt');
  fs.writeFileSync(listFile, list.join('\n'));
  const video = path.join(parts, 'video.mp4');
  ff(['-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', video]);
  const out = path.join(dir, `trailer-${name}.mp4`);
  const fadeAt = Math.max(0, total - 2 * BEAT);
  ff(['-i', video, '-i', music, '-map', '0:v', '-map', '1:a', '-t', total.toFixed(4),
    '-af', `afade=t=out:st=${fadeAt.toFixed(3)}:d=${(2 * BEAT).toFixed(3)}`,
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', out]);
  // Contact sheet: the middle frame of every shot, to eyeball the cuts.
  const sheet = path.join(RAW, `contact-${lang}-${name}.png`);
  const select = bounds.map((t) => `lt(prev_pts*TB\\,${t.toFixed(3)})*gte(pts*TB\\,${t.toFixed(3)})`).join('+');
  ff(['-i', out, '-vf', `select='${select}',scale=320:-2,tile=${Math.min(plan.length, 6)}x${Math.ceil(plan.length / 6)}`, '-frames:v', '1', '-vsync', 'vfr', sheet]);
  console.log(`[${lang}] trailer ${name}: ${total.toFixed(2)} s, ${plan.length} shots`);
  return out;
}

const plans = (goAt) => {
  const start = Math.max(0, goAt - 2 * BEAT);
  const heroes = (n, beats) => HEROES.slice(0, n).map((id) => ({ clip: `clip-hero-${id}.mp4`, from: 0.25, beats }));
  const races = (beats) => TRACKS.map((id) => ({ clip: `clip-race-${id}.mp4`, from: 0.4, beats }));
  // Real gameplay (start + races) must fill at least 70% of a store video (Yandex rule): 27s = 50/68, 19s = 36/48.
  return {
    '27s': [{ clip: 'clip-lineup.mp4', from: 0.3, beats: 6, title: true }, ...heroes(3, 2), { clip: 'clip-start.mp4', from: start, beats: 6 }, ...races(11), { clip: 'clip-lineup.mp4', from: 2.2, beats: 6, title: true }],
    '19s': [{ clip: 'clip-lineup.mp4', from: 0.3, beats: 4, title: true }, ...heroes(2, 2), { clip: 'clip-start.mp4', from: start, beats: 4 }, ...races(8), { clip: 'clip-lineup.mp4', from: 2.2, beats: 4, title: true }],
  };
};

for (const lang of LANGS) {
  const dir = path.join(RAW, lang);
  const OUT = path.join(ROOT, 'store-assets', lang);
  fs.rmSync(OUT, { recursive: true, force: true });
  const log = JSON.parse(fs.readFileSync(path.join(dir, 'log.json'), 'utf8'));
  const p = plans(log.start.goAt > 0 ? log.start.goAt : 3.2);
  const trailers = Object.fromEntries(Object.entries(p).map(([name, plan]) => [name, cut(lang, name, plan)]));

  const img = (name) => path.join(dir, `${name}.png`);
  const fit = (from, to, w, h, extra = '') => ff(['-i', img(from), '-vf', `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1${extra}`, '-frames:v', '1', to]);
  const cover = (to, w, h) => fit('shot-lineup', to, w, h,
    `,drawbox=x=0:y=ih*0.7:w=iw:h=ih*0.3:color=0x07091a@0.55:t=fill,drawtext=fontfile='${FONT}':text='ZOMBIE SPRINT':fontcolor=white:fontsize=${Math.round(Math.min(w / 9, h / 5.2))}:x=(w-text_w)/2:y=h*0.745:shadowcolor=0x000000@0.85:shadowx=3:shadowy=3`);
  const screens = ['shot-race-sunny_circuit', 'shot-zombies', 'shot-race-dune_drift', 'shot-race-frostbite_falls', 'shot-routes', 'shot-race-neon_nexus'];
  const makeScreens = (to, w, h) => screens.forEach((s, i) => fit(s, path.join(to, `screen-${i + 1}-${w}x${h}.png`), w, h));

  const yandex = path.join(OUT, 'yandex');
  const vkok = path.join(OUT, 'vkok');
  const crazy = path.join(OUT, 'crazy');
  const gamedist = path.join(OUT, 'gamedist');
  for (const d of [yandex, vkok, crazy, gamedist]) ensure(d);

  // Yandex screenshots must show real gameplay on at least 70% of the image: races only.
  screens.filter((s) => s.startsWith('shot-race-')).forEach((s, i) => fit(s, path.join(yandex, `screen-${i + 1}-1920x1080.png`), 1920, 1080));
  makeScreens(crazy, 1920, 1080);
  makeScreens(vkok, 1200, 600);

  // Yandex videos: 16:9 required and 9:16 optional, both up to 28 s and 100 MB.
  fit('shot-face-rosa', path.join(yandex, 'icon-512.png'), 512, 512);
  cover(path.join(yandex, 'cover-800x470.png'), 800, 470);
  fs.copyFileSync(trailers['19s'], path.join(yandex, 'trailer-19s-1280x720.mp4'));

  for (const s of [576, 278, 150]) fit('shot-face-rosa', path.join(vkok, `icon-${s}-${s === 576 ? 'universal' : s === 278 ? 'catalog' : 'small'}.png`), s, s);
  fit('shot-face-rosa', path.join(vkok, 'favicon-32.png'), 32, 32, ',eq=saturation=1.2:contrast=1.1');
  cover(path.join(vkok, 'snippet-1120x630.png'), 1120, 630);
  fs.copyFileSync(trailers['27s'], path.join(vkok, 'trailer-27s-1280x720.mp4'));

  fit('shot-face-bram', path.join(crazy, 'icon-512.png'), 512, 512);
  cover(path.join(crazy, 'cover-square-800x800.png'), 800, 800);
  cover(path.join(crazy, 'cover-portrait-800x1200.png'), 800, 1200);
  cover(path.join(crazy, 'cover-landscape-1920x1080.png'), 1920, 1080);
  fs.copyFileSync(trailers['19s'], path.join(crazy, 'trailer-19s-1280x720.mp4'));
  ff(['-i', trailers['19s'], '-filter_complex', '[0:v]split=2[bg][fg];[bg]scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,boxblur=24:2,eq=brightness=-0.06[back];[fg]scale=720:-2[front];[back][front]overlay=(W-w)/2:(H-h)/2[v]', '-map', '[v]', '-map', '0:a', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', path.join(crazy, 'trailer-19s-720x1280.mp4')]);
  fs.copyFileSync(path.join(crazy, 'trailer-19s-720x1280.mp4'), path.join(yandex, 'trailer-19s-720x1280.mp4'));

  fit('shot-face-bram', path.join(gamedist, 'icon-512.png'), 512, 512);
  cover(path.join(gamedist, 'marketing-1280x720.jpg'), 1280, 720);
  cover(path.join(gamedist, 'marketing-1280x550.jpg'), 1280, 550);
  cover(path.join(gamedist, 'cover-landscape-1920x1080.png'), 1920, 1080);
  for (const [w, h] of [[512, 384], [512, 512], [200, 120]]) fit('shot-lineup', path.join(gamedist, `thumb-${w}x${h}.jpg`), w, h);
  fs.copyFileSync(trailers['27s'], path.join(gamedist, 'trailer-27s-1280x720.mp4'));
  console.log(`[${lang}] store materials → ${path.relative(ROOT, OUT)}`);
}

if (!process.env.KEEP_RAW) fs.rmSync(RAW, { recursive: true, force: true });
