import type { TrackDefinition } from '../../core/types';

/**
 * Neon Quarantine - locked-down night city.
 * Start straight -> high-speed sweep -> jump -> hairpin 1 -> 180 degree sweep -> very long
 * straight -> hairpin 2 -> fast left -> S-bend -> hairpin 3 onto the start straight.
 * Simple closed centerline (no crossover). ~1350 m.
 */
export const neonNexus: TrackDefinition = {
  id: 'neon_nexus',
  name: 'Neon Quarantine',
  theme: 'neon',
  laps: 3,
  description: 'Lockdown lights, rooftop jumps, and three brutal corners for the deadliest racers.',
  difficulty: 3,
  controlPoints: [
    { x: 0, y: 0, z: 0 }, // 0 finish line
    { x: 0, y: 0, z: -158.5 },
    { x: 65.3, y: 2, z: -223.7 }, // high-speed sweep
    { x: 93.2, y: 6.5, z: -223.7 }, // jump crest
    { x: 121.2, y: 3, z: -223.7 },
    { x: 163.1, y: 1, z: -181.8 },
    { x: 163.1, y: 0, z: -144.5 },
    { x: 173.4, y: 0, z: -126.7 }, // hairpin 1 (left)
    { x: 193.9, y: 0, z: -126.7 },
    { x: 204.1, y: 0, z: -144.5 },
    { x: 204.1, y: 1, z: -181.8 },
    { x: 246.1, y: 2.5, z: -223.7 }, // 180 degree sweep
    { x: 288, y: 4, z: -181.8 },
    { x: 288, y: 0, z: 4.7 }, // long straight
    { x: 275, y: 0, z: 27.3 }, // hairpin 2 (right)
    { x: 248.9, y: 0, z: 27.3 },
    { x: 235.8, y: 0, z: 4.7 },
    { x: 193.9, y: 2, z: -37.3 }, // fast left
    { x: 147.3, y: 3, z: -37.3 },
    { x: 111, y: 2.5, z: -16.3 }, // S-bend
    { x: 74.6, y: 1.5, z: 4.7 },
    { x: 46.7, y: 1, z: 32.6 },
    { x: 46.7, y: 0.5, z: 88.6 },
    { x: 35, y: 0, z: 108.8 }, // hairpin 3 (right) onto the straight
    { x: 11.7, y: 0, z: 108.8 },
    { x: 0, y: 0, z: 88.6 },
  ],
  halfWidth: 7.5,
  halfWidths: [8, 8, 7.5, 7.5, 7.5, 7.5, 8, 8.5, 8.5, 8.5, 8, 7.5, 7.5, 8, 8.5, 8.5, 8.5, 7.5, 7.5, 7.5, 7.5, 7.5, 8, 8.5, 8.5, 8],
  wallHalfWidthFactor: 1.4,
  itemBoxRows: [0.09, 0.4, 0.56, 0.8],
  boostPads: [0.175, 0.52, 0.75],
  environment: {
    skyTop: 0x03030b,
    skyHorizon: 0x4a1a6a,
    skyBottom: 0x0f2e2a,
    fogColor: 0x160a22,
    fogDensity: 0.0009,
    sunColor: 0xb4d8c0,
    sunIntensity: 0.9,
    sunDirection: { x: -0.35, y: 0.8, z: -0.49 },
    ambientSky: 0x3a2266,
    ambientGround: 0x0f2a2a,
    ambientIntensity: 0.7,
  },
  palette: {
    road: 0x15141c,
    roadStripe: 0x2bd455,
    curb: 0xffa412,
    curbAlt: 0x17151d,
    offroad: 0x1e1c2a,
    wall: 0x00e5ff,
    ground: 0x0c0b14,
  },
};
