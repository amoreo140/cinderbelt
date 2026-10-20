# Cinderbelt – game design overview

Cinderbelt is a browser space game about building your own ship and flying it somewhere worth going. You start docked at a home station with a small tin-can ship. You mine asteroids, sell the ore, craft parts and snap them together on a grid. Then you fly further out, where the rock is richer and the pirates are better armed. The ship you end up with is one you designed, built and tested yourself.

This document describes the design of the game: what is in it today, and, clearly marked, what is planned. For the code structure see [`ARCHITECTURE.md`](ARCHITECTURE.md); for how the project was made see [`MADE-WITH-AI.md`](MADE-WITH-AI.md); for how to run it see the [`README`](../README.md).

## 1. Pitch and design pillars

You pilot a ship built from parts on a grid. The ship is simulated as one rigid body with real mass, centre of gravity and moment of inertia, so where you put an engine or a heavy cargo hold changes how it flies. The view is top-down 3D with a tilted camera, and the whole game plays on a single plane in an infinite, deterministically generated universe. Everything is made for this game: 3D models by Blender scripts, music composed as code, no downloaded assets.

The design is organised around a few pillars. New features are judged by whether they support at least one and weaken none.

- **The ship is your work.** Every upgrade is visible on the hull and changes how the ship flies. There is no character XP and no passive "+5% mining" skill tree. Parts are the only source of power; the research tree (the Archive) unlocks parts and services, not percentages.
- **Further means richer, stranger and more dangerous.** Distance from home is the main axis of progress. Each depth has its own resources, threats, sky, music and points of interest, and some regions can only be survived with a specific part.
- **Every trip is a small story.** A trip has a departure, a goal, a complication and a return. Fuel, cargo and risk are three axes of decision ("one more asteroid, or home?"). Coming home is the reward.
- **The universe remembers.** Mined fields, destroyed nests, repaired relays and wrecks stay where you left them. Your work visibly changes the space around you.
- **Mystery is assembled from knowledge.** The story is not told in cutscenes. It is pieced together from signals, logs and places, and the journal shows what you know and what is missing.
- **Respect for the player's time.** You can save and pause any time, there are no daily tasks and no time-limited content, and the game never punishes you for not playing.

Mining is meant to be a skill, not a timer: ore veins have a grade (roughly 60–160% yield), richer chunks reward careful flying, and a mining beam has to be aimed, not just held down. The camera is tuned for readability: it zooms out in combat, enemies get arrows and health rings, and the background can be dimmed.

## 2. Core loop

**Fly, mine, haul or trade, upgrade or build, explore or fight, return.** Money, fuel, energy and cargo all pull on each other.

| Resource | Where it comes from | What it limits |
|---|---|---|
| Credits | Selling ore and goods, contracts, wreck salvage, bounties | Buying and crafting parts, hangar slots, repairs |
| Fuel | Made from ice at stations; also from convoy tankers | Engines and the inertial dampers burn it in proportion to thrust |
| Energy | The cockpit and reactors produce it, batteries store it | Lasers, cannons, shields, the tractor beam, the scanner and on-board workshops drain it; without energy they stop working |
| Heat | Each mining laser heats up while it cuts a vein | After 4 s on a vein the laser overheats and cools for 1.5 s |
| Cargo | Cargo holds | Mining stops when the hold is full; cargo mass makes the ship heavier |

The pieces interact in simple ways. A bigger hold means more money per trip but a slower, less manoeuvrable ship. More lasers mine faster but need a bigger reactor, and a bigger reactor needs hull space. Fuel makes the far trip a decision: ice mined near home becomes the range you can spend further out. Money buys better parts, better parts open farther sectors, and farther sectors pay more and push back harder.

Stations are the hub. A station has these tabs: Overview, Market (resources and parts), Crafting, Shipyard, Service, Board (contracts, cartography) and the Archive. The home station also has a Development tab. Docking is a manoeuvre rather than a button: you approach the dock clamp slowly and nose-first (within about 4 u, under about 3 u/s, bow within 35 degrees), and a docking panel guides you.

Flight itself uses inertia. Engines push in the direction they face; gyroscopes turn the ship; inertial dampers (on by default) use your engines to stop drift on any axis where you give no input. Each cockpit has weak built-in manoeuvring thrusters, so any ship can always be brought to a halt.

## 3. Ship building

The Shipyard is a grid editor. A ship is a connected set of parts on integer grid cells (1x1, 2x1 and 2x2 parts, rotated in 90-degree steps), with exactly one Cockpit. A part has mass, durability and a function.

