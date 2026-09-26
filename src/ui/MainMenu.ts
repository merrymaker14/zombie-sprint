/**
 * Main menu: Title → Character Select → Track Select. Pure DOM; the 3D backdrop
 * behind it is owned by Game (mirrored via onHighlight).
 */
import type { CharacterDef, Difficulty, InputState, RaceSettings, TrackDefinition } from '../core/types';
import type { TrackRecord } from '../game/Records';
import { events } from '../core/events';
import { formatRaceTime } from '../core/math';
import { GAME_TITLE, DEFAULT_LAPS } from '../core/constants';
import { button, cssHex, cssRgba, el, TextField } from './dom';
import {
  characterName,
  characterTagline,
  difficultyBlurb,
  difficultyLabel,
  formatOrdinal,
  getLanguage,
  onLanguageChange,
  setLanguage,
  t,
  themeLabel,
  trackDescription,
  trackName,
  weightLabel,
  zombieJoke,
} from '../core/i18n';
import { keyLabel, onKeyLabelsChange } from './keyLabels';

export type MenuPanel = 'title' | 'characterSelect' | 'trackSelect';

/** Clicks right after a panel appears are the tail of a double click on the previous panel. */
const CLICK_LOCK_MS = 500;
/** Compaction steps tried (style.css `.fit-N`) until the select panel fits the viewport. */
const MAX_FIT_LEVEL = 4;

const DIFFICULTIES: readonly Difficulty[] = ['easy', 'normal', 'hard'];
const DIFFICULTY_LABEL: Record<Difficulty, string> = { easy: 'difficulty.easy', normal: 'difficulty.normal', hard: 'difficulty.hard' };
const STAT_KEYS: readonly { key: keyof CharacterDef['stats']; label: string }[] = [
  { key: 'speed', label: 'SPD' },
  { key: 'acceleration', label: 'ACC' },
  { key: 'handling', label: 'HND' },
  { key: 'weight', label: 'WGT' },
  { key: 'miniTurbo', label: 'MT' },
];
const CHAR_COLUMNS = 4;
/** Portrait palette; mirrors the 3D drivers built in KartModel. */
const ZOMBIE_PORTRAIT_COLORS: Record<string, { skin: string; shade: string; shirt: string; hair: string }> = {
  zippy: { skin: '#9fd47c', shade: '#6f7486', shirt: '#283a7c', hair: '#1e2c4a' },
  pixel: { skin: '#a9dcae', shade: '#8f78a6', shirt: '#2e2447', hair: '#2a2440' },
  fennec: { skin: '#92bf6f', shade: '#6d6376', shirt: '#e8902a', hair: '#5e3b22' },
  max: { skin: '#a6c67f', shade: '#70697c', shirt: '#7a4a2a', hair: '#6c4326' },
  juno: { skin: '#9ccaa0', shade: '#6c6a8c', shirt: '#444859', hair: '#1d1a29' },
  kai: { skin: '#76b9a2', shade: '#5a6b82', shirt: '#d1a93a', hair: '#3f6e2d' },
  bram: { skin: '#82a56b', shade: '#5e5a70', shirt: '#d88a3c', hair: '#34402c' },
  rosa: { skin: '#b5c99f', shade: '#86709a', shirt: '#5b2c83', hair: '#6d53a3' },
};

