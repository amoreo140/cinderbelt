# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.3.3] – robustness

Fixes from a robustness and security review by brummilab (issues #2, #3, #4 and PR #5) – thank you!

### Fixed
- An error in the game loop no longer freezes the game silently: it stops at a card that saves your progress when that is safe, offers Back to menu and copyable error details, and stray browser errors show a short warning.
- A game that fails to load or start no longer leaves its slot reported as open in another tab, a failed save no longer leaves the indicator on "Saving", a screen that fails to download shows a Retry button, and a language file that cannot be loaded at start falls back to another language or a Reload card instead of a blank page.
- An imported save with an absurd game tick or position no longer freezes the tab: validation accepts only safe integers, caps the tick at 2^40 and every saved position and velocity at 1e10.
- Save import is bounded further: every deadline and event tick, string length, duplicate or oversized list (contract boards, combat objects, ship parts) and file size above 16 MB is rejected instead of stalling the game.

### Project
- The web version is published only after all checks pass, and only the publishing step has write access; workflow actions are pinned and kept current by Dependabot.

## [0.3.2] – flight comfort

Based on player feedback on 0.3.1: easier flying for newcomers.

### Flight
- Assisted flight: with the inertial dampers on, your ship holds a cruise speed of 25 u/s; switch the dampers off (Z) for free flight up to the full 60 u/s. The console shows when the limit is holding you back.
- The route planner and the shipyard figures use the cruise speed.
- A bow arrow shows which way your ship faces; it is brighter for a few seconds after undocking.

### Docking
- Dock at any heading: within reach of the clamp and slow enough, the clamp turns your ship into place. The Archive's docking computer still extends the reach and speed.

### Scanner
- A pulse costs 15 energy instead of 30.
- The low-energy message tells you how much energy the scanner needs and how much you have; an empty pulse says what the scanner finds.

### Look and sound
- Space dust streaks at speed are shorter and fainter.
- The engine sound is quieter and softer.
- Wrecks near you no longer fade away in front of you; they expire only once you are far away.

## [0.3.1] – a clearer start

Based on the feedback on the first public release: a calmer first 15 minutes, a simpler station and a third language.

### First 15 minutes
- Music is off by default for new players, and the controls help starts closed.
- New interface size setting (Settings) scales the whole HUD.
- Guild Training panel: a checklist of the phases that stays until a step is done, a Done state, and a final card that stays on screen; bottom centre in flight.
- Goal marker on screen and a bolder goal arrow, with concrete target names.
- HUD parts, keys and station tabs unlock step by step during the training; skipping or finishing it shows everything. Saves are unaffected, but a save made mid-training shows only the parts unlocked so far.
- Compact ship console: cargo, speed, shield and dampers appear only when they matter.
- One-line location readout; the radar legend shows while `?` is held.
- Radio shows as one line at the top centre with a longer reading time and up to four lines of text.
- Larger HUD text.
- Edge arrows keep clear of the pirate threat band and the radio line.

### Station
- Six station tabs: servicing (refuel, repair) moved into the Overview, crafting into the Market, and the Board is now called Jobs.
- Tab icons and badges: the Jobs tab counts contracts ready to hand in, Market and Shipyard show a dot when there is something to do.
- Larger station text.
- Arrival card on the Overview: the useful actions after docking (sell cargo, refuel, repair, hand in contracts) as big buttons with their values.
- Jobs board: a recommended contract with the reason, compact rows for the other offers, and a compact local-conditions strip.
- Local conditions show only when something is going on in the sector.
- The welcome text appears only at the home station; "Unload cargo to storage" sits under the cargo gauge.
- Training: the suggested cells are shown before the engine is turned, with an R prompt; the compact panel in the shipyard no longer overlaps its skip link.

### Shipyard
- Top view (Home) is a toggle: pressed again it returns to the 3/4 view.
- The footer shows that Alt + drag (or the middle button) turns and tilts the camera.

### Languages
- German as a third language, contributed by @brummilab (#1): every text module translated (`de*.ts`), a German glossary (`src/i18n/GLOSSARY-DE.md`), German sector names with gender agreement, German seed words, and German number and percent formatting.

## [0.3.0] – first public release

### Flight & mining
- Inertial flight with engines, gyroscopes and inertial dampers; mass, centre of gravity and moment of inertia come from the placed parts.
- Mining lasers aimed at veins with a yield grade; lasers overheat after 4 s and cool for 1.5 s.
- Fuel made from ice, energy from reactors and batteries, cargo mass that slows the ship.
- Docking as a manoeuvre with a guiding panel.

### Ships & building
- Shipyard grid editor with 1x1, 2x1 and 2x2 parts, a hull budget per cockpit tier, T1 and T2 parts and part variants.
- Nine shaped-armour variants, a hull shell with torn edges, mirror mode, templates and `CB2.` share codes.
- Fleet and hangar with several ships.

### World
- Infinite deterministic universe in 200x200 chunks, four depths and named sectors with Quiet, Guarded, Contested and Pirate security.
- Guild stations, Guild Lanes, convoys with trading, refuelling and escort contracts, and restorable Guild relays.
- Comets, derelict stations, ship graveyards, landmarks, signals and world events (distress calls, ion storms, ambushes).
- Sector map with chart knowledge, route planner, notes, and cartography as a trade.

### Combat
- Part-based damage, shields, severed sections that become wrecks, tractor beam towing and salvage.
- Pirate clans with their own ships, named captains with bounties, tolls and duels, and Rust Fortresses.
- Guild Watch patrol ships that defend the player.

### Progression
- Eleven contract types with reputation tiers, a pinned objectives panel and a nine-step Guild Training.
- The Archive research tree, home station development (paint shop, trophy hall), four death penalties and custom difficulty.

### Presentation
- Adaptive music composed as code, radio voices with portraits, and models generated by Blender scripts.
- Complete English and Slovak translations, switchable at runtime.

### Tech
- Versioned saves in IndexedDB with four slots, autosave, backups and `.cinder` export.
- Deterministic simulation with unit, end-to-end and balance-bot tests, and a performance guard.
- Code under MIT, art and music under CC BY 4.0.
