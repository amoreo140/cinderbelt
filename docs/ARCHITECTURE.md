# Architecture

Cinderbelt is a browser game written in TypeScript. It is built with Vite, rendered with three.js
and has a Preact UI. The code is split into a pure simulation and three layers that only read it
(rendering, UI, audio). This document explains the split, what lives where and why. For the game
itself, see [GAME-DESIGN.md](GAME-DESIGN.md).

## The big picture

```text
 keyboard / mouse / UI buttons
            |
            v
   src/game/input.ts, UI handlers        build a PlayerCommand / GameAction
            |
            v
   src/game/Game.ts  --FixedLoop(60 Hz)-->  Simulation.step(cmd)   (src/sim)
            |                                   |  mutates state, returns SimEvent[]
            |                                   v
            |                        state (ships, world, career, ...)
            |                                   |
            +--- read-only access --------------+
            |            |              |
            v            v              v
     src/render      src/ui          src/audio
   (three.js scene) (Preact HUD,    (sfx recipes,
    interpolated     menus,          music director)
    between ticks)   station UI)

 saves: Simulation <-> src/sim/save (serialize / validate / migrate) <-> src/game/storage (IndexedDB)
 texts: src/i18n (tx()) is read by game, UI and audio; the simulation emits ids and events only
```

Everything the player does becomes a command or an action. The simulation advances in fixed
steps and returns events (a shot was fired, a contract completed, ...). The renderer, the UI and
the audio engine read the resulting state and react to the events. They never change the
simulation directly.

## Directory map

```text
src/
  main.ts        boot: language, save storage, App
  sim/           pure deterministic simulation (no three.js, no DOM)
  render/        three.js scene, models, post-processing, quality governor
  ui/            Preact components, the "Hull language" design system (ui/theme)
  game/          glue: App/boot, Game (loop), input, settings, view-models, save service
  data/          content tables: parts, stations, contracts, economy, factions, ...
  audio/         procedural SFX, ambient and the music player/director
  i18n/          Slovak + English + German texts and the tx() accessor
  testing/       small helpers shared by tests (GLB and fs access in Node)
art/             Blender scripts that generate every model/texture, optimizer, art handbook
public/assets/   shipped, optimized assets (models, textures, music, skybox, planets)
tools/           bot, econ model, fixtures, lint, music, perf, regions
tests/           e2e (Playwright) and the save fixtures
docs/            public documentation
```

## `src/sim` - the simulation

The simulation is a plain TypeScript state machine. `Simulation` (`src/sim/Simulation.ts`) owns
the world and the player's ship, and `Simulation.step(cmd)` advances it by one fixed tick
(`SIM_DT = 1/60`). Subsystems live in folders next to it: `combat`, `mining`, `ship`, `station`,
`world`, `career`, `contracts`, `discovery`, `salvage`, `pirates`, `convoys`, `fleet`, `guild`,
`home`, `navigation`, `events` and more.

Rules that make the rest of the architecture possible:

- **Pure and deterministic.** No three.js, no DOM, no `Math.random`, no `Date`. Randomness comes
  from a seeded generator (`createRng`, mulberry32, in `src/sim/math/rng.ts`) whose state is part
  of the saved state. The world is generated per chunk from the game seed. Same seed plus same
  commands means the same game. This is what makes saves, the balance bot and the determinism
  tests possible.
- **Fixed tick.** `src/game/fixedLoop.ts` accumulates real elapsed time and runs whole 1/60 s
  steps (at most 5 per frame, so a slow frame cannot cause a spiral of death). The renderer gets
  the leftover fraction as an interpolation alpha.
- **Commands in, events out.** The UI and input build `PlayerCommand`/`GameAction` values
  (`src/sim/commands.ts`); the simulation applies them in `step` and returns `SimEvent[]`. Text is
  never produced in the simulation; events carry ids and numbers and the UI looks the wording up
  in `src/i18n`.
- **Cached, read-only query results.** Many queries return shared cached objects
  (`sectorEffects`, `flightMods`, convoy and escort poses, `chunkPirates`, ...) to avoid garbage.
  Callers must treat them as read-only.
