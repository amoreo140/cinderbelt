# Cinderbelt – translation glossary (SK → EN)

Shared term choices for the English locale. Every `en*.ts` module uses these words, so the game reads
as one text. When a term is missing here, pick one, use it consistently and add it to this table in the
same commit.

## Style

- **British English** spelling (armour, colour, manoeuvre, harbour, centre), plain and short like the
  Slovak: second person ("you"), no pathos, no exclamation marks in journal entries.
- Keep the **key letters** of the Slovak line (`F – dock`, `J – journal`): the keys are the same in both
  languages. Keys in brackets stay in brackets: `(J)`, `(M)`.
- **Numbers are formatted by the code** (`src/i18n/format.ts`: `1,240.5` in English, `1 240,5` in
  Slovak) – texts only receive formatted strings or integers. Never hard-code a decimal comma.
- **Plurals**: Slovak modules use `skPlural(n, one, few, many)`, English modules `enPlural(n, one, other)`
  (both from `./plural`). Do not copy the Slovak three-form logic into English.
- **Percentages**: no space in English (`45%`), Slovak keeps the non-breaking space (`45 %`). UI code
  formats them with `formatPercent` (`src/i18n/format.ts`); never compose `" %"` by hand.
- Typography: en dash with spaces ` – ` as in the Slovak texts; curly quotes `“…”` for names and
  nicknames (Slovak uses `„…“`); `×` for multipliers, `−` (true minus) for negative deltas.
- A proper name inside a text uses the same English form everywhere (Guild buoy, Rust fortress).

## Units

| Slovak | English | Notes |
|---|---|---|
| kr (kredity) | **cr** (credits) | `1,240 cr`; the word is "credits" |
| j (jednotka) | **u** (unit) | distances and amounts: `45 u`, `12k u` on the map |
| j/s | **u/s** | speed, flows |
| D (Dáta) | **D** (Data) | Institute research currency: `+100 D`; the word is "Data" (uncountable) |
| b (body trupu / reputácie) | **pts** | hull points, reputation points; singular `pt` |
| energia | (no unit) | energy amounts are bare numbers (`Battery 120`), rates `/s` (`+2/s`) – never `u/s` |
| % | % | `45%` in English, `45 %` in Slovak (see Style) |
| t | t | tonnes |
| HP, s, ° | HP, s, ° | unchanged |
| tis. j | k u | `12k u` |
| min, h | min, h | `1 h 05 min`, play time `1:42 h` |

## Factions and clans

| Slovak | English |
|---|---|
| Ťažobný cech / Cech | **Mining Guild** / **the Guild** |
| Kartografický inštitút / Inštitút | **Cartographic Institute** / **the Institute** |
| Voľní obchodníci / Obchodníci | **Free Traders** / **Traders** |
| Hrdza | **the Rust** (pirate clan; "Rust pirates", "Rust space") |
| Kotol | **the Cauldron** |
| Šikmá hviezda | **the Slanted Star** |
| Strážcovia | **the Wardens** |
| Kováči hviezd / Kováči | **the Forge-smiths** (ancient builders of the Echoes; adjective "Forge-smith": Forge-smith armour) |
| šakal (pirátska loď) | jackal (Rust Jackal) |
| kladivo | hammer (Rust Hammer) |
| kapitán (menovaný pirát) | captain |
| Hrdzavá pevnosť I–IV | Rust Fortress I–IV |
| Pirátsky maják | Pirate beacon |

Captains are written `“Nick” Name`; epithets go without "the" in that pattern. A faction's full name keeps
the article ("The Rust" at the start of a line), the short form drops it ("Rust pirates").

Captain **names** (Korma, Vlasta, …) are proper names and stay as they are; captain **nicknames**
(`preco.captains.nicknames`, e.g. Vdova, Hrdzavý, Kotlík) are translated as short epithets without
"the" ("Widow", "Rusty", "Kettle" → `“Widow” Korma`) – keep all 15 different and in the same order.

## Story and discovery

| Slovak | English |
|---|---|
| Ozvena, Ozvena-0 | **Echo**, **Echo-0** (`objavy.echoName`) |
| Ozveny | Echoes |
| Ozvena Kováčov / Ozveny Kováčov | **Forge-smith Echo** / Forge-smith Echoes (never "Echo of the Forge-smiths") |
| Maják Kováčov | Forge-smith beacon |
| Frekvencie Kováčov | Forge-smith frequencies |
| úlomok (Kováčov) | shard |
| Archív | **Archive** (station tab and the research tree) |
| uzol (Archívu) | node |
| Atlas | Atlas |
| denník | **journal** (J) |
| Vedomosti / Záznamy / Príručka | Knowledge / Log / Manual |
| skener, pulz, analýza | scanner, pulse, analysis |
| signál | signal |
| anomália (gravitačná, iónová, radiačná, časová ozvena) | anomaly (gravity, ion, radiation, time echo) |
| úkryt | cache |
| vrak | wreck |
| obrí asteroid, škrupina, jadro | giant asteroid, shell, core |
| fragment, plán, variant | fragment, blueprint, variant |
| plán (výrobný), fragment plánu | blueprint, blueprint fragment |
| Pozorovanie | Observation |
| Žiariaci úlomok | Glowing shard |
| Pirátsky denník | Pirate log |
| núdzový signál / núdzové volanie | distress signal / distress call |
| Kapitola 0 · Signál, Kapitola 1 · Hrdza | Chapter 0 · Signal, Chapter 1 · The Rust |