**Parts.** Cockpit, Armour, Engine (main, side, reverse), Gyroscope, Fuel tank, Reactor, Battery, Cargo hold, Mining laser, Heavy laser, Cannon, Shield generator, Radar, Tractor beam, plus later additions such as the Large reactor (it explodes when destroyed), the Repair module (consumes material from the ship's cargo) and the on-board Refinery (refined ore, about +15% value). Many parts have variants such as Overdrive, Eco, Rapid-fire, Armoured, Survey, Combat, Scout, Extended and Quick-charge.

**Tiers.** Parts come in tiers T1 and T2 today, with T3 planned. Higher tiers need rarer materials and are made in Crafting.

**Hull budget.** The Cockpit determines how many hull points the ship may have (28, 48, 80 and 140 for successive cockpit tiers in the design). A 1x1 part costs 1 point, 2x1 costs 2, 3x1 costs 3 and 2x2 costs 3. This makes the shipyard a puzzle with trade-offs rather than "bigger is better".

**Hull shell.** A visible shell is drawn around the parts, with torn edges when the ship is damaged. Position lights and silhouettes show the ship's shape at a glance.

**Shaped armour.** Armour has nine shapes (wedge, cut corner, rounded, arc, half, nose, wings, a 2x1 nose, and a low ridge for the terrace). Shapes change where shots hit and where cannon firing arcs are cut, and a damaged plate must be repaired or scrapped to change shape, so there are no cheap repairs through shape swaps.

**Editing aids.** Free part placement (you only confirm when the ship is connected), group selection and move, an orbit and tilt camera, a mirror mode (M / Shift+M), a 180-degree rotate, a check panel, and "Restore to design" after damage or loss.

**Templates and sharing.** Ship designs can be saved as templates (an Archive node) and exported as share codes beginning with `AF1.` or `AF2.`, so players can trade designs as text.

**Fleet and hangar.** You can own several ships. Hangar slots are bought at stations (up to 2 in total, 4 with the Archive node "Hangar +2"; slot prices run from 5k to 40k credits). You switch your active ship at a station; parked ships stay there with their cargo.

## 4. The world

**Infinite and chunked.** Space is divided into 200x200 unit chunks, generated deterministically from the world seed and the chunk coordinates, so the same seed always gives the same universe. Only your changes (mined rocks, destroyed nests, repaired relays, discoveries) are saved. Asteroids do not respawn, so the world gently pushes you outward.

**Depth and sectors.** Distance from home sets a hidden gradient of four depths (Home Belt, Outer Belts, Crystal Nebulae, Dead Zones), which drives economy and difficulty. On top of it the map is divided into irregular, named **sectors**, each with a security level:

| Security | Meaning |
|---|---|
| Quiet | Depth 1 only; essentially no pirates |
| Guarded | Guild Watch patrols; pirates are rare |
| Contested | Pirates are common; can be turned into Guarded by player work |
| Pirate | Pirate nests; the richest and most dangerous |

A sector has an environment (Asteroid Field, Ice Field, Quiet Space, Rust Field, Ion Fringe, Wreck Yard, Titan Plateau, Comet Path and others), a name, and local conditions. Pirates, sky and music change at sector borders, which are marked in space with buoys and fences, and entering a sector gives an entry notice and a radio line. The map shows your knowledge of each sector as Charted, Reported or Uncharted, plus a sector card, a route planner, and your own notes (N).

**Stations and the Guild.** The Mining Guild runs the stations and the **Guild Lanes**, corridors marked with buoys that lead out from home. A repair-and-power job on the Board lets you restore a **Guild relay** in a Contested sector: you repair the mast, power the receiver with your mining laser, and defend it from a Rust counterattack (Guild reinforcements arrive). The sector then becomes permanently Guarded. **Guild Watch** ships then patrol it and defend you.

**Convoys.** Trade convoys travel the Guild Lanes. You can link up with one (F) and buy rare items, sell cargo to it at 0.9x of market price, or refuel from its tanker. You can also take an **escort** contract (10% advance, ambushes on the way, a reward on arrival). Guild Watch ships and convoy ships are real ships in the simulation, and your weapons never fire on them.

**Points of interest.** Comets can be mined while they move. **Derelict stations** are dormant: you power a relay with the mining laser, which wakes defensive sentries, and a terminal then opens a cache. **Ship graveyards** are fields of wrecks with live mines and sleeping pirates. Landmarks give sectors their identity. Signals, anomalies and Forge-smith Echoes (the remains of the ancient builders) are found with the scanner, and a **journal** (J) assembles what you learn.

**Maps and charts as goods.** The Cartographic Institute buys survey data. You place survey points with the scanner (Tab) to chart a sector, sell your own maps at the Cartography section of the Board, and buy Guild maps that reveal neighbouring sectors. The contract "First chart" introduces this.

A director schedules world events (distress signals, ion storms, comet flybys, ambushes) so that space does not feel static.

## 5. Combat and factions

**Ships are made of the same parts.** Pirates fly ships built from parts like yours, and damage applies to the part that is hit. A projectile is transformed into the ship's local frame and walked across the grid to the first part it meets; shields absorb damage first. When a part is destroyed, the ship is re-checked for connectivity from the Cockpit, and any disconnected section becomes a separate wreck with its own velocity. Losing the Cockpit means death.

**Wrecks and salvage.** Wrecks can be towed with the **tractor beam** (T), cut into pieces and salvaged for parts and materials. Some wrecks have joints you can cut to free valuable pieces.

**Pirates and clans.** Pirates act as clans (the Rust, the Cauldron, the Slanted Star) with their own ship models. Ship types include the Jackal, the Hammer, the Scavenger and the **Gunner** (long range, artillery-like). Named captains have bounties and appear in the Trophy hall once beaten. Pirates use a state machine (patrol, attack, circle and fire, flee at low health) and can raid your position if you attract too much Rust attention (Calm, Watched, Hunted, Raid). They pay tolls and offer duels via radio.

**Rust Fortresses.** A fortress (core, generator, turrets) is the big early fight and a milestone. Beating one earns a trophy.

**Guild Watch.** Real patrol ships defend the player and fight pirates in Guarded sectors.

**The Wardens** and the **Colossus** are planned later opponents (see the roadmap).

## 6. Progression and meta

- **Contracts.** The Board offers Delivery, Mining, Hunt, Rescue, Survey, Scan, Escort, Retrieval, Construction, Fortress and Chart contracts, generated from templates plus place and modifier. Reward is tied to your best ship. Reputation with the Guild, the Institute and the Free Traders moves through Unknown, Known, Trusted and Proven.
- **Objectives (G).** A pinned goal panel ("Engine T2: missing 8 Ti") answers "what next?". The first hours are guided by **Guild Training**: nine steps in a training ship, led over the radio by Master Bartos, which you can skip.
- **The Archive.** A research tree paid with **Data** earned from exploration and Institute contracts. It unlocks parts, services and tools (for example the docking computer, templates, Hangar +2, map notes), not stat percentages.
- **Home station development.** The Development tab exists only on the home station. The **Paint shop** offers five paints (Factory, Graphite, Sand, Navy, Racing), free and only available at home. The **Trophy hall** displays copies of ships of defeated captains and the fortress trophy.
- **Difficulty.** Chosen at New game, with a seed:

| Death penalty | What happens |
|---|---|
| None | Respawn at the last station; nothing is lost |
| Mild | Cargo is lost and the ship comes back damaged |
| Hard | Installed parts and cargo are lost; credits and station storage stay |
| Hardcore | One life: on death the game permanently drops to Hard difficulty ("Fallen hero") |

 Pirate count, aim and mining yield are separate settings, and a Custom option mixes them.
- **Saves.** Four slots, plus autosave on docking, backups, and export to a file (`.cinder`). The save format is versioned and old saves migrate automatically.

## 7. Presentation

- **Art.** All 3D models are generated by Blender scripts in the repository: ship parts in three tiers, pirate sets per clan, stations, derelicts, the comet, ships of the Guild, planets and landmarks. Portraits for the radio are part of the same pipeline.
- **Music and sound.** Music is composed as code: an adaptive director picks a mood (menu, calm, adventure, combat, mystery) and layers intensity, and the music varies by sector. Voices come through a radio with portraits.
- **Multilingual.** The whole game is available in English, Slovak and German, switchable without restarting. The browser's language is detected on first start.
- **Performance.** The production-build budget is 60 fps at Medium on a 4x throttled CPU, with at most 180 draw calls at Medium and 700k triangles. A dynamic resolution option protects slower GPUs, and a `test:perf` guard checks the budget.

## 8. Roadmap (plans, not promises)

Everything above exists in the current build. The items below are plans that may change.

- **Next: M4e "Mastery".** A test track with timed runs, decorations and awards, assists, and additional music layers (mining layer, tension state, discovery sting, a "Home" motif).
- **M5a: Crystal zone.** A third depth with crystal asteroids, T3 parts, radiation and the shielding needed to survive it, the Wardens (a guardian faction), and the first big boss, the **Colossus**. This is planned as the first complete release of the main story arc.
- **Later: planets and bases.** Planetary bases with cargo drones and trade routes, then a deeper zone with exotic matter and ruins, workshops of the Forge-smiths and a final project that completes the ancient **warp core**, the central mystery of the game. After that, expeditions and other post-game content.
