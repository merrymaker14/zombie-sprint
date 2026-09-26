/**
 * Track records: the player's best place and best time for each track and difficulty.
 *
 * This is the progress the game keeps, and it travels with the player's account
 * through the platform cloud (package.json `cloudKeys`). VK rule 2.3.8 asks for
 * progress to follow the player between devices; a record set on the phone that
 * is missing on the computer reads as lost progress.
 *
 * The cloud answers late — up to twenty seconds on a mobile network, long after
 * the game has started. A save made in that window would stamp the local copy as
 * newer, and the bootstrap would then drop the cloud copy as stale and overwrite
 * it with ours. So while the cloud is on its way, saves stay local (no stamp, no
 * upload), and the arriving copy is merged record by record instead of replacing
 * what this session has set.
 */
import type { Difficulty } from '../core/types';
import { read, scoped, write } from 'game-kit/save';
import { KART_COUNT } from '../core/constants';

const KEY = 'zs_records';
/** How long saves wait for the platform cloud before writing to it anyway. */
const CLOUD_HOLD_MS = 30_000;
/** A lap of any track is well under this; longer is a corrupt value. */
const MAX_TIME = 3600;
const DIFFICULTIES: readonly Difficulty[] = ['easy', 'normal', 'hard'];

export interface TrackRecord {
  /** Best finishing place, 1..KART_COUNT. */
  place: number;
  /** Best finishing time in seconds. */
  time: number;
}

export interface RecordResult {
  /** No record existed for this track and difficulty before. */
  first: boolean;
  improvedPlace: boolean;
  improvedTime: boolean;
}

type Table = Record<string, Partial<Record<Difficulty, TrackRecord>>>;
/** Stored shape: short keys, the value goes to a cloud slot with a size limit. */
type Stored = Record<string, Partial<Record<Difficulty, { p: number; t: number }>>>;

export class Records {
  private table: Table;
  private cloudHoldUntil = 0;
  /** Something was saved while waiting for the cloud; it goes up once the wait ends. */
  private heldDirty = false;

  constructor() {
    const platform = (window as unknown as { __PLATFORM__?: string }).__PLATFORM__;
    if (platform && platform !== 'none') {
      this.cloudHoldUntil = performance.now() + CLOUD_HOLD_MS;
      // The cloud may never answer (a platform read failure sends no signal); the
      // records set meanwhile must still reach it.
      window.setTimeout(() => this.releaseHold(), CLOUD_HOLD_MS + 500);
    }
    this.table = this.load();
  }

  get(trackId: string, difficulty: Difficulty): TrackRecord | null {
    return this.table[trackId]?.[difficulty] ?? null;
  }

  /** Waiting for the platform cloud (tests read this). */
  get cloudHold(): boolean {
    return performance.now() < this.cloudHoldUntil;
  }

  /** Record a finished race. A race without a finish time changes nothing. */
  submit(trackId: string, difficulty: Difficulty, place: number, time: number): RecordResult {
    const none: RecordResult = { first: false, improvedPlace: false, improvedTime: false };
    if (!isFinite(time) || time <= 0 || time > MAX_TIME || place < 1 || place > KART_COUNT) return none;
    const rounded = Math.round(time * 1000) / 1000;
    const prev = this.get(trackId, difficulty);
    const result: RecordResult = {
      first: !prev,
      improvedPlace: !prev || place < prev.place,
      improvedTime: !prev || rounded < prev.time,
    };
    if (!result.improvedPlace && !result.improvedTime) return result;
    const row = (this.table[trackId] ??= {});
    row[difficulty] = {
      place: prev ? Math.min(prev.place, place) : place,
      time: prev ? Math.min(prev.time, rounded) : rounded,
    };
    this.save();
    return result;
  }

  /**
   * The platform cloud has arrived: merge it with what this session holds.
   * The bootstrap put the cloud copy into storage only if it was newer; either way
   * the best of both sides survives.
   * @returns the cloud brought a record this device did not have
   */
  merge(): boolean {
    this.cloudHoldUntil = 0;
    const mine = this.table;
    const theirs = this.load();
    const out: Table = {};
    let gained = false;
    let mineAdds = false;
    for (const id of new Set([...Object.keys(mine), ...Object.keys(theirs)])) {
      for (const d of DIFFICULTIES) {
        const a = mine[id]?.[d];
        const b = theirs[id]?.[d];
        if (!a && !b) continue;
        if (b && (!a || b.place < a.place || b.time < a.time)) gained = true;
        if (a && (!b || a.place < b.place || a.time < b.time)) mineAdds = true;
        (out[id] ??= {})[d] = {
          place: Math.min(a?.place ?? KART_COUNT, b?.place ?? KART_COUNT),
          time: Math.min(a?.time ?? MAX_TIME, b?.time ?? MAX_TIME),
        };
      }
    }
    this.table = out;
    /* The merged table goes back up only if this device adds something: otherwise the
       other device never learns what was set here. Saving unconditionally was harmful
       when the cloud read had failed — the bootstrap then opens writing blind, and a
       fresh device would push its empty table over the records in the account. */
    if (mineAdds) this.save();
    return gained;
  }

  private releaseHold(): void {
    if (this.cloudHoldUntil === 0) return;
    this.cloudHoldUntil = 0;
    if (this.heldDirty) this.save();
  }

  private load(): Table {
    const raw = read<Stored | null>(KEY, null);
    const out: Table = {};
    if (!raw || typeof raw !== 'object') return out;
    // The value comes from the platform cloud and from a storage the player can edit: trust nothing.
    for (const [id, row] of Object.entries(raw)) {
      if (!row || typeof row !== 'object' || id.length > 40) continue;
      for (const d of DIFFICULTIES) {
        const cell = (row as Record<string, unknown>)[d] as { p?: unknown; t?: unknown } | undefined;
        if (!cell) continue;
        const place = Math.floor(Number(cell.p));
        const time = Number(cell.t);
        if (!(place >= 1 && place <= KART_COUNT) || !(time > 0 && time <= MAX_TIME)) continue;
        (out[id] ??= {})[d] = { place, time };
      }
    }
    return out;
  }

  private save(): void {
    const data: Stored = {};
    for (const [id, row] of Object.entries(this.table)) {
      for (const d of DIFFICULTIES) {
        const r = row[d];
        if (r) (data[id] ??= {})[d] = { p: r.place, t: r.time };
      }
    }
    if (performance.now() < this.cloudHoldUntil) {
      this.heldDirty = true;
      try {
        localStorage.setItem(scoped(KEY), JSON.stringify(data));
      } catch {
        // Storage may be denied inside a platform frame; the session still works.
      }
      return;
    }
    this.heldDirty = false;
    write(KEY, data);
  }
}
