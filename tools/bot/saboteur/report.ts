// Markdown report of the saboteur suite (reports/econ/saboteur-report.md): every finding of the
// first run (exploits and softlocks) with the fix that closed it and its numbers before → after, the
// controls that hold, the recovery times per difficulty and the softlock search.
import { INSTALL_FEE, partBuyPrice } from '../../../src/data/economy';
import { LOAN_ENGINE_KEY, LOAN_LASER_KEY } from '../../../src/sim/station/guildLoan';
import { towFastTravel, type LoopResult } from './scenarios';
import type { SaboteurOptions, SeedReport } from './suite';

const k = (x: number): string => (Math.abs(x) >= 10_000 ? `${(x / 1000).toFixed(0)} k` : Math.abs(x) >= 1000 ? `${(x / 1000).toFixed(1)} k` : `${Math.round(x)}`);
const min = (s: number | null | undefined): string => (s === null || s === undefined || !Number.isFinite(s) ? '–' : s >= 3600 ? `${(s / 3600).toFixed(2)} h` : `${(s / 60).toFixed(1)} min`);
const pct = (x: number): string => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(0)} %`;

function median(xs: number[]): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

const loopsOf = (reports: SeedReport[], id: string, penalty?: string): LoopResult[] =>
  reports.flatMap((r) => r.loops.filter((l) => l.id === id && (!penalty || l.penalty === penalty)));

/** `accepted`: a real but small finding the user decided to keep as it is (see the fix column). */
type Status = 'fixed' | 'open' | 'documented' | 'accepted';

interface FindingRow {
  id: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  /** Measured by the first saboteur run (commit 1998103), seeds 1–8. */
  before: string;
  /** Measured by this run. */
  after: string;
  status: Status;
  fix: string;
  test: string;
}

const statusOf = (open: boolean): Status => (open ? 'open' : 'fixed');

/** W1 (refine arbitrage across rings): accepted by the user 2026-10-16, closed in M4d (user decision). */
const W1_DECISION = '2026-10-16';
/** The commit that closed W1 with the refined price ceiling (M4d T7). */
const W1_FIX = '19c3170';

export function buildSaboteurReport(reports: SeedReport[], opts: SaboteurOptions & { wallSeconds: number }): string {
  const seeds = reports.map((r) => r.seed);
  const baseMild = median(reports.map((r) => r.baselines.find((b) => b.penalty === 'mild')!.run.perHour));
  const baseHard = median(reports.map((r) => r.baselines.find((b) => b.penalty === 'hard')!.run.perHour));
  const baseNone = median(reports.map((r) => r.baselines.find((b) => b.penalty === 'none')!.run.perHour));
  const rows: FindingRow[] = [];
  const hitsOf = (ls: LoopResult[]): string => `${ls.filter((l) => l.exploit).length}/${ls.length} runs exploitable`;

  // --- exploits ---
  const hard = [...loopsOf(reports, 'scuttleFarm', 'hard'), ...loopsOf(reports, 'scuttleFarm', 'hardcore')];
  rows.push({
    id: 'X1',
    severity: 'critical',
    title: 'Scuttle farm on Hard/Hardcore: strip, sell everything, abandon ship → the respawn handed out a whole new starter ship',
    before: '1002 k kr/h (4.2 k kr per ~15 s cycle) vs honest 12 k kr/h; 16/16 runs',
    after: `${k(median(hard.map((l) => l.perHour)))} kr/h (${k(median(hard.map((l) => l.metrics?.perCycle ?? 0)))} kr per cycle) vs honest ${k(baseHard)} kr/h; ${hitsOf(hard)}`,
    status: statusOf(hard.some((l) => l.exploit)),
    fix: 'The Hard/Hardcore respawn hull is a Guild loan (every part flagged `loan`, worth 0, cannot leave the hull); the scuttle also costs the tow fee.',
    test: '`findings.test.ts` › X1',
  });

  const contract = loopsOf(reports, 'contractInflation');
  const ratios = reports.map((r) => r.quotes.maxRatio);
  rows.push({
    id: 'X2',
    severity: 'high',
    title: 'Contract quote inflation: remove lasers / holds before accepting – the frozen reward was quoted for the crippled ship',
    before: 'quotes ×3.7 (max ×5.1); +2.9 k kr/h of frozen reward above honest quotes; 7/8 runs',
    after: `quotes ×${median(ratios).toFixed(2)} (max ×${Math.max(...ratios).toFixed(2)}) of the starter quote; ${k(median(contract.map((l) => l.metrics?.extraPerHour ?? 0)))} kr/h above honest quotes; ${hitsOf(contract)}`,
    status: statusOf(contract.some((l) => l.exploit) || Math.max(...ratios) > 1.0001),
    fix: 'Quotes use the best ship the player has had (flying ship, respawn layout, blueprint and a saved high-water mark of units/h per ring, `stats.bestUnitsPerHour`), never below the ring reference ship (the starter hull) – a ship stripped just before accepting changes nothing.',
    test: '`findings.test.ts` › X2',
  });

  const dupe = loopsOf(reports, 'noneSalvageDupe', 'none');
  const dupeMild = loopsOf(reports, 'noneSalvageDupe', 'mild');
  rows.push({
    id: 'X3',
    severity: 'high',
    title: 'Part duplication on "none": ram a part off, load it from the wreck, abandon ship → the respawn restored the part and kept the salvage',
    before: '+585 kr per ~73 s cycle; 7/8 runs',
    after: `${k(median(dupe.map((l) => l.metrics?.perCycle ?? 0)))} kr per cycle; none ${hitsOf(dupe)}, mild ${hitsOf(dupeMild)}`,
    status: statusOf([...dupe, ...dupeMild].some((l) => l.exploit)),
    fix: 'Salvage on board is lost on every death; a scuttled ship arrives as it was (lost parts stay lost); a world death that restores the docked layout takes the restored parts out of the player\'s own wrecks.',
    test: '`findings.test.ts` › X3, `death.test.ts`',
  });

  const tele = loopsOf(reports, 'noneTeleport');
  rows.push({
    id: 'X4',
    severity: 'medium',
    title: 'Free teleport on "none": abandon ship with a full hold far away → docked at the last station, cargo kept, full tank, every part repaired',
    before: '+64 % kr/h vs honest (26 k vs 20 k kr/h), 24 scuttles/h; 7/8 runs',
    after: `${pct(median(tele.map((l) => l.metrics?.uplift ?? 0)))} kr/h vs honest (${k(median(tele.map((l) => l.perHour)))} vs ${k(baseNone)} kr/h), ${Math.round(median(tele.map((l) => l.metrics?.scuttles ?? 0)))} scuttles/h; ${hitsOf(tele)}`,
    status: statusOf(tele.some((l) => l.exploit)),
    fix: 'A voluntary scuttle leaves the cargo in the abandoned wreck (fly back for it), pays the tow fee to the respawn station (free when broke), never repairs or refuels (HP and tank as they were, at most the penalty\'s share) and keeps the difficulty\'s penalty on top. World-caused deaths keep the binding rules.',
    test: '`findings.test.ts` › X4, `death.test.ts`',
  });

  const kit = loopsOf(reports, 'kitFarm');
  const laserBuy = partBuyPrice(LOAN_LASER_KEY, 1)!;
  rows.push({
    id: 'X5',
    severity: 'medium',
    title: 'Emergency kit farm: a free T1 laser at home every 10 min, sold each time',
    before: '+550 kr per kit, ≤ 3.3 k kr/h; 8/8 runs',
    after: `${k(median(kit.map((l) => l.gain)))} kr in ${opts.hours} h (${Math.round(median(kit.map((l) => l.metrics?.kits ?? 0)))} loans, ${Math.round(median(kit.map((l) => l.metrics?.cashIns ?? 0)))} attempts to take one off and sell it; a rich laserless player got ${Math.max(0, ...kit.map((l) => l.metrics?.richLoans ?? 0))}); ${hitsOf(kit)}`,
    status: statusOf(kit.some((l) => l.exploit)),
    fix: `The kit became the Guild loan: mounted on the hull for free, never in a storage (no sale, scrap, courier, crafting); removing it returns it to the Guild. Lent only when the reachable worth (credits + sellable parts on the ship / at this station + cargo and stored resources) is below the part's price + install fee (${laserBuy + INSTALL_FEE} kr for the laser).`,
    test: '`findings.test.ts` › X5, `guildLoan.test.ts`',
  });

  const parts = reports.flatMap((r) => r.partRewards);
  if (parts.length) {
    const over = parts.filter((p) => p.ratio > 1.05);
    rows.push({
      id: 'X6',
      severity: 'medium',
      title: 'Exclusive-part contracts: the credit share was floored at 30 % – reward + the part sold paid more than the credit-only reward',
      before: '×1.73 of the credit-only reward (max ×3.63); 69/84 part offers above ×1.05',
      after: `×${median(parts.map((p) => p.ratio)).toFixed(2)} (max ×${Math.max(...parts.map((p) => p.ratio)).toFixed(2)}); ${over.length}/${parts.length} part offers above ×1.05; ${parts.filter((p) => p.dropped).length} parts worth more than the whole reward not offered`,
      status: statusOf(over.length > 0),
      fix: 'The part replaces credits worth its sale value down to 0; a part worth more than the whole reward is not paid (the contract pays credits only).',
      test: '`findings.test.ts` › X6, `career.test.ts`',
    });
  }

  // --- softlocks ---
  const engineless = reports.flatMap((r) => r.targeted.filter((t) => t.scenario === 'enginelessAtStation'));
  const elReached = engineless.filter((t) => t.reached);
  const elStuck = elReached.filter((t) => t.stuck);
  rows.push({
    id: 'S1',
    severity: 'high',
    title: 'No forward engine, docked at a non-home shipyard, poor: the tow returned to the same station, the kit existed only at home, the shipyard could not even remove parts',
    before: 'permanent softlock in 10/10 mild/none runs that reached the state',
    after: `stuck ${elStuck.length}/${elReached.length} runs that reached the state (all difficulties); back to selling ore after ${min(median(elReached.filter((t) => !t.stuck).map((t) => t.attempts.find((a) => a.ok)?.seconds ?? NaN)))}`,
    status: statusOf(elStuck.length > 0),
    fix: 'The Guild loan is available at every station with a shipyard; a draft that only removes parts is valid on a ship that already has no forward thrust (so a stranded player can always strip and sell).',
    test: '`findings.test.ts` › S1, `design.test.ts`',
  });

  const spare = reports.flatMap((r) => r.targeted.filter((t) => t.scenario === 'spareEngineElsewhere' && t.reached));
  const spareStuck = spare.filter((t) => t.stuck);
  rows.push({
    id: 'S2',
    severity: 'medium',
    title: 'A spare engine stored at another station blocked the home engine kit (any storage, salvage or shipment counted)',
    before: 'recovered only through kit-laser sales (X5) after 19.3 min; with an unsellable loan it would have been permanent',
    after: `stuck ${spareStuck.length}/${spare.length}; back to selling ore after ${min(median(spare.filter((t) => !t.stuck).map((t) => t.attempts.find((a) => a.ok)?.seconds ?? NaN)))}`,
    status: statusOf(spareStuck.length > 0),
    fix: 'Only a spare in reach (this station\'s storage or on board) blocks the loan; parts at other stations and in courier shipments do not.',
    test: '`findings.test.ts` › S2, `guildLoan.test.ts`',
  });

  const recoveries = reports.flatMap((r) => r.recoveries);
  rows.push({
    id: 'S3',
    severity: 'low',
    title: `The kit part could not be mounted with < ${INSTALL_FEE} kr (install fee) – sell it and wait 10 min for the next one`,
    before: 'ship ready after 10.0 min in 32/32 recoveries',
    after: `ship ready after ${min(median(recoveries.map((x) => x.shipReady ?? NaN)))} (median), ${recoveries.filter((x) => x.recovered).length}/${recoveries.length} recovered`,
    status: statusOf(recoveries.some((x) => !x.recovered)),
    fix: 'The Guild mounts its loan on the hull itself, free of the install fee; no cooldown (there is nothing to farm).',
    test: '`findings.test.ts` › S3',
  });

  const chaosStuck = reports.flatMap((r) => r.chaos.filter((c) => c.stuck));
  for (const c of chaosStuck.slice(0, 5)) {
    rows.push({
      id: `C${c.seed}.${c.run}`,
      severity: 'high',
      title: `Random sequence got stuck: ${c.moves.join(' → ')}`,
      before: '–',
      after: c.attempts.map((a) => `${a.strategy}: ${a.note}`).join('; '),
      status: 'open',
      fix: '–',
      test: `\`npm run bot -- --mode=saboteur --seeds=${c.seed}\` (${c.penalty}, run ${c.run}, tick ${c.tick})`,
    });
  }

  const tows = towFastTravel();
  rows.push({
    id: 'X7',
    severity: 'low',
    title: 'Tow as fast travel (only from an empty tank): a paid tow also topped the tank up to 25 % for free',
    before: 'paid off above 25 k–32 k kr/h of income',
    after: `pays off above ${k(Math.min(...tows.map((t) => t.breakEvenPerHour)))}–${k(Math.max(...tows.map((t) => t.breakEvenPerHour)))} kr/h of income (honest bot: ${k(baseMild)} kr/h net worth, ~29 k kr/h mined) – and it needs an empty tank`,
    status: 'documented',
    fix: 'Trivial part done: only a free (broke) tow tops the tank up (a quarter, at least 15 units); a paid tow is only a tow. The tow price itself is unchanged (documented: a late-game player with an empty tank far away may still prefer it).',
    test: '`actions.test.ts` › towing',
  });

  const arb = reports.flatMap((r) => r.arbitrage);
  const bestArb = [...arb].sort((a, b) => b.margin - a.margin)[0];
  if (bestArb && bestArb.margin > 0) {
    rows.push({
      id: 'X8',
      severity: 'low',
      title: 'Buy at one station, sell into a demand (+45 %) at another: the only positive resource round-trip',
      before: '≤ 0.63 kr/u between the guaranteed stations, ≤ 150 u per station and sector epoch',
      after: `≤ ${bestArb.margin.toFixed(2)} kr/u (${bestArb.resource} ${bestArb.buyAt} → ${bestArb.sellAt}), ≤ 150 u per station and epoch (≈ ${Math.round(bestArb.margin * 150)} kr / 30 min) plus travel`,
      status: 'documented',
      fix: 'Not changed – it is trading, needs travel and is capped by the demand volume; a cap on the bonus that holds for every ring and price jitter is not trivial (the fix would track bought stock like the courier does).',
      test: '–',
    });
  }

  rows.push(...homeFindingRows(reports));
  rows.push(...guildFindingRows(reports));

  const out: string[] = [];
  out.push('# Saboteur / exploiter report (headless bot vs. the safety nets)');
  out.push('');
  out.push(
    `> Generated by \`npm run bot -- --mode=saboteur\` (tools/bot/saboteur) – seeds ${seeds.join(', ')}, exploit loops ${opts.hours} game h each (scuttle farms 10 min), ` +
      `${opts.chaosRuns} random adversarial sequences per seed on ${opts.chaosPenalties.join(' / ')}, oracle budget 40 game min + 12 min of honest play. ` +
      `Wall time ${opts.wallSeconds.toFixed(0)} s. Rerun: \`npm run bot -- --mode=saboteur --seeds=${seeds[0]}-${seeds[seeds.length - 1]} --hours=${opts.hours} --chaos=${opts.chaosRuns}\` ` +
      '(`--json=…` keeps the raw results, `--from=<json>` rebuilds this page; reproductions: `npm run test:bot`, slow suite: `BOT_SLOW=1 npm run test:bot`).',
  );
  out.push('');
  out.push('**Rule under test:** a player who sabotages himself or plays terribly must always be able to recover (never stuck), but sabotage must never be an advantage – free help must never yield anything the player would otherwise have to mine or earn.');
  out.push('');
  out.push('**Value metric:** net worth at liquidation value = credits + every owned part at the station buy-back price (40 %, damaged parts pro rata; Guild loan parts 0) + cargo / storage resources at the home sell price. ' +
    'An honest bot spends on upgrades, which liquidation values at 40 %, so its *net worth* grows slower than its mined value (see the baselines below) – the exploit loops are compared on the same metric. ' +
    'The scuttle farm uses the *usable-ship* value instead: net worth + the Guild loan parts on the hull at their buy-back price (a loop that turns owned parts into credits and gets a loan hull back gains a ship, not net worth).');
  out.push('');
  const open = rows.filter((r) => r.status === 'open');
  const accepted = rows.filter((r) => r.status === 'accepted');
  out.push(
    `**Result:** ${rows.filter((r) => r.status === 'fixed').length} findings fixed, ${rows.filter((r) => r.status === 'documented').length} minor ones documented, ` +
      `${accepted.length ? `${accepted.length} accepted (${accepted.map((r) => r.id).join(', ')}), ` : ''}` +
      `${open.length ? `**${open.length} open (${open.map((r) => r.id).join(', ')})**` : '0 open'}; ` +
      `${reports.flatMap((r) => r.chaos).filter((c) => c.stuck).length} stuck runs in the random softlock search.`,
  );
  out.push('');
  out.push(SAFETY_NETS);
  out.push('');
  out.push('## Findings: before → after');
  out.push('');
  out.push('"Before" is the first saboteur run (commit 1998103, seeds 1–8, 1 h loops, 5 chaos runs per seed); "after" is this run.');
  out.push('');
  out.push('| ID | Severity | Finding | Before | After | Status | Fix | Test |');
  out.push('|---|---|---|---|---|---|---|---|');
  for (const r of rows) out.push(`| ${r.id} | **${r.severity}** | ${r.title} | ${r.before} | ${r.after} | ${r.status === 'open' ? '**open**' : r.status === 'accepted' ? `accepted (user decision ${W1_DECISION})` : r.status} | ${r.fix} | ${r.test} |`);
  out.push('');
  out.push('The reproduction tests in `tools/bot/findings.test.ts` ("saboteur findings – fixed") first asserted the broken behaviour; they were inverted with the fix and now guard it.');
  out.push('');

  out.push('## Controls (rules that hold)');
  out.push('');
  out.push('| Check | Result | Seeds |');
  out.push('|---|---|---|');
  const ctrl = (label: string, ls: LoopResult[], note: (l: LoopResult) => string): void => {
    out.push(`| ${label} | ${ls.some((l) => l.exploit) ? '**broken**' : 'holds'} – ${ls.length ? note(ls[0]!) : '–'} | ${ls.filter((l) => !l.exploit).length}/${ls.length} |`);
  };
  ctrl('Scuttle farm on mild (the ship as it was, at most 40 % HP, tow fee)', loopsOf(reports, 'scuttleFarm', 'mild'), (l) => `net worth ${k(l.gain)} kr in ${min(l.seconds)}`);
  ctrl('Scuttle farm on none (the ship as it was, tow fee)', loopsOf(reports, 'scuttleFarm', 'none'), (l) => `net worth ${k(l.gain)} kr in ${min(l.seconds)}`);
  ctrl('Salvage dupe on mild (salvage is lost on death)', dupeMild, (l) => `net worth ${k(l.metrics?.perCycle ?? 0)} kr per cycle`);
  ctrl('Emergency fuel ration / free tow (fuel cannot be sold)', loopsOf(reports, 'rationCheck'), (l) => l.detail);
  ctrl('Contract accept → free cancel loop', loopsOf(reports, 'cancelLoop'), (l) => l.detail);
  ctrl('Guild loan across save → load', loopsOf(reports, 'saveLoadKit'), (l) => l.detail);
  ctrl('Coverage farm (sectors 1b): re-fly a charted sector, also after save → load – charting Data once per sector', loopsOf(reports, 'coverageFarm'), (l) => l.detail);
  ctrl('Chart farm (sectors 2): sell a chart twice (also from a save copy), buy + resell, contract + sale, survey points again – once each', loopsOf(reports, 'chartFarm'), (l) => l.detail);
  ctrl('Guild Training rewards on mild (sell every reward and the kit, cash in the loans, die, skip again, skip from a save copy)', loopsOf(reports, 'trainingFarm', 'mild'), (l) => l.detail);
  ctrl('Guild Training rewards on hard (the same; the Hard respawn hull during the training)', loopsOf(reports, 'trainingFarm', 'hard'), (l) => l.detail);
  ctrl('Hangar switch shuffle (M4a): switch A ↔ B, sell the cargo, refuel, switch back – cargo, fuel and parts stay with their ship', loopsOf(reports, 'fleetSwitch'), (l) => l.detail);
  ctrl('Damaged-part laundering (M4a): park / switch / save keep the damage; dismantling costs what the shipyard removal costs', loopsOf(reports, 'fleetLaunder'), (l) => l.detail);
  ctrl('Guild loan and the hangar (M4a): no loan while a flyable ship stands here; a loan part never parks', loopsOf(reports, 'fleetLoan'), (l) => l.detail);
  ctrl('Hard loan hull and the hangar (M4a): scuttle → loan hull → switch dissolves it', loopsOf(reports, 'fleetHardHull'), (l) => l.detail);
  ctrl('Crafted hangar actions (M4a): slots past the cap, names, unknown ships, wrong cockpits, in flight', loopsOf(reports, 'fleetCrafted'), (l) => l.detail);
  ctrl('Ship templates (M4a): crafted saves, tampered codes, locked parts, applying a template', loopsOf(reports, 'fleetTemplates'), (l) => l.detail);
  ctrl('Fleet across save → load (M4a): both directions, copies independent', loopsOf(reports, 'fleetSaveCopy'), (l) => l.detail);
  ctrl('Derelict terminal (M4b): Data, log and each item once – take twice, from a save copy, berth again, after a death; fabricator twice; crafted takes (unknown site / item, not berthed)', loopsOf(reports, 'siteTerminal'), (l) => l.detail);
  ctrl('Graveyard farm (M4b): Data of the first analysed wreck once, ≤ 2 fragment rolls, looted wrecks never refilled – over despawn / respawn and a save → load', loopsOf(reports, 'graveyardFarm'), (l) => l.detail);
  ctrl('Comet budget (M4b): nucleus and tail shards once per pass – also from a save copy and after leaving and returning in the same pass', loopsOf(reports, 'cometBudget'), (l) => l.detail);
  ctrl('Relay charge (M4b): a half charge does not grow over a save → load, a powered relay stays powered, a lit relay pays nothing', loopsOf(reports, 'relayCharge'), (l) => l.detail);
  ctrl('Mine farm (M4b): every mine blows once (also after a save → load and leaving / returning), blowing mines pays nothing', loopsOf(reports, 'mineFarm'), (l) => l.detail);
  ctrl('Event triggers (M4b): `debugEvent` (forced showers / ambushes – ambush loot farming) only in dev builds', loopsOf(reports, 'eventTriggers'), (l) => l.detail);
  ctrl('Reshape back and forth (SL2 E2): every shape of a plate in turn and back, a damaged plate re-laid', loopsOf(reports, 'shapeReshape'), (l) => l.detail);
  ctrl('Damaged-plate arbitrage (SL2 E2): Tab to another shape (remove + place) and back vs the station repair, every tier × ring × shape', loopsOf(reports, 'shapeRepairSurvey'), (l) => l.detail);
  ctrl("Removing a damaged wedge (SL2 E2): repair / scrap at the full plate's price for the same missing HP", loopsOf(reports, 'shapeRemoveDamaged'), (l) => l.detail);
  ctrl("Loot of the player's own wedges (SL2 E2): one item in, one out; damaged = the full plate's scrap", loopsOf(reports, 'shapeLoot'), (l) => l.detail);
  ctrl('Crafted shapes (SL2 E2): AF2 codes, template saves and shipyard commits', loopsOf(reports, 'shapeCrafted'), (l) => l.detail);
  ctrl('A template with shapes through save → load (SL2 E2)', loopsOf(reports, 'shapeTemplates'), (l) => l.detail);
  ctrl('Mirror mode with too few plates (SL2 E2): pays only what is in the draft', loopsOf(reports, 'shapeMirror'), (l) => l.detail);
  out.push(...homeControlLines(reports));
  out.push(...guildControlLines(reports));
  out.push(`| Part buy → sell, craft → sell, resource buy → sell at one station | holds – parts buy ×1.5 (×ring) vs sell ×0.4; resources ×1.25 vs ×0.8 (demand ×1.16 < ×1.25) | analytic |`);
  out.push('');
  out.push(SHAPES_SECTION);
  out.push(homeSection(reports));
  out.push(guildSection(reports));

  out.push('## Honest baselines (net worth per game hour)');
  out.push('');
  out.push('| Difficulty | Median kr/h | p10 – p90 | First ore sale (median) | Deaths |');
  out.push('|---|---|---|---|---|');
  for (const p of ['none', 'mild', 'hard'] as const) {
    const runs = reports.map((r) => r.baselines.find((b) => b.penalty === p)!.run);
    const s = runs.map((x) => x.perHour).sort((a, b) => a - b);
    out.push(`| ${p} | ${k(median(s))} | ${k(s[Math.floor(s.length * 0.1)]!)} – ${k(s[Math.min(s.length - 1, Math.floor(s.length * 0.9))]!)} | ${min(median(runs.map((x) => x.firstOreSale ?? NaN)))} | ${runs.reduce((a, x) => a + x.deaths, 0)} |`);
  }
  out.push('');
  out.push('Before the fixes: none 20 k (12 k – 26 k), mild 14 k (12 k – 26 k), hard 12 k (5.3 k – 19 k) kr/h; first ore sale 0.9 / 1.2 / 1.2 min.');
  out.push('');

  out.push('## Liquidation and recovery (scenario 1)');
  out.push('');
  out.push('Strip the ship to the smallest valid hull, sell every part, the cargo and the storage, burn the credits on buy → sell round-trips, then recover with the safety nets only and hand over to the honest pilot.');
  out.push('');
  out.push('| Difficulty | Net worth before → after liquidation | Ship can mine again after | First ore sale after | Recovered | Route (median seed) |');
  out.push('|---|---|---|---|---|---|');
  for (const p of ['none', 'mild', 'hard', 'hardcore'] as const) {
    const rs = recoveries.filter((x) => x.penalty === p);
    if (!rs.length) continue;
    out.push(
      `| ${p} | ${k(median(rs.map((x) => x.worthStart)))} → ${k(median(rs.map((x) => x.worthLiquidated)))} | ${min(median(rs.map((x) => x.shipReady ?? NaN)))} | ${min(median(rs.map((x) => x.firstSale ?? NaN)))} | ${rs.filter((x) => x.recovered).length}/${rs.length} | ${rs[Math.floor(rs.length / 2)]!.route} |`,
    );
  }
  out.push('');
  out.push(`Before the fixes the liquidated player waited 10.0 min for the next kit (S3) and could skip it on Hard by scuttling for a fresh, sellable starter ship (X1). Now the Guild lends the laser (${LOAN_LASER_KEY}) or engine (${LOAN_ENGINE_KEY}) in the step the need arises – mounted, free, worth nothing.`);
  out.push('');

  out.push('## Softlock search (scenario 3)');
  out.push('');
  const chaos = reports.flatMap((r) => r.chaos);
  out.push(`${chaos.length} random adversarial sequences (70 % start with a full liquidation; then sell / strip / burn credits / fly off / run dry / ram nose or stern / go to another station / scuttle / tow / wait / dock home at random), each judged by the recovery oracle (strategies "nets" and "scuttle", every one on its own save → restore copy).`);
  out.push('');
  out.push('| Difficulty | Runs | Stuck | Recovered via nets | via scuttle | Median time back to selling ore |');
  out.push('|---|---|---|---|---|---|');
  for (const p of opts.chaosPenalties) {
    const cs = chaos.filter((c) => c.penalty === p);
    const okAt = (s: string) => cs.filter((c) => c.attempts.some((a) => a.strategy === s && a.ok)).length;
    const times = cs.map((c) => c.attempts.find((a) => a.ok)?.seconds ?? NaN).filter((x) => Number.isFinite(x));
    out.push(`| ${p} | ${cs.length} | ${cs.filter((c) => c.stuck).length} | ${okAt('nets')} | ${okAt('scuttle')} | ${min(median(times))} |`);
  }
  out.push('');
  out.push('Targeted adversarial sequences (legal commands only: liquidate, fly, ram the engines off stern-first, tow):');
  out.push('');
  out.push('| Scenario | Difficulty | Reached the state | Stuck | Recovered (median time) | Example |');
  out.push('|---|---|---|---|---|---|');
  const targeted = reports.flatMap((r) => r.targeted);
  for (const scenario of [...new Set(targeted.map((t) => t.scenario))]) {
    for (const p of ['mild', 'none', 'hard'] as const) {
      const ts = targeted.filter((t) => t.scenario === scenario && t.penalty === p);
      if (!ts.length) continue;
      const reached = ts.filter((t) => t.reached);
      const stuck = reached.filter((t) => t.stuck);
      const ok = reached.filter((t) => !t.stuck);
      const ex = stuck[0] ?? ok[0] ?? ts[0]!;
      const how = ex.attempts.map((a) => `${a.strategy}: ${a.ok ? `ok after ${min(a.seconds)}` : a.note}`).join('; ');
      out.push(
        `| ${scenario} | ${p} | ${reached.length}/${ts.length} | ${stuck.length ? `**${stuck.length}**` : '0'} | ${ok.length} (${min(median(ok.map((t) => t.attempts.find((a) => a.ok)?.seconds ?? NaN)))}) | seed ${ex.seed}, tick ${ex.tick}: ${ex.state} → ${how} |`,
      );
    }
  }
  out.push('');
  out.push('"Reached" = the legal sequence really ended with the ship arriving without forward thrust at that station (enginelessAtStation: a non-home shipyard; spareEngineElsewhere: home, with a spare engine left at the guaranteed ring-1 station); on the other seeds the ram missed or the tow went elsewhere. The Guild may already have lent an engine in the arrival step – the oracle then only has to fly.');
  out.push('');

  out.push('## Contract quotes for a crippled ship (X2 detail)');
  out.push('');
  out.push('| Seed | Offer | Starter ship | Without lasers | Minimal hull with the laser |');
  out.push('|---|---|---|---|---|');
  for (const r of reports.slice(0, 4)) for (const o of r.quotes.offers) out.push(`| ${r.seed} | ${o.type} | ${o.starter} | ${o.noLaser} | ${o.minimal} |`);
  out.push('');

  out.push('## Tow vs. flying home (X7 detail)');
  out.push('');
  out.push('| Distance | Tow cost | Flight home | Break-even income |');
  out.push('|---|---|---|---|');
  for (const t of tows) out.push(`| ${t.distance} u | ${t.cost} kr | ${t.flightSeconds.toFixed(0)} s | ${k(t.breakEvenPerHour)} kr/h |`);
  out.push('');

  out.push(RULES);
  return out.join('\n');
}

