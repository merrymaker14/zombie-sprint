import type { TrackDefinition } from '../../core/types';

/**
 * Doomsday Highway - ash dunes and broken overpasses.
 * Start straight -> banked sweeper -> jump crest -> hairpin 1 -> 180 degree banked sweeper ->
 * long canyon descent with high walls -> hairpin 2 -> flowing S-bend -> final sweeper.
 * ~1150 m.
 */
export const duneDrift: TrackDefinition = {
  id: 'dune_drift',
  name: 'Doomsday Highway',
  theme: 'desert',
  laps: 3,
  description: 'Race through ash dunes and broken overpasses before the horde catches up.',
  difficulty: 2,
  controlPoints: [
    { x: 0, y: 0, z: 0 }, // 0 finish line
    { x: 0, y: 0, z: -120.2 },
    { x: 60.1, y: 2, z: -180.3 }, // banked sweeper 1
    { x: 100.2, y: 3, z: -180.3 },
    { x: 136.2, y: 4.5, z: -144.2 },
    { x: 136.2, y: 8, z: -116.2 }, // jump crest
    { x: 136.2, y: 4.5, z: -88.1 },
    { x: 146.2, y: 2, z: -70.8 }, // hairpin 1 (left)
    { x: 166.3, y: 2, z: -70.8 },
    { x: 176.3, y: 2, z: -88.1 },
    { x: 176.3, y: 3, z: -128.2 },
    { x: 212.3, y: 5, z: -164.2 }, // banked sweeper 2 (180 deg)
    { x: 248.4, y: 6, z: -128.2 },
    { x: 248.4, y: 3.8, z: -20.8 }, // canyon descent
    { x: 248.4, y: 0.5, z: 86.5 },
    { x: 237.6, y: 0, z: 105.3 }, // hairpin 2 (right)
    { x: 215.9, y: 0, z: 105.3 },
    { x: 205.1, y: 0, z: 86.5 },
    { x: 205.1, y: 0, z: 66.5 },
    { x: 171.5, y: 0.5, z: 32.8 }, // left sweep
    { x: 136.8, y: 1.5, z: 52.9 }, // S-bend
    { x: 102.1, y: 2.5, z: 72.9 },
    { x: 44.1, y: 0.5, z: 72.9 },
    { x: 0, y: 0, z: 28.8 }, // final sweeper onto the straight
  ],
  halfWidth: 8.5,
  halfWidths: [9, 9, 8.5, 8.5, 8.5, 8.5, 8.5, 9, 9, 9, 8.5, 8.5, 8, 7.5, 7.5, 9, 9, 9, 8.5, 8.5, 8.5, 8.5, 9, 9],
  wallHalfWidthFactor: 1.3,
  itemBoxRows: [0.12, 0.42, 0.62, 0.86],
  boostPads: [0.255, 0.55, 0.88],
  environment: {
    skyTop: 0x2e1838,
    skyHorizon: 0xd8683e,
    skyBottom: 0x8a4a38,
    fogColor: 0xb87656,
    fogDensity: 0.0026,
    sunColor: 0xffa066,
    sunIntensity: 2.4,
    sunDirection: { x: -0.7, y: 0.36, z: 0.61 },
    ambientSky: 0xe8a488,
    ambientGround: 0x6e4a3a,
    ambientIntensity: 1.05,
  },
  palette: {
    road: 0x4c4543,
    roadStripe: 0xffd35a,
    curb: 0xe8b020,
    curbAlt: 0x2a2624,
    offroad: 0xae8a6c,
    wall: 0x9e7258,
    ground: 0xa8826a,
  },
};