## World

| Slovak | English |
|---|---|
| prstenec | **ring** – now only the subtitle of a depth (`depth 2 · Outer Belts`); contract slips show `depth 2` / `hĺbka 2`, no `P1`/`R1` badges |
| Domovský pás | **Home Belt** |
| Vonkajšie pásy | **Outer Belts** |
| Kryštálové hmloviny | **Crystal Nebulae** |
| Mŕtve zóny | **Dead Zones** |
| zóna | zone |
| Základňa Počiatok | **Origin Base** |
| stanica / domovská stanica / hliadka | station / home station / outpost |
| Hliadka (station name) | Outpost |
| station name prefixes: Kotva, Maják, Prístav, Útočisko, Brána, Uzol, Kruh, Vlna | Anchor, Beacon, Harbour, Haven, Gate, Node, Circle, Wave |
| star names (Vega, Lyra, …) | unchanged |
| žila (rudná) | vein |
| bohatá / chudobná ruda, kvalita | rich / poor ore, grade |
| ruda, úlomok rudy | ore, ore nugget |
| bója | buoy |
| dokovacia svorka, rameno | dock clamp, arm |
| maják | beacon |

## Sectors (`skSektory.ts`, design `2026-10-18-sektory-design.md` §0)

| Slovak | English |
|---|---|
| sektor | **sector** |
| hĺbka 1–4 (podtitul: názov prstenca) | depth 1–4 (subtitle: the ring name) |
| Pokojný / Strážený / Sporný / Pirátsky | **Quiet / Guarded / Contested / Pirate** (security) |
| Zmapovaný `[x]` / Hlásený `[?]` / Nezmapovaný `[ ]` | **Charted / Reported / Uncharted** |
| hrozba: žiadni piráti / zriedka / často / hniezdo | threat: no pirates / rare / often / nest |
| Cechová cesta | **Guild Lane** |
| Stráž Cechu | Guild Watch |
| Hrdzavé značky | Rust markers |
| hlásenie vstupu, „Vstup“ | entry notice, "Entering" |
| Miestne podmienky (bývalý „Stav sektora“) | **Local conditions** |
| Počiatok (sektor) | Origin |
| Šakalí kút / Zbojnícky kút | Jackal Nook / Brigand Nook (pirate corners) |
| Hrdzavé hniezdo I–IV (sektor pevnosti) | Rust Nest I–IV |
| generated names: adjective × noun (SK in the noun's gender) | `SK_ADJECTIVES`/`SK_NOUNS` ↔ `EN_ADJECTIVES`/`EN_NOUNS`, same order (Hrdzavý prah = Rust Threshold) |
| prostredia: Asteroidové pole, Ľadové pole, Tichý priestor, Hrdzavé pole, Iónový lem, Vrakovisko, Titánová plošina, Kryštálová hmlovina, Kométová dráha, Hlboká tma | environments: Asteroid Field, Ice Field, Quiet Space, Rust Field, Ion Fringe, Wreck Yard, Titan Plateau, Crystal Nebula, Comet Path, Deep Dark (never "belt") |
| karta sektora, „Trasa domov: 3 sektory“, „preletené 35 %“, „Neznámy sektor“ | sector card, "Route home: 3 sectors", "flown 35%", "Unknown sector" |
| Stráž Cechu (rádio v Strážených sektoroch), tag „Cech“ | Guild Watch (radio in Guarded sectors), tag "Guild" |

## Ship and parts

| Slovak | English |
|---|---|
| loď, trup | ship, hull |
| diel, diely | part, parts |
| úroveň T1 / T2 | tier T1 / T2 |
| úroveň (Archív, reputácia) | Level, short `L1` |
| varianty: pretlakový, úsporný, rýchlopal, pancierovaný, merací (survey – radar), bojový, prieskumný (scout – kokpit), veľká, rýchle dobíjanie | **Overdrive, Eco, Rapid-fire, Armoured, Survey, Combat, Scout, Extended, Quick-charge** – capitalised in part names (`Engine – Overdrive T1`) and explanations alike. Survey ↔ „merací“ like Meranie / merací bod; Scout ↔ „prieskumný“ |
| návrh (lode), Obnoviť podľa návrhu | design, Restore to design |
| odolnosť (dielu) | durability |
| rozobrať (diel na šrot) | scrap |
| Kontrola · Vlastnosti · Cena zmien | Check · Properties · Cost of changes |
| Výpožička Cechu | Guild loan |
| Kokpit | Cockpit |
| Pancier | Armour |
| Motor (hlavný / bočný / spätný) | Engine (main / side / reverse) |
| Gyroskop | Gyroscope |
| Ťažobný laser | Mining laser |
| Ťažký laser | Heavy laser |
| Nákladný priestor / Veľký nákladný priestor | Cargo hold / Large cargo hold |
| Palivová nádrž | Fuel tank |
| Reaktor | Reactor |
| Batéria | Battery |
| Radar | Radar |
| Kanón | Cannon |
| Generátor štítu, štít | Shield generator, shield |
| Vlečný lúč | Tractor beam |
| tlmiče (inerciálne) | (inertial) dampers |
| ťah, otáčanie, bočný posun | thrust, turning, strafe |
| zakryté trysky | blocked nozzles |
| odtiahnutie | tow |
| palivo, energia, náklad, teplo | fuel, energy, cargo, heat |
| železo, meď, ľad, titán (Fe, Cu, Ľad, Ti) | iron, copper, ice, titanium (Fe, Cu, Ice, Ti) |

## Station and career

| Slovak | English |
|---|---|
| Prehľad · Trh · Výroba · Lodenica · Servis · Tabuľa · Archív | Overview · Market · Crafting · Shipyard · Service · Board · Archive |
| trh surovín / trh dielov | resource market / parts market |
| sklad (stanice) | storage |
| kuriér | courier |
| kontrakt, lístok | contract, slip |
| Dodávka, Ťažba, Lov, Záchrana, Meranie, Prieskum, Eskorta, Vyzdvihnutie, Stavba, Pevnosť, Mapa | Delivery, Mining, Hunt, Rescue, **Survey** (Meranie), **Scan** (Prieskum), Escort, Retrieval, Construction, Fortress, Chart |
| Predsunutá základňa | Forward base |
| Fond / Nazbierané; Kľúčový uzol / predmet; prah | Fund / Collected; Key node / item; threshold |
| Trofejná sieň · Hľadaní kapitáni · Kariérne zadanie | Trophy hall · Wanted captains · Career assignment |
| Rozvoj (záložka domova) · Lakovňa · lak · Index Kovania | Development (home tab) · Paint shop · paint · Forge Index |
| laky: Továrenský, Grafit, Piesok, Námornícka, Pretekárska | Factory, Graphite, Sand, Navy, Racing |
| Zásielka · Sklady | Shipment · Storage |
| reputácia, licencia | reputation, licence |
| Neznámy · Známy · Overený · Dôveryhodný | Unknown · Known · Trusted · Proven |
| ciele (G) | objectives (G) |
| stav sektora | sector state |
| mýto | toll |
| pozornosť Hrdze; Pokoj · Sledujú ťa · Lovia ťa · Nájazd | Rust attention; Calm · Watched · Hunted · Raid |
| odmena za hlavu | bounty |
| korisť (z vraku) | salvage |
| spoj (vraku), rozoberateľný vrak, odrezaný kus | joint, salvageable wreck, cut-off piece |
| Zberač, kontajner, Rezonátor | Scavenger, container, Resonator |
| vojnová pokladnica, nájazd / nájazdníci, súboj, mýtnik | war chest, raid / raiders, duel, toll collector |
| jadro / generátor / veža pevnosti | core / generator / turret |
| Výcvik Cechu | Guild Training |
| Prvý deň (onboarding objectives) | First Day |
| majster Bartoš | Master Bartoš |

## Menu and saves

| Slovak | English |
|---|---|
| Nová hra · Načítať hru · Nastavenia · O hre | New game · Load game · Settings · About |
| Pokračovať | Continue |
| Opustiť loď · obnova (po smrti) | Abandon ship · respawn |
| Padlý hrdina · Čierna skrinka · Trvalé úložisko | Fallen hero · Black box · persistent storage |
| Smer letu · Otrasy kamery | Flight path · Camera shake |
| slot, záloha | slot, backup |
| obťažnosť: Žiadny · Mierny · Tvrdý · Hardcore (trest za smrť) | death penalty: None · Mild · Hard · Hardcore |
| Rádio: Všetko · Dôležité · Vypnuté | Radio: All · Important · Off |
| Kvalita grafiky | Graphics quality |
| Jazyk | Language (the language names are never translated: Slovenčina, English) |
