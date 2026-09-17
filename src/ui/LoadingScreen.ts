/**
 * Loading overlay shown while a Track is being built. Track name, theme colour
 * band, animated progress bar and rotating tips.
 */
import type { TrackDefinition } from '../core/types';
import { clamp01 } from '../core/math';
import { cssHex, el, TextField } from './dom';
import { formatLaps, loadingTips, onLanguageChange, t, themeLabel, trackName } from '../core/i18n';
import { keyLabel } from './keyLabels';

const TIP_INTERVAL = 2.4;

export class LoadingScreen {
  private readonly rootNode: HTMLElement;
  private readonly title: TextField;
  private readonly subtitle: TextField;
  private readonly band: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly tipNode: HTMLElement;
  private readonly tipText: TextField;
  private tipTimer = 0;
  private tipIndex = 0;
  private progress = 0;
  private visible = false;
  private currentDef: TrackDefinition | null = null;
  private readonly languageUnsub: () => void;

  constructor(root: HTMLElement) {
    this.rootNode = el('div', 'screen loading hidden', undefined, root);
    const panel = el('div', 'loading-panel', undefined, this.rootNode);
    this.band = el('div', 'loading-band', undefined, panel);
    const inner = el('div', 'loading-inner', undefined, panel);
    const kicker = el('div', 'loading-kicker', t('loading.kicker'), inner);
    kicker.dataset.i18n = 'loading.kicker';
    this.title = new TextField(el('h2', 'loading-title', '', inner));
    this.subtitle = new TextField(el('div', 'loading-subtitle', '', inner));
    const track = el('div', 'loading-track', undefined, inner);
    this.bar = el('div', 'loading-bar', undefined, track);
    el('div', 'loading-bar-shimmer', undefined, this.bar);
    this.tipNode = el('div', 'loading-tip', undefined, inner);
    const tipLabel = el('span', 'loading-tip-label', t('loading.tip'), this.tipNode);
    tipLabel.dataset.i18n = 'loading.tip';
    this.tipText = new TextField(el('span', 'loading-tip-text', '', this.tipNode));
    this.languageUnsub = onLanguageChange(() => this.refreshLanguage());
  }

  show(def: TrackDefinition): void {
    this.currentDef = def;
    this.refreshLanguage();
    const env = def.environment;
    this.band.style.background = `linear-gradient(90deg, ${cssHex(env.skyTop)}, ${cssHex(env.skyHorizon)}, ${cssHex(
      def.palette.road,
    )})`;
    this.tipIndex = Math.floor(Math.random() * this.tips().length);
    this.tipText.set(this.tips()[this.tipIndex]);
    this.tipTimer = 0;
    this.setProgress(0);
    this.rootNode.classList.remove('hidden');
    this.visible = true;
  }

  hide(): void {
    this.rootNode.classList.add('hidden');
    this.visible = false;
  }

  setProgress(p: number): void {
    p = clamp01(p);
    if (Math.abs(p - this.progress) < 0.002) return;
    this.progress = p;
    this.bar.style.transform = `scaleX(${p.toFixed(3)})`;
  }

  update(dt: number): void {
    if (!this.visible) return;
    this.tipTimer += dt;
    if (this.tipTimer >= TIP_INTERVAL) {
      this.tipTimer = 0;
      const tips = this.tips();
      this.tipIndex = (this.tipIndex + 1) % tips.length;
      this.tipText.set(tips[this.tipIndex]);
      this.tipNode.classList.remove('tip-in');
      void this.tipNode.offsetWidth;
      this.tipNode.classList.add('tip-in');
    }
  }

  dispose(): void {
    this.languageUnsub();
    this.rootNode.remove();
  }

  private refreshLanguage(): void {
    const def = this.currentDef;
    if (def) {
      const stars = '★'.repeat(def.difficulty) + '☆'.repeat(3 - def.difficulty);
      this.title.set(trackName(def.id, def.name).toUpperCase());
      this.subtitle.set(`${formatLaps(def.laps)}  ·  ${stars}  ·  ${themeLabel(def.theme)}`);
    }
    this.rootNode.querySelectorAll<HTMLElement>('[data-i18n]').forEach((node) => {
      const key = node.dataset.i18n;
      if (key) node.textContent = t(key);
    });
    if (this.visible) this.tipText.set(this.tips()[this.tipIndex % this.tips().length]);
  }

  private tips(): readonly string[] {
    return loadingTips({ power: `${keyLabel('KeyE')} / Enter`, lookBack: keyLabel('KeyQ') });
  }
}
