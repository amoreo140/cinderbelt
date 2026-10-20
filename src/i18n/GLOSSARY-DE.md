# Cinderbelt – translation glossary (EN → DE)

Shared term choices for the German locale. Every `de*.ts` module uses these words, so the game reads as
one text. The German modules are translated from the English ones (`en*.ts`) and checked against the
Slovak originals where the English is ambiguous. When a term is missing here, pick one, use it
consistently and add it to this table in the same commit.

## Style

- **Standard German**, informal second person (**du**, lower case), plain and short: no pathos, no
  exclamation marks in journal entries. Prefer short words in HUD labels; compounds are fine but keep
  them readable (hyphenate long or mixed ones: `Rost-Piraten`, `Schmiede-Echo`).
- Keep the **key letters** of the English line (`F – andocken`, `J – Journal`): the keys are the same in
  every language. Keys in brackets stay in brackets: `(J)`, `(M)`.
- **Numbers are formatted by the code** (`src/i18n/format.ts`: `1.240,5` in German) – texts only receive
  formatted strings or integers. Never hard-code a decimal separator.
- **Plurals**: German modules use `dePlural(n, one, other)` from `./plural` (same shape as `enPlural`).
- **Percentages**: German keeps a non-breaking space (`45 %`); UI code formats them with `formatPercent`.
- Typography: en dash with spaces ` – `; German quotes `„…“` for names and nicknames; `×` for
  multipliers, `−` (true minus) for negative deltas.
- A proper name inside a text uses the same German form everywhere.

## Units

| English | German | Notes |
|---|---|---|
| cr (credits) | **cr** (Credits) | `1.240 cr`; the word is „Credits“ |
| u (unit) | **E** (Einheit) | distances and amounts: `45 E`, `12k E` on the map |
| u/s | **E/s** | speed, flows |
| D (Data) | **D** (Daten) | `+100 D` |
| pts / pt | **Pkt.** | hull and reputation points |
| t, HP, s, °, min, h | unchanged | `1 h 05 min`, play time `1:42 h` |

## Factions and clans

| English | German |
|---|---|
| Mining Guild / the Guild | **Bergbaugilde** / **die Gilde** (adjective compounds: Gilden-…) |
| Cartographic Institute / the Institute | **Kartografisches Institut** / **das Institut** |
| Free Traders / Traders | **Freie Händler** / **Händler** |
| the Rust | **der Rost** (pirate clan; „Rost-Piraten“, „Rost-Raum“) |
| the Cauldron | **der Kessel** |
| the Slanted Star | **der Schiefe Stern** |
| the Wardens | **die Wächter** |
| the Forge-smiths | **die Sternschmiede** (plural; compounds `Schmiede-`: Schmiede-Panzerung, Schmiede-Echo) |
| jackal / Rust Jackal | Schakal / Rost-Schakal |
| hammer / Rust Hammer | Hammer / Rost-Hammer |
| captain | Kapitän |
| Rust Fortress I–IV | Rostfestung I–IV |
| Pirate beacon | Piraten-Leuchtfeuer |

Captains are written `„Spitzname“ Name`. Captain **names** stay as in English (Kane, Vesta, …). Captain
**nicknames** are translated as short epithets without article („Witwe“, „Rostig“, „Kesselchen“) – keep
all of them different and in the same order.

## Story and discovery

| English | German |
|---|---|
| Echo, Echo-0, Echoes | Echo, Echo-0, Echos |
| Forge-smith Echo / beacon / frequencies | Schmiede-Echo / Schmiede-Leuchtfeuer / Schmiede-Frequenzen |
| shard | Splitter |
| Archive, node | Archiv, Knoten |
| Atlas | Atlas |
| journal (J) | **Journal** (J) |
| Knowledge / Log / Manual | Wissen / Protokoll / Handbuch |
| scanner, pulse, analysis | Scanner, Puls, Analyse |
| signal | Signal |
| anomaly (gravity, ion, radiation, time echo) | Anomalie (Gravitations-, Ionen-, Strahlungs-, Zeitecho) |
| cache | Versteck |
| wreck | Wrack |
| giant asteroid, shell, core | Riesenasteroid, Schale, Kern |
| blueprint, blueprint fragment, variant | Bauplan, Bauplanfragment, Variante |
| Observation | Beobachtung |
| Glowing shard | Leuchtender Splitter |
| Pirate log | Piratenlogbuch |
| distress signal / distress call | Notsignal / Notruf |
| Chapter 0 · Signal, Chapter 1 · The Rust | Kapitel 0 · Signal, Kapitel 1 · Der Rost |

## World

| English | German |
|---|---|
| ring, depth | Ring, Tiefe (`Tiefe 2 · Äußere Gürtel`) |
| Home Belt / Outer Belts | **Heimatgürtel** / **Äußere Gürtel** |
| Crystal Nebulae / Dead Zones | **Kristallnebel** / **Tote Zonen** |
| zone | Zone |
| Origin Base | **Basis Ursprung** |
| station / home station / outpost | Station / Heimatstation / Außenposten |
| station name prefixes: Anchor, Beacon, Harbour, Haven, Gate, Node, Circle, Wave | Anker, Bake, Hafen, Zuflucht, Tor, Knoten, Kreis, Welle |
| star names (Vega, Lyra, …) | unchanged |
| vein, rich / poor ore, grade | Ader, reiches / armes Erz, Gehalt |
| ore, ore nugget | Erz, Erzbrocken |
| buoy | Boje |
| dock clamp, arm | Andockklammer, Arm |
| beacon | Leuchtfeuer |

