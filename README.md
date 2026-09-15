# Zombie Sprint

Cartoon 3D championship among eight different zombies. Choose a zombie class,
drift through dangerous routes, collect powers and cross the finish line first.
The game is child-friendly: no blood, no gore, only bright arcade effects.

Everything is procedural: geometry, textures, sound effects, music and track
decoration are generated in code. There are no external game assets to host.

## Game

- 8 zombie racers with light, medium and heavy handling classes.
- 4 routes: Graveyard Loop, Doomsday Highway, Frozen Outbreak and Neon Quarantine.
- 3-lap runs against 7 AI rivals.
- Drift mini-boosts, speed pads, powers, collisions and catch-up balancing.
- Keyboard and gamepad controls.
- Interstitial ads after completed runs and display banners on non-racing screens.
- Platform pause, mute and gameplay signals wired through `game-kit`.

## Local development

```bash
npm install
npm run dev
```

The Vite server opens on the local URL it prints. WebGL2 is required.

Useful scripts:

| Script | Purpose |
| --- | --- |
| `npm run dev` | Start the development server |
| `npm run typecheck` | Run TypeScript checks |
| `npm run build` | Build the normal web version into `dist/` |
| `npm run build:targets` | Build and audit all platform archives |
| `npm run build:targets -- --target=yandex` | Build one platform archive |
| `npm run build:targets -- --gd-id=GAME_ID` | Build GameDistribution with its game ID |

## Platform builds

`npm run build:targets` produces four audited folders next to `dist/`:

- `dist-yandex/` — Yandex Games
- `dist-vkok/` — VK Games / OK
- `dist-crazy/` — CrazyGames
- `dist-gamedist/` — GameDistribution

The GameDistribution account must provide a real `gameId` before uploading that
archive. Until then, the shell is present and the game runs without its ads.

The shared integration is in `src/platform/ads.ts`. It handles SDK readiness,
banner visibility, interstitial pacing, rewarded-ad availability, app focus,
platform mute and gameplay start/stop signals.

## Controls

| Action | Keyboard | Gamepad |
| --- | --- | --- |
| Sprint | W / Up | Right trigger |
| Brake / reverse | S / Down | Left trigger |
| Steer | A / D or Left / Right | Left stick |
| Hop / drift | Space / Shift | A / RB |
| Use power | E / Ctrl / Enter | X / LB |
| Look back | Q | |
| Pause | Esc / P | Start |
| Menu confirm / back | Enter / Space / Esc | A / B |

## Project layout

```text
zombie-sprint/
├── index.html
├── src/
│   ├── main.ts
│   ├── platform/        platform ads and lifecycle bridge
│   ├── game/            game loop, races, camera and menu backdrop
│   ├── kart/            physics, procedural kart model and zombie roster
│   ├── track/           procedural routes, terrain and decorations
│   ├── items/           powers, hazards and item visuals
│   ├── ai/              rival driving logic
│   ├── audio/           synthesized audio and music
│   ├── fx/              particles and post-processing
│   └── ui/              menus, HUD, loading and results screens
├── tools/build-targets.mjs
└── game-kit/            shared platform runtime (sibling folder)
```

## License

The source is distributed under the MIT license. See [LICENSE](LICENSE).