const SAFETY_NETS = `## Safety nets (after the fixes)

| Net | Where | Rule | Probed by |
|---|---|---|---|
| Emergency fuel ration | \`sim/station/actions.ts\` (refuel \`emergency\`) , \`data/economy.ts\` (\`emergencyFuelTarget\`) | tank below the target and ice + credits cannot reach it → free fill to the target: a quarter of the tank, but at least 15 units (one trip for a liquidated hull with a tiny tank) | rationCheck, every recovery |
| Tow (H) | \`sim/station/tow.ts\` | empty tank or no forward thrust; free when broke (cargo + salvage lost, the tank topped up to the ration target), else 100 + 0.2·d kr and no free fuel; no forward thrust → nearest shipyard | rationCheck, chaos, S1, X7 |
| Guild loan (replaces the emergency kit) | \`sim/station/guildLoan.ts\`, \`sim/ship/loan.ts\` | at every station with a shipyard: a T1 laser / forward engine when none is on board, none in reach (this storage, on board) and the reachable worth (credits + sellable parts on the ship and here + cargo / stored resources) < price + install fee; mounted on the hull for free; a loan part works normally but cannot be sold, scrapped, stored, couriered or crafted with – removing it returns it to the Guild, losing it leaves nothing to salvage | X5, S1, S2, S3, recoveries |
| Scuttle + death rules | \`sim/combat/combat.ts\` (scuttlePlayer), \`sim/death/death.ts\` | world deaths (binding, spec 15.2): none = the ship as it was right before the fatal event (parts lost earlier stay lost, damage kept), cargo kept, full tank; mild = the same at most 40 % HP, cargo lost, 25 % tank; hard = Guild-loan starter hull, means-tested (only the parts the player cannot buy here, never worth more than the hull the death took), cargo lost, credits + storages kept; hardcore → hard. Salvage on board is lost on every death. A voluntary scuttle: the cargo stays in the wreck, tow fee (free when broke), the ship as it was (no repair, no refuel, no lost part back) with the penalty on top | X1, X3, X4, controls, chaos |
| Evacuation | \`sim/death/death.ts\` (planDeath) | starter / stranded layout at a station without a shipyard → nearest shipyard | chaos, S1 |
| Shipyard | \`sim/shipyard/design.ts\` (evaluateDesign) | a removal-only draft is valid on a ship that already has no forward thrust; a removed loan part goes back to the Guild (never storage, repair or scrap, never cancels a new part); damaged owned part removed without repair → scrap | S1, X5 |
| Wreck salvage | \`sim/combat/combat.ts\`, \`sim/combat/wrecks.ts\` | own detached parts are loadable (intact = part, damaged = scrap; loan parts nothing); a restored layout takes its parts back out of the player's wrecks | X3 |
| Guild Training | \`sim/training/training.ts\` | every step pays once (the step index only moves forward, a skip gives only the parts not paid yet, a done or skipped training never pays again); a reward the player sold or lost comes back only as a Guild loan (worth 0) when an install step needs it | trainingFarm |
| Contracts | \`sim/contracts/board.ts\` | rewards frozen at accept, quoted from the best ship the player has had (high-water mark per ring), never below the starter hull; exclusive part replaces credits down to 0 and is dropped when worth more than the reward; free cancel ≤ 2 min | X2, X6, cancelLoop |
| Market | \`data/economy.ts\`, \`sim/sector/market.ts\` | parts buy ×1.5 / sell ×0.4, resources ×1.25 / ×0.8, demand +45 % on ≤ 150 u per epoch | X8, controls |
| Hangar and fleet (M4a) | \`sim/fleet/*\`, \`sim/station/guildLoan.ts\` | a switch parks the active ship with its parts, HP, fuel and cargo (Guild loan parts go back to the Guild; a hull without its own cockpit dissolves into storage); dismantling uses the shipyard's removal rules (repair fee or scrap); a flyable stored ship here blocks the Guild loan and stored ships count in the means test; slots 5 000 / 15 000 kr, capped at 2 (4 with the Archive), never refunded; names sanitised | fleetSwitch, fleetLaunder, fleetLoan, fleetHardHull, fleetCrafted, fleetSaveCopy |
| Ship templates (M4a) | \`sim/templates/*\`, \`sim/shipyard/template.ts\` | a template is only a design: applying it is a normal shipyard commit (every part kept, moved with its HP, taken from storage, bought or crafted at the usual price; locked parts unavailable); saves and codes are validated (keys, one cockpit, no overlap, in the hangar, connected, checksum) and capped by the Archive | fleetTemplates |
| World sites (M4b) | \`sim/sites/*\`, \`sim/discovery/wrecks.ts\` | a derelict's Data, log and items are paid once (taken bitmask and \`visited\`, saved); a berth is not a dock (no market, respawn or storage); a graveyard pays its Data for the first analysed wreck only and rolls fragments for its first two looted wrecks; graveyard wrecks are rebuilt from the seed and remember cuts and loot under their keys; comet budgets are per pass (the current pass saved); relay charges and powered relays are saved as they are; gone mines are a saved bitmask | siteTerminal, graveyardFarm, cometBudget, relayCharge, mineFarm |
| Shaped armour (SL2 E2) | \`sim/shipyard/design.ts\`, \`sim/station/repair.ts\`, \`sim/combat/wrecks.ts\`, \`sim/salvage/dismantle.ts\`, \`sim/templates/codec.ts\` | a shape is one armour item laid differently: a reshape is one installation; damage is the HP missing in full-plate HP – repair (\`repairCost × hpMult\`) and scrap (\`fullEquivalentHp\`) at the full plate's price; only a full-HP plate (or one whose max HP stays: wing L ↔ wing R ↔ full) is reshaped in place (\`reshapeDamaged\`), a damaged one goes remove + place with its repair priced; the player's own plate drops whole, another wreck's only with area ≥ 0.75; AF2 codes and saves are validated (known shape, shapeable part, overlap, bounds) | shapeReshape, shapeRepairSurvey, shapeRemoveDamaged, shapeLoot, shapeCrafted, shapeTemplates, shapeMirror |
| Home and workshop (M4c) | \`sim/ship/workshop.ts\`, \`sim/station/actions.ts\` (sale), \`sim/combat/partBlast.ts\`, \`sim/home/*\`, \`sim/save/validateHome.ts\` | refined ore is a sub-account of the ship's cargo (\`refined ≤ cargo\`, clamped after every action and every step, every outflow takes raw units first, storage and shipments hold raw ore only), refined only in flight, sold from the ship at ×1.15 never stacked with the demand bonus and never above the cheapest buy price anywhere (W1 ceiling, M4d); repair modules draw whole Fe / Ti units from the hold only into a saved HP bank (a crafted bank loads as at most one unit); a large reactor blows once (40 / 50 dmg to its 8-neighbours, no loot of what it destroys), a player's wreck is never dismantlable (no cut, no cut blast); home modules once each, at home, buildable ones only; a paint is free and only for a ship at home; pins only of the player's trophies, ≤ 6, unique | refineArbitrage, refineSurvey, refinedCarry, refinedSellTwice, repairStorageOnly, repairBank, blastOwnWreck, paintElsewhere, paintCrafted, homeBuildCrafted, trophyPinCrafted |
| Guild and trade (M4d) | \`sim/convoys/*\`, \`sim/guild/*\`, \`sim/npc/sides.ts\`, \`sim/navigation/notes.ts\`, \`sim/save/validateConvoys.ts\` | convoys never sell resources; the cargo sale pays 0.9 × the ring's station sale (refined units under the W1 ceiling, never the demand bonus), ≤ 200 u per pass over all resources (the trade record is saved, an unlink / relink or a save keeps it); every rare item once per pass at ≥ 1.2 × the market; tanker fuel at 1.5 ×, ≤ 60 u per pass, never sold back; one link at a time, pinned beside the moving port, no fuel burned; the escort deposit (10 % of the frozen reward, capped at the credits) comes back once – on a free cancel (only before the convoy departed) or on the arrival, a saved one is clamped to the contract's; one relay contract at a time, paid once per lane for a sector secured after its acceptance, a counterattack ship shot down stays down for the whole hold; \`debugGuild\` only in a dev build; player shots and rams never touch Guild Watch or convoy ships (no friendly fire), pirates the Watch destroys leave no cargo loot and are not the player's kills; map notes ≤ 30 × 40 characters, finite positions, known icons, ids never reused | convoyArbitrage, convoyCap, convoyItems, tankerFuel, convoySaveLoad, convoyLinkRide, convoyCrafted, escortDeposit, escortCancelFarm, escortStack, relayDoublePay, relayHoldFarm, watchNoValue, mapNotesNoValue |
| Events director (M4b) | \`sim/events/director.ts\` | rolled events are one-shot per (sector, bucket) (\`director.fired\`, saved); \`debugEvent\` only with \`import.meta.env.DEV\` | eventTriggers, saboteur.test.ts |
| Save / load | \`sim/save\` (V8) | loan flags, the pending scuttle and the best-ship record are saved | saveLoadKit |
`;

