/**
 * Pause overlay: Resume / Restart / Quit to menu over a blurred backdrop.
 */
import type { InputState } from '../core/types';
import { events } from '../core/events';
import { button, el, FocusRing } from './dom';
import { onLanguageChange, t } from '../core/i18n';

export class PauseMenu {
  onResume: (() => void) | null = null;
  onRestart: (() => void) | null = null;
  onQuit: (() => void) | null = null;
  onToggleSound: (() => void) | null = null;

  private readonly rootNode: HTMLElement;
  private readonly focus: FocusRing;
  private readonly languageUnsub: () => void;
  /** Sound switch: on a phone there is no M key, and VK asks for a quick way to mute (2.2.5). */
  private readonly soundButton: HTMLButtonElement;
  private soundMuted = false;
  private visible = false;

  constructor(root: HTMLElement) {
    this.rootNode = el('div', 'screen pause hidden', undefined, root);
    const panel = el('div', 'glass panel pause-panel', undefined, this.rootNode);
    const kicker = el('div', 'panel-kicker', t('pause.kicker'), panel);
    kicker.dataset.i18n = 'pause.kicker';
    const title = el('h2', 'panel-title', t('pause.title'), panel);
    title.dataset.i18n = 'pause.title';
    const actions = el('div', 'actions column', undefined, panel);

    this.focus = new FocusRing((i) => this.activate(i));
    const resume = button(t('pause.resume'), 'primary', () => this.activate(0));
    const restart = button(t('pause.restart'), '', () => this.activate(1));
    this.soundButton = button(t('sound.on'), 'pause-sound', () => this.activate(2));
    this.soundButton.dataset.action = 'sound';
    const quit = button(t('pause.quit'), 'danger', () => this.activate(3));
    resume.dataset.i18n = 'pause.resume';
    restart.dataset.i18n = 'pause.restart';
    quit.dataset.i18n = 'pause.quit';
    actions.append(resume, restart, this.soundButton, quit);
    this.focus.add(resume);
    this.focus.add(restart);
    this.focus.add(this.soundButton);
    this.focus.add(quit);

    const hint = el('div', 'panel-hint', t('pause.hint'), panel);
    hint.dataset.i18n = 'pause.hint';
    this.languageUnsub = onLanguageChange(() => this.refreshLanguage());
  }

  show(): void {
    this.focus.set(0);
    this.rootNode.classList.remove('hidden');
    this.visible = true;
  }

  hide(): void {
    this.rootNode.classList.add('hidden');
    this.visible = false;
  }

  get isVisible(): boolean {
    return this.visible;
  }

  /** Show the player's own sound switch. */
  setSound(muted: boolean): void {
    this.soundMuted = muted;
    this.soundButton.textContent = t(muted ? 'sound.off' : 'sound.on');
    this.soundButton.classList.toggle('off', muted);
  }

  handleInput(input: InputState): void {
    if (!this.visible) return;
    if (input.menuUp || input.menuLeft) {
      if (this.focus.move(-1)) events.emit('ui:move', {});
    } else if (input.menuDown || input.menuRight) {
      if (this.focus.move(1)) events.emit('ui:move', {});
    }
    if (input.confirm) {
      this.focus.activate();
    } else if (input.back) {
      events.emit('ui:back', {});
      this.onResume?.();
    }
  }

  private activate(i: number): void {
    events.emit('ui:select', {});
    if (i === 0) this.onResume?.();
    else if (i === 1) this.onRestart?.();
    else if (i === 2) this.onToggleSound?.();
    else this.onQuit?.();
  }

  dispose(): void {
    this.languageUnsub();
    this.rootNode.remove();
  }

  private refreshLanguage(): void {
    this.rootNode.querySelectorAll<HTMLElement>('[data-i18n]').forEach((node) => {
      const key = node.dataset.i18n;
      if (key) node.textContent = t(key);
    });
    this.setSound(this.soundMuted);
  }
}
