import {
  adAudioMuted,
  adBusy,
  adPlatform,
  adReady,
  adsGameReady,
  banner,
  bindPlaying,
  gameplay,
  initAds,
  interstitial,
  onAdAudio,
  onAdBusy,
  onAppFocus,
  onPlatformMute,
  rewardWarm,
  rewarded,
} from 'game-kit/platform/ads.js';
import { offPlatform } from 'game-kit/platform';

const INTERSTITIAL_GAP_MS = adPlatform() === 'crazy' ? 185_000 : 150_000;
let lastInterstitial = 0;
let raceCount = 0;

export function setup(isPlaying: () => boolean): void {
  lastInterstitial = Date.now();
  bindPlaying(isPlaying);
  initAds();
}

export const ready = adsGameReady;
export const setGameplay = gameplay;
export { onAdAudio, onAdBusy, onAppFocus, onPlatformMute, banner, adAudioMuted, adBusy, adReady, adPlatform };

export function adAvailable(): boolean {
  const platform = adPlatform();
  if (platform === 'none' || offPlatform()) return true;
  if (platform === 'vkok') return adReady() && rewardWarm();
  return adReady();
}

export function atRaceFinish(): Promise<boolean> {
  const current = raceCount++;
  if (current < 1 || Date.now() - lastInterstitial < INTERSTITIAL_GAP_MS) return Promise.resolve(false);
  lastInterstitial = Date.now();
  return interstitial();
}

export function reward(): Promise<boolean> {
  return adAvailable() ? rewarded() : Promise.resolve(false);
}
