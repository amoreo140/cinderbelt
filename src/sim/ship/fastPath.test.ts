import { describe, expect, it } from 'vitest';
import { CAPTAIN_MAX_LEVEL } from '../../data/captains';
import type { PartId, Tier } from '../../data/parts';
import type { VariantId } from '../../data/variants';
import { captainGrid } from '../captains/captains';
import { ENEMY_TEMPLATES } from '../combat/enemies';
import type { EnemyKind } from '../combat/types';
import { hullPoints } from './budget';
import { hullHp } from './hp';
import { createStarterShip } from './presets';
import { computeProperties } from './properties';
import type { Rotation, ShipGrid } from './types';

// SL2 E2 fast path: a grid without shapes must give exactly
// the numbers it gave before shapes existed. The values below were recorded with the pre-E2 code (commit
// 93495f3) and are compared with exact equality – never re-record them to make this test pass.
// The fixture grids are copied in (not read from tests/fixtures/saves), so regenerating the fixtures does
// not change this test.

/** [id, partId, tier, x, y, rot, variant?] */
type GridRow = [number, PartId, Tier, number, number, Rotation, VariantId?];

const gridOf = (rows: readonly GridRow[]): ShipGrid => ({
  parts: rows.map(([id, partId, tier, x, y, rot, variant]) => ({ id, partId, tier, x, y, rot, ...(variant ? { variant } : {}) })),
  nextId: Math.max(...rows.map((r) => r[0])) + 1,
});

