// One bot run on one seed: steps the real simulation headless as fast as possible and records
// milestones (game time), the credit curve, trips, deaths, tows, stuck states and failed actions.
import { partValue } from '../../src/data/economy';
import { partKey, type PartKey } from '../../src/data/parts';
import { RESOURCE_IDS, type ResourceId } from '../../src/data/resources';
import { applyDeath } from '../../src/sim/death/death';
import { hullPoints } from '../../src/sim/ship/budget';
import { SIM_DT, Simulation, type SimEvent } from '../../src/sim/Simulation';
import { stationStorage } from '../../src/sim/station/storage';
import { BotLog, DEFAULT_BOT_OPTIONS, homeSellPrice, Pilot, type BotNote, type BotOptions } from './pilot';
import { beginTraining } from '../../src/sim/training/training';
import { playTraining } from '../../src/sim/training/testing';
import { sectorSecurity } from '../../src/sim/regions';
import { securityHere, securityOverrides } from '../../src/sim/pirates/sectors';
import { archiveNode } from '../../src/data/archive';
import { resourcePrice } from '../../src/data/economy';
import { REFINER_WORKSHOP } from './shipPlan';
import { currentHp } from '../../src/sim/ship/hp';
import { playerMounts, refinedBonusAt, repairMaterialPerHp } from '../../src/sim/ship/workshop';
import type { LaneId } from '../../src/sim/regions';
import { guildRelaySite } from '../../src/sim/guild/relaySites';
import { convoyColliders, escortHitTargets } from '../../src/sim/convoys';

export interface RunOptions extends BotOptions {
  /** Game hours to simulate. */
  hours: number;
  /** Credits added at the start (tests and what-if runs: skip the first hour of mining); default 0. */
  startCredits?: number;
  /**
   * M4d: lanes whose Guild relay sector starts secured (`--secured=A,B`) – written into `guild.relays` like a
   * won relay hold, so the relay sector is Guarded from the first step (the cautious persona's exposure check).
   */
  secured?: readonly LaneId[];
}

export interface Sample {
  /** Game seconds. */
  t: number;
  credits: number;
  /** Mined units × home sell price (what the mined rock is worth). */
  minedValue: number;
  /** Positive credit changes (sales, contracts, First Day rewards). */
  earned: number;
  /** Rewards only (contracts + First Day). */
  rewards: number;
  units: number;
  ring2: boolean;
  /** Data collected so far (`discovery.dataTotal`). */
  data: number;
}

export interface Trip {
  /** Undock tick → dock tick (game seconds). */
  start: number;
  end: number;
  units: number;
  value: number;
  miningSeconds: number;
  veinSeconds: number;
  /** From undock to the first mining tick and from the last mining tick to docking. */
  transitSeconds: number;
  /** Fuel burned (refuel excluded). */
  fuelUsed: number;
  ring2: boolean;
}

