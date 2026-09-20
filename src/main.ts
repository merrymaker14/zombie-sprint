/**
 * Bootstrap: WebGL2 detection, global error handling, then hand over to Game.
 */
import { GAME_TITLE } from './core/constants';

/** Longest wait for a platform SDK before the menu opens anyway. */
const PLATFORM_SDK_WAIT_MS = 10_000;
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

  // The play area is not a document: no browser context menu, no text selection,
  // no image dragging anywhere in it. Yandex checks this with a right click on
  // whatever is on screen — menus and HUD are DOM on top of the canvas, so a
  // handler on the canvas alone leaves them open (that is how a sister game got
  // rejected). Form fields are left alone; the game has none today.
  for (const type of ['contextmenu', 'selectstart', 'dragstart'] as const) {
    document.addEventListener(type, (event) => {
      if ((event.target as HTMLElement | null)?.closest('input, textarea')) return;
      event.preventDefault();
    });
  }

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
    // The menu must not become usable before the platform can hear "ready": Yandex 1.19 rejects a
    // LoadingAPI.ready() that arrives after the menu, and the SDK initializes asynchronously.
    // Wait for it behind a splash (capped, so an ad blocker cannot keep the game closed), then
    // open the menu and report ready right after its first frame.
    const begin = (): void => {
      game.start();
      // The splash leaves and ready is reported together, right after the menu's first frame
      // (which compiles the menu shaders and can take well over one display frame).
      requestAnimationFrame(() => {
        splash?.remove();
        ads.ready();
      });
    };
    const splash = ads.platformSdkExpected() ? el('div', 'boot-splash', undefined, app) : null;
    if (splash) {
      el('div', 'boot-splash-title', GAME_TITLE, splash);
      el('div', 'boot-splash-dots', undefined, splash);
      const waitStart = performance.now();
      const waitForSdk = (): void => {
        if (ads.adReady() || performance.now() - waitStart > PLATFORM_SDK_WAIT_MS) begin();
        else setTimeout(waitForSdk, 30);
      };
      waitForSdk();
    } else {
      begin();
    }
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