/** Bust of a zombie racer as inline SVG (viewBox 160x64, head centred at 80,33). */
function zombiePortraitSvg(id: string): string {
  const key = id in ZOMBIE_PORTRAIT_COLORS ? id : 'zippy';
  const { skin, shade, shirt, hair } = ZOMBIE_PORTRAIT_COLORS[key];
  const MOUTH = '#3b2433';
  const PUPIL = '#1c1824';
  const WHITE = '#ebe7cf';
  const TOOTH = '#f3eec8';
  const STITCH = '#28301f';
  const PLASTER = '#e9c29a';
  const BANDAGE = '#e2ddd0';

  const torso = (w: number, fill: string): string =>
    `<path d="M${80 - w} 64 C${80 - w} 53 ${80 - w * 0.55} 48.5 80 48.5 C${80 + w * 0.55} 48.5 ${80 + w} 53 ${80 + w} 64 Z" fill="${fill}"/>`;
  const neck = (w = 10): string => `<rect x="${80 - w / 2}" y="41" width="${w}" height="10" fill="${skin}"/>`;
  const ears = (spread = 17): string =>
    [-1, 1]
      .map((s) => `<ellipse cx="${80 + s * spread}" cy="34.5" rx="3.2" ry="4.6" fill="${skin}"/><ellipse cx="${80 + s * (spread + 0.3)}" cy="34.5" rx="1.5" ry="2.6" fill="${shade}"/>`)
      .join('');
  const headShape = `<ellipse cx="80" cy="33" rx="17" ry="17.5" fill="${skin}"/>`;
  const stitch = (x1: number, y1: number, x2: number, y2: number, n: number): string => {
    let s = `<path d="M${x1} ${y1} L${x2} ${y2}" stroke="${STITCH}" stroke-width="1" stroke-linecap="round"/>`;
    const len = Math.hypot(x2 - x1, y2 - y1);
    const nx = (-(y2 - y1) / len) * 1.8;
    const ny = ((x2 - x1) / len) * 1.8;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const x = x1 + (x2 - x1) * t;
      const y = y1 + (y2 - y1) * t;
      s += `<path d="M${(x - nx).toFixed(1)} ${(y - ny).toFixed(1)} L${(x + nx).toFixed(1)} ${(y + ny).toFixed(1)}" stroke="${STITCH}" stroke-width="0.9" stroke-linecap="round"/>`;
    }
    return s;
  };
  const bandAid = (x: number, y: number, k = 1): string =>
    [45, -45].map((a) => `<rect x="${x - 3.6 * k}" y="${y - 1.2 * k}" width="${7.2 * k}" height="${2.4 * k}" rx="0.8" fill="${PLASTER}" transform="rotate(${a} ${x} ${y})"/>`).join('');

  type Eyes = 'goofy' | 'sleepy' | 'closed' | 'wide' | 'patch';
  type Mouth = 'grin' | 'open' | 'howl' | 'lips' | 'tusks';
  const face = (big: 1 | -1, eyes: Eyes, mouth: Mouth, brow: string | null): string => {
    const bx = 80 - 7 * big;
    const sx = 80 + 7.5 * big;
    let s = '';
    if (eyes === 'closed') {
      for (const x of [bx, sx]) {
        s += `<ellipse cx="${x}" cy="35.5" rx="6" ry="5" fill="${shade}"/>`;
        s += `<path d="M${x - 4} 34.5 Q${x} 29 ${x + 4} 34.5" stroke="${PUPIL}" stroke-width="1.8" fill="none" stroke-linecap="round"/>`;
      }
    } else {
      const bigR = eyes === 'sleepy' ? 5.2 : 6;
      s += `<ellipse cx="${bx}" cy="35.5" rx="7.6" ry="6.6" fill="${shade}"/><circle cx="${bx}" cy="33" r="${bigR}" fill="${WHITE}"/>`;
      if (eyes === 'wide') s += `<circle cx="${bx}" cy="33" r="1.8" fill="${PUPIL}"/>`;
      else s += `<circle cx="${bx + 1.8 * big}" cy="34.4" r="2.4" fill="${PUPIL}"/>`;
      if (eyes === 'sleepy') s += `<path d="M${bx - 5.8} 33.6 A5.8 5.8 0 0 1 ${bx + 5.8} 33.6 Z" fill="${skin}"/>`;
      if (eyes !== 'patch') {
        s += `<ellipse cx="${sx}" cy="35" rx="5.6" ry="5" fill="${shade}"/><circle cx="${sx}" cy="33.5" r="4.3" fill="${WHITE}"/>`;
        if (eyes === 'wide') s += `<circle cx="${sx}" cy="33.5" r="1.5" fill="${PUPIL}"/>`;
        else {
          s += `<circle cx="${sx + big}" cy="35" r="1.7" fill="${PUPIL}"/>`;
          s += `<path d="M${sx - 4.7} ${eyes === 'sleepy' ? 34.4 : 33.4} A4.7 4.7 0 0 1 ${sx + 4.7} ${eyes === 'sleepy' ? 34.4 : 33.4} Z" fill="${skin}"/>`;
        }
      }
    }
    if (brow) {
      s += `<path d="M${bx - 5} 25.8 L${bx + 5} 24.2" stroke="${brow}" stroke-width="2.2" stroke-linecap="round"/>`;
      if (eyes !== 'patch') s += `<path d="M${sx - 4.5} 27.2 L${sx + 4.5} 28.8" stroke="${brow}" stroke-width="2.2" stroke-linecap="round"/>`;
    }
    if (mouth !== 'howl' && mouth !== 'tusks') s += `<ellipse cx="80.5" cy="38.8" rx="2.1" ry="1.7" fill="${shade}" fill-opacity="0.45"/>`;
    if (mouth === 'grin') {
      s += `<path d="M72.5 44 Q79 47.8 87.5 43" stroke="${MOUTH}" stroke-width="3.2" fill="none" stroke-linecap="round"/>`;
      s += `<rect x="76" y="42.6" width="2.8" height="3.2" fill="${TOOTH}" transform="rotate(8 77.4 44)"/><rect x="83.4" y="42.8" width="2.3" height="2.6" fill="${TOOTH}" transform="rotate(-12 84.5 44)"/>`;
    } else if (mouth === 'open') {
      s += `<ellipse cx="80.5" cy="45" rx="4.2" ry="3.2" fill="${MOUTH}"/><rect x="79" y="41.9" width="2.6" height="2.8" fill="${TOOTH}"/>`;
    } else if (mouth === 'howl') {
      s += `<ellipse cx="80" cy="38" rx="3.2" ry="2.3" fill="#2d2227"/>`;
      s += `<ellipse cx="80" cy="45.2" rx="4" ry="5" fill="${MOUTH}"/><ellipse cx="80" cy="48" rx="2.4" ry="1.4" fill="#ff7fa0"/>`;
      s += `<path d="M76.9 41 l0.9 2.6 l0.9 -2.6 Z M81.3 41 l0.9 2.6 l0.9 -2.6 Z" fill="${TOOTH}"/>`;
    } else if (mouth === 'lips') {
      s += `<path d="M74 44.2 Q80 47.6 86 43.6 Q80 42.2 74 44.2 Z" fill="#6b2b5a"/><rect x="80.6" y="43.2" width="2" height="2.2" fill="${TOOTH}" transform="rotate(-12 81.6 44)"/>`;
    }
    return s;
  };

  let back = '';
  let body = '';
  let head = '';
  let front = '';
  let defs = '';

  switch (key) {
    case 'zippy': {
      back = `<path d="M95 27 L117 19.5 L119 24 L97 31 Z" fill="#ff3fb4"/><path d="M96 29.5 L115 33.5 L113.5 38 L95.5 33.5 Z" fill="#ff3fb4"/><path d="M108 22.8 L110 22.1 L111.4 26.2 L109.4 26.9 Z" fill="#ffffff"/>`;
      body = `<path d="M50 64 C50 53 60 48.5 80 48.5 C100 48.5 110 53 110 64 Z" fill="${skin}"/>` + neck();
      body += `<path d="M63 64 C63 55 68 50 72.5 49 L87.5 49 C92 50 97 55 97 64 Z" fill="${shirt}"/>`;
      body += stitch(58, 50.5, 55, 57, 3) + stitch(102, 50.5, 105, 57, 3);
      body += `<rect x="72" y="53" width="16" height="11" rx="1" fill="#fbf8ee"/><path d="M79 56.8 L81.8 55 L81.8 62.5 L79.8 62.5 L79.8 58 L79 58.4 Z" fill="#22304a"/>`;
      head = ears() + headShape + face(1, 'goofy', 'grin', null) + bandAid(90.5, 41, 0.75);
      front = `<path d="M63 30 C62 12 98 12 97 30 Z" fill="${hair}"/>`;
      front += `<path d="M64 24 L59 12 L68.5 17 L69 6 L76.5 14 L81 3 L85 13.5 L92.5 6 L92 16.5 L101.5 12 L96 24 Z" fill="${hair}"/>`;
      front += `<path d="M62.5 27.2 Q80 22 97.5 27.2 L97.5 32 Q80 26.8 62.5 32 Z" fill="#ff3fb4"/><path d="M62.8 29.6 Q80 24.4 97.2 29.6" stroke="#ffffff" stroke-width="1.1" fill="none"/>`;
      break;
    }
    case 'pixel': {
      defs = `<linearGradient id="zp-mohawk" x1="0" y1="1" x2="0" y2="0"><stop offset="0.45" stop-color="#4dffc3"/><stop offset="1" stop-color="#ff5fd2"/></linearGradient>`;
      body = `<ellipse cx="80" cy="50" rx="17" ry="5" fill="#3a3057"/>` + neck() + torso(27, shirt);
      body += `<path d="M76.5 50 V59 M83.5 50 V59" stroke="#4dffc3" stroke-width="1.4" class="char-zombie-glow"/><circle cx="76.5" cy="60" r="1.3" fill="#ff5fd2"/><circle cx="83.5" cy="60" r="1.3" fill="#ff5fd2"/>`;
      body += `<path d="M56 62 Q58 54 65 51 M104 62 Q102 54 95 51" stroke="#4dffc3" stroke-width="1.8" fill="none" stroke-linecap="round" class="char-zombie-glow"/>`;
      head = ears() + headShape + face(-1, 'goofy', 'grin', hair) + stitch(65.5, 21, 64, 29, 3);
      head += `<circle cx="62.6" cy="40.5" r="1.6" fill="none" stroke="#ff5fd2" stroke-width="1" class="char-zombie-glow"/>`;
      front = `<path d="M73.5 19.5 L71 6 L76.2 13 L78.5 1.5 L81.5 12.5 L86 3.5 L86.5 13.5 L91.5 8.5 L87.5 20 Q80 16.5 73.5 19.5 Z" fill="url(#zp-mohawk)" class="char-zombie-glow"/>`;
      break;
    }
    case 'fennec': {
      let mane = '';
      for (let i = 0; i < 26; i++) {
        const a = (i / 26) * Math.PI * 2;
        const r = i % 2 ? 19 : 27 + 2.5 * Math.sin(i * 2.3);
        mane += `${i ? 'L' : 'M'}${(80 + Math.cos(a) * r * 1.05).toFixed(1)} ${(35 + Math.sin(a) * r * 0.95).toFixed(1)} `;
      }
      back = `<path d="${mane}Z" fill="${hair}"/><ellipse cx="80" cy="35" rx="21" ry="20" fill="#9a6a3e" fill-opacity="0.35"/>`;
      back += [-1, 1].map((s) => `<path d="M${80 + s * 16} 20 L${80 + s * 21} 3 L${80 + s * 6} 13 Z" fill="${hair}"/><path d="M${80 + s * 14.5} 17 L${80 + s * 18} 7 L${80 + s * 9} 13.5 Z" fill="#f29aa8"/>`).join('');
      body = neck() + torso(26, shirt) + `<path d="M80 50 V64" stroke="#9a5a1a" stroke-width="1.6"/>`;
      body += `<path d="M58 52 L62 57 M61 50.5 L65 55.5 M98 52 L102 57" stroke="${skin}" stroke-width="1.2" stroke-linecap="round"/>`;
      head = headShape + face(1, 'closed', 'howl', null) + stitch(91.5, 39, 89.5, 46, 2);
      head += `<path d="M68 29.5 L76 27.5 M84 27.5 L92 29.5" stroke="${hair}" stroke-width="2" stroke-linecap="round"/>`;
      front = `<path d="M67 23 L71 29 L74.5 21.5 L80 28.5 L85.5 21.5 L89 29 L93 23 Q80 12 67 23 Z" fill="${hair}"/>`;
      break;
    }
    case 'max': {
      back = `<path d="M93 46 C104 43.5 112 39.5 126 42.5 L127 48 C113 45.5 105 50 94 53 Z" fill="#f7f3e8"/><path d="M111.5 41 L115.5 40.6 L116.4 46.2 L112.4 46.8 Z" fill="#d83a2e"/>`;
      back += `<path d="M126.5 43 L131 41.5 M127 45.5 L131.5 45.5 M127 48 L131 49.5" stroke="#d83a2e" stroke-width="1" stroke-linecap="round"/>`;
      body = neck() + torso(29, shirt);
      body += [66, 70, 74, 78, 82, 86, 90, 94].map((x, i) => `<circle cx="${x}" cy="${49.5 - Math.sin((i / 7) * Math.PI) * 1.2}" r="3.3" fill="${i % 2 ? '#efe2c4' : '#dfcca4'}"/>`).join('');
      body += `<rect x="77" y="51" width="6" height="10" fill="#f7f3e8"/><rect x="77" y="57" width="6" height="2" fill="#d83a2e"/>`;
      head = headShape + face(1, 'goofy', 'grin', '#3a2a1f') + bandAid(86, 48, 0.6);
      head += `<path d="M80 41.2 C76 39 71 40 69.5 43.2 C73 42 76 43 80 42.8 C84 43 87 42 90.5 43.2 C89 40 84 39 80 41.2 Z" fill="#3a2a1f"/>`;
      front = `<path d="M60.5 40 C57 10 103 10 99.5 40 L98 47 C94 43 95.5 32 92 27.5 Q80 21 68 27.5 C64.5 32 66 43 62 47 Z" fill="${hair}"/>`;
      front += `<path d="M80 14 V21" stroke="#c99a66" stroke-width="1" stroke-dasharray="1.6 1.4"/>`;
      front += `<path d="M62 27 Q80 19.5 98 27" stroke="#3a2a1e" stroke-width="2.6" fill="none"/>`;
      front += [73, 87].map((x) => `<circle cx="${x}" cy="23" r="4.8" fill="#7fd6ff" stroke="#d5dbe2" stroke-width="2"/><circle cx="${x - 1.5}" cy="21.5" r="1.2" fill="#ffffff" fill-opacity="0.8"/>`).join('');
      front += `<rect x="77.2" y="22" width="5.6" height="2" fill="#d5dbe2"/>`;
      break;
    }
    case 'juno': {
      body = neck(11) + torso(29, shirt) + `<path d="M72 49 Q80 53 88 49" stroke="#2a2c36" stroke-width="2.4" fill="none"/>`;
      body += `<path d="M81.5 51 L76.5 57.5 L80.2 57.5 L78 63.5 L84.5 55.6 L80.8 55.6 L83.4 51 Z" fill="#ffc93a" class="char-zombie-glow"/>`;
      for (const s of [-1, 1]) {
        const x = 80 + s * 14;
        body += `<rect x="${Math.min(x, x + s * 9)}" y="40" width="9" height="4" rx="1" fill="#b9c2cc"/><rect x="${x + s * 9 - (s < 0 ? 4 : 0)}" y="38.5" width="4" height="7" rx="1" fill="#8d96a3"/>`;
        body += `<path d="M${x + s * 14} 37 L${x + s * 17} 33.5 L${x + s * 14.5} 32.5 L${x + s * 18} 28" stroke="#fff27a" stroke-width="1.4" fill="none" stroke-linecap="round" class="char-zombie-glow"/>`;
        body += `<path d="M${x + s * 14.5} 44 L${x + s * 18} 46 L${x + s * 16} 48" stroke="#9ff4ff" stroke-width="1.2" fill="none" stroke-linecap="round" class="char-zombie-glow"/>`;
      }
      head = ears() + `<path d="M63 31 C63 22 64 17.5 68 16.5 L92 16.5 C96 17.5 97 22 97 31 C97 44 90 51 80 51 C70 51 63 44 63 31 Z" fill="${skin}"/>`;
      head += face(-1, 'wide', 'grin', hair) + stitch(67, 21.5, 93, 21.5, 7);
      front = `<path d="M64 17.5 L62.5 2.5 L69 12 L70.5 1 L75 11 L78 1 L81 11 L85 1.5 L87 11 L92 1.5 L93 12 L98 3 L96 17.5 Z" fill="${hair}"/><path d="M84 13 L86.5 1.2 L89.8 12.5 Z" fill="#efeaf8"/>`;
      break;
    }
    case 'kai': {
      back = [-1, 1].map((s) => `<path d="M${80 + s * 17} 28 C${80 + s * 21} 38 ${80 + s * 19} 46 ${80 + s * 22} 54 M${80 + s * 13} 22 C${80 + s * 20} 30 ${80 + s * 23} 40 ${80 + s * 26} 49" stroke="${hair}" stroke-width="3" fill="none" stroke-linecap="round"/>`).join('');
      body = neck() + torso(28, shirt);
      body += `<rect x="70" y="53" width="20" height="11" fill="#587340"/><path d="M71.5 53.5 L66.5 48.5 M88.5 53.5 L93.5 48.5" stroke="#ff7a1a" stroke-width="2.8" stroke-linecap="round"/><circle cx="72.5" cy="55.5" r="1.3" fill="#ffd23f"/><circle cx="87.5" cy="55.5" r="1.3" fill="#ffd23f"/>`;
      head = headShape + face(1, 'sleepy', 'open', '#2e4f22') + bandAid(69.5, 41.5, 0.7);
      front = `<path d="M62.5 33 C59.5 11 100.5 11 97.5 33 C94 26.5 88 24 80 25 C72 24 66 26.5 62.5 33 Z" fill="#3a6329"/>`;
      front += `<path d="M69.5 25.5 L68 31.5 M75 24.5 L74.5 29.5 M86 24.5 L87 30 M91 26 L92.5 31.5" stroke="#5b8a36" stroke-width="2.3" stroke-linecap="round"/>`;
      front += `<path d="M79.5 25 V29" stroke="#a6e05a" stroke-width="1.8" stroke-linecap="round"/><circle cx="79.5" cy="30" r="1.6" fill="#a6e05a"/>`;
      front += `<ellipse cx="80" cy="15.2" rx="23" ry="5.2" fill="#3d8a31"/><ellipse cx="80" cy="14" rx="23" ry="5" fill="#62c247"/><path d="M80 14 L75 9.2 L81 9 Z" fill="#3d8a31"/>`;
      front += `<path d="M87 12.5 Q88.5 4 91 11 Q93.5 4 95 12.5 Z" fill="#ff7fc4"/><path d="M89.5 12 Q91 7 92.5 12 Z" fill="#ffd2ea"/><circle cx="91" cy="12.4" r="1.2" fill="#ffd84a"/>`;
      front += `<ellipse cx="70" cy="10.5" rx="5.2" ry="3.4" fill="#86d84c"/><circle cx="67.8" cy="7.5" r="1.9" fill="#86d84c"/><circle cx="72.2" cy="7.5" r="1.9" fill="#86d84c"/>`;
      front += `<circle cx="67.8" cy="7.3" r="1" fill="${WHITE}"/><circle cx="72.2" cy="7.3" r="1" fill="${WHITE}"/><circle cx="67.8" cy="7.5" r="0.5" fill="${PUPIL}"/><circle cx="72.2" cy="7.5" r="0.5" fill="${PUPIL}"/>`;
      front += `<path d="M68 11.5 Q70 12.8 72 11.5" stroke="#2f5a1c" stroke-width="0.7" fill="none"/>`;
      break;
    }
    case 'bram': {
      body = `<path d="M38 64 C38 51 54 46 80 46 C106 46 122 51 122 64 Z" fill="${skin}"/>` + neck(15);
      body += `<path d="M65 64 C65 56 69 50.5 73 49.5 L87 49.5 C91 50.5 95 56 95 64 Z" fill="${shirt}"/>`;
      body += `<path d="M50 53.5 L47 61 M53 52.5 L50 60.5" stroke="${BANDAGE}" stroke-width="2.4" stroke-linecap="round"/>` + stitch(108, 49.5, 111, 55, 3);
      head = ears(15) + `<ellipse cx="80" cy="33" rx="15" ry="15.5" fill="${skin}"/><ellipse cx="80" cy="43.5" rx="13.5" ry="7.5" fill="${skin}"/>`;
      head += face(1, 'patch', 'tusks', null);
      head += `<path d="M73 44.8 H87" stroke="${MOUTH}" stroke-width="2.2" stroke-linecap="round"/><path d="M74.2 45.5 L75.6 39.5 L77.6 45.5 Z M82.4 45.5 L84.4 39.5 L85.8 45.5 Z" fill="${TOOTH}"/>`;
      head += `<ellipse cx="80.5" cy="38" rx="2.3" ry="1.9" fill="${shade}" fill-opacity="0.45"/>`;
      front = `<path d="M65.5 29 C65 15 95 15 94.5 29 C90 23 70 23 65.5 29 Z" fill="${hair}"/>`;
      front += `<path d="M69.5 26.5 L79 28.5 L88.5 26.5" stroke="${hair}" stroke-width="2.6" fill="none" stroke-linejoin="round"/>`;
      front += `<path d="M64.5 16 L97 33 L96 39.5 L63.5 22.5 Z" fill="${BANDAGE}"/><path d="M66 21.5 Q80 15.5 94 21.5 L94 25.5 Q80 19.5 66 25.5 Z" fill="${BANDAGE}"/>`;
      front += `<path d="M71 20.5 L88 29.5" stroke="#b9b3a4" stroke-width="0.8"/>` + bandAid(88, 19, 0.75);
      break;
    }
    case 'rosa': {
      back = `<path d="M57.5 34 C55 11 105 11 102.5 34 C104.5 44 101 52 97 57 L63 57 C59 52 55.5 44 57.5 34 Z" fill="${hair}"/>`;
      back += `<path d="M56 57 Q57 44 64 45.5 Q65.5 38.5 71.5 42.5 Q75 36 80 41 Q85 36 88.5 42.5 Q94.5 38.5 96 45.5 Q103 44 104 57 Z" fill="#f7f3ff"/>`;
      back += `<path d="M64 45.5 L68 55 M71.5 42.5 L73.5 54 M80 41 V54 M88.5 42.5 L86.5 54 M96 45.5 L92 55" stroke="#e3daf2" stroke-width="1"/>`;
      body = neck() + torso(29, shirt) + `<circle cx="54" cy="58" r="9" fill="${shirt}"/><circle cx="106" cy="58" r="9" fill="${shirt}"/>`;
      body += `<path d="M66 56 Q80 60 94 56" stroke="#e0b04a" stroke-width="1.6" fill="none"/><circle cx="80" cy="58.2" r="2" fill="#19d3c5"/>`;
      body += [72, 75.5, 79, 82.5, 86].map((x) => `<circle cx="${x + 1}" cy="${50.2 + Math.abs(x + 1 - 80) * 0.08}" r="1.6" fill="#f7f3ff"/>`).join('');
      head = headShape + face(1, 'goofy', 'lips', '#4a3570');
      head += `<path d="M68 26.8 L66.5 24.5 M70.5 26.2 L70 23.6 M73 26.2 L73.5 23.6" stroke="${PUPIL}" stroke-width="0.9" stroke-linecap="round"/>`;
      head += `<ellipse cx="67.5" cy="41.5" rx="3" ry="1.8" fill="#d98fb0" fill-opacity="0.8"/><ellipse cx="92.5" cy="41.5" rx="3" ry="1.8" fill="#d98fb0" fill-opacity="0.8"/><circle cx="89" cy="44.5" r="0.8" fill="#3a2a3a"/>`;
      head += `<circle cx="61.8" cy="43" r="1.6" fill="#19d3c5"/><circle cx="98.2" cy="43" r="1.6" fill="#19d3c5"/>`;
      front = `<path d="M62.5 31 C61 14 99 14 97.5 31 C93.5 23 86 21 80 24.2 C74 21 66.5 23 62.5 31 Z" fill="${hair}"/>`;
      front += `<path d="M65.5 27 C67.5 20 73.5 17.5 78.5 18.8 C74 21 70.5 24 68.5 29.5 Z" fill="#e6e1f2"/>`;
      front += `<path d="M61 29 C57.5 40 59.5 48 63 53 L66 51 C63.5 45 63 38 64.5 30 Z" fill="#e6e1f2"/><path d="M99 29 C102.5 40 100.5 48 97 53 L94 51 C96.5 45 97 38 95.5 30 Z" fill="${hair}"/>`;
      front += `<g transform="rotate(-14 76 12)"><path d="M65.5 18.5 L65.5 7.5 L70.5 12 L76 3.5 L81.5 12 L86.5 7.5 L86.5 18.5 Z" fill="#f5c04a"/><path d="M65.5 16 H86.5" stroke="#c48f2a" stroke-width="1"/>`;
      front += `<circle cx="65.5" cy="7" r="1.4" fill="#fff0a0"/><circle cx="76" cy="3" r="1.5" fill="#fff0a0"/><circle cx="86.5" cy="7" r="1.4" fill="#fff0a0"/>`;
      front += `<circle cx="76" cy="14.5" r="2" fill="#ff4f9a"/><circle cx="70" cy="15" r="1.4" fill="#19d3c5"/><circle cx="82" cy="15" r="1.4" fill="#19d3c5"/></g>`;
      break;
    }
  }

  return (
    `<svg viewBox="0 0 160 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">` +
    (defs ? `<defs>${defs}</defs>` : '') +
    `<g class="char-zombie-bob">${back}${body}<g class="char-zombie-nod">${head}${front}</g></g></svg>`
  );
}

