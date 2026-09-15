/**
 * Main menu: Title → Character Select → Track Select. Pure DOM; the 3D backdrop
 * behind it is owned by Game (mirrored via onHighlight).
 */
import type { CharacterDef, Difficulty, InputState, RaceSettings, TrackDefinition } from '../core/types';
import { events } from '../core/events';
import { GAME_TITLE, DEFAULT_LAPS } from '../core/constants';
import { button, cssHex, cssRgba, el, TextField } from './dom';
import {
  characterName,
  characterTagline,
  difficultyBlurb,
  difficultyLabel,
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

export type MenuPanel = 'title' | 'characterSelect' | 'trackSelect';

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
const ZOMBIE_SKIN: Record<string, number> = {
  zippy: 0xa8d875,
  pixel: 0xd0e878,
  fennec: 0x86c96c,
  max: 0x9cbf72,
  juno: 0xb5d77f,
  kai: 0x72c7a2,
  bram: 0x789b70,
  rosa: 0xb4c978,
};

export class MainMenu {
  onStart: ((settings: RaceSettings) => void) | null = null;
  onHighlight: ((characterId: string) => void) | null = null;
  onPanelChange: ((panel: MenuPanel) => void) | null = null;

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
    this.i18nText('div', 'zombie-badge', 'brand.badge', title);
    this.jokeLine = new TextField(el('div', 'zombie-joke', zombieJoke(), title));
    const languagePicker = el('div', 'language-picker glass', undefined, title);
    this.i18nText('span', 'language-label', 'language.label', languagePicker);
    const languageButtons = el('div', 'language-buttons', undefined, languagePicker);
    for (const code of ['ru', 'en'] as const) {
      const languageButton = button(code === 'ru' ? 'РУ' : 'EN', 'lang-btn', () => setLanguage(code));
      languageButton.dataset.language = code;
      languageButtons.appendChild(languageButton);
    }
    const prompt = el('div', 'press-start', undefined, title);
    this.i18nText('span', 'press-start-text', 'menu.pressStart', prompt);
    this.i18nText('div', 'zombie-friendly-note', 'brand.note', title);
    const legend = el('div', 'controls-legend glass', undefined, title);
    const keys: [string, string][] = [
      ['W / ↑', 'controls.sprint'],
      ['S / ↓', 'controls.brake'],
      ['A D / ← →', 'controls.steer'],
      ['SPACE / SHIFT', 'controls.drift'],
      ['E / CTRL', 'controls.power'],
      ['Q', 'controls.lookBack'],
      ['ESC / P', 'controls.pause'],
      ['M', 'controls.mute'],
    ];
    for (const [k, v] of keys) {
      const row = el('div', 'legend-row', undefined, legend);
      el('kbd', '', k, row);
      this.i18nText('span', '', v, row);
    }
    this.i18nText('div', 'version', 'brand.version', title);
    title.addEventListener('click', () => {
      if (this.panel === 'title') this.goTo('characterSelect', true);
    });

    // ------------------------------------------------------- character select
    const chars = el('section', 'panel-select panel-chars', undefined, this.rootNode);
    const charHead = el('header', 'select-header', undefined, chars);
    this.i18nText('div', 'panel-kicker', 'menu.chapter1', charHead);
    this.i18nText('h2', 'panel-title', 'menu.chooseZombie', charHead);
    const charGrid = el('div', 'card-grid char-grid', undefined, chars);
    characters.forEach((c, i) => {
      const card = this.buildCharacterCard(c);
      card.addEventListener('pointerenter', () => this.setCharacter(i));
      card.addEventListener('click', () => {
        if (this.charIndex === i) this.goTo('trackSelect', true);
        else this.setCharacter(i, true);
      });
      card.addEventListener('dblclick', () => this.goTo('trackSelect', true));
      charGrid.appendChild(card);
      this.charCards.push(card);
    });
    const charFoot = el('footer', 'select-footer glass', undefined, chars);
    const charInfo = el('div', 'select-info', undefined, charFoot);
    this.charName = new TextField(el('div', 'select-info-name', '', charInfo));
    this.charTagline = new TextField(el('div', 'select-info-tagline', '', charInfo));
    const charActions = el('div', 'actions', undefined, charFoot);
    charActions.appendChild(this.i18nButton('menu.back', 'ghost', () => this.goTo('title', true)));
    const releaseButton = this.i18nButton('menu.release', 'primary', () => this.goTo('trackSelect', true));
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
      card.addEventListener('pointerenter', () => {
        this.trackRow = 0;
        this.setTrack(i);
      });
      card.addEventListener('click', () => {
        if (this.trackIndex === i && this.trackRow === 0) this.start();
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
        this.trackRow = 1;
        this.setDifficulty(i, true);
      });
      this.diffButtons.push(b);
    });
    this.diffBlurb = new TextField(el('div', 'difficulty-blurb', '', diffWrap));
    const trActions = el('div', 'actions', undefined, trFoot);
    trActions.appendChild(this.i18nButton('menu.back', 'ghost', () => this.goTo('characterSelect', true)));
    this.startButton = this.i18nButton('menu.startRun', 'primary start', () => this.start());
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
    this.goTo(panel, false);
    this.onHighlight?.(this.highlightedCharacter.id);
  }

  hide(): void {
    this.rootNode.classList.add('hidden');
    this.visible = false;
  }

  dispose(): void {
    this.languageUnsub();
    window.clearInterval(this.jokeTimer);
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
    this.applyPanel();
    if (changed) this.onPanelChange?.(panel);
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
    const zombieHead = el('div', 'char-zombie-head', undefined, swatch);
    zombieHead.style.setProperty('--zombie-skin', cssHex(ZOMBIE_SKIN[c.id] ?? 0x9fcf78));
    el('span', 'char-zombie-eye char-zombie-eye-l', undefined, zombieHead);
    el('span', 'char-zombie-eye char-zombie-eye-r', undefined, zombieHead);
    const mouth = el('span', 'char-zombie-mouth', undefined, zombieHead);
    el('span', 'char-zombie-tooth', undefined, mouth);
    el('div', 'char-wheel char-wheel-l', undefined, swatch);
    el('div', 'char-wheel char-wheel-r', undefined, swatch);
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
    return card;
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
    this.jokeLine.set(zombieJoke());
  }
}