/** Shaped armour (SL2 E2, plan B1): the probe table, the repair parity, the balance case and the notes. */
const SHAPES_SECTION = `## Shaped armour (SL2 E2)

Probes of task B1 (\`tools/bot/saboteur/shapes.ts\`, quick test \`saboteur.test.ts\` › shaped armour; default (b): damage is the HP missing, in full-plate HP). Every probe gains nothing (rows in *Controls* above); the net-worth metric values a damaged shaped plate by its full-equivalent HP, like repair and scrap do.

| Probe | What it tries | Result |
|---|---|---|
| shapeReshape | every shape of one plate in turn and back to full, twice; a damaged plate re-laid (crafted commits) | each reshape = 1 installation (10 kr), the plate stays one item at full HP; 7/7 crafted reshapes of a damaged plate that change the max HP refused (\`reshapeDamaged\`), wing L ↔ wing R ↔ full keeps the damage exactly; gain 0 |
| shapeRepairSurvey | Tab on a damaged plate (remove + place in another shape, then back) vs the station repair – T1/T2 × full + 9 shapes × 10/50/90 % HP × rings 1–4 (240 quotes, 2 160 routes) | the Tab route prices the same repair, never buys or crafts a new plate, and pays ≥ 2 installations more (cheapest margin 20 kr); no arbitrage |
| shapeRemoveDamaged | remove a wedge missing 10 of 20 HP (rich and broke) | repair 8 kr + 1 iron = the full plate missing 10 of 40 HP = station repair + removal; broke: scrap 5 iron = the full plate's scrap; one plain plate to storage |
| shapeLoot | a wedge hanging on a plate; the plate shot off, the wedge loaded back from the wreck | intact: wreck loot 1 × armor:1, loaded (only the destroyed plate lost); damaged 10/20 HP: scrap 5 iron = the full plate missing 10 HP |
| shapeCrafted | 18 crafted AF2 codes (shape on a cannon / the cockpit, unknown or numeric code, \`t\`, huge / negative / fractional index, huge or unsafe cell, rotation 4, 6-tuples, duplicate / unknown keys, wrong version, a shape in AF1, overlap, too long), 5 template saves, 6 shipyard commits | all refused with the expected error, state unchanged; a valid AF2 wedge decodes |
| shapeTemplates | a template with 3 shaped plates through save → load, built on a stripped hull on the original and the copy | template, AF2 code and decode identical; built for 17 135 kr = the quote on both, the same ship |
| shapeMirror | wing L + mirrored wing R with 1 plate in storage; the copy's cells blocked | 1 from storage + 1 bought, 2 installations = 410 kr = paid; blocked copy: 1 op in the draft, 10 kr |

**Repair parity** (station repair of a shaped plate − the full plate missing the same HP, rings 1–4): 0 kr / 0 u for every shape and tier except the rounding of the shaped max HP and the price ceiling – T1 round −1 kr, T1 arc +1 kr, T2 chamfer / round +1 kr (at most one credit per repair; damage cannot be moved between shapes, so there is no loop).

**Balance** (\`src/sim/combat/balance.test.ts\` › example C, 8 approaches, 120 s, mild): example C after E2 vs the same cells laid full (\`filledFull\`), against a T2 Hammer and a level-3 captain:

| Ship | vs Hammer T2: wins / TTK | vs captain L3: wins / TTK | Pooled wins / TTK / hull lost |
|---|---|---|---|
| C after E2 (shaped) | 8 / 18.6 s | 7 / 43.2 s | 15 / 30.9 s / 0 % |
| C laid full | 8 / 28.9 s | 6 / 22.8 s | 14 / 26.3 s / 1.1 % |

The shaped C kills the Hammer faster (free arcs beside the bow wedges), the captain slower (less HP in front); pooled it is within the tolerance of the case (≤ 1 more win, TTK ≥ 80 % of the full-cell ship's, hull lost ≥ full − 5 %). The DH §6.1 bar (a T1 fighter beats a T1 Jackal head-on) is unchanged.

**Observations (no gain, for the record):**
- *Guild loan means test* (\`sim/station/guildLoan.ts\` \`liquidValue\`): a damaged shaped plate is valued as \`scrapResources(key, hp, maxHp)\` – by its own HP ratio, not by the full-equivalent HP the shipyard scraps it from (a T1 wedge at 10/20 HP: 3 iron instead of 5). The player looks a few credits poorer; a loan is worth 0 and lends one part per function, so nothing can be gained – a one-line parity fix (\`fullEquivalentHp\` / \`fullMaxHp\` for shaped parts) if wanted.
- *Laser cutting of the player's own wreck pieces* (\`sim/salvage/dismantle.ts\` \`pieceLoot\`): a cut (not intact) shaped plate scraps from \`fullEquivalentHp(PIECE_SCRAP_HP × maxHp)\`, so a cut T1 wedge yields 16 kr of scrap vs 10 kr for a cut full plate (nose 2×1: 3 kr) – always far below the plate item (105 kr) that loading it whole gives; no loop.
`;

