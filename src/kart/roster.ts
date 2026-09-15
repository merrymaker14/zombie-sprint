/**
 * Zombie roster - 8 original racers. Stats are 0..1 and trade off by weight
 * class: light = agile/quick off the line, heavy = fast top end but ponderous.
 */
import type { CharacterDef } from '../core/types';

export const CHARACTERS: CharacterDef[] = [
  // --- light ---------------------------------------------------------------
  {
    id: 'zippy',
    name: 'Grave Sprinter',
    color: 0x1fd6ee,
    accent: 0xff3fb4,
    driverColor: 0xf7f9ff,
    weightClass: 'light',
    stats: { speed: 0.18, acceleration: 0.95, handling: 0.9, weight: 0.12, miniTurbo: 0.9 },
    tagline: 'The fastest zombie on the starting line.',
  },
  {
    id: 'pixel',
    name: 'Neon Ghoul',
    color: 0xff4fa3,
    accent: 0x4dffc3,
    driverColor: 0xfff1a8,
    weightClass: 'light',
    stats: { speed: 0.12, acceleration: 0.9, handling: 0.95, weight: 0.08, miniTurbo: 0.85 },
    tagline: 'Small, slippery, and impossible to catch.',
  },
  {
    id: 'fennec',
    name: 'Howler',
    color: 0xffcf1f,
    accent: 0xff6a00,
    driverColor: 0x2b1b12,
    weightClass: 'light',
    stats: { speed: 0.25, acceleration: 0.85, handling: 0.8, weight: 0.2, miniTurbo: 0.95 },
    tagline: 'A scream in every corner.',
  },
  // --- medium --------------------------------------------------------------
  {
    id: 'max',
    name: 'Rotter Ace',
    color: 0xe32222,
    accent: 0xffd23f,
    driverColor: 0xffffff,
    weightClass: 'medium',
    stats: { speed: 0.55, acceleration: 0.55, handling: 0.55, weight: 0.5, miniTurbo: 0.55 },
    tagline: 'The balanced champion of the horde.',
  },
  {
    id: 'juno',
    name: 'Voltage Zombie',
    color: 0x7c3aed,
    accent: 0xffb020,
    driverColor: 0x161326,
    weightClass: 'medium',
    stats: { speed: 0.6, acceleration: 0.45, handling: 0.5, weight: 0.55, miniTurbo: 0.65 },
    tagline: 'Charges every drift with undead energy.',
  },
  {
    id: 'kai',
    name: 'Swamp Walker',
    color: 0x1e6bff,
    accent: 0xff7a1a,
    driverColor: 0xdff6ff,
    weightClass: 'medium',
    stats: { speed: 0.5, acceleration: 0.6, handling: 0.65, weight: 0.45, miniTurbo: 0.5 },
    tagline: 'Slow, steady, and covered in toxic slime.',
  },
  // --- heavy ---------------------------------------------------------------
  {
    id: 'bram',
    name: 'Bone Crusher',
    color: 0x1f9a4b,
    accent: 0xd88a3c,
    driverColor: 0x5a3b21,
    weightClass: 'heavy',
    stats: { speed: 0.92, acceleration: 0.2, handling: 0.25, weight: 0.95, miniTurbo: 0.3 },
    tagline: 'Heavy footsteps. Heavier collisions.',
  },
  {
    id: 'rosa',
    name: 'Grave Queen',
    color: 0xff6a00,
    accent: 0x19d3c5,
    driverColor: 0x2a2a34,
    weightClass: 'heavy',
    stats: { speed: 1.0, acceleration: 0.15, handling: 0.3, weight: 0.9, miniTurbo: 0.35 },
    tagline: 'The final boss of the starting grid.',
  },
];

export function getCharacter(id: string): CharacterDef {
  for (let i = 0; i < CHARACTERS.length; i++) {
    if (CHARACTERS[i].id === id) return CHARACTERS[i];
  }
  return CHARACTERS[0];
}