export class MainMenu {
  onStart: ((settings: RaceSettings) => void) | null = null;
  onHighlight: ((characterId: string) => void) | null = null;
  onPanelChange: ((panel: MenuPanel) => void) | null = null;
  onToggleSound: (() => void) | null = null;
  /** The player's record for a route and difficulty (null — none yet). */
  recordFor: ((trackId: string, difficulty: Difficulty) => TrackRecord | null) | null = null;

  private readonly rootNode: HTMLElement;
  private readonly panels: Record<MenuPanel, HTMLElement>;
  private panel: MenuPanel = 'title';
  private visible = false;

  // Character select
  private readonly charCards: HTMLElement[] = [];
  private charIndex = 0;
  private readonly charName: TextField;
  private readonly charTagline: TextField;

  // Track select
  private readonly trackCards: HTMLElement[] = [];
  private trackIndex = 0;
  private readonly diffButtons: HTMLElement[] = [];
  private difficultyIndex = 1;
  private readonly diffBlurb: TextField;
  private readonly startButton: HTMLElement;
  private readonly languageUnsub: () => void;
  private readonly jokeLine: TextField;
  private readonly jokeTimer: number;
  /** 0 = track cards row, 1 = difficulty row, 2 = start button. */
  private trackRow = 0;
  private readonly charGrid: HTMLElement;
  private readonly legendKeys: { node: HTMLElement; label: () => string }[] = [];
  private readonly keyLabelsUnsub: () => void;
  private clickLockUntil = 0;
  private fitFrame = 0;
  /**
   * Sound switch on the title. Until now the only way to mute was the M key: a
   * phone has none, and VK asks for a quick sound switch in the app (2.2.5).
   */
  private readonly soundButton: HTMLButtonElement;
  private soundMuted = false;
  private readonly recordPills: HTMLElement[] = [];