const RULES = `## Rules implemented

1. **One free-help channel, the Guild loan** (the Guild loan, \`loan\`). Every free part – the laser / engine for a stranded player and the Hard respawn hull (the Guild Training's replacement for a sold or lost reward too) – is a loan part (\`PlacedPart.loan\`). It works normally but can never leave the hull: no sale, scrap, storage, courier or crafting; removing it in the shipyard returns it to the Guild, losing it in flight leaves nothing in the wreck. The shipyard shows the loan parts (message "Guild loan" with the parts highlighted) and the "Back to the Guild" cost line; the hub toast explains the loan.
2. **Need = reachable net worth.** Help only when credits + sellable parts on the ship and at this station + cargo and stored resources here cannot buy the missing part (+ install fee). A spare in reach blocks it (mount it or sell it); spares at other stations or in courier shipments do not.
3. **Help where the player is.** Every station with a shipyard lends, mounted on the hull for free, with no cooldown – there is nothing to farm.
4. **Removal-only drafts on a stranded ship.** A ship that already has no forward thrust may always strip parts to sell them.
5. **A voluntary scuttle is never cheaper than a tow.** The cargo stays in the abandoned wreck, the tow fee is charged (free when broke), no repair, no refuel, lost parts stay lost, the penalty on top; salvage on board is lost on every death. World-caused deaths keep the binding difficulty rules.
6. **Hard / Hardcore respawn = loan hull.** The previous hull and its loans are gone; the new hull is lent.
7. **Contract quotes from the best ship.** Units/h and the reference income come from the best ship the player has had (saved high-water mark), never below the starter hull; exclusive parts replace credits down to 0.
8. **The safety nets allow one trip.** The emergency ration (and a free tow) fills the tank to a quarter, but at least 15 units – a liquidated hull with a 20-unit tank could not mine on 5. Loan parts exist only on the hull, so a new loan never adds to an old one: the Hard respawn replaces the old hull (its loans with it), and the station loan lends only what is missing.

Known residue (by design): a player whose whole reachable worth is below a T1 laser can still turn his own last laser into credits (its 40 % sale value) and fly on a lent one – a one-time conversion bounded by one part per function, at no gain in net worth (the loan is worth 0); doing it again needs a new part first.
`;

