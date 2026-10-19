// The saboteur suite for one seed: every exploit loop (with its honest baseline), the liquidation /
// recovery runs per difficulty, the surveys and the softlock search (random + targeted).
import type { DeathPenalty } from '../../../src/sim/settings';
import type { PilotRun } from './pilotLoop';
import {
  arbitrageSurvey,
  baseline,
  cancelLoop,
  contractInflation,
  coverageFarm,
  chartFarm,
  kitFarm,
  liquidateAndRecover,
  noneSalvageDupe,
  noneTeleport,
  partRewardSurvey,
  quoteSurvey,
  rationCheck,
  saveLoadKit,
  scuttleFarm,
  type ArbitrageRow,
  type LoopResult,
  type PartRewardRow,
  type QuoteSurvey,
  type RecoveryResult,
} from './scenarios';
import { fleetProbes } from './fleet';
import { siteProbes } from './sites';
import { shapeProbes } from './shapes';
import { homeProbes } from './home';
import { guildProbes } from './guild';
import { trainingFarm } from './training';
import { chaosRun, enginelessAtStation, spareEngineElsewhere, type ChaosResult, type TargetedResult } from './softlock';

export interface SaboteurOptions {
  /** Game hours of the exploit loops that are compared with the honest baseline. */
  hours: number;
  /** Random adversarial sequences per seed and difficulty. */
  chaosRuns: number;
  /** Difficulties of the softlock search. */
  chaosPenalties: DeathPenalty[];
}

export const DEFAULT_SABOTEUR_OPTIONS: SaboteurOptions = { hours: 1, chaosRuns: 4, chaosPenalties: ['mild', 'none', 'hard'] };

export interface SeedReport {
  seed: number;
  wallMs: number;
  loops: LoopResult[];
  baselines: { penalty: DeathPenalty; run: PilotRun }[];
  recoveries: RecoveryResult[];
  quotes: QuoteSurvey;
  partRewards: PartRewardRow[];
  arbitrage: ArbitrageRow[];
  chaos: ChaosResult[];
  targeted: (TargetedResult & { scenario: string })[];
}

const PENALTIES: readonly DeathPenalty[] = ['none', 'mild', 'hard', 'hardcore'];

export function runSaboteurSeed(seed: number, options: Partial<SaboteurOptions> = {}, progress?: (msg: string) => void): SeedReport {
  const o = { ...DEFAULT_SABOTEUR_OPTIONS, ...options };
  const started = Date.now();
  const secs = Math.round(o.hours * 3600);
  const log = (m: string): void => progress?.(`seed ${seed}: ${m} (${((Date.now() - started) / 1000).toFixed(1)} s)`);

  const loops: LoopResult[] = [];
  for (const p of PENALTIES) loops.push(scuttleFarm(seed, p, Math.min(secs, 600)));
  log('scuttle farms');
  loops.push(kitFarm(seed, 'mild', secs));
  loops.push(contractInflation(seed, secs));
  log('kit farm, contract inflation');
  loops.push(noneTeleport(seed, secs));
  log('none teleport');
  loops.push(noneSalvageDupe(seed, 'none'), noneSalvageDupe(seed, 'mild'));
  loops.push(rationCheck(seed), cancelLoop(seed), saveLoadKit(seed), coverageFarm(seed), chartFarm(seed));
  loops.push(trainingFarm(seed, 'mild'), trainingFarm(seed, 'hard'));
  loops.push(...fleetProbes(seed));
  loops.push(...siteProbes(seed));
  loops.push(...shapeProbes(seed));
  loops.push(...homeProbes(seed));
  loops.push(...guildProbes(seed));
  log('dupe, controls, fleet, sites, shapes, home, guild');
  for (const l of loops) {
    if (l.baselinePerHour === null && (l.id === 'scuttleFarm' || l.id === 'kitFarm' || l.id === 'noneSalvageDupe')) {
      const base = PENALTIES.includes(l.penalty) ? baseline(seed, l.penalty === 'hardcore' ? 'hard' : l.penalty, secs) : null;
      if (base) l.baselinePerHour = base.perHour;
    }
  }
  log('baselines');
  const baselines = (['none', 'mild', 'hard'] as const).map((penalty) => ({ penalty, run: baseline(seed, penalty, secs) }));

  const recoveries = PENALTIES.map((p) => liquidateAndRecover(seed, p, Math.min(secs, 45 * 60)));
  log('recoveries');

  const chaos: ChaosResult[] = [];
  for (const p of o.chaosPenalties) for (let run = 0; run < o.chaosRuns; run++) chaos.push(chaosRun(seed, p, run));
  log('chaos');
  const targeted: SeedReport['targeted'] = [];
  for (const p of ['mild', 'none', 'hard'] as const) {
    targeted.push({ ...enginelessAtStation(seed, p), scenario: 'enginelessAtStation' });
    targeted.push({ ...spareEngineElsewhere(seed, p), scenario: 'spareEngineElsewhere' });
  }
  log('targeted');

  return {
    seed,
    wallMs: Date.now() - started,
    loops,
    baselines,
    recoveries,
    quotes: quoteSurvey(seed),
    partRewards: partRewardSurvey(seed),
    arbitrage: arbitrageSurvey(seed).slice(0, 5),
    chaos,
    targeted,
  };
}