/** Every distinct grid in the fixture saves (player, respawn, fleet, blueprints, enemies, wrecks). */
const FIXTURE_GRIDS: readonly [string, readonly GridRow[]][] = [
  ["after-training.player.grid", [[1,'cockpit',1,1,0,0],[2,'miningLaser',1,2,0,0],[3,'cargo',1,0,0,0],[4,'fuelTank',1,-1,0,0],[5,'engine',1,-2,0,0],[6,'engine',1,2,1,2],[7,'engine',1,0,-1,1],[8,'engine',1,0,1,3],[9,'engine',1,2,-1,2],[10,'cargo',1,1,1,0],[11,'reactor',1,1,-1,0],[12,'radar',1,-1,-1,0],[13,'gyro',1,-1,1,0],[14,'engine',1,-2,1,0]]],
  ["cargo-full.player.grid", [[3,'cargo',1,0,0,0],[4,'fuelTank',1,-1,0,0],[5,'engine',1,-2,0,0],[6,'engine',1,2,1,2],[7,'engine',1,0,-1,1],[8,'engine',1,0,1,3],[9,'engine',1,2,-1,2],[10,'cargo',1,1,1,0],[11,'reactor',1,1,-1,0],[12,'radar',1,-1,-1,0],[13,'gyro',1,-1,1,0],[14,'engine',1,-2,1,0],[15,'armor',1,1,2,0],[16,'armor',1,-1,2,0],[17,'cargo',1,1,-2,0],[18,'reactor',1,2,2,0],[19,'miningLaser',1,3,2,0],[20,'fuelTank',1,1,3,0],[21,'reactor',1,2,3,0],[22,'cannon',1,-1,3,0],[23,'cannon',1,-2,2,0],[24,'shield',1,-2,-1,0],[25,'miningLaser',2,2,0,0],[26,'reactor',1,-1,-2,0],[27,'miningLaser',1,3,3,0],[28,'cargo',1,2,-2,0],[29,'cargo',1,-2,3,0],[30,'cockpit',2,1,0,0]]],
  ["cargo-full.combat.enemies[0].grid", [[1,'cockpit',1,1,0,0],[2,'tractorBeam',1,2,0,0],[3,'gyro',1,1,2,0],[4,'fuelTank',1,0,0,0],[5,'cargo',1,0,1,0],[6,'cargo',1,0,-1,0],[7,'reactor',1,-1,0,0],[8,'engine',1,-2,0,0],[9,'engine',1,-1,1,0],[10,'engine',1,-1,-1,0],[11,'engine',1,0,2,3],[12,'engine',1,0,-2,1],[13,'engine',1,1,1,2],[14,'engine',1,1,-1,2]]],
  ["cargo-full.combat.enemies[1].grid", [[1,'cockpit',1,0,0,0],[2,'cannon',1,1,0,0],[3,'engine',1,-1,0,0],[4,'engine',1,0,1,3],[5,'engine',1,0,-1,1],[6,'engine',1,1,1,2],[7,'engine',1,1,-1,2]]],
  ["cargo-full.combat.wrecks[0].grid", [[1,'cockpit',1,2,0,0],[2,'cargo',1,1,0,0],[3,'cargo',1,1,1,0],[6,'cargo',1,0,-1,0],[7,'reactor',1,0,0,0],[8,'fuelTank',1,-1,1,0],[9,'fuelTank',1,-1,-1,0],[10,'engine',1,-1,0,0],[11,'engine',1,-2,1,0],[13,'armor',1,3,0,0]]],
  ["comet.player.grid", [[3,'cargo',1,0,0,0],[4,'fuelTank',1,-1,0,0],[5,'engine',1,-2,0,0],[6,'engine',1,2,1,2],[7,'engine',1,0,-1,1],[8,'engine',1,0,1,3],[9,'engine',1,2,-1,2],[10,'cargo',1,1,1,0],[12,'radar',1,-1,-1,0],[13,'gyro',1,-1,1,0],[14,'engine',1,-2,1,0],[15,'armor',1,1,2,0],[16,'armor',1,-1,2,0],[17,'cargo',1,1,-2,0],[20,'fuelTank',1,1,3,0],[22,'cannon',1,-1,3,0],[23,'cannon',1,-2,2,0],[25,'miningLaser',2,2,0,0],[26,'reactor',1,-1,-2,0],[28,'cargo',1,2,-2,0],[29,'cargo',1,-2,3,0],[30,'cockpit',2,1,0,0],[31,'reactor',2,1,-1,0],[32,'reactor',2,2,2,0],[33,'reactor',2,2,3,0],[34,'miningLaser',2,3,2,0],[35,'miningLaser',2,3,3,0],[36,'miningLaser',2,3,-2,0],[37,'shield',1,-2,-1,0]]],
  ["damaged.player.grid", [[4,'fuelTank',1,-1,0,0],[5,'engine',1,-2,0,0],[6,'engine',1,2,1,2],[7,'engine',1,0,-1,1],[8,'engine',1,0,1,3],[9,'engine',1,2,-1,2],[10,'cargo',1,1,1,0],[11,'reactor',1,1,-1,0],[12,'radar',1,-1,-1,0],[13,'gyro',1,-1,1,0],[14,'engine',1,-2,1,0],[15,'armor',1,1,2,0],[16,'armor',1,-1,2,0],[17,'cargo',1,1,-2,0],[18,'reactor',1,2,2,0],[20,'fuelTank',1,1,3,0],[21,'reactor',1,2,3,0],[22,'cannon',1,-1,3,0],[23,'cannon',1,-2,2,0],[24,'shield',1,-2,-1,0],[25,'miningLaser',2,2,0,0],[26,'reactor',1,-1,-2,0],[27,'miningLaser',1,3,3,0],[28,'cargo',1,2,-2,0],[29,'cargo',1,-2,3,0],[30,'cockpit',2,1,0,0]]],
  ["dock-approach.player.grid", [[1,'cockpit',1,1,0,0],[2,'gyro',1,0,0,0],[3,'miningLaser',1,2,0,0],[4,'reactor',1,-1,0,0],[5,'cargo',1,0,1,0],[6,'cargo',1,0,-1,0],[7,'fuelTank',1,1,1,0],[8,'radar',1,1,-1,0],[9,'engine',1,-1,1,0],[10,'engine',1,-1,-1,0],[11,'engine',1,2,1,2],[12,'engine',1,2,-1,2],[13,'engine',1,0,-2,1],[14,'engine',1,0,2,3]]],
  ["fortress.combat.wrecks[0].grid", [[1,'cockpit',1,2,0,0],[2,'cargo',1,1,0,0],[3,'cargo',1,1,1,0],[4,'cargo',1,1,-1,0],[5,'cargo',1,0,1,0],[8,'fuelTank',1,-1,1,0],[9,'fuelTank',1,-1,-1,0],[10,'engine',1,-1,0,0],[12,'engine',1,-2,-1,0],[13,'armor',1,3,0,0]]],
  ["graveyard.combat.enemies[0].grid", [[1,'cockpit',1,1,0,0],[2,'armor',1,2,0,0],[3,'armor',1,1,1,0],[4,'armor',1,1,-1,0],[5,'cannon',1,2,1,0],[6,'cannon',1,2,-1,0],[7,'shield',1,0,0,0],[8,'reactor',1,-1,0,0],[9,'gyro',1,0,1,0],[10,'fuelTank',1,0,-1,0],[11,'engine',1,-2,0,0],[12,'engine',1,-1,1,0],[13,'engine',1,-1,-1,0],[14,'engine',1,0,2,3],[15,'engine',1,0,-2,1],[16,'engine',1,1,2,2],[17,'engine',1,1,-2,2]]],
  ["graveyard.combat.enemies[2].grid", [[1,'cockpit',1,1,0,0],[2,'cannon',2,3,1,0],[3,'cannon',2,3,0,0],[4,'cannon',2,3,-1,0],[5,'armor',1,2,1,0],[6,'armor',1,2,0,0],[7,'armor',1,2,-1,0],[8,'gyro',1,1,1,0],[9,'shield',1,1,-1,0],[10,'reactor',1,0,0,0],[11,'reactor',1,-1,0,0],[12,'fuelTank',1,0,1,0],[13,'fuelTank',1,0,-1,0],[14,'engine',1,-1,1,0],[15,'engine',1,-1,-1,0],[16,'engine',1,1,2,2],[17,'engine',1,1,-2,2],[18,'engine',1,0,2,3],[19,'engine',1,0,-2,1],[20,'armor',1,-1,2,0],[21,'armor',1,-1,-2,0]]],
  ["graveyard.combat.wrecks[0].grid", [[1,'cockpit',2,0,0,0],[3,'engine',2,-1,0,0],[4,'engine',2,0,1,3],[5,'engine',2,0,-1,1],[6,'engine',2,1,1,2]]],
  ["graveyard.combat.wrecks[1].grid", [[1,'cockpit',2,1,0,0],[2,'armor',2,2,0,0],[3,'armor',2,1,1,0],[4,'armor',2,1,-1,0],[5,'cannon',2,2,1,0],[6,'cannon',2,2,-1,0],[7,'shield',2,0,0,0],[8,'reactor',2,-1,0,0],[9,'gyro',2,0,1,0],[10,'fuelTank',2,0,-1,0],[12,'engine',2,-1,1,0],[13,'engine',2,-1,-1,0],[14,'engine',2,0,2,3],[15,'engine',2,0,-2,1],[16,'engine',2,1,2,2],[17,'engine',2,1,-2,2]]],
  ["graveyard.combat.wrecks[2].grid", [[1,'cockpit',2,1,0,0],[2,'armor',2,2,0,0],[3,'armor',2,1,1,0],[5,'cannon',2,2,1,0],[7,'shield',2,0,0,0],[8,'reactor',2,-1,0,0],[9,'gyro',2,0,1,0],[10,'fuelTank',2,0,-1,0],[11,'engine',2,-2,0,0],[12,'engine',2,-1,1,0],[13,'engine',2,-1,-1,0],[14,'engine',2,0,2,3],[15,'engine',2,0,-2,1],[17,'engine',2,1,-2,2]]],
  ["graveyard.combat.wrecks[3].grid", [[1,'cockpit',2,1,0,0],[2,'armor',2,2,0,0],[3,'armor',2,1,1,0],[4,'armor',2,1,-1,0],[5,'cannon',2,2,1,0],[6,'cannon',2,2,-1,0],[7,'shield',2,0,0,0],[8,'reactor',2,-1,0,0],[9,'gyro',2,0,1,0],[10,'fuelTank',2,0,-1,0],[11,'engine',2,-2,0,0],[12,'engine',2,-1,1,0],[13,'engine',2,-1,-1,0],[14,'engine',2,0,2,3],[15,'engine',2,0,-2,1],[16,'engine',2,1,2,2],[17,'engine',2,1,-2,2]]],
  ["graveyard.combat.wrecks[4].grid", [[1,'cockpit',2,1,0,0],[2,'armor',2,2,0,0],[4,'armor',2,1,-1,0],[5,'cannon',2,2,1,0],[6,'cannon',2,2,-1,0],[7,'shield',2,0,0,0],[8,'reactor',2,-1,0,0],[9,'gyro',2,0,1,0],[10,'fuelTank',2,0,-1,0],[11,'engine',2,-2,0,0],[12,'engine',2,-1,1,0],[13,'engine',2,-1,-1,0],[14,'engine',2,0,2,3],[15,'engine',2,0,-2,1],[16,'engine',2,1,2,2],[17,'engine',2,1,-2,2]]],
  ["graveyard.combat.wrecks[5].grid", [[1,'cockpit',2,0,0,0],[4,'engine',2,0,1,3],[5,'engine',2,0,-1,1],[6,'engine',2,1,1,2]]],
  ["gunner.combat.wrecks[0].grid", [[1,'cockpit',2,1,0,0],[2,'armor',2,2,0,0],[3,'armor',2,1,1,0],[4,'armor',2,1,-1,0],[5,'cannon',2,2,1,0],[6,'cannon',2,2,-1,0],[7,'shield',2,0,0,0],[8,'reactor',2,-1,0,0],[9,'gyro',2,0,1,0],[10,'fuelTank',2,0,-1,0],[11,'engine',2,-2,0,0],[14,'engine',2,0,2,3],[15,'engine',2,0,-2,1],[16,'engine',2,1,2,2],[17,'engine',2,1,-2,2]]],
  ["gunner.combat.wrecks[1].grid", [[1,'cockpit',1,1,0,0],[2,'gyro',1,0,0,0],[3,'miningLaser',1,2,0,0],[4,'reactor',1,-1,0,0],[5,'cargo',1,0,1,0],[6,'cargo',1,0,-1,0],[7,'fuelTank',1,1,1,0],[10,'engine',1,-1,-1,0],[11,'engine',1,2,1,2],[12,'engine',1,2,-1,2],[13,'engine',1,0,-2,1],[14,'engine',1,0,2,3]]],
  ["hangar.fleet.stored[0].grid", [[1,'cockpit',2,0,0,0],[2,'armor',2,1,0,0],[3,'cannon',2,1,1,0],[4,'cannon',2,1,-1,0],[5,'gyro',1,-1,0,0],[6,'reactor',2,0,1,0],[7,'reactor',2,0,-1,0],[8,'shield',2,-1,1,0],[9,'fuelTank',1,-1,-1,0],[10,'engine',2,-2,0,0],[11,'engine',2,-2,1,0],[12,'engine',2,-2,-1,0],[13,'engine',1,0,2,3],[14,'engine',1,0,-2,1],[15,'engine',1,1,2,2],[16,'engine',1,1,-2,2]]],
  ["training-mid.player.grid", [[1,'cockpit',1,1,0,0],[2,'miningLaser',1,2,0,0],[3,'cargo',1,0,0,0],[4,'fuelTank',1,-1,0,0],[5,'engine',1,-2,0,0],[6,'engine',1,2,1,2]]],
  ["wreck-salvage.combat.wrecks[0].grid", [[1,'cockpit',1,2,0,0],[2,'cargo',1,1,0,0],[3,'cargo',1,1,1,0],[7,'reactor',1,0,0,0],[8,'fuelTank',1,-1,1,0],[9,'fuelTank',1,-1,-1,0],[10,'engine',1,-1,0,0],[11,'engine',1,-2,1,0]]],
];