// ------------------------------------------------------------------------------------------------
// M4c "Home and Workshop" (tools/bot/saboteur/home.ts)

const HOME_PROBES: readonly [string, string][] = [
  ['refineArbitrage', 'Buy ore → refine in flight → sell (M4c): home ↔ G1 both ways and into a sector demand; the refined bonus never stacks with the demand'],
  ['refineSurvey', 'Refine arbitrage survey (M4c, W1): cheapest buy vs the dearest refined sale over every station of rings 1–4 (under the M4d refined price ceiling)'],
  ['refinedCarry', 'Refined ore off the ship (M4c): transfer out and back (also in one step), the swap trick, hangar switches, courier, a delivery contract'],
  ['refinedSellTwice', 'Selling refined ore twice (M4c): unit by unit, three sales in one step, via storage in one step, crafted quantities'],
  ['repairStorageOnly', 'Repair module (M4c): material only in station storage, 2 Fe in the hold, a T1 + T2 neighbour; the price next to the station repair'],
  ['repairBank', 'Repair bank through save → load (M4c): a copy mid-repair, a crafted 1e6 HP bank, a bank of a missing part, a negative bank'],
  ['blastOwnWreck', "Large-reactor blast and the player's own wreck (M4c): the reactor blown on the hull, torn off and lasered, loaded back"],
  ['paintElsewhere', 'Paint a ship that is not at home (M4c): active ship at G1, stored at G1 from home, stored at home from G1, in flight'],
  ['paintCrafted', "Crafted paintShip (M4c): another game's ship ids, ids that exist nowhere, unknown paints, the same paint"],
  ['homeBuildCrafted', 'homeBuild twice, away from home, in flight, a future (`since`) module, unknown ids, two in one step, poor, from a save copy (M4c)'],
  ['trophyPinCrafted', 'trophyPin (M4c): no hall, a captain not defeated, a fortress not destroyed, malformed ids, a 7th pin, crafted saves'],
];

