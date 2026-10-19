# How Cinderbelt is made with AI

Cinderbelt is a browser space game: fly a ship, mine asteroids, trade, fight pirates, and build your own
ship from parts. It is made by one person who designs and decides, and by AI coding agents (Claude Code)
that do the implementation under that person's direction. This page describes how that works in
practice, what the process looks like, and where it has gone wrong. It is meant to be honest rather than
impressive.

Some numbers: work started in mid-October 2026, and about 640 commits of private history came before
the first public release (the public repository starts with a single release commit). At that release
the suite had about 4,470 unit tests and 177 end-to-end tests. Those numbers say how much was produced, not how good it is. The
verification process described below is what tells us the second part.

## 1. Who does what

**The author** owns everything that is a matter of judgement:

- the vision of the game and what to build next;
- design decisions: when an agent proposes two or three options for a mechanic, the author picks, and
  the pick is written into the design spec so it is not re-litigated later;
- playtesting. Whether something is fun, readable, or fair is not something the test suite can say;
- taste. One early rule was "no generic AI-looking UI": the interface follows its own design system
  (the "Hull language", a look derived from the ship hulls and panels of the game itself) instead of default dark-glass
  panels. The same applies to art direction and music mood;
- priorities and scope, including saying "not now".

The author writes in Slovak. That is part of why the game is bilingual: Slovak and English are both
first-class, every player-facing string lives in the i18n modules, and a test fails if one language is
missing a key. The design notes are mostly Slovak too; the code, comments and public documentation are
English.

**The agents** do the production work:

- game code (simulation, rendering, UI, save system);
- art, as Blender Python scripts (section 4);
- music, composed and rendered as code (section 4);
- tests, from unit tests to Playwright end-to-end specs and the bot tooling;
- documentation and reviews of other agents' work.

The author does not review every line. The author reviews behaviour, by playing, and relies on the checks
below to catch the rest. That is a real trade-off, and a reader of this repository should know it.

## 2. How a feature gets made

A feature normally goes through the same pipeline:

1. **Brainstorm and design spec.** The author and an agent talk through the idea. The result is a spec in
   the author's working notes with the decisions recorded, including the options that were rejected.
   Examples of what such specs cover: the long-term playability design, the sector system, the UI
   language, ship building 2.0, and this public release itself.
2. **Critique.** For larger designs a separate agent reads the spec and writes a critique (some specs have
   a "critique 1" next to them). The point is a second reading that is not anchored on the first.
3. **Implementation plan.** The spec is turned into a plan with small, self-contained tasks. The working
   notes contain a few dozen of these, one per milestone or stage (for example the first prototype,
   mining, stations and trade, combat, the flight trainer, sectors, the fleet/hangar milestone, the
   Guild and trade milestone, the performance pass).
4. **Dispatch.** A coordinator agent hands the tasks to fresh, focused sub-agents, in parallel when the
   tasks do not touch the same files. Each sub-agent owns a set of files and gets a short brief: goal,
   what was ruled out, which files to read. A fresh agent per task works better than one long-running
   agent, because there is less accumulated context to go stale or drift.
5. **Per-task checks.** Every task has to pass `npm run typecheck`, the unit tests, a production build,
   the e2e specs that its change touches, and a quick run of the balance bot. Tests for logic are written
   first.
6. **Review.** Review agents compare the plans and specs with the code that was actually written, and
   look for places where the two disagree.
7. **Verification passes.** Before a milestone is called done, a separate pass runs the full e2e suite,
   longer bot runs, the saboteur, and the performance guard on a production build. These passes are
   written up as reports, including what failed and why.
8. **The author plays it.** Feedback goes back into step 1.

## 3. Guard rails that make it work

Agents are fast and confident, and they make mistakes at the same rate as anyone, just more quickly. The
repository is set up so that mistakes show up as red checks instead of as surprises in a playtest.

- **Deterministic, pure simulation.** `src/sim/` has no three.js, no DOM, no `Math.random` and no `Date`.
  Everything is driven by a seed, so a situation can be reproduced exactly, and rendering and UI can only
  read the state. See [docs/ARCHITECTURE.md](ARCHITECTURE.md).
- **Versioned saves with migrations.** Any new persistent state needs a version bump, a migration and
  tests, and the save/load determinism tests must stay green.
- **Fixtures.** `?fixture=hour1` (dev server) or `loadFixture(page, 'hour1')` in a test jumps straight to
  a saved game situation: a pirate fortress, a convoy, a derelict station, a damaged ship. Agents and
  tests do not have to play for an hour to reach the thing they are checking. The list is in
  `tests/fixtures/saves/README.md`.
- **Balance bot and economy model.** A scripted pilot (`tools/bot/`) plays the game through the same sim
  API and reports milestone timings and money flow across many seeds; an economy model lives in
  `tools/econ/`. Its quick suite runs with every task; long runs are reserved for changes that really move
  the economy.
- **The saboteur.** A second mode of the bot actively tries to break the game: it hunts for exploits such
  as arbitrage loops, softlocks, and ways to get paid twice. After the Guild and trade milestone the
  recorded result was a list of found exploits that were all fixed before the pass was closed.