export interface RunResult {
  seed: number;
  hours: number;
  ticks: number;
  wallMs: number;
  /** Milestone id → game seconds. */
  milestones: Record<string, number>;
  samples: Sample[];
  trips: Trip[];
  deaths: { t: number; pos: string }[];
  stuck: (BotNote & { seed: number })[];
  notes: BotNote[];
  failures: Record<string, number>;
  failureExamples: BotNote[];
  counts: Record<string, number>;
  creditsByReason: Record<string, number>;
  mined: Record<ResourceId, number>;
  final: { credits: number; hull: number; parts: Record<string, number>; storageParts: Record<string, number>; goalIndex: number };
  vein: { miningSeconds: number; veinSeconds: number; veinMissSeconds: number };
  /** Number of docking sessions and total seconds docked. */
  docked: { count: number; seconds: number };
  fuelByMode: Record<string, number>;
  /** Soft-lock that ended the run early (null = ran the full time). */
  aborted: { t: number; reason: string } | null;
  secondsByMode: Record<string, number>;
  /** Data gained by source (`dataGained.source`). */
  dataBySource: Record<string, number>;
  /**
   * M4b "World Comes Alive" counters (task T15): director events (`event:<kind>`), ambushes by the
   * security of their sector (`ambush:<security>`, `ambushPirates`, `ambushGunnerLed`), micrometeor hits and
   * damage, mines, sleepers, derelict relays / berths / terminal Data and items (`derelictItemValue` = part
   * value of the taken parts), graveyard Data, comet sightings – each also counted in ring 2 (`p2:<key>`).
   */
  m4b: Record<string, number>;
  /**
   * M4c on-board workshop counters (the refiner persona; none for ships without a workshop): `refined` units
   * refined in flight, `refinedSold` refined units sold, `refinedBonus` ≈ credits of the refined bonus (units ×
   * the station's sell price × the bonus paid there, `refinedBonusAt` – REFINED_BONUS under the W1 refined price
   * ceiling), `refiningSeconds:fuel|ore`, `repairHp` HP the repair modules
   * healed and `repairMaterial` the Fe / Ti units it cost, `partsRepaired` (`partRepaired` events),
   * `workshopIdle:<what>:<reason>`, `partBlasts`.
   */
  m4c: Record<string, number>;
  /**
   * M4d "Guild and Trade" counters: `aiShipsMax` the most AI ships at once (pirates + live Guild Watch + escort
   * convoy ships – the budget is 10), `watchLiveMax`, `watchMet` distinct live Watch ships, `watchSeconds` with one
   * live, `watchEngaged`, `watchKills` pirates destroyed by a Watch shot (no cargo loot, not the bot's kill),
   * `watchLost` Watch ships destroyed, `convoyFlybys` flyby warnings, `convoyContactSeconds` sampled seconds the
   * ship touched a convoy ship's circles, `securedLanes` lanes secured at the start.
   */
  m4d: Record<string, number>;
}

/**
 * Class of an enemy by its id: regular group `pr:`, scavenger `zb:`, hunting party / captain `hp:` `cap:`,
 * M4b ambush party `ab:`, graveyard sleeper `gs:`, derelict sentry `dd:`; anything else 'other'
 * (fortress garrisons and reinforcements, distress traps `amb:`).
 */
export function enemyClass(id: string): string {
  if (id.startsWith('pr:')) return 'pirate';
  if (id.startsWith('zb:')) return 'scavenger';
  if (id.startsWith('hp:') || id.startsWith('cap:')) return 'hunt';
  if (id.startsWith('ab:')) return 'ambush';
  if (id.startsWith('gs:')) return 'sleeper';
  if (id.startsWith('dd:')) return 'sentry';
  return 'other';
}