/** Control rows of the M4c probes (each must gain nothing; refineSurvey watches the closed W1 finding). */
export function homeControlLines(reports: Pick<SeedReport, 'loops'>[]): string[] {
  const out: string[] = [];
  for (const [id, label] of HOME_PROBES) {
    const ls = reports.flatMap((r) => r.loops.filter((l) => l.id === id));
    if (!ls.length) continue;
    const bad = ls.filter((l) => l.exploit);
    const verdict = id === 'refineSurvey' ? (bad.length ? '**finding W1 (closed in M4d) is back**' : 'holds') : bad.length ? '**broken**' : 'holds';
    out.push(`| ${label} | ${verdict} – ${(bad[0] ?? ls[0]!).detail} | ${ls.length - bad.length}/${ls.length} |`);
  }
  return out;
}

/** Findings of the M4c probes: W1 (refined cross-ring margin) and B1 (repair bank switching material). */
export function homeFindingRows(reports: Pick<SeedReport, 'loops'>[]): FindingRow[] {
  const rows: FindingRow[] = [];
  const survey = reports.flatMap((r) => r.loops.filter((l) => l.id === 'refineSurvey'));
  if (survey.length) {
    const pos = survey.filter((l) => l.exploit);
    const best = Math.max(...survey.map((l) => l.metrics?.bestMargin ?? 0));
    const perCycle = pos.map((l) => l.metrics?.perCycle ?? 0);
    const perHour = pos.map((l) => l.perHour);
    const dist = pos.map((l) => l.metrics?.nearDistance ?? 0);
    rows.push({
      id: 'W1',
      severity: 'low',
      title:
        'Refine arbitrage across rings (M4c): ore bought in a ring with a low resource multiplier, refined on board and sold ×1.15 in ring 4 beats the buy price – iron ring 2 (×0.9, buy 4.3) → ring 4 (×1.2, refined 4.6), copper ring 1 → ring 4 with a lucky ±5 % jitter. The plan\'s bound (0.8 × 1.15 = 0.92 < 1.25) holds only at the same ring multiplier',
      before: 'M4c: best +0.30 kr/u; the closest positive pairs 5243–7702 u apart: 51–221 kr per 735 u hold (≈ 225–974 kr/h before fuel); 4/4 seeds',
      after: pos.length
        ? `best +${best.toFixed(2)} kr/u; the closest positive pairs ${Math.min(...dist)}–${Math.max(...dist)} u apart: ${Math.min(...perCycle)}–${Math.max(...perCycle)} kr per 735 u hold (≈ ${k(Math.min(...perHour))}–${k(Math.max(...perHour))} kr/h before fuel, vs ~30–57 k kr/h of honest P2 mining); ${pos.length}/${survey.length} seeds`
        : `no positive pair on ${survey.length} seeds: best ${best.toFixed(2)} kr/u (iron ring 2 4.3 → ring 3–4 refined 4.2)`,
      status: pos.length ? 'open' : 'fixed',
      fix: pos.length
        ? 'Regression: W1 was closed by the refined price ceiling (`REFINED_CEILING`, `refinedUnit`) – a refined price now reaches the cheapest buy price again; check `data/workshop.ts` and every sale through `shipSaleValue`.'
        : `Closed in ${W1_FIX} (user decision: the refined price ceiling, M4d plan §2.6): a refined unit never sells above the cheapest buy price of its resource anywhere – \`REFINED_CEILING\` in \`data/workshop.ts\`, derived from the station price formula (iron 4.2, copper 5.8, titanium 11.2), applied in \`refinedUnit\` (\`sim/ship/workshop.ts\`) by every refined sale and quote (station, convoy, trade UI). No new state; ring 1–2 refining and every titanium sale keep the full +15 %, ring 3–4 iron / copper get less (ring 4 iron +5 %).`,
      test: '`saboteur.test.ts` › M4c (`refineSurvey`), `econOracle.test.ts` (W1 bound), `workshop.test.ts`',
    });
  }
  const repair = reports.flatMap((r) => r.loops.filter((l) => l.id === 'repairStorageOnly' && (l.metrics?.mixedSwitches ?? 0) > 0));
  if (repair.length) {
    const wasted = repair.map((l) => l.metrics?.mixedWasted ?? 0);
    const switches = repair.map((l) => l.metrics?.mixedSwitches ?? 0);
    const healed = repair.map((l) => (l.metrics?.mixedHealedT1 ?? 0) + (l.metrics?.mixedHealedT2 ?? 0));
    const burns = wasted.some((w) => w > 1e-9);
    rows.push({
      id: 'B1',
      severity: 'low',
      title:
        'Repair bank flip-flop (M4c, a loss, not an exploit): one repair module beside a damaged T1 and a damaged T2 part switches its target whenever their HP fractions cross; `fund` dropped the other material\'s bank (< 1 unit) at every switch – the material burned while almost nothing was repaired',
      before: 'T1 plate at 50 % + T2 plate at 33 %, 3 Fe + 3 Ti: 3–5 bank switches burned 4.5–5.5 units (≈ 11.7 HP repaired instead of ~67 HP); 4 seeds',
      after: `${Math.min(...switches)}–${Math.max(...switches)} bank switches, ${Math.min(...wasted).toFixed(1)}–${Math.max(...wasted).toFixed(1)} units burned, ${Math.min(...healed).toFixed(1)}–${Math.max(...healed).toFixed(1)} HP repaired; ${repair.length} seeds`,
      status: burns ? 'open' : 'fixed',
      fix: burns
        ? 'In `sim/ship/workshop.ts` (`repairTarget` / `fund`): keep the current target while its bank is not empty (hysteresis), or keep one bank per material.'
        : 'Fixed in 4838089 (`sim/ship/workshop.ts`, save shape unchanged): a module whose weakest neighbour changed material keeps the bank\'s part and repairs it from the bank only until it is empty (hysteresis); a module of the other material waits while any module repairs with the bank\'s material.',
      test: '`saboteur.test.ts` › M4c (`repairStorageOnly` metrics)',
    });
  }
  return rows;
}

