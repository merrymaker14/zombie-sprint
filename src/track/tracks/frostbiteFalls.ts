import type { TrackDefinition } from '../../core/types';

/**
 * Frozen Outbreak - slippery ice route.
 * High start straight -> tight chicane -> big downhill sweeper -> frozen-lake causeway with
 * no barriers (void off the edge!) -> long climb -> second chicane -> final corner.
 * ~1200 m.
 */
export const frostbiteFalls: TrackDefinition = {
  id: 'frostbite_falls',
  name: 'Frozen Outbreak',
  theme: 'snow',
  laps: 3,
  description: 'A slippery ice run past abandoned shelters and a dangerous frozen-lake shortcut.',
  difficulty: 2,
  controlPoints: [
    { x: 0, y: 8, z: 0 }, // 0 finish line (plateau)
    { x: 0, y: 8, z: -134.1 },
    { x: -6.7, y: 7.5, z: -150.4 }, // chicane 1
    { x: -6.7, y: 6.5, z: -182.9 },
    { x: 0, y: 5.5, z: -199.2 },
    { x: 0, y: 4.5, z: -237.5 },
    { x: 57.5, y: 2, z: -295 }, // big downhill sweeper
    { x: 134.1, y: 0, z: -295 },
    { x: 208.7, y: -1, z: -264.1 }, // frozen lake sweep (void)
    { x: 239.5, y: -1, z: -189.6 },
    { x: 239.5, y: -1, z: -122.5 }, // end of lake
    { x: 239.5, y: 1.5, z: -21.9 }, // long climb
    { x: 239.5, y: 4, z: 78.7 },
    { x: 191.6, y: 5.5, z: 126.6 },
    { x: 143.7, y: 6.5, z: 126.6 },
    { x: 127.5, y: 7.5, z: 119.8 }, // chicane 2
    { x: 94.9, y: 8.5, z: 119.8 },
    { x: 78.7, y: 9, z: 126.6 },
    { x: 47.9, y: 8.5, z: 126.6 },
    { x: 0, y: 8, z: 78.7 }, // final corner onto the straight
  ],
  halfWidth: 8,
  halfWidths: [8.5, 8.5, 8.5, 8.5, 8.5, 8, 8, 7.5, 7.5, 7.5, 7.5, 8, 8, 8, 8, 8.5, 8.5, 8.5, 8, 8.5],
  wallHalfWidthFactor: 1.5,
  itemBoxRows: [0.08, 0.36, 0.62, 0.9],
  boostPads: [0.22, 0.66, 0.935],
  voidRanges: [[0.315, 0.545]],
  environment: {
    skyTop: 0x26394a,
    skyHorizon: 0x97a8b0,
    skyBottom: 0xc4d0d4,
    fogColor: 0xa4b3b9,
    fogDensity: 0.0034,
    sunColor: 0xdae6ee,
    sunIntensity: 1.75,
    sunDirection: { x: 0.36, y: 0.66, z: -0.66 },
    ambientSky: 0xb8cad6,
    ambientGround: 0x7f909a,
    ambientIntensity: 1.0,
  },
  palette: {
    road: 0x4f5a66,
    roadStripe: 0xf2f6f8,
    curb: 0xcc2f2f,
    curbAlt: 0xf4f4f4,
    offroad: 0xdbe3e8,
    wall: 0x9cc3d6,
    ground: 0xd6dfe5,
  },
};
