/**
 * On-screen race controls for touch devices, plus the "turn your device" screen.
 *
 * Steering is one zone: the finger's side of the zone centre picks left or right,
 * so a thumb can slide across without lifting. Throttle is automatic while touch
 * controls are in use (released only by the brake button), which is how mobile
 * kart racers free the right thumb for drift and powers. Every control tracks its
 * own pointer ids, so steering and drifting work at the same time.
 *
 * Visibility is pure CSS: `html.touch-mode` plus `#ui[data-state]` (countdown/racing).
 */
import { el } from './dom';
import { isTouchMode } from './touchMode';
import { onLanguageChange, t } from '../core/i18n';

export interface TouchFrame {
  /** Touch controls are the active input method. */
  active: boolean;
  /**
   * Automatic throttle: only once the race is running. Holding the throttle through
   * the countdown is punished with a jump-start spin-out (RaceManager.go).
   */
  autoThrottle: boolean;
  steer: number;
  brake: boolean;
  drift: boolean;
  itemHeld: boolean;
  /** Edges: true once per press, cleared by read(). */
  itemPressed: boolean;
  pausePressed: boolean;
}

type Role = 'brake' | 'drift' | 'item' | 'pause';

export class TouchControls {
  private readonly parent: HTMLElement;
  private readonly root: HTMLElement;
  private readonly rotate: HTMLElement;
  private readonly steerZone: HTMLElement;
  private readonly steerPointers = new Map<number, number>();
  private readonly held: Record<Role, Set<number>> = {
    brake: new Set(),
    drift: new Set(),
    item: new Set(),
    pause: new Set(),
  };
  private itemEdge = false;
  private pauseEdge = false;
  private readonly frame: TouchFrame = {
    active: false,
    autoThrottle: false,
    steer: 0,
    brake: false,
    drift: false,
    itemHeld: false,
    itemPressed: false,
    pausePressed: false,
  };
  private readonly labels: { node: HTMLElement; key: string }[] = [];
  private readonly languageUnsub: () => void;

  constructor(parent: HTMLElement) {
    this.parent = parent;
    this.root = el('div', 'touch-controls', undefined, parent);
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());

    this.steerZone = el('div', 'tc-steer', undefined, this.root);
    el('span', 'tc-steer-arrow tc-steer-left', '◀', this.steerZone);
    el('span', 'tc-steer-arrow tc-steer-right', '▶', this.steerZone);
    this.steerZone.addEventListener('pointerdown', this.onSteerDown);
    this.steerZone.addEventListener('pointermove', this.onSteerMove);
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
      this.steerZone.addEventListener(type, this.onSteerUp);
    }

    this.button('pause', 'tc-pause', '❚❚', 'touch.pause');
    this.button('item', 'tc-item', '', 'touch.item');
    this.button('drift', 'tc-drift', '', 'touch.drift');
    this.button('brake', 'tc-brake', '', 'touch.brake');

    this.rotate = el('div', 'rotate-device', undefined, parent);
    const card = el('div', 'rotate-card', undefined, this.rotate);
    el('div', 'rotate-icon', '📱', card);
    this.label(el('div', 'rotate-title', '', card), 'game.rotateTitle');
    this.label(el('div', 'rotate-body', '', card), 'game.rotateBody');

    this.languageUnsub = onLanguageChange(() => this.refreshLabels());
    this.refreshLabels();
    window.addEventListener('blur', this.releaseAll);
    document.addEventListener('visibilitychange', this.releaseAll);
  }

  /** Current touch state; edge flags are consumed by this call. */
  read(): TouchFrame {
    const f = this.frame;
    f.active = isTouchMode();
    f.autoThrottle = f.active && this.parent.dataset.state === 'racing';
    let steer = 0;
    for (const side of this.steerPointers.values()) steer += side;
    f.steer = Math.max(-1, Math.min(1, steer));
    f.brake = this.held.brake.size > 0;
    f.drift = this.held.drift.size > 0;
    f.itemHeld = this.held.item.size > 0;
    f.itemPressed = this.itemEdge;
    f.pausePressed = this.pauseEdge;
    this.itemEdge = false;
    this.pauseEdge = false;
    this.steerZone.dataset.steer = f.steer < 0 ? 'left' : f.steer > 0 ? 'right' : '';
    return f;
  }

  dispose(): void {
    this.languageUnsub();
    window.removeEventListener('blur', this.releaseAll);
    document.removeEventListener('visibilitychange', this.releaseAll);
    this.root.remove();
    this.rotate.remove();
  }

  // ----------------------------------------------------------------------------

  private button(role: Role, className: string, glyph: string, labelKey: string): void {
    const node = el('div', `tc-btn ${className}`, undefined, this.root);
    node.setAttribute('role', 'button');
    if (glyph) el('span', 'tc-glyph', glyph, node);
    if (role === 'pause') this.labels.push({ node, key: labelKey });
    else this.label(el('span', 'tc-label', '', node), labelKey);
    const set = this.held[role];
    const release = (e: PointerEvent): void => {
      set.delete(e.pointerId);
      node.classList.toggle('down', set.size > 0);
    };
    node.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      capture(node, e.pointerId);
      if (set.size === 0) {
        if (role === 'item') this.itemEdge = true;
        if (role === 'pause') this.pauseEdge = true;
      }
      set.add(e.pointerId);
      node.classList.add('down');
    });
    node.addEventListener('pointerup', release);
    node.addEventListener('pointercancel', release);
    node.addEventListener('lostpointercapture', release);
  }

  private label(node: HTMLElement, key: string): void {
    this.labels.push({ node, key });
  }

  private refreshLabels(): void {
    for (const { node, key } of this.labels) {
      if (node.classList.contains('tc-btn')) node.setAttribute('aria-label', t(key));
      else node.textContent = t(key);
    }
  }

  private sideOf(e: PointerEvent): number {
    const r = this.steerZone.getBoundingClientRect();
    return e.clientX < r.left + r.width / 2 ? -1 : 1;
  }

  private readonly onSteerDown = (e: PointerEvent): void => {
    e.preventDefault();
    capture(this.steerZone, e.pointerId);
    this.steerPointers.set(e.pointerId, this.sideOf(e));
  };

  private readonly onSteerMove = (e: PointerEvent): void => {
    if (this.steerPointers.has(e.pointerId)) this.steerPointers.set(e.pointerId, this.sideOf(e));
  };

  private readonly onSteerUp = (e: PointerEvent): void => {
    this.steerPointers.delete(e.pointerId);
  };

  private readonly releaseAll = (): void => {
    this.steerPointers.clear();
    for (const set of Object.values(this.held)) set.clear();
    for (const node of Array.from(this.root.querySelectorAll('.tc-btn.down'))) node.classList.remove('down');
  };
}

function capture(node: HTMLElement, pointerId: number): void {
  try {
    node.setPointerCapture(pointerId);
  } catch {
    // Synthetic or already-released pointers cannot be captured; tracking still works.
  }
}