/** The M4c section: what each probe tried, per seed. */
export function homeSection(reports: Pick<SeedReport, 'loops' | 'seed'>[]): string {
  const out: string[] = [];
  const has = reports.some((r) => r.loops.some((l) => HOME_PROBES.some(([id]) => id === l.id)));
  if (!has) return '';
  out.push('## Home and workshop (M4c)');
  out.push('');
  out.push(
    'Probes of task T13 (`tools/bot/saboteur/home.ts`, quick test `saboteur.test.ts` › M4c). Setup steps (a rich player, the Data of the Archive nodes, defeated captains, a destroyed fortress, a delivery contract, Guild level 2 for the courier) are written directly; every gain is measured after them through real actions and flight. Net worth values refined ore at the raw price, so the refinery\'s honest +15 % on the player\'s own ore is not counted as a gain.',
  );
  out.push('');
  out.push('| Probe | Seed | Gain (kr) | Result |');
  out.push('|---|---|---|---|');
  for (const [id] of HOME_PROBES) {
    for (const r of reports) {
      const l = r.loops.find((x) => x.id === id);
      if (!l) continue;
      const verdict = l.exploit ? (id === 'refineSurvey' ? '**W1**' : '**broken**') : 'holds';
      out.push(`| ${id} | ${r.seed} | ${Number.isFinite(l.gain) ? (Math.round(l.gain * 100) / 100).toString() : '–'} | ${verdict} – ${l.detail} |`);
    }
  }
  out.push('');
  out.push('**Observations (no gain, for the record):**');
  out.push(
    "- *Refined ore through storage within one step* – fixed in 4838089: `Simulation.step` now clamps `refined ≤ cargo` after every action (it used to clamp after all of the step's actions, so a transfer to storage and back in the same step kept the refined count). Ore moved to storage comes back raw even within one step, as the plan says; the swap trick only loses the buy / sell spread.",
  );
  out.push(
    "- *The repair module is ~2× cheaper per HP than the station repair* (no credits – ~84 % of the station bill; 21 HP of a T1 plate: 2 Fe ≈ 10 kr vs 16 kr + 2 Fe at the station) – by design (open question 3). It restores only the player's own damage and draws only from the hold, so there is no loop: a damaged part cannot be bought, looted or stored (damaged loot is scrap).",
  );
  out.push(
    '- *A T1 repair module in ring 2 often idles for material*: T1 parts repair with iron and a ring-2 miner hauls titanium (the refiner persona of the balance bot logs `workshopIdle:repair:material`).',
  );
  out.push('');
  return out.join('\n');
}


// ------------------------------------------------------------------------------------------------
// M4d "Guild and Trade" (tools/bot/saboteur/guild.ts)

const GUILD_PROBES: readonly [string, string][] = [
  ['convoyArbitrage', 'Buy ore at a station → sell it at a passing convoy (M4d): the real loop at home and raw / refined sales in rings 1–3 against the station sale and the cheapest buy anywhere'],
  ['convoyCap', 'The 200 u cap per convoy pass (M4d): refilled cargo, unlink → relink, a save → load copy, F at a second pass while linked'],
  ['convoyItems', 'Convoy rare items (M4d): every slot, again, crafted slots, a save copy, unlink → relink; the parts sold back at home'],
  ['tankerFuel', 'Tanker fuel (M4d): four fills against the 60 u cap, a save copy, crafted amounts, selling fuel to a convoy or a station'],
  ['convoySaveLoad', 'Save → load around a convoy link (M4d): the link and the trade record kept; crafted trades (sold −1000 / 1e9, every slot bit, foreign passes) and a link to a pass not in flight'],
  ['convoyLinkRide', 'The convoy link as a ride (M4d): 120 s from the departure and through the turn-around – fuel, station circles, no jump at the unlink, a save copy while linked'],
  ['convoyCrafted', 'Crafted convoy commands (M4d): unlinked (docked, flying), malformed slots / quantities / resources / amounts, two buys or two sales in one step, `debugGuild`'],
  ['escortDeposit', 'Escort deposit (M4d): 3 × free cancel → accept, the full escort (deposit back once, a save copy, abandon after the arrival, turn-in twice), a late cancel, a poor pilot, a crafted deposit in a save'],
  ['escortCancelFarm', 'Escort ambush loot through the free cancel (M4d): accept → shoot the ambush party down → abandon within 2 min → accept the same slip again'],
  ['escortStack', 'Two escorts on one stretch (M4d): two slips of one station on the same leg – one convoy per contract, both paid'],
  ['relayDoublePay', 'The relay contract pays once per lane (M4d): secured and turned in, turned in again, new and stale slips of the secured lane, a second relay slip while one is active'],
  ['relayHoldFarm', 'The relay hold re-arms (M4d): two of three counterattack ships shot down, out beyond the hold radius and back – only the survivor comes back, never a fresh party'],
  ['watchNoValue', 'No friendly fire (M4d): player shots and a ram at a live Guild Watch ship, shots at a scheduled convoy ship and an escorted trader; pirates destroyed by Watch shots'],
  ['mapNotesNoValue', 'Map notes (M4d): without the node, 35 notes, crafted text / position / icon / ids, deletes, a save copy, crafted saves – notes and routes pay nothing'],
];

/** Probes guarding a finding (G1–G3, fixed after T16): a gain there is that finding back. */
const GUILD_FINDING: Readonly<Record<string, string>> = { relayHoldFarm: 'G1', escortCancelFarm: 'G2', escortDeposit: 'G3' };
// G4 (`debugGuild` 'watch' outside a dev build) is checked by saboteur.test.ts – the bot process is a dev build
/** The commits that fixed the M4d findings. */
const GUILD_FIX = { G1: 'bce7ac6', G2: 'cfae2ae', G3: 'd494a43', G4: '5d48077', estimate: 'a4ef1fd', corners: 'de6bd58' } as const;

/** Control rows of the M4d probes (each must gain nothing; a gain where a finding was fixed is marked with it). */
export function guildControlLines(reports: Pick<SeedReport, 'loops'>[]): string[] {
  const out: string[] = [];
  for (const [id, label] of GUILD_PROBES) {
    const ls = reports.flatMap((r) => r.loops.filter((l) => l.id === id));
    if (!ls.length) continue;
    const bad = ls.filter((l) => l.exploit);
    const verdict = bad.length ? (GUILD_FINDING[id] ? `**finding ${GUILD_FINDING[id]} (broken again)**` : '**broken**') : GUILD_FINDING[id] ? `holds (${GUILD_FINDING[id]} fixed)` : 'holds';
    out.push(`| ${label} | ${verdict} – ${(bad[0] ?? ls[0]!).detail} | ${ls.length - bad.length}/${ls.length} |`);
  }
  return out;
}

const range = (xs: number[], f: (x: number) => string = (x) => k(x)): string => (xs.length ? (Math.min(...xs) === Math.max(...xs) ? f(xs[0]!) : `${f(Math.min(...xs))}–${f(Math.max(...xs))}`) : '–');

