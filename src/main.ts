/**
 * Bootstrap: WebGL2 detection, global error handling, then hand over to Game.
 */
import { GAME_TITLE } from './core/constants';
import { Game } from './game/Game';
import { el } from './ui/dom';
import { showToast } from './ui/toast';
import * as ads from './platform/ads';
import { events } from './core/events';
import { t } from './core/i18n';

function hasWebGL2(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2', { failIfMajorPerformanceCaveat: false });
    return gl instanceof WebGL2RenderingContext;
  } catch {
    return false;
  }
}

function showFatal(root: HTMLElement, title: string, body: string): void {
  root.replaceChildren();
  const wrap = el('div', 'fatal', undefined, root);
  const panel = el('div', 'glass panel fatal-panel', undefined, wrap);
  el('div', 'panel-kicker', GAME_TITLE, panel);
  el('h2', 'panel-title', title, panel);
  el('p', 'fatal-body', body, panel);
  const retry = el('button', 'btn primary', t('fatal.reload'), panel);
  retry.type = 'button';
  retry.addEventListener('click', () => window.location.reload());
}

function boot(): void {
  const app = document.getElementById('app') ?? el('div', '', undefined, document.body);
  app.id = 'app';

  if (!hasWebGL2()) {
    showFatal(
      app,
      t('fatal.webglTitle'),
      t('fatal.webglBody'),
    );
    return;
  }

  let errorToasts = 0;
  const report = (message: string, err: unknown): void => {
    console.error(message, err);
    if (errorToasts < 3) {
      errorToasts++;
      showToast(message, 'error');
    }
  };
  window.addEventListener('error', (ev) => {
    report(t('error.runtime', { message: ev.message || 'unknown' }), ev.error);
  });
  window.addEventListener('unhandledrejection', (ev) => {
    const reason = ev.reason instanceof Error ? ev.reason.message : String(ev.reason);
    report(`Unhandled promise rejection: ${reason}`, ev.reason);
  });

  try {
    const game = new Game(app);
    ads.setup(() => game.currentState === 'racing' || game.currentState === 'countdown');
    ads.onAdBusy((busy: boolean) => {
      document.body.classList.toggle('ad-busy', busy);
      ads.setGameplay(!busy && (game.currentState === 'racing' || game.currentState === 'countdown'));
    });
    ads.onAppFocus((focused: boolean) => {
      if (!focused && (game.currentState === 'racing' || game.currentState === 'countdown')) {
        game.pauseFromPlatform();
      }
    });
    ads.onPlatformMute((muted: boolean) => game.setPlatformMute(muted));
    events.on('race:allFinished', () => { void ads.atRaceFinish(); });
    game.start();
    requestAnimationFrame(() => ads.ready());
    let lastBannerState = '';
    const syncBanner = (): void => {
      const show = game.currentState === 'title' || game.currentState === 'results' || game.currentState === 'paused';
      const state = show ? 'show' : 'hide';
      if (state !== lastBannerState) {
        lastBannerState = state;
        ads.banner(show);
      }
      requestAnimationFrame(syncBanner);
    };
    requestAnimationFrame(syncBanner);
    (window as unknown as { __zombieSprint?: Game }).__zombieSprint = game;
  } catch (err) {
    console.error('[main] failed to start game', err);
    showFatal(
      app,
      t('fatal.startTitle'),
      t('fatal.startBody'),
    );
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