- **Scratch lists.** Hot paths reuse lists from `src/sim/scratch.ts` (`clearList` pops instead of
  setting `length = 0`, so V8 keeps the storage). A scratch list is filled and consumed inside one
  call; do not nest uses of the same one.

## `src/render` - three.js

`GameRenderer` (`src/render/GameRenderer.ts`) builds and updates the scene from simulation state.
It owns no game rules.

- **Model loading.** Models are loaded through `createModelLoader()`
  (`src/render/assets/gltf.ts`). Optimized GLBs are compressed with meshopt and reference a shared
  palette atlas (`AF_Palette`), so all models share one texture and one GPU upload. `ModelLibrary`
  and `catalog.ts` map ids to files; `prefetch.ts` and `bootAssets.ts` handle download order.
- **Batching.** A ship hull merges its static part meshes into one mesh per material
  (`shipBatch.ts`); station traffic vehicles (`traffic/vehicleBatch.ts`) and wrecks
  (`sites/wreckBatch.ts`) are batched similarly. Only moving nodes stay separate.
- **Level of detail.** Ship graveyards are the heaviest scenes: far out they drop shadows and
  ambient occlusion for wrecks, and wreck batches get a simplified LOD1 mesh (meshopt simplification
  in a shared worker, `sites/wreckLod*.ts`; without the worker they keep drawing LOD0).
- **Post chain.** `post/PostStack.ts` runs the post-processing (ambient occlusion in `AoPass.ts`,
  final composition in `FinalPass.ts`).
- **Quality and dynamic resolution.** `quality.ts` defines Low/Medium/High presets and the `auto`
  governor. `dynamicResolution.ts` lowers the render scale from measured GPU time (`gpuTimer.ts`)
  before a preset is stepped down, because a resolution change only resizes render targets while a
  preset change recompiles materials. Both are pure and unit tested.
- **Shader warm-up.** `warmup.ts` and `GameRenderer` compile programs and upload textures during
  loading (sliced into small tasks, with `compileAsync`), so no new shader program appears
  mid-session.

## `src/ui` - Preact

The UI is Preact (`src/ui/`), mounted over the canvas. Screens such as the menu, station, shipyard
editor and map are lazy-loaded (`lazy.ts`, `lazyScreens.ts`). Components read view-models built in
`src/game`. Pure helpers (`radar.ts`, `map.ts`, `hudMemo.ts`, ...) are unit tested separately from
the components.

Visual language: the **Hull language** design system. Its tokens and building blocks (panels,
buttons, chips, meters, modals, tabs, toasts, ...) live in `src/ui/theme` and `src/ui/kit.tsx`,
styled as plates and structural bands of a ship hull. Do not add generic dark-glass panels. A
standalone UI kit page (`ui-kit.html`) renders the components for review.

## `src/game` - glue

- `main.ts` loads the saved language, opens save storage and creates `App`
  (`src/game/app/App.ts`), which drives menu, loading, new game and in-game states
  (`appState.ts`). The heavy runtime (three.js, renderer, models) is downloaded behind the menu
  (`runtimeLoad.ts`, `runtime.ts`).
- `Game.ts` creates the `Simulation`, the renderer and the audio, runs the `FixedLoop`, forwards
  input and publishes state for the UI.
- `input.ts`, `flightAssist.ts` and friends turn raw input into commands.
- `settings/userSettings.ts` holds user preferences (language, graphics, controls) in
  `localStorage`; difficulty settings belong to a save (`src/sim/settings.ts`).
- `save/` is the save service (autosave, queue, slot locks); `storage/` is the IndexedDB
  implementation plus an in-memory fallback.
- `devFixtures.ts` boots a dev build into a test save (see Testing). It is imported only behind
  `import.meta.env.DEV`, so production builds contain neither it nor the fixtures.

## `src/data` - content tables

Parts, stations, factions, contracts, economy prices, sector definitions, pirates, training steps
and so on are plain typed tables (plus a few JSON files generated by the art scripts, such as
station and derelict layouts). They hold numbers and ids, not text. The simulation imports from
`src/data`; the economy model in `tools/econ` reads the same numbers.

## `src/audio`