/** Findings of the M4d probes: G1 relay hold farm, G2 escort cancel farm, G3 crafted escort deposit. */
export function guildFindingRows(reports: Pick<SeedReport, 'loops'>[]): FindingRow[] {
  const rows: FindingRow[] = [];
  const of = (id: string): LoopResult[] => reports.flatMap((r) => r.loops.filter((l) => l.id === id));
  const farm = of('relayHoldFarm');
  if (farm.length) {
    const bad = farm.filter((l) => l.exploit);
    const m = (key: string): number[] => bad.map((l) => l.metrics?.[key] ?? 0);
    rows.push({
      id: 'G1',
      severity: 'medium',
      title:
        'Relay hold as a pirate spawn on demand (M4d): an interrupted hold re-arms when the player comes back within 400 u, and `beginFight` clears the kills (`combat.defeated`) of the counterattack ids `rc:<lane>:<i>` – so shooting two of the three ships down, flying out beyond 900 u and back brings a fresh party with fresh loot, as long as the third survives (the sector is secured only when all are gone)',
      before: '– (new in M4d)',
      after: bad.length
        ? `${range(m('cycles'), String)} cycles × 2 kills on ${bad.length}/${farm.length} seeds, ${range(m('loot'))} kr of loot per 3 cycles; ≈ ${range(m('perHour'))} kr/h with instant kills, ≈ ${range(m('perHourSlow'))} kr/h at 75 s per kill (honest P2 mining ≈ 26–31 k kr/h)`
        : `a re-armed hold brought back only the ships not shot down on ${farm.length} seeds (${range(farm.map((l) => l.metrics?.kills ?? 0), String)} kills of a 3-ship party, no loot twice)`,
      status: bad.length ? 'open' : 'fixed',
      fix: bad.length
        ? 'Not fixed (econ task – the sim untouched). Suggested in `sim/guild/relayChain.ts`: keep the counterattack kills of the same hold – `beginFight` clears `combat.defeated` only on the first fight of a hold (a re-armed fight brings only the ships not yet destroyed; none left = the hold is won), or a counterattack ship destroyed in a re-armed fight drops no cargo.'
        : `Fixed in ${GUILD_FIX.G1}: \`beginFight\` no longer clears the kills; the counterattack ships shot down (or fled) stay down while the lane is powered (\`keepPartyDown\` keeps their \`combat.defeated\` entries past the 20 min respawn), so a re-armed hold brings back only the ships still alive (none left = the hold is won).`,
      test: '`saboteur.test.ts` › M4d (`relayHoldFarm`)',
    });
  }
  const esc = of('escortCancelFarm');
  if (esc.length) {
    const bad = esc.filter((l) => l.exploit);
    const m = (key: string): number[] => bad.map((l) => l.metrics?.[key] ?? 0);
    rows.push({
      id: 'G2',
      severity: 'medium',
      title:
        'Escort ambush loot through the free cancel (M4d, like M12 for hunts): accept an escort whose first ambush comes early, meet the convoy, shoot the party down, abandon within 2 min – the deposit comes back, the slip returns to the board, a new acceptance arms a fresh party (new serial, new `ea:` ids)',
      before: '– (new in M4d)',
      after: bad.length
        ? `${range(m('cycles'), String)} cycles on ${bad.length}/${esc.length} seeds, the party ≈ 25 s after the acceptance with the soonest slip, ${range(m('loot'))} kr of loot per 3 cycles; ≈ ${range(m('perHourSlow'))} kr/h at 75 s per kill (the kills must fall within the 2 min)`
        : `the cancel after the departure was not free on ${esc.length} seeds (no deposit back, the slip not back on the board – 0 cycles)`,
      status: bad.length ? 'open' : 'fixed',
      fix: bad.length
        ? 'Not fixed (econ task – the sim untouched). Suggested in `sim/contracts/board.ts` `abandon` (the M12 rule for hunts): no free cancel and no slip back on the board once the escort convoy has departed or an ambush was armed (`convoys.escorts.get(serial).fired !== 0`) – the deposit is lost like on a late cancel.'
        : `Fixed in ${GUILD_FIX.G2}: \`cancelIsFree\` (\`sim/contracts/board.ts\`, shared by \`abandon\` and the slip view) – no free cancel once the escort convoy has departed or an ambush was armed (\`escortUnderway\`), the M12 rule for hunts: the deposit is lost, the slip stays off the board, the contract fails as abandoned.`,
      test: '`saboteur.test.ts` › M4d (`escortCancelFarm`)',
    });
  }
  const dep = of('escortDeposit');
  if (dep.length) {
    const bad = dep.filter((l) => (l.metrics?.craftedPaid ?? 0) > 1);
    rows.push({
      id: 'G3',
      severity: 'low',
      title:
        "Crafted save: an escort convoy's deposit is not bounded (M4d): `validateConvoys` checks `deposit ≥ 0` only and `repairConvoys` never compares it with the contract – a save edited to a deposit of 1 000 000 loads as it is and pays it out on the arrival or on a free cancel",
      before: '– (new in M4d)',
      after: bad.length ? `1 000 000 kr paid back for a ${range(dep.map((l) => l.metrics?.deposit ?? 0))} kr deposit on ${bad.length}/${dep.length} seeds` : `the crafted deposit is clamped on ${dep.length} seeds`,
      status: bad.length ? 'open' : 'fixed',
      fix: bad.length
        ? 'Not fixed (econ task – the sim untouched). Suggested in `sim/save/validateConvoys.ts` `repairConvoys`: clamp `deposit` to `escortDepositOf(contract.reward)` and to 0 for a `done` record or a ready contract (warning `sitesRepaired`). Low: whoever edits saves can edit the credits too, but the other crafted-save paths are clamped (repair bank, notes, trades).'
        : `Fixed in ${GUILD_FIX.G3}: \`repairConvoys\` clamps the deposit to \`escortDepositOf(contract.reward)\` and to 0 for an arrived convoy or a ready contract (warning \`sitesRepaired\`).`,
      test: '`saboteur.test.ts` › M4d (`escortDeposit`)',
    });
  }
  if (of('convoyCrafted').length) {
    // checked in a production build by saboteur.test.ts (vi.stubEnv DEV = false); the bot process runs as a dev build
    rows.push({
      id: 'G4',
      severity: 'low',
      title:
        "`debugGuild { what: 'watch' }` is not gated by `import.meta.env.DEV` (M4d): `debugWatchNear` (`sim/guild/watch.ts`) has no dev check, so a crafted command in a production build moves the flying ship up to 6 000 u, beside the nearest scheduled Guild Watch ship (a free teleport – an escape from a fight, a skipped flight); `secure` and `convoy` are refused there",
      before: '– (new in M4d)',
      after: 'production build: `secure`, `convoy` and `watch` refused, the ship not moved',
      status: 'fixed',
      fix: `Fixed in ${GUILD_FIX.G4}: \`debugWatchNear\` has the \`import.meta.env.DEV\` check of \`debugSecureRelay\` / \`debugConvoyNear\`, and \`guildAction\` (\`sim/guild/debug.ts\`) refuses every \`debugGuild\` command in a production build up front.`,
      test: '`saboteur.test.ts` › M4d (debugGuild in a production build)',
    });
  }
  return rows;
}

/** The M4d section: what each probe tried, per seed, and the observations. */
export function guildSection(reports: Pick<SeedReport, 'loops' | 'seed'>[]): string {
  const out: string[] = [];
  const has = reports.some((r) => r.loops.some((l) => GUILD_PROBES.some(([id]) => id === l.id)));
  if (!has) return '';
  out.push('## Guild and trade (M4d)');
  out.push('');
  out.push(
    'Probes of task T16 (`tools/bot/saboteur/guild.ts`, quick test `saboteur.test.ts` › M4d; design decisions: no friendly fire, W1 closed). Setup steps (credits, Guild level 2, a game moved to the tick of a convoy pass, the approach to a moving trade port, the 5 s laser charge of a relay mast, cargo aboard, the flights to a meeting point or back to a station) are written directly; fights are resolved by lethal player shots, so the loot of a kill is real and the fight time is a lower bound (the farms also give a rate at 75 s per kill). Every gain is measured after the setup through real actions.',
  );
  out.push('');
  out.push('| Probe | Seed | Gain (kr) | Result |');
  out.push('|---|---|---|---|');
  for (const [id] of GUILD_PROBES) {
    for (const r of reports) {
      const l = r.loops.find((x) => x.id === id);
      if (!l) continue;
      const verdict = l.exploit ? (GUILD_FINDING[id] ? `**${GUILD_FINDING[id]}**` : '**broken**') : 'holds';
      out.push(`| ${id} | ${r.seed} | ${Number.isFinite(l.gain) ? (Math.round(l.gain * 100) / 100).toString() : '–'} | ${verdict} – ${l.detail} |`);
    }
  }
  out.push('');
  out.push('**Observations (no gain, for the record):**');
  out.push(
    '- *Two escorts on one stretch* (`escortStack`): two slips of one station on the same leg are two contracts with two convoys (never a shared one); flown together they pay both rewards for about the time of the longer one, and each convoy brings its own ambushes – contract stacking like two scans of one area. Escort slips have weight 2 and come only at lane stations.',
  );
  out.push(
    `- *The linked ship no longer snaps at the route's corners* (\`convoyLinkRide\`, fixed in ${GUILD_FIX.corners}): the trader's heading snaps at the rock-avoiding corners of the route (T5b) and the pinned pose used to jump with it (steps of up to ~4 u at 10 u/s); the linked ship's heading now eases towards the trader's (at most 1.5 rad/s) and it swings round the trader instead – no teleport, no station circle entered, the unlink keeps the convoy's velocity.`,
  );
  out.push('- *The convoy ride is free but slow*: a linked ship burns no fuel and rides at 10 u/s (1.7 min per 1 000 u) – far slower than flying; nothing to sell.');
  out.push(`- *The escort duration estimate* (fixed in ${GUILD_FIX.estimate}): \`escortSeconds\` counted 3 × 75 s per ambush while a P2 pilot's convoy stood still a median 77 s per ambush – the estimate was 1.4 × the real time and an escort paid ≈ 2 × the reference income per real hour; now 1.5 × 75 s (≈ 1.08 × the real time, bot-report.md).`);
  out.push(`- *\`debugGuild\`* is accepted in the bot process (\`import.meta.env.DEV\` is true under the Vite runner); in a production build (\`saboteur.test.ts\` stubs DEV) every \`what\` is refused – finding G4, fixed in ${GUILD_FIX.G4}.`);
  out.push('');
  return out.join('\n');
}