## Sectors

| English | German |
|---|---|
| sector | **Sektor** |
| Quiet / Guarded / Contested / Pirate | **Ruhig / Bewacht / Umkämpft / Piraten** |
| Charted / Reported / Uncharted | **Kartiert / Gemeldet / Unkartiert** |
| threat: no pirates / rare / often / nest | Bedrohung: keine Piraten / selten / häufig / Nest |
| Guild Lane | **Gildenroute** |
| Guild Watch | Gildenwache |
| Rust markers | Rost-Markierungen |
| entry notice, „Entering“ | Einflugmeldung, „Einflug“ |
| Local conditions | **Lokale Bedingungen** |
| Origin | Ursprung |
| Jackal Nook / Brigand Nook | Schakalwinkel / Räuberwinkel |
| Rust Nest I–IV | Rostnest I–IV |
| generated names | `DE_ADJECTIVES` (strong forms per gender) × `DE_NOUNS` (with gender), same order as English |
| environments: Asteroid Field, Ice Field, Quiet Space, Rust Field, Ion Fringe, Wreck Yard, Titan Plateau, Crystal Nebula, Comet Path, Deep Dark | Asteroidenfeld, Eisfeld, Stiller Raum, Rostfeld, Ionensaum, Wrackfeld, Titanplateau, Kristallnebel, Kometenbahn, Tiefe Dunkelheit |
| sector card, "Route home: 3 sectors", "flown 35%", "Unknown sector" | Sektorkarte, „Heimweg: 3 Sektoren“, „35 % geflogen“, „Unbekannter Sektor“ |

## Ship and parts

| English | German |
|---|---|
| ship, hull | Schiff, Rumpf |
| part, parts | Teil, Teile |
| tier T1 / T2 | Klasse T1 / T2 |
| Level, short `L1` | Stufe, short `L1` |
| variants: Overdrive, Eco, Rapid-fire, Armoured, Survey, Combat, Scout, Extended, Quick-charge | **Leistung, Spar, Schnellfeuer, Gepanzert, Vermessung, Kampf, Aufklärung, Erweitert, Schnellladung** (`Triebwerk – Leistung T1`) |
| design, Restore to design | Entwurf, Nach Entwurf wiederherstellen |
| durability | Haltbarkeit |
| scrap | verschrotten |
| Check · Properties · Cost of changes | Prüfung · Eigenschaften · Änderungskosten |
| Guild loan | Gildendarlehen |
| Cockpit, Armour | Cockpit, Panzerung |
| Engine (main / side / reverse) | Triebwerk (Haupt- / Seiten- / Rückwärts-) |
| Gyroscope | Gyroskop |
| Mining laser / Heavy laser | Bergbaulaser / Schwerer Laser |
| Cargo hold / Large cargo hold | Frachtraum / Großer Frachtraum |
| Fuel tank, Reactor, Battery, Radar | Treibstofftank, Reaktor, Batterie, Radar |
| Cannon | Kanone |
| Shield generator, shield | Schildgenerator, Schild |
| Tractor beam | Traktorstrahl |
| (inertial) dampers | (Trägheits-)Dämpfer |
| thrust, turning, strafe | Schub, Drehen, Seitenschub |
| blocked nozzles | blockierte Düsen |
| tow | Abschleppen |
| fuel, energy, cargo, heat | Treibstoff, Energie, Fracht, Hitze |
| iron, copper, ice, titanium (Fe, Cu, Ice, Ti) | Eisen, Kupfer, Eis, Titan (Fe, Cu, Eis, Ti) |

## Station and career