`AudioEngine` is a Web Audio graph with procedural sound effects (`recipes.ts`, `combatRecipes.ts`,
`voices/`) and ambient layers. `audio/music` plays the pre-rendered Opus tracks listed in
`public/assets/music/manifest.json`; `musicDirector.ts` chooses tracks and stem intensity from the
game situation. `src/game/GameAudio.ts` and `audioMapping.ts` connect simulation events to sounds.

## `src/i18n` - three languages

The game is multilingual (Slovak, English and German). Player-facing text is only read through `tx()`
(`src/i18n/index.ts`), never hard-coded in components or the simulation. Each language is a
bundle (`textsSk.ts`, `textsEn.ts`, `textsDe.ts`) assembled from per-area modules (`skPirates.ts`,
`enPirates.ts`, `dePirates.ts`, ...), and **only the active language is loaded at runtime**; `setLocale()`
(`locale.ts`) is async the first time a language is switched to. Tests and the UI kit register
every language via `allTexts.ts`. `parity.test.ts` checks that all languages have the same keys and shapes.
`GLOSSARY.md` fixes the vocabulary.

## Saves

`src/sim/save` defines the save format; `LATEST_SAVE_VERSION` lives in `migrations.ts`.
`serialize.ts` turns a `Simulation` into data and back, `validate*.ts` reject malformed input and
`migrations.ts` upgrades old versions one step at a time (`MIGRATIONS[n]` converts n to n + 1).
Slot metadata for the load screen is a separate small record (`meta.ts`). `*Determinism.test.ts`
files check that saving and loading in the middle of a scenario gives exactly the same result as
running straight through. Any new persistent state needs a version bump, a migration and tests.

## Asset pipeline

Every visual asset is generated: Python scripts in `art/blender/` run in headless Blender and write
into `public/assets/`; `art/README.md` is the handbook. Afterwards `npm run assets:optimize`
(`art/tools/optimize_assets.mjs`) converts them to the shipped form: GLBs with the shared atlas and
meshopt compression, WebP images. `npm run assets:check` reports unoptimized files, and a game test
fails on an unoptimized GLB.

## Music pipeline

Music is composed as code. `tools/music/build.py` synthesizes, mixes, masters and encodes tracks
to Opus and writes `public/assets/music/manifest.json`. Renders are deterministic. See
`tools/music/README.md`.

## Testing and tools

- **Unit tests:** Vitest, files next to the code (`*.test.ts`). `npm test`.
- **E2E:** Playwright specs in `tests/e2e`, run against the dev server in software WebGL. Set
  `E2E_PORT` to use your own server.
- **Fixtures:** `tests/fixtures/saves/*.json` are saves at chosen points of the game, produced by
  `npm run fixtures` (`tools/fixtures`). Open `http://localhost:5317/?fixture=hour1` in dev or call
  `loadFixture(page, 'hour1')` in e2e. See `tests/fixtures/saves/README.md`.
- **Balance bot and saboteur:** `tools/bot` plays the game through the simulation's command
  interface (`npm run bot`); `npm run test:bot` is the quick suite. The saboteur scenarios
  (`tools/bot/saboteur`) try to break the economy and progression.
- **Economy model:** `tools/econ/econ-model.mjs` computes progression pace and material
  availability from `src/data`.
- **Performance guard:** `npm run test:perf` builds the production bundle with dev hooks and runs
  `tests/e2e/perfGuard.spec.ts` on a real GPU against the budget below.
- **Language lint:** `npm run lint:lang` fails on non-English code comments and test titles.
- `tools/regions` is a prototype tool for sector generation.

## Performance budget

Measured on the production build at 1080p:

- 60 fps at Medium on a 4x CPU throttle; JS per frame <= 3 ms (desktop, High), <= 14 ms (4x, High).
- No frame > 50 ms after warm-up (desktop); no new shader programs mid-session.
- Draw calls (all passes): Low <= 100, Medium <= 180, High <= 250; triangles <= 700k.
- Buffer uploads <= 256 KB/frame (use `addUpdateRange`); allocations <= 5 MB/s in flight.
- JS heap after GC <= 32 MB, flat over 5 minutes.
- Transparent `DoubleSide` materials need `forceSinglePass`. Benchmark production builds, not the
  dev server.
