declare module 'game-kit/platform' {
  export function offPlatform(): boolean;
}

declare module 'game-kit/save' {
  export const scoped: (key: string) => string;
  export function read<T = unknown>(key: string, fallback?: T): T;
  export function write<T>(key: string, value: T): T;
}

declare module 'game-kit/platform/ads.js' {
  export function adAudioMuted(): boolean;
  export function adBusy(): boolean;
  export function adPlatform(): string;
  export function adReady(): boolean;
  export function adsGameReady(): void;
  export function banner(show: boolean): void;
  export function bindPlaying(fn: () => boolean): void;
  export function gameplay(on: boolean): void;
  export function initAds(): void;
  export function interstitial(): Promise<boolean>;
  export function onAdAudio(fn: (muted: boolean) => void): () => void;
  export function onAdBusy(fn: (busy: boolean) => void): () => void;
  export function onAppFocus(fn: (focused: boolean) => void): () => void;
  export function onPlatformMute(fn: (muted: boolean) => void): () => void;
  export function rewardWarm(): boolean;
  export function rewarded(): Promise<boolean>;
}