const KINDS = Object.keys(ENEMY_TEMPLATES) as EnemyKind[];
const TIERS: readonly Tier[] = [1, 2];

function allGrids(): [string, ShipGrid][] {
  const out: [string, ShipGrid][] = [['starter', createStarterShip()]];
  for (const kind of KINDS) for (const tier of TIERS) out.push([`enemy:${kind}:${tier}`, ENEMY_TEMPLATES[kind](tier)]);
  for (let level = 1; level <= CAPTAIN_MAX_LEVEL; level++) out.push([`captain:${level}`, captainGrid(level)]);
  for (const [name, rows] of FIXTURE_GRIDS) out.push([`fixture:${name}`, gridOf(rows)]);
  return out;
}

/** [mass, centre of mass x, y, inertia, bounding radius, hull points, max hull HP]. */
type Fingerprint = [number, number, number, number, number, number, number];

function fingerprint(grid: ShipGrid): Fingerprint {
  const p = computeProperties(grid);
  return [p.mass, p.centerOfMass.x, p.centerOfMass.y, p.inertia, p.boundingRadius, hullPoints(grid), hullHp(grid, new Map()).max];
}

const RECORDED: Record<string, Fingerprint> = {
  'starter': [25, 0.38, 0.02, 54.54666666666667, 2.762538609294695, 14, 390],
  'enemy:jackal:1': [13, 0.23076923076923078, 0, 13.474358974358974, 1.968739047867834, 7, 215],
  'enemy:jackal:2': [10.399999999999999, 0.23076923076923078, 0, 10.77948717948718, 1.968739047867834, 7, 377],
  'enemy:hammer:1': [32, 0.375, 0.015625, 81.32552083333334, 3.082158178656716, 17, 525],
  'enemy:hammer:2': [25.599999999999994, 0.37500000000000006, 0.015625, 65.06041666666667, 3.082158178656716, 17, 918],
  'enemy:scavenger:1': [25.5, 0.11764705882352941, 0.1568627450980392, 59.26960784313726, 2.8671756994485724, 14, 400],
  'enemy:scavenger:2': [20.399999999999995, 0.1176470588235294, 0.1568627450980392, 47.41568627450981, 2.8671756994485724, 14, 700],
  'enemy:gunner:1': [39.6, 0.6010101010101009, 0, 126.09595959595958, 3.30617440929005, 21, 726],
  'enemy:gunner:2': [32.39999999999999, 0.6543209876543211, 0, 105.52839506172842, 3.302637156696256, 21, 1153],
  'enemy:sentry:1': [10.5, 0, -0.047619047619047616, 8.226190476190476, 1.7547258288055954, 5, 180],
  'enemy:sentry:2': [8.4, 0, -0.04761904761904763, 6.580952380952381, 1.7547258288055954, 5, 315],
  'captain:1': [32, 0.375, 0.015625, 81.32552083333334, 3.082158178656716, 17, 535],
  'captain:2': [44, 0.5909090909090909, 0.2159090909090909, 168.41856060606065, 3.5210928440488836, 23, 745],
  'captain:3': [44.800000000000004, 0.8928571428571428, 0.2767857142857143, 231.1202380952381, 4.023551294393979, 29, 1685],
  'captain:4': [54.40000000000001, 0.8088235294117644, 0.007352941176470609, 347.47549019607845, 4.216524720582823, 35, 2051],
  'captain:5': [64.00000000000001, 0.8624999999999996, 0.03125000000000002, 509.79416666666674, 5.147814248752949, 41, 2453],
  'fixture:after-training.player.grid': [25, 0.28, 0.04, 60.166666666666664, 3.180970156557144, 14, 390],
  'fixture:cargo-full.player.grid': [50.900000000000006, 0.35559921414538304, 0.6679764243614931, 270.8357891290111, 4.232895979871336, 28, 874],
  'fixture:cargo-full.combat.enemies[0].grid': [25.5, 0.11764705882352941, 0.1568627450980392, 59.26960784313726, 2.8671756994485724, 14, 400],
  'fixture:cargo-full.combat.enemies[1].grid': [13, 0.23076923076923078, 0, 13.474358974358974, 1.968739047867834, 7, 215],
  'fixture:cargo-full.combat.wrecks[0].grid': [19.5, 0.48717948717948717, 0.07692307692307693, 53.506410256410255, 3.3600547277854957, 10, 310],
  'fixture:comet.player.grid': [49.70000000000001, 0.34004024144869205, 0.5573440643863177, 271.0982226693494, 4.397011194686207, 29, 1022],
  'fixture:damaged.player.grid': [47.900000000000006, 0.2839248434237996, 0.6471816283924843, 256.05932498260273, 4.300547826472288, 26, 819],
  'fixture:dock-approach.player.grid': [25, 0.38, 0.02, 54.54666666666667, 2.762538609294695, 14, 390],
  'fixture:fortress.combat.wrecks[0].grid': [18, 0.6111111111111112, 0, 54.27777777777777, 3.5031577883335743, 10, 310],
  'fixture:graveyard.combat.enemies[0].grid': [32, 0.375, 0.015625, 81.32552083333334, 3.082158178656716, 17, 525],
  'fixture:graveyard.combat.enemies[2].grid': [39.6, 0.6010101010101009, 0, 126.09595959595958, 3.30617440929005, 21, 726],
  'fixture:graveyard.combat.wrecks[0].grid': [8, 0, 0.15, 7.153333333333332, 2.019547256027216, 5, 281],
  'fixture:graveyard.combat.wrecks[1].grid': [24.399999999999995, 0.4918032786885247, 0.01639344262295082, 57.75846994535519, 2.7865553674720003, 16, 874],
  'fixture:graveyard.combat.wrecks[2].grid': [21.599999999999998, 0.2037037037037037, 0.037037037037037035, 51.87407407407409, 2.9111216985203443, 14, 752],
  'fixture:graveyard.combat.wrecks[3].grid': [25.599999999999994, 0.37500000000000006, 0.015625, 65.06041666666667, 3.082158178656716, 17, 918],
  'fixture:graveyard.combat.wrecks[4].grid': [23.999999999999996, 0.33333333333333337, -0.05, 62.47333333333334, 3.040975767321897, 16, 848],
  'fixture:graveyard.combat.wrecks[5].grid': [6.800000000000001, 0.1764705882352941, 0.1764705882352941, 5.509803921568627, 1.8967390409604703, 4, 237],
  'fixture:gunner.combat.wrecks[0].grid': [23.199999999999996, 0.5172413793103449, 0.017241379310344827, 57.25287356321839, 3.224407205623958, 15, 830],
  'fixture:gunner.combat.wrecks[1].grid': [22.5, 0.4444444444444444, 0, 48.30555555555556, 2.755894438362745, 12, 350],
  'fixture:hangar.fleet.stored[0].grid': [26.7, -0.19850187265917607, 0.0037453183520599286, 66.59756554307117, 3.041930551749403, 16, 717],
  'fixture:training-mid.player.grid': [11.5, 0.4782608695652174, 0.13043478260869565, 24.090579710144926, 3.188797771243997, 6, 185],
  'fixture:wreck-salvage.combat.wrecks[0].grid': [16, 0.21875, 0.1875, 36.838541666666664, 3.0699457119010383, 8, 240],
};

// −0 and 0 count as equal (the recording went through JSON)
const normalised = (f: Fingerprint): Fingerprint => f.map((v) => v + 0) as Fingerprint;

describe('fast path: grids without shapes are unchanged by SL2 E2', () => {
  const grids = allGrids();

  it('covers every recorded grid and nothing else', () => {
    expect(grids.map(([name]) => name).sort()).toEqual(Object.keys(RECORDED).sort());
  });

  for (const [name, grid] of grids) {
    it(`${name}: mass, centre of mass, inertia, radius, hull points and HP are bit-identical`, () => {
      expect(normalised(fingerprint(grid))).toEqual(normalised(RECORDED[name]!));
    });
  }
});