  constructor(
    root: HTMLElement,
    private readonly characters: readonly CharacterDef[],
    private readonly tracks: readonly TrackDefinition[],
  ) {
    this.rootNode = el('div', 'screen menu hidden', undefined, root);

    // ---------------------------------------------------------------- title
    const title = el('section', 'panel-title-screen', undefined, this.rootNode);
    const logoWrap = el('div', 'logo', undefined, title);
    const words = GAME_TITLE.split(' ');
    words.forEach((w, i) => {
      const line = el('span', `logo-word logo-word-${i}`, undefined, logoWrap);
      line.dataset.text = w;
      line.textContent = w;
    });
    this.i18nText('div', 'logo-sub', 'brand.subtitle', title);
    this.jokeLine = new TextField(el('div', 'zombie-joke', zombieJoke(), title));
    const languagePicker = el('div', 'language-picker glass', undefined, title);
    // A miss on the label or the gap between buttons must not count as "click to start".
    languagePicker.addEventListener('click', (ev) => ev.stopPropagation());
    this.i18nText('span', 'language-label', 'language.label', languagePicker);
    const languageButtons = el('div', 'language-buttons', undefined, languagePicker);
    for (const code of ['ru', 'en'] as const) {
      const languageButton = button(code === 'ru' ? 'РУ' : 'EN', 'lang-btn', () => setLanguage(code));
      languageButton.dataset.language = code;
      languageButtons.appendChild(languageButton);
    }
    const soundPicker = el('div', 'sound-picker glass', undefined, title);
    soundPicker.addEventListener('click', (ev) => ev.stopPropagation());
    this.soundButton = button(t('sound.on'), 'sound-btn', () => this.onToggleSound?.());
    this.soundButton.dataset.action = 'sound';
    soundPicker.appendChild(this.soundButton);
    const prompt = el('div', 'press-start', undefined, title);
    this.i18nText('span', 'press-start-text press-start-keys', 'menu.pressStart', prompt);
    this.i18nText('span', 'press-start-text press-start-touch', 'menu.pressStartTouch', prompt);
    const legend = el('div', 'controls-legend glass', undefined, title);
    // Arrows first: they are the same on every keyboard layout.
    const keys: [() => string, string][] = [
      [() => `↑ / ${keyLabel('KeyW')}`, 'controls.sprint'],
      [() => `↓ / ${keyLabel('KeyS')}`, 'controls.brake'],
      [() => `← → / ${keyLabel('KeyA')} ${keyLabel('KeyD')}`, 'controls.steer'],
      [() => 'SPACE / SHIFT', 'controls.drift'],
      [() => `${keyLabel('KeyE')} / ENTER`, 'controls.power'],
      [() => keyLabel('KeyQ'), 'controls.lookBack'],
      [() => `ESC / ${keyLabel('KeyP')}`, 'controls.pause'],
      [() => 'M', 'controls.mute'],
    ];
    for (const [label, v] of keys) {
      const row = el('div', 'legend-row', undefined, legend);
      this.legendKeys.push({ node: el('kbd', '', label(), row), label });
      this.i18nText('span', '', v, row);
    }
    this.keyLabelsUnsub = onKeyLabelsChange(() => this.refreshKeyLabels());
    title.addEventListener('click', () => {
      if (this.panel === 'title' && !this.clickLocked()) this.goTo('characterSelect', true);
    });

    // ------------------------------------------------------- character select
    const chars = el('section', 'panel-select panel-chars', undefined, this.rootNode);
    const charHead = el('header', 'select-header', undefined, chars);
    this.i18nText('div', 'panel-kicker', 'menu.chapter1', charHead);
    this.i18nText('h2', 'panel-title', 'menu.chooseZombie', charHead);
    const charGrid = el('div', 'card-grid char-grid', undefined, chars);
    this.charGrid = charGrid;
    characters.forEach((c, i) => {
      const card = this.buildCharacterCard(c);
      // Hover only lifts the card (CSS). Selection follows clicks, taps and keys, so the
      // cursor crossing other cards on its way to the footer does not change the choice.
      card.addEventListener('click', () => {
        if (this.clickLocked()) return;
        if (this.charIndex === i) this.goTo('trackSelect', true);
        else this.setCharacter(i, true);
      });
      charGrid.appendChild(card);
      this.charCards.push(card);
    });
    const charFoot = el('footer', 'select-footer glass', undefined, chars);
    const charInfo = el('div', 'select-info', undefined, charFoot);
    this.charName = new TextField(el('div', 'select-info-name', '', charInfo));
    this.charTagline = new TextField(el('div', 'select-info-tagline', '', charInfo));
    const charActions = el('div', 'actions', undefined, charFoot);
    charActions.appendChild(this.i18nButton('menu.back', 'ghost', () => {
      if (!this.clickLocked()) this.goTo('title', true);
    }));
    const releaseButton = this.i18nButton('menu.release', 'primary', () => {
      if (!this.clickLocked()) this.goTo('trackSelect', true);
    });
    releaseButton.dataset.action = 'release-horde';
    charActions.appendChild(releaseButton);

    // ----------------------------------------------------------- track select
    const tr = el('section', 'panel-select panel-tracks', undefined, this.rootNode);
    const trHead = el('header', 'select-header', undefined, tr);
    this.i18nText('div', 'panel-kicker', 'menu.chapter2', trHead);
    this.i18nText('h2', 'panel-title', 'menu.chooseRoute', trHead);
    const trackGrid = el('div', 'card-grid track-grid', undefined, tr);
    tracks.forEach((t, i) => {
      const card = this.buildTrackCard(t);
      // Hovering brings the focus ring back to the card row but never changes the route:
      // the first click or tap picks a route, a click on the picked one starts the run.
      card.addEventListener('pointerenter', (ev) => {
        if (ev.pointerType !== 'mouse') return;
        this.trackRow = 0;
        this.refreshTrackFocus();
      });
      card.addEventListener('click', () => {
        if (this.clickLocked()) return;
        if (this.trackIndex === i) this.start();
        else {
          this.trackRow = 0;
          this.setTrack(i, true);
        }
      });
      trackGrid.appendChild(card);
      this.trackCards.push(card);
    });
    const trFoot = el('footer', 'select-footer glass', undefined, tr);
    const diffWrap = el('div', 'difficulty', undefined, trFoot);
    this.i18nText('div', 'difficulty-label', 'menu.threatLevel', diffWrap);
    const seg = el('div', 'segmented', undefined, diffWrap);
    DIFFICULTIES.forEach((d, i) => {
      const b = this.i18nButton(DIFFICULTY_LABEL[d], 'seg', () => {}, seg);
      b.dataset.difficulty = d;
      b.type = 'button';
      b.addEventListener('pointerenter', () => {
        this.trackRow = 1;
        this.refreshTrackFocus();
      });
      b.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (this.clickLocked()) return;
        this.trackRow = 1;
        this.setDifficulty(i, true);
      });
      this.diffButtons.push(b);
    });
    this.diffBlurb = new TextField(el('div', 'difficulty-blurb', '', diffWrap));
    const trActions = el('div', 'actions', undefined, trFoot);
    trActions.appendChild(this.i18nButton('menu.back', 'ghost', () => {
      if (!this.clickLocked()) this.goTo('characterSelect', true);
    }));
    this.startButton = this.i18nButton('menu.startRun', 'primary start', () => {
      if (!this.clickLocked()) this.start();
    });
    this.startButton.dataset.action = 'start-run';
    this.startButton.addEventListener('pointerenter', () => {
      this.trackRow = 2;
      this.refreshTrackFocus();
    });
    trActions.appendChild(this.startButton);

    this.panels = { title, characterSelect: chars, trackSelect: tr };
    this.setCharacter(0);
    this.setTrack(0);
    this.setDifficulty(1);
    this.languageUnsub = onLanguageChange(() => this.refreshLanguage());
    this.jokeTimer = window.setInterval(() => this.jokeLine.set(zombieJoke()), 6500);
    window.addEventListener('resize', this.onResize);
    this.refreshLanguage();
    this.applyPanel();
  }

  // ------------------------------------------------------------------ public

  get currentPanel(): MenuPanel {
    return this.panel;
  }

  get highlightedCharacter(): CharacterDef {
    return this.characters[this.charIndex];
  }

  show(panel: MenuPanel = 'title'): void {
    this.rootNode.classList.remove('hidden');
    this.visible = true;
    // A race just finished may have set a record.
    this.refreshRecords();
    // The menu reopens under the cursor that just clicked a results or pause button.
    this.lockClicks();
    this.goTo(panel, false);
    this.onHighlight?.(this.highlightedCharacter.id);
  }

  hide(): void {
    this.rootNode.classList.add('hidden');
    this.visible = false;
  }

  /** One step back through the panels; false on the title, where nothing is left to close. */
  back(): boolean {
    if (!this.visible) return false;
    if (this.panel === 'trackSelect') this.goTo('characterSelect', true);
    else if (this.panel === 'characterSelect') this.goTo('title', true);
    else return false;
    return true;
  }

  dispose(): void {
    this.languageUnsub();
    this.keyLabelsUnsub();
    window.clearInterval(this.jokeTimer);
    window.removeEventListener('resize', this.onResize);
    cancelAnimationFrame(this.fitFrame);
    this.rootNode.remove();
  }

  /** Drive navigation from the InputState edges (keyboard / gamepad). */
  handleInput(input: InputState): void {
    if (!this.visible) return;
    switch (this.panel) {
      case 'title':
        if (input.confirm) this.goTo('characterSelect', true);
        break;
      case 'characterSelect': {
        const n = this.characters.length;
        if (input.menuLeft) this.setCharacter((this.charIndex - 1 + n) % n, true);
        else if (input.menuRight) this.setCharacter((this.charIndex + 1) % n, true);
        else if (input.menuUp) this.setCharacter((this.charIndex - CHAR_COLUMNS + n) % n, true);
        else if (input.menuDown) this.setCharacter((this.charIndex + CHAR_COLUMNS) % n, true);
        if (input.confirm) this.goTo('trackSelect', true);
        else if (input.back) this.goTo('title', true);
        break;
      }
      case 'trackSelect': {
        if (input.menuUp) {
          this.trackRow = (this.trackRow + 2) % 3;
          this.refreshTrackFocus();
          events.emit('ui:move', {});
        } else if (input.menuDown) {
          this.trackRow = (this.trackRow + 1) % 3;
          this.refreshTrackFocus();
          events.emit('ui:move', {});
        } else if (input.menuLeft || input.menuRight) {
          const dir = input.menuRight ? 1 : -1;
          if (this.trackRow === 0) {
            const n = this.tracks.length;
            this.setTrack((this.trackIndex + dir + n) % n, true);
          } else if (this.trackRow === 1) {
            this.setDifficulty((this.difficultyIndex + dir + 3) % 3, true);
          } else {
            events.emit('ui:move', {});
          }
        }
        if (input.confirm) this.start();
        else if (input.back) this.goTo('characterSelect', true);
        break;
      }
    }
  }

  // ----------------------------------------------------------------- private

  private goTo(panel: MenuPanel, sound: boolean): void {
    if (sound) {
      const forward =
        (this.panel === 'title' && panel !== 'title') || (this.panel === 'characterSelect' && panel === 'trackSelect');
      events.emit(forward ? 'ui:select' : 'ui:back', {});
    }
    const changed = panel !== this.panel;
    this.panel = panel;
    if (changed) this.lockClicks();
    this.applyPanel();
    if (changed) this.onPanelChange?.(panel);
  }

  private lockClicks(): void {
    this.clickLockUntil = performance.now() + CLICK_LOCK_MS;
  }

  private clickLocked(): boolean {
    return performance.now() < this.clickLockUntil;
  }

  private applyPanel(): void {
    for (const key of Object.keys(this.panels) as MenuPanel[]) {
      const node = this.panels[key];
      const active = key === this.panel;
      node.classList.toggle('active', active);
      if (active) {
        node.classList.remove('panel-in');
        void node.offsetWidth;
        node.classList.add('panel-in');
      }
    }
    if (this.panel === 'trackSelect') {
      this.trackRow = 0;
      this.refreshTrackFocus();
    }
    this.fitLayout();
  }

  private readonly onResize = (): void => {
    cancelAnimationFrame(this.fitFrame);
    this.fitFrame = requestAnimationFrame(() => this.fitLayout());
  };

  /**
   * Pick the least compact layout (`.fit-1`..`.fit-N`) in which the active select panel
   * fits the viewport, so Back / Start never leave the screen on short platform frames.
   * Offsets ignore the entry transforms, so this is safe mid-animation.
   */
  private fitLayout(): void {
    if (!this.visible || this.panel === 'title') return;
    const section = this.panels[this.panel];
    for (let level = 0; level <= MAX_FIT_LEVEL; level++) {
      for (let k = 1; k <= MAX_FIT_LEVEL; k++) section.classList.toggle(`fit-${k}`, k <= level);
      if (!this.panelOverflows(section)) break;
    }
    if (this.panel === 'characterSelect') this.revealCard(this.charGrid, this.charCards[this.charIndex]);
  }

  private panelOverflows(section: HTMLElement): boolean {
    if (section === this.panels.characterSelect) {
      // The grid shrinks and scrolls; it overflows when its cards need more than its box.
      const grid = this.charGrid;
      const first = this.charCards[0];
      const last = this.charCards[this.charCards.length - 1];
      if (!first || !last) return false;
      const cs = getComputedStyle(grid);
      const inner = grid.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      return last.offsetTop + last.offsetHeight - first.offsetTop > inner + 1;
    }
    const foot = section.querySelector<HTMLElement>('.select-footer');
    if (!foot) return false;
    const cs = getComputedStyle(section);
    return foot.offsetTop + foot.offsetHeight > section.clientHeight - parseFloat(cs.paddingBottom) + 1;
  }

  /** Keep the chosen card inside a scrolled card grid without scrolling the page layers. */
  private revealCard(grid: HTMLElement, card: HTMLElement | undefined): void {
    if (!card || grid.scrollHeight <= grid.clientHeight + 1) return;
    const cs = getComputedStyle(grid);
    const top = card.offsetTop - parseFloat(cs.paddingTop);
    const bottom = card.offsetTop + card.offsetHeight + parseFloat(cs.paddingBottom);
    if (top < grid.scrollTop) grid.scrollTop = top;
    else if (bottom > grid.scrollTop + grid.clientHeight) grid.scrollTop = bottom - grid.clientHeight;
  }

  private refreshKeyLabels(): void {
    for (const { node, label } of this.legendKeys) node.textContent = label();
  }

  private setCharacter(i: number, sound = false): void {
    if (i < 0 || i >= this.characters.length) return;
    const changed = i !== this.charIndex;
    this.charIndex = i;
    this.charCards.forEach((c, k) => {
      c.classList.toggle('selected', k === i);
      c.classList.toggle('focused', k === i);
    });
    const def = this.characters[i];
    this.charName.set(characterName(def.id, def.name).toUpperCase());
    this.charTagline.set(characterTagline(def.id, def.tagline));
    if (this.visible && this.panel === 'characterSelect') this.revealCard(this.charGrid, this.charCards[i]);
    if (changed) {
      if (sound) events.emit('ui:move', {});
      this.onHighlight?.(def.id);
    }
  }

  private setTrack(i: number, sound = false): void {
    if (i < 0 || i >= this.tracks.length) return;
    const changed = i !== this.trackIndex;
    this.trackIndex = i;
    this.trackCards.forEach((c, k) => c.classList.toggle('selected', k === i));
    this.refreshTrackFocus();
    if (changed && sound) events.emit('ui:move', {});
  }

  private setDifficulty(i: number, sound = false): void {
    const changed = i !== this.difficultyIndex;
    this.difficultyIndex = i;
    this.diffButtons.forEach((b, k) => b.classList.toggle('selected', k === i));
    this.diffBlurb.set(difficultyBlurb(DIFFICULTIES[i]));
    this.refreshRecords();
    this.refreshTrackFocus();
    if (changed && sound) events.emit('ui:move', {});
  }

  private refreshTrackFocus(): void {
    this.trackCards.forEach((c, k) => c.classList.toggle('focused', this.trackRow === 0 && k === this.trackIndex));
    this.diffButtons.forEach((b, k) =>
      b.classList.toggle('focused', this.trackRow === 1 && k === this.difficultyIndex),
    );
    this.startButton.classList.toggle('focused', this.trackRow === 2);
  }

  private start(): void {
    const track = this.tracks[this.trackIndex];
    const character = this.characters[this.charIndex];
    if (!track || !character) return;
    events.emit('ui:select', {});
    this.onStart?.({
      characterId: character.id,
      trackId: track.id,
      difficulty: DIFFICULTIES[this.difficultyIndex],
      laps: track.laps > 0 ? track.laps : DEFAULT_LAPS,
    });
  }

  private buildCharacterCard(c: CharacterDef): HTMLElement {
    const card = el('div', 'card char-card glass');
    card.tabIndex = -1;
    card.style.setProperty('--card-accent', cssHex(c.color));
    card.style.setProperty('--card-accent-2', cssHex(c.accent));
    card.style.setProperty('--card-glow', cssRgba(c.color, 0.55));
    const swatch = el('div', 'char-swatch', undefined, card);
    swatch.style.background = `linear-gradient(145deg, ${cssHex(c.color)} 0%, ${cssHex(c.accent)} 100%)`;
    const zombiePortrait = el('div', `char-zombie-portrait char-zombie-${c.id}`, undefined, swatch);
    // Static markup built from constants only.
    zombiePortrait.innerHTML = zombiePortraitSvg(c.id);
    el('div', 'card-name', characterName(c.id, c.name).toUpperCase(), card);
    el('div', 'card-tag', characterTagline(c.id, c.tagline), card);
    const pill = el('div', `pill weight-${c.weightClass}`, weightLabel(c.weightClass), card);
    pill.title = t('menu.zombieClass');
    const stats = el('div', 'stats', undefined, card);
    for (const s of STAT_KEYS) {
      const row = el('div', 'stat', undefined, stats);
      el('span', 'stat-label', t(`stats.${s.key === 'miniTurbo' ? 'miniTurbo' : s.key}`), row);
      const bar = el('div', 'stat-bar', undefined, row);
      const fill = el('div', 'stat-fill', undefined, bar);
      const v = Math.max(0, Math.min(1, c.stats[s.key]));
      fill.style.width = `${Math.round(v * 100)}%`;
    }
    return card;
  }

  private buildTrackCard(trackDef: TrackDefinition): HTMLElement {
    const card = el('div', 'card track-card glass');
    card.tabIndex = -1;
    const env = trackDef.environment;
    card.style.setProperty('--card-accent', cssHex(env.skyHorizon));
    card.style.setProperty('--card-glow', cssRgba(env.skyHorizon, 0.5));
    const art = el('div', 'track-art', undefined, card);
    art.style.background = `linear-gradient(180deg, ${cssHex(env.skyTop)} 0%, ${cssHex(env.skyHorizon)} 55%, ${cssHex(
      trackDef.palette.ground,
    )} 56%, ${cssHex(trackDef.palette.ground)} 100%)`;
    const road = el('div', 'track-art-road', undefined, art);
    road.style.background = cssHex(trackDef.palette.road);
    road.style.borderColor = cssHex(trackDef.palette.curb);
    el('div', 'track-theme-pill pill', themeLabel(trackDef.theme), art);
    const body = el('div', 'track-body', undefined, card);
    const nameRow = el('div', 'track-name-row', undefined, body);
    el('div', 'card-name', trackName(trackDef.id, trackDef.name).toUpperCase(), nameRow);
    const stars = el('div', 'stars', undefined, nameRow);
    for (let i = 0; i < 3; i++) el('span', i < trackDef.difficulty ? 'star on' : 'star', '★', stars);
    el('div', 'card-tag', trackDescription(trackDef.id, trackDef.description), body);
    const meta = el('div', 'track-meta', undefined, body);
    el('span', 'pill laps-pill', t('menu.laps', { count: trackDef.laps }), meta);
    el('span', 'pill difficulty-pill', difficultyLabel(DIFFICULTIES[trackDef.difficulty - 1] ?? 'normal'), meta);
    this.recordPills.push(el('div', 'track-record hidden', '', body));
    return card;
  }

  /** Record lines on the route cards, for the difficulty picked below them. */
  refreshRecords(): void {
    const difficulty = DIFFICULTIES[this.difficultyIndex];
    this.tracks.forEach((tr, i) => {
      const pill = this.recordPills[i];
      if (!pill) return;
      const best = this.recordFor?.(tr.id, difficulty) ?? null;
      pill.classList.toggle('hidden', !best);
      pill.textContent = best ? t('records.best', { place: formatOrdinal(best.place), time: formatRaceTime(best.time) }) : '';
    });
  }

  /** Show the player's own sound switch. */
  setSound(muted: boolean): void {
    this.soundMuted = muted;
    this.soundButton.textContent = t(muted ? 'sound.off' : 'sound.on');
    this.soundButton.classList.toggle('off', muted);
  }

  private i18nText<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, key: string, parent: HTMLElement): HTMLElementTagNameMap[K] {
    const node = el(tag, className, t(key), parent);
    node.dataset.i18n = key;
    return node;
  }

  private i18nButton(key: string, className: string, onClick: () => void, parent?: HTMLElement): HTMLButtonElement {
    const node = button(t(key), className, onClick);
    node.dataset.i18n = key;
    if (parent) parent.appendChild(node);
    return node;
  }

  private refreshLanguage(): void {
    document.documentElement.lang = getLanguage();
    this.rootNode.querySelectorAll<HTMLElement>('[data-i18n]').forEach((node) => {
      const key = node.dataset.i18n;
      if (key) node.textContent = t(key);
    });
    this.rootNode.querySelectorAll<HTMLElement>('[data-language]').forEach((node) => {
      node.classList.toggle('selected', node.dataset.language === getLanguage());
      node.classList.toggle('focused', node.dataset.language === getLanguage());
    });
    this.charCards.forEach((card, i) => {
      const c = this.characters[i];
      card.querySelector<HTMLElement>('.card-name')!.textContent = characterName(c.id, c.name).toUpperCase();
      card.querySelector<HTMLElement>('.card-tag')!.textContent = characterTagline(c.id, c.tagline);
      const pill = card.querySelector<HTMLElement>('.pill');
      if (pill) {
        pill.textContent = weightLabel(c.weightClass);
        pill.title = t('menu.zombieClass');
      }
      card.querySelectorAll<HTMLElement>('.stat-label').forEach((label, statIndex) => {
        label.textContent = t(`stats.${STAT_KEYS[statIndex].key === 'miniTurbo' ? 'miniTurbo' : STAT_KEYS[statIndex].key}`);
      });
    });
    this.trackCards.forEach((card, i) => {
      const tr = this.tracks[i];
      card.querySelector<HTMLElement>('.track-theme-pill')!.textContent = themeLabel(tr.theme);
      card.querySelector<HTMLElement>('.card-name')!.textContent = trackName(tr.id, tr.name).toUpperCase();
      card.querySelector<HTMLElement>('.card-tag')!.textContent = trackDescription(tr.id, tr.description);
      card.querySelector<HTMLElement>('.laps-pill')!.textContent = t('menu.laps', { count: tr.laps });
      card.querySelector<HTMLElement>('.difficulty-pill')!.textContent = difficultyLabel(DIFFICULTIES[tr.difficulty - 1] ?? 'normal');
    });
    this.setCharacter(this.charIndex);
    this.setDifficulty(this.difficultyIndex);
    this.setSound(this.soundMuted);
    this.jokeLine.set(zombieJoke());
    this.fitLayout();
  }
}