export function runSeed(seed: number, options: Partial<RunOptions> = {}): RunResult {
  const opts: RunOptions = { ...DEFAULT_BOT_OPTIONS, hours: 2, ...options };
  const started = Date.now();
  const sim = new Simulation({ seed, settings: { seedText: String(seed) } });
  if (opts.training === 'play') {
    beginTraining(sim.state);
    playTraining(sim);
    if (sim.state.career.training.status !== 'done') throw new Error(`seed ${seed}: the scripted training did not finish (${JSON.stringify(sim.state.career.training)})`);
  }
  if (opts.startCredits) sim.state.credits += opts.startCredits;
  const m4d: Record<string, number> = {};
  const m4dBump = (key: string, n = 1): void => {
    if (n) m4d[key] = (m4d[key] ?? 0) + n;
  };
  const m4dMax = (key: string, n: number): void => {
    if (n > (m4d[key] ?? 0)) m4d[key] = n;
  };
  // M4d: lanes secured from the start (a won relay hold, as relayChain.ts `secure` writes it)
  for (const lane of opts.secured ?? []) {
    const site = guildRelaySite(seed, lane);
    if (!site) continue;
    sim.state.guild.relays.set(lane, { stage: 'secured', sector: site.sector, tick: 0 });
    sim.state.sites.powered.add(site.id);
    m4dBump('securedLanes');
  }
  // the refiner persona starts with the Data of its workshop's Archive nodes (an explorer collects them in
  // P1–P2; the miner bot earns ~6 D/h) – the credit fees it pays itself
  if (opts.persona === 'refiner') {
    const data = (REFINER_WORKSHOP.archive ?? []).reduce((sum, n) => sum + archiveNode(n).data, 0);
    sim.state.discovery.dataFund += data;
    sim.state.discovery.dataTotal += data;
  }
  const log = new BotLog();
  const pilot = new Pilot(sim, opts, log);
  const maxTicks = Math.round((opts.hours * 3600) / SIM_DT);
  const state = sim.state;

  const milestones: Record<string, number> = {};
  const mark = (id: string): void => {
    if (milestones[id] === undefined) milestones[id] = state.tick * SIM_DT;
  };
  const samples: Sample[] = [];
  const trips: Trip[] = [];
  const deaths: RunResult['deaths'] = [];
  const creditsByReason: Record<string, number> = {};
  let earned = 0;
  let rewards = 0;
  let trip: { start: number; units0: number; value0: number; mining: number; vein: number; first: number; last: number; ring2: boolean; fuel: number } | null = null;
  let lastFuel = state.player.fuel;
  // pirate encounters: distinct pirate / scavenger ids that came into play, groups among them
  const metIds = new Set<string>();
  const metGroups = new Set<string>();
  const metWatch = new Set<string>();
  let dockedCount = 0;
  const dataBySource: Record<string, number> = {};
  const m4b: Record<string, number> = {};
  const bump = (key: string, n = 1): void => {
    m4b[key] = (m4b[key] ?? 0) + n;
    if (pilot.ring2) m4b[`p2:${key}`] = (m4b[`p2:${key}`] ?? 0) + n;
  };
  let dockedTicks = 0;
  const m4c: Record<string, number> = {};
  const m4cBump = (key: string, n = 1): void => {
    if (n) m4c[key] = (m4c[key] ?? 0) + n;
  };
  const refinedSum = (): number => RESOURCE_IDS.reduce((sum, r) => sum + state.player.refined[r], 0);

  const minedUnits = (): number => RESOURCE_IDS.reduce((s, r) => s + state.stats.mined[r], 0);
  const minedValue = (): number => RESOURCE_IDS.reduce((s, r) => s + state.stats.mined[r] * homeSellPrice(r), 0);
  const sample = (): void => {
    samples.push({ t: state.tick * SIM_DT, credits: state.credits, minedValue: minedValue(), earned, rewards, units: minedUnits(), ring2: pilot.ring2, data: state.discovery.dataTotal });
  };
  sample();

  while (state.tick < maxTicks && !pilot.aborted) {
    if (state.player.destroyed) {
      deaths.push({ t: state.tick * SIM_DT, pos: `(${state.player.body.pos.x.toFixed(0)}, ${state.player.body.pos.y.toFixed(0)})` });
      applyDeath(sim);
      trip = null;
    }
    const cmd = pilot.command();
    const flying = state.player.dock.mode === 'flying';
    const repairs = flying && playerMounts(state.player).repairs.length > 0;
    const before = { refined: { ...state.player.refined }, hp: repairs ? new Map(state.player.hp) : null };
    const events: SimEvent[] = sim.step(cmd);
    pilot.onEvents(events);
    // M4c workshop: what the refineries and repair modules did this step (in flight HP only rise by a repair
    // module, the refined sub-account only by a refinery), what the docked sales took off the refined units
    if (flying && state.player.dock.mode === 'flying') {
      m4cBump('refined', Math.max(0, refinedSum() - RESOURCE_IDS.reduce((sum, r) => sum + before.refined[r], 0)));
      const w = state.player.workshop;
      if (w.refining) m4cBump(`refiningSeconds:${w.refining}`, SIM_DT);
      if (before.hp) {
        for (const part of state.player.grid.parts) {
          const gain = currentHp(state.player.hp, part) - currentHp(before.hp, part);
          if (gain <= 1e-9) continue;
          m4cBump('repairHp', gain);
          m4cBump('repairMaterial', gain * repairMaterialPerHp(part).perHp);
        }
      }
    } else if (state.player.dock.mode === 'docked' && events.some((e) => e.type === 'creditsChanged' && e.reason === 'sell')) {
      const st = sim.station(state.player.dock.stationId);
      for (const r of RESOURCE_IDS) {
        const sold = before.refined[r] - state.player.refined[r];
        if (sold <= 1e-9 || !st) continue;
        m4cBump('refinedSold', sold);
        // the bonus actually paid there: +15 % under the W1 refined price ceiling (less for ring 3–4 iron / copper)
        const sell = resourcePrice(r, st.ring, st.priceJitter[r]).sell;
        m4cBump('refinedBonus', sold * sell * refinedBonusAt(r, sell));
      }
    }
    for (const e of events) {
      if (e.type === 'partRepaired') m4cBump('partsRepaired');
      else if (e.type === 'workshopIdle') m4cBump(`workshopIdle:${e.what}:${e.reason}`);
      else if (e.type === 'partBlast') m4cBump('partBlasts');
    }

    // M4d: the AI budget, live Guild Watch ships, convoy contacts
    const watch = state.guild.watch;
    m4dMax('aiShipsMax', state.combat.enemies.length + watch.length + escortHitTargets(state).length);
    if (watch.length) {
      m4dMax('watchLiveMax', watch.length);
      m4dBump('watchSeconds', SIM_DT);
      for (const w of watch) {
        if (metWatch.has(w.id)) continue;
        metWatch.add(w.id);
        m4dBump('watchMet');
      }
    }
    if (state.tick % 30 === 0 && flying && state.player.dock.mode === 'flying') {
      if (convoyColliders(state, state.player.body.pos, state.player.props.boundingRadius + 0.5).length > 0) m4dBump('convoyContactSeconds', 30 * SIM_DT);
    }
    for (const e of events) {
      if (e.type === 'watchEngaged') m4dBump('watchEngaged');
      else if (e.type === 'shipDestroyed' && typeof e.by === 'string' && e.by.startsWith('gw:')) m4dBump('watchKills');
      else if (e.type === 'npcDestroyed' && e.id.startsWith('gw:')) m4dBump('watchLost');
      else if (e.type === 'eventWarning' && e.kind === 'convoyFlyby') m4dBump('convoyFlybys');
    }

    for (const en of state.combat.enemies) {
      if (metIds.has(en.id)) continue;
      metIds.add(en.id);
      log.count(`met:${enemyClass(en.id)}`);
      if (en.kind === 'gunner') log.count('met:gunner');
      const kind = enemyClass(en.id);
      if (kind === 'pirate') {
        const group = en.id.slice(0, en.id.lastIndexOf(':'));
        if (!metGroups.has(group)) {
          metGroups.add(group);
          log.count('met:groups');
        }
      }
    }
    for (const e of events) {
      if (e.type === 'enemyAlert') log.count('alerts');
      else if (e.type === 'huntingParty') log.count('huntingParties');
      else if (e.type === 'tollDemanded') log.count('tolls');
      if (e.type === 'eventStarted') {
        if (e.kind === 'ambush' || e.kind === 'micrometeors') bump(`event:${e.kind}`);
      } else if (e.type === 'ambushSpawned') {
        // the security of the sector the ambush was rolled in (key ev:ambush:<sector>@<bucket>)
        const m = /^ev:ambush:(.+)@-?\d+$/.exec(e.key);
        const security = m ? sectorSecurity(state.seed, m[1]!, securityOverrides(state)) : securityHere(state, state.player.body.pos);
        bump(`ambush:${security}`);
        bump('ambushPirates', e.count);
        if (e.leader === 'gunner') bump('ambushGunnerLed');
      } else if (e.type === 'micrometeorHit') {
        bump('micrometeorHits');
        if (e.shielded) bump('micrometeorShielded');
        else bump('micrometeorDamage', e.damage);
      } else if (e.type === 'mineArmed') bump('minesArmed');
      else if (e.type === 'mineExploded') bump('minesExploded');
      else if (e.type === 'sleepersWoke') bump('sleepersWoke');
      else if (e.type === 'derelictWoke') bump(`derelictWoke:${e.defence}`);
      else if (e.type === 'relayPowered') bump('relaysPowered');
      else if (e.type === 'berthed') bump('berths');
      else if (e.type === 'derelictVisited') {
        bump('derelictsVisited');
        bump('derelictData', e.data);
      } else if (e.type === 'derelictTaken') {
        bump(`derelictTaken:${e.what.kind}`);
        if (e.what.kind === 'part' || e.what.kind === 'crafted') bump('derelictItemValue', partValue(e.what.key));
      } else if (e.type === 'cometSighted') bump('cometsSighted');
      else if (e.type === 'analysisDone' && e.target.startsWith('gy:') && e.data > 0) bump('graveyardData', e.data);
      else if (e.type === 'dataGained') dataBySource[e.source] = (dataBySource[e.source] ?? 0) + e.amount;
      if (e.type === 'creditsChanged') {
        creditsByReason[e.reason] = (creditsByReason[e.reason] ?? 0) + e.delta;
        if (e.delta > 0) earned += e.delta;
        if (e.delta > 0 && e.reason === 'contract') rewards += e.delta;
        if (e.reason === 'sell' && e.delta > 0) mark('firstSale');
      } else if (e.type === 'contractCompleted') {
        mark('firstContract');
      } else if (e.type === 'undocked') {
        trip = { start: state.tick, units0: minedUnits(), value0: minedValue(), mining: 0, vein: 0, first: -1, last: -1, ring2: pilot.ring2, fuel: 0 };
      } else if (e.type === 'docked') {
        dockedCount++;
        if (trip) {
          const firstT = trip.first >= 0 ? trip.first : state.tick;
          const lastT = trip.last >= 0 ? trip.last : state.tick;
          trips.push({
            start: trip.start * SIM_DT,
            end: state.tick * SIM_DT,
            units: minedUnits() - trip.units0,
            value: minedValue() - trip.value0,
            miningSeconds: trip.mining * SIM_DT,
            veinSeconds: trip.vein * SIM_DT,
            transitSeconds: (firstT - trip.start + (state.tick - lastT)) * SIM_DT,
            fuelUsed: trip.fuel,
            ring2: trip.ring2,
          });
        }
        trip = null;
      }
    }
    const p = state.player;
    if (trip && p.fuel < lastFuel) trip.fuel += lastFuel - p.fuel;
    lastFuel = p.fuel;
    if (p.dock.mode === 'docked') dockedTicks++;
    if (p.beams.some((b) => b.asteroidId !== null)) {
      log.miningTicks++;
      if (trip) {
        trip.mining++;
        if (trip.first < 0) trip.first = state.tick;
        trip.last = state.tick;
      }
      if (p.beams.some((b) => b.vein !== null)) {
        log.veinTicks++;
        if (trip) trip.vein++;
      }
    }
    if (milestones.firstRing2 === undefined && Math.hypot(p.body.pos.x, p.body.pos.y) > 1500) mark('firstRing2');
    if (milestones.firstTitanium === undefined && state.stats.mined.titanium > 0) mark('firstTitanium');
    for (const [id, tick] of log.goals) if (milestones[id] === undefined) milestones[id] = tick * SIM_DT;
    if (state.tick % 3600 === 0) sample();
  }
  sample();

  const failures: Record<string, number> = {};
  for (const f of log.failures) failures[f.kind] = (failures[f.kind] ?? 0) + 1;
  const parts: Record<string, number> = {};
  for (const p of state.player.grid.parts) {
    const k = partKey(p.partId, p.tier);
    parts[k] = (parts[k] ?? 0) + 1;
  }
  const storageParts: Record<string, number> = {};
  for (const [k, n] of Object.entries(stationStorage(state, 'home').parts) as [PartKey, number][]) if (n) storageParts[k] = n;
  const mined = {} as Record<ResourceId, number>;
  for (const r of RESOURCE_IDS) mined[r] = state.stats.mined[r];

  return {
    seed,
    hours: opts.hours,
    ticks: state.tick,
    wallMs: Date.now() - started,
    milestones,
    samples,
    trips,
    deaths,
    stuck: log.stuck.map((s) => ({ ...s, seed })),
    notes: log.notes,
    failures,
    failureExamples: log.failures.slice(0, 20),
    counts: log.counts,
    creditsByReason,
    mined,
    final: {
      credits: state.credits,
      hull: hullPoints(state.player.grid),
      parts,
      storageParts,
      goalIndex: pilot.goalIndex,
    },
    vein: { miningSeconds: log.miningTicks * SIM_DT, veinSeconds: log.veinTicks * SIM_DT, veinMissSeconds: log.veinMissTicks * SIM_DT },
    docked: { count: dockedCount, seconds: dockedTicks * SIM_DT },
    fuelByMode: log.fuelByMode,
    aborted: pilot.aborted ? { t: state.tick * SIM_DT, reason: pilot.aborted } : null,
    secondsByMode: Object.fromEntries(Object.entries(log.ticksByMode).map(([k, v]) => [k, v * SIM_DT])),
    dataBySource,
    m4b,
    m4c,
    m4d,
  };
}