- **Performance budget with an automated guard.** The budget (frame time, draw calls, triangles, upload
  size, heap) is written down in CLAUDE.md and ARCHITECTURE.md, and `npm run test:perf` measures it on a
  production build with a real GPU.
- **Language and i18n checks.** `npm run lint:lang` fails on non-English code comments and test titles.
  An i18n parity test fails when a string exists in only one language.
- **Screenshots that agents must look at.** For UI and rendering changes, an agent has to take a
  Playwright screenshot and actually view it, not just assert that the page loaded.

None of this proves the game is bug-free. It narrows where bugs can hide.

## 4. Art and music as code

**Art.** Everything visual is generated by Python scripts run in headless Blender: ship parts, hull
connectors, asteroids, stations, derelicts, landmarks, planets, communicator portraits, UI icons, textures
and VFX sprites. Nothing is downloaded and nothing is hand-modelled. One entry-point script rebuilds the
whole asset set, and an optimizer post-step compresses the results; a game test fails if a model is not
optimized. The conventions, entry points and timings are in [art/README.md](../art/README.md). A practical
consequence is that art can be reviewed as a diff and regenerated, and an art agent works in `art/` and
`public/assets/` without touching game code.

The honest limit: scripted art has a recognisable character, and a first version from an agent is rarely
good. The art audit reports in the working notes are largely lists of "this looks wrong or repetitive,
fix it" that the author and agents went through over several rounds.

**Music.** The soundtrack is composed as code and rendered offline by a Python pipeline in
[tools/music/](../tools/music/README.md). Every instrument is synthesized (additive, FM, noise); there are
no samples. Each part has its own seeded random generator, so a rebuild is deterministic, and the Opus
files are muxed bit-exact, so rebuilding reproduces the committed files byte for byte with the same
encoder. The build lints melodies against the chord progression and validates loop seams. Combat music is
shipped as stems that add up to the full mix and are layered by intensity.

## 5. What worked, what did not

**Worked**

- *Small, focused agents.* A fresh agent with a tight brief and its own set of files beat long sessions.
  It is also what makes parallel work possible at all.
- *Writing decisions down.* Specs with recorded decisions meant a new agent could pick up a task without
  being told the history, and the author did not have to repeat choices.
- *Making the game testable by construction.* The deterministic sim, fixtures and bot made it cheap to
  check large changes (a performance pass of 14 small tasks, a full translation of comments).
- *Measuring performance on the production build.* An audit after the Guild milestone found, among other
  things, that opening the map with a route planned cost about 24 ms of JavaScript per frame under a 4x
  CPU throttle, and the station screen about 15 ms. The follow-up pass brought both well under budget
  (roughly 2 ms and 6 ms in the written results). Those problems were invisible on a fast desktop.

**Did not work, or cost time**

- *Several agents in one git tree.* Agents working in parallel in one checkout stepped on each other.
  The rules in CLAUDE.md are scar tissue: stage files explicitly, never `git add -A`, build any temporary
  index from `HEAD` (a stale copy of the index silently reverted other agents' commits), never stash or
  hard-reset a shared tree, and never remove a git worktree whose `node_modules` is a junction (it
  deleted the shared `node_modules` more than once).
- *Flaky tests under load.* A full e2e run takes tens of minutes. Several failures turned out to be
  timing or test-design problems, for example a spec that assumed no pirate patrol would spawn in a
  pirate sector while the suite was under load. The verification reports record these as test problems,
  not game bugs, and the fix was to make the specs filter by their own entities.
- *Performance regressions arrive quietly.* Features added by different agents each cost a little; the
  total went over budget (draw calls, triangle counts at far zoom, heap, allocation rate) until an audit
  measured it. The automated guard exists because of this. Some items from the audit are still listed as
  open work.
- *Mixed-language code.* The author's notes and early comments were Slovak. Translating all comments,
  test titles and i18n module names to English, and adding the lint that keeps it that way, was a
  dedicated pass before going public.
- *Agents agree with you.* An agent given a hypothesis tends to confirm it. That is why review and
  verification are separate agents with a different brief, and why the author's playtest is not optional.

**Still needs a human**

Deciding what to build; whether it is fun; whether the economy *feels* fair rather than merely balanced
on a spreadsheet; whether a screen looks like it belongs in this game; when to stop polishing. The bot can
say a milestone arrives within a few percent of the previous build. It cannot say the milestone is
enjoyable.

## 6. Using AI on this repo yourself

[CLAUDE.md](../CLAUDE.md) holds the project conventions in a form any coding agent (or person) can read:
language rules, the pure-simulation rule, the git rules, the workflow, and the performance budget. If you
use an AI assistant here, point it at that file and at [docs/ARCHITECTURE.md](ARCHITECTURE.md).

Contributions made with AI are welcome on the same terms as any other: they have to pass the same checks
(typecheck, unit tests, `lint:lang`, build, the relevant e2e specs, the quick bot suite) and follow the
same conventions, and the person submitting them is responsible for understanding what they changed. See
[CONTRIBUTING.md](../CONTRIBUTING.md).
