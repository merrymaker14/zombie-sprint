/**
 * Printed labels for layout-dependent keys. Input is read by physical `code`
 * (KeyW is the key at the W position on every layout), but hints must show the
 * letter the player sees on that key: Z on AZERTY. Labels are learned from real
 * key presses and, where the page may use it, from the Keyboard Map API.
 */
const DEFAULT_LABELS: Record<string, string> = {
  KeyW: 'W',
  KeyA: 'A',
  KeyS: 'S',
  KeyD: 'D',
  KeyE: 'E',
  KeyQ: 'Q',
  KeyP: 'P',
};

const labels: Record<string, string> = { ...DEFAULT_LABELS };
const listeners = new Set<() => void>();
let started = false;

function learn(code: string, key: string): void {
  if (!(code in DEFAULT_LABELS)) return;
  // Only Latin letters: a Cyrillic layout keeps the Latin print on the same keys.
  if (!/^[a-z]$/i.test(key)) return;
  const label = key.toUpperCase();
  if (labels[code] === label) return;
  labels[code] = label;
  for (const listener of Array.from(listeners)) listener();
}

function start(): void {
  if (started) return;
  started = true;
  window.addEventListener('keydown', (e) => learn(e.code, e.key), { capture: true, passive: true });
  try {
    const keyboard = (navigator as unknown as {
      keyboard?: { getLayoutMap?: () => Promise<{ get(code: string): string | undefined }> };
    }).keyboard;
    // Cross-origin platform iframes reject this call; typed keys still teach the labels.
    keyboard
      ?.getLayoutMap?.()
      .then((map) => {
        for (const code of Object.keys(DEFAULT_LABELS)) {
          const key = map.get(code);
          if (key) learn(code, key);
        }
      })
      .catch(() => {});
  } catch {
    // Keyboard Map API unavailable.
  }
}

export function keyLabel(code: string): string {
  start();
  return labels[code] ?? code.replace(/^Key/, '');
}

export function onKeyLabelsChange(listener: () => void): () => void {
  start();
  listeners.add(listener);
  return () => listeners.delete(listener);
}
