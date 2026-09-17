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

  // Details go to the console only; the player sees one plain translated line per session.
  let errorShown = false;
  const report = (detail: unknown, err: unknown): void => {
    console.error(detail, err);
    if (errorShown) return;
    errorShown = true;
    showToast(t('error.runtime'), 'error');
  };
  window.addEventListener('error', (ev) => {
    // Platform SDKs and browser extensions live on other origins: not our failure to report.
    let foreign = !ev.filename || ev.message === 'Script error.';
    try {
      foreign = foreign || new URL(ev.filename, location.href).origin !== location.origin;
    } catch {
      foreign = true;
    }
    if (foreign) {
      console.error('[external script error]', ev.message, ev.error);
      return;
    }
    report(ev.message, ev.error);
  });
  window.addEventListener('unhandledrejection', (ev) => {
    report('[unhandledrejection]', ev.reason);
  });

  try {
    const game = new Game(app);
    ads.setup(() => game.currentState === 'racing' || game.currentState === 'countdown');
    // CrazyGames measures the first playable moment through gameplayStart().
    // State changes are the source of truth; listening only to ad-busy changes
    // left the first race unreported when no ad had run yet.
    events.on('game:stateChange', ({ to }) => {
      ads.setGameplay(to === 'racing' || to === 'countdown');
    });
    ads.onAdBusy((busy: boolean) => {
      document.body.classList.toggle('ad-busy', busy);
      game.setAdBusy(busy);
      ads.setGameplay(!busy && (game.currentState === 'racing' || game.currentState === 'countdown'));
    });
    ads.onAdAudio((muted: boolean) => game.setAdAudio(muted));
    ads.onAppFocus((focused: boolean) => game.setAppFocus(focused));
    ads.onPlatformMute((muted: boolean) => game.setPlatformMute(muted));
    events.on('race:allFinished', () => { void ads.atRaceFinish(); });
    game.start();
    requestAnimationFrame(() => ads.ready());
    let lastBannerState = '';
    const syncBanner = (): void => {
      // Hidden under an advert and asked again after it; the key also changes once the SDK is up,
      // otherwise a request made before the SDK answered is dropped for good.
      const show = !ads.adBusy()
        && (game.currentState === 'title' || game.currentState === 'results' || game.currentState === 'paused');
      const state = (show ? 'show' : 'hide') + (ads.adReady() ? '' : ':nosdk');
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
