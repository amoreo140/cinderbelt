# Cinderbelt – project conventions

## Language
- **All code is in English: identifiers AND code comments.** `npm run lint:lang` checks
  comments and test titles (string literals may hold Slovak – tests assert the Slovak localisation).
- **The game is bilingual: Slovak + English.** Every player-facing string lives in
  the i18n files (`src/i18n/`), never hard-coded in components or the simulation.
  Add every new string in both languages.
  Only the active language is loaded at runtime (`setLocale()` is async on a first switch – await or poll
  in e2e); vitest and the UI kit register both via `src/i18n/allTexts.ts`.
- Documentation may be bilingual (Slovak/English).

## Git
- Commit messages: short and imperative; no tool attribution trailers – how AI is used in this
  project is described in `docs/MADE-WITH-AI.md`.
- Several agents or people may work in the same tree: stage files **explicitly**
  (`git add <paths>`), never `git add -A` over the whole tree. Never `git stash`,
  `git checkout -- <path>` or `git reset --hard` in a shared tree – they move other people's
  uncommitted work.
- Do not stage `art/`, `public/assets/` or `.claude/` in code changes; regenerated art is committed separately.

## Architecture
- `src/sim/` is pure and deterministic (no three.js, DOM, `Math.random`, `Date`).
  Many sim queries return cached shared objects (`sectorEffects`, `flightMods`, convoy/escort poses,
  `chunkPirates`, …) and hot paths use scratch lists (`src/sim/scratch.ts`): treat results as read-only
  and don't nest uses of the same scratch list.
  Rendering (`src/render/`) and UI (`src/ui/`) only read simulation state.
- Save format is versioned (`src/sim/save/`); any new persistent state needs a
  version bump + migration + tests, and the save/load determinism tests must stay green.
- UI uses the "Hull language" design system (tokens and components in `src/ui/theme/`).
  No generic dark-glass panels.
- Models load through `createModelLoader()` (`src/render/assets/gltf.ts`, shared
  palette atlas, meshopt). Art conventions: `art/README.md`.

## Workflow
- TDD for logic; verify UI/render with Playwright screenshots and look at them.
- Dev server: port 5317 (`npm run dev`). Don't kill servers you didn't start; run
  e2e with your own `--output=<dir>` and `--workers=2`.
- Test save positions: start a spec or a screenshot at a given point of the game with
  `loadFixture(page, 'hour1')` (`tests/e2e/fixtures.ts`) or `http://localhost:5317/?fixture=hour1`
  instead of playing there; list and regeneration (`npm run fixtures`) in `tests/fixtures/saves/README.md`.
  Own dev server for e2e: `E2E_PORT=5327 npx playwright test …`.
- Checks before finishing: `npm run typecheck`, `npm test`, `npm run lint:lang`, `npm run build`, only the
  e2e specs your change touches, and `npm run test:bot` (quick suite). Do NOT run the
  full e2e suite or long bot/saboteur runs (many seeds × hours) unless the brief asks;
  a short sanity bot run (≤ 5 seeds × 1 h) is enough when the economy really changed.
  The full suite runs in a separate verification pass.
- Perf guard: `npm run test:perf` (builds the production bundle with dev hooks, serves it on `PERF_PORT`, default 5337, and runs `tests/e2e/perfGuard.spec.ts` on the real GPU – the budget below per key fixture) after render/UI changes that can cost frames; not part of the default e2e run.
- Scratch git worktrees: run `npm install` inside them (own `node_modules`); never
  symlink or junction the shared `node_modules` into a worktree, and never run `npm ci` or
  `rm -rf node_modules` in a tree other processes are using.
- Key docs: `README.md`, `docs/GAME-DESIGN.md`, `docs/ARCHITECTURE.md`, `CONTRIBUTING.md`,
  `docs/MADE-WITH-AI.md`, `art/README.md` (art pipeline), `tests/fixtures/saves/README.md`
  (test fixtures), `tools/music/README.md` (music pipeline).

## Performance budget (production build, 1080p)
- Frame: 60 fps at Medium on a 4x CPU throttle; JS/frame ≤ 3 ms (desktop, High), ≤ 14 ms (4x, High).
- No frame > 50 ms after warm-up (desktop); no new shader programs mid-session (warm up with compileAsync).
- Draw calls (all passes): Low ≤ 100, Medium ≤ 180, High ≤ 250; triangles ≤ 700k.
- Buffer uploads ≤ 256 KB/frame (use addUpdateRange); allocations ≤ 5 MB/s in flight.
- JS heap after GC ≤ 32 MB, flat over 5 min; relaunch growth ≤ 0.1 MB.
- Transparent DoubleSide materials: set forceSinglePass. Benchmark prod builds, not the dev server.
