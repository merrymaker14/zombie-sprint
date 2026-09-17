/**
 * Touch mode: on for touch-first devices, and switched on by any real touch and
 * off again by a key press or a mouse click, so a 2-in-1 laptop shows on-screen
 * controls only while the player is actually using the screen. Mirrored as the
 * `touch-mode` class on <html> for CSS.
 */
const CLASS_NAME = 'touch-mode';
const listeners = new Set<(on: boolean) => void>();
let started = false;
let touch = false;

function set(on: boolean): void {
  if (on === touch) return;
  touch = on;
  document.documentElement.classList.toggle(CLASS_NAME, on);
  for (const listener of Array.from(listeners)) listener(on);
}

function start(): void {
  if (started) return;
  started = true;
  let coarse = false;
  try {
    coarse = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
  } catch {
    coarse = false;
  }
  touch = coarse;
  document.documentElement.classList.toggle(CLASS_NAME, coarse);
  window.addEventListener(
    'pointerdown',
    (e) => {
      if (e.pointerType === 'touch' || e.pointerType === 'pen') set(true);
      else if (e.pointerType === 'mouse') set(false);
    },
    { capture: true, passive: true },
  );
  window.addEventListener(
    'keydown',
    (e) => {
      if (!e.repeat && e.key !== 'Unidentified') set(false);
    },
    { capture: true, passive: true },
  );
}

export function isTouchMode(): boolean {
  start();
  return touch;
}

export function onTouchModeChange(listener: (on: boolean) => void): () => void {
  start();
  listeners.add(listener);
  return () => listeners.delete(listener);
}