| English | German |
|---|---|
| Overview · Market · Crafting · Shipyard · Service · Board · Archive | Übersicht · Markt · Fertigung · Werft · Service · Tafel · Archiv |
| resource market / parts market | Rohstoffmarkt / Teilemarkt |
| storage | Lager |
| courier | Kurier |
| contract, slip | Auftrag, Zettel |
| Delivery, Mining, Hunt, Rescue, Survey, Scan, Escort, Retrieval, Construction, Fortress, Chart | Lieferung, Abbau, Jagd, Rettung, Vermessung, Erkundung, Eskorte, Bergung, Bau, Festung, Karte |
| Forward base | Vorgeschobene Basis |
| Fund / Collected; Key node / item; threshold | Fonds / Gesammelt; Schlüsselknoten / -gegenstand; Schwelle |
| Trophy hall · Wanted captains · Career assignment | Trophäenhalle · Gesuchte Kapitäne · Karriereauftrag |
| Development · Paint shop · paint · Forge Index | Ausbau · Lackiererei · Lack · Schmiede-Index |
| paints: Factory, Graphite, Sand, Navy, Racing | Werk, Graphit, Sand, Marine, Renn |
| Shipment · Storage | Sendung · Lager |
| reputation, licence | Ruf, Lizenz |
| Unknown · Known · Trusted · Proven | Unbekannt · Bekannt · Vertraut · Bewährt |
| objectives (G) | Ziele (G) |
| toll | Wegzoll |
| Rust attention; Calm · Watched · Hunted · Raid | Rost-Aufmerksamkeit; Ruhe · Beobachtet · Gejagt · Überfall |
| bounty | Kopfgeld |
| salvage | Bergegut |
| joint, salvageable wreck, cut-off piece | Verbindung, bergbares Wrack, abgetrenntes Stück |
| Scavenger, container, Resonator | Plünderer, Container, Resonator |
| war chest, raid / raiders, duel, toll collector | Kriegskasse, Überfall / Angreifer, Duell, Zolleintreiber |
| core / generator / turret | Kern / Generator / Geschützturm |
| Guild Training | Gildenausbildung |
| First Day | Erster Tag |
| Master Hale (Guild instructor) | Meister Hale (Gildenausbilder) |

## Menu and saves

| English | German |
|---|---|
| New game · Load game · Settings · About | Neues Spiel · Spiel laden · Einstellungen · Über das Spiel |
| Continue | Fortsetzen |
| Abandon ship · respawn | Schiff aufgeben · Wiedereinstieg |
| Fallen hero · Black box · persistent storage | Gefallener Held · Flugschreiber · dauerhafter Speicher |
| Flight path · Camera shake | Flugbahn · Kamerawackeln |
| slot, backup | Speicherplatz, Sicherung |
| death penalty: None · Mild · Hard · Hardcore | Strafe bei Tod: Keine · Mild · Hart · Hardcore (never „Todesstrafe“) |
| Radio: All · Important · Off | Funk: Alles · Wichtiges · Aus |
| Graphics quality | Grafikqualität |
| Language | Sprache (the language names are never translated: Slovenčina, English, Deutsch) |

## Further terms (added during the first translation)

| English | German |
|---|---|
| part hold | Teilelager |
| hangar slot | Hangarplatz / Stellplatz |
| template, shipyard draft | Vorlage, Werftentwurf |
| manoeuvring thrusters (cockpit) | Steuerdüsen |
| centre of mass, lever arm | Schwerpunkt, Hebelarm |
| refinery, refine, refined ore | Raffinerie, veredeln, veredeltes Erz |
| repair module, workshop | Reparaturmodul, Werkstatt |
| mirror mode | Spiegelmodus |
| armour shapes | Voll, Keil, Fase, Runde Ecke, Bogen, Halbplatte, Bugspitze, Flügel, Bug 2×1 |
| extra variants: Focused, Light, Flywheel, Buffer, Long barrel | Fokussiert, Leicht, Schwungrad, Puffer, Langlauf |
| Speed (HUD) | Tempo |
| firing arc / cannon arc | Schusswinkel / Kanonenwinkel |
| Main menu · Paused · Resume | Hauptmenü · Pause · Weiter |
| Guild relay, relay | Gildenrelais, Relais |
| convoy, convoy link, link / unlink | Konvoi, Konvoi-Kopplung, koppeln / abkoppeln |
| trade port | Handelsport |
| survey point / survey buoy | Messpunkt / Vermessungsboje |
| derelict station, ship graveyard, comet | Verlassene Station, Schiffsfriedhof, Komet |
| deposit, ambush, pirate pack, hunting party | Kaution, Hinterhalt, Piratenrudel, Jagdtrupp |
| Gunner, Sentry drone, Clan beacon | Schütze, Wachdrohne, Clan-Leuchtfeuer |
| map marker, Landmarks (card) | Kartenmarkierung, Wegmarken |
| replica, pedestal | Nachbildung, Sockel |
| Traffic control, Station voice | Verkehrsleitung, Stationsstimme |
| micrometeor shower | Mikrometeoritenschauer |
| training hull, training rock, Guild buoy, training panel | Übungsrumpf, Übungsfels, Gildenboje, Ausbildungsfenster |
| Docking computer, Hull shell | Andockcomputer, Rumpfhülle |
| Dynamic resolution, Background brightness, Combat zoom-out | Dynamische Auflösung, Hintergrundhelligkeit, Kampf-Auszoomen |
| undock | abdocken („Abdocken“, „dock ab“) |
| Archive nodes: vein analyser, onboard refinery, cruise drive, shielding, deep scanner, jump beacon, rift beacon, point defence, swarm defence, Forge-smith beam, orbital drop | Aderanalysator, Bordraffinerie, Reiseantrieb, Abschirmung, Tiefenscanner, Sprung-Leuchtfeuer, Riss-Leuchtfeuer, Nahbereichsabwehr, Schwarmabwehr, Schmiede-Strahl, Orbitalabwurf |
| key labels Del, Home, PgUp/PgDn, Ctrl | Entf, Pos1, Bild↑/Bild↓, Strg |
