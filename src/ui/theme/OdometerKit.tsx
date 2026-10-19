// Style guide (ui-kit.html): the Odometer states (idle, value up, value down, slowed down for review,
// reduced motion, bare inside a Readout) and the ship rows of the Storages overview (kit fixture
// until the game layer fills `StoragesData.ships`).
import { useEffect, useState } from 'preact/hooks';
import type { StorageShipRow } from '../../game/fleet/types';
import { StorageShips } from '../board/StoragesView';
import { Readout } from './Meters';
import { Odometer } from './Odometer';
import { Panel } from './Panel';

const UP = [1240, 1275, 1310, 1990, 9996, 10012, 10400];
const DOWN = [10400, 5400, 5395, 990, 250];

/** Steps through `values` every `ms` (wraps around). */
function useCycle(values: readonly number[], ms: number): number {
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI((x) => (x + 1) % values.length), ms);
    return () => clearInterval(id);
  }, [values, ms]);
  return values[i]!;
}

const SHIPS: StorageShipRow[] = [
  { id: 1, name: 'Spark', generated: true, active: true, stationId: 'home', stationName: 'Origin Base', here: true, tierLabel: 'T1 miner', hullPoints: 18 },
  { id: 3, name: 'Hammer II', generated: false, active: false, stationId: 'home', stationName: 'Origin Base', here: true, tierLabel: 'T2 fighter', hullPoints: 31 },
  { id: 2, name: 'Falcon', generated: true, active: false, stationId: 'lyra-12', stationName: 'Lyra-12 Outpost', here: false, tierLabel: 'T1 freighter', hullPoints: 22 },
];

function KitRow({ label, children }: { label: string; children: preact.ComponentChildren }) {
  return (
    <div class="kit-row">
      <span class="kit-row-label af-label">{label}</span>
      <div class="kit-row-body">{children}</div>
    </div>
  );
}

export function OdometerKit() {
  const up = useCycle(UP, 1400);
  const down = useCycle(DOWN, 1700);
  const slow = useCycle(UP, 2200);
  return (
    <Panel material="band" cut="lg" as="section" class="kit-section" testId="kit-odometer">
      <h2 class="kit-h2">Odometer and ships in the storages</h2>
      <p class="kit-note">
        Credits change digits in a step: a changed digit snaps to the new value in one clamp step (from above on a rise, from below on a fall), with no
        springing and no counting down. The other digits stand still, the width does not move (tabular figures). Reduced motion = the new value at once.
      </p>
      <KitRow label="Idle">
        <Odometer value={128450} />
      </KitRow>
      <KitRow label="Rising">
        <Odometer value={up} testId="kit-odo-up" />
      </KitRow>
      <KitRow label="Falling">
        <Odometer value={down} testId="kit-odo-down" />
      </KitRow>
      <KitRow label="Slowed down (review)">
        <span style={{ '--af-dur-clamp': '1600ms' }}>
          <Odometer value={slow} />
        </span>
      </KitRow>
      <KitRow label="Reduced motion">
        <span data-reduced-motion="">
          <Odometer value={up} />
        </span>
      </KitRow>
      <KitRow label="Without a label">
        <Panel material="screen" class="kit-gauges">
          <Readout value={<Odometer variant="bare" value={up} />} unit="u" label="Distance" />
        </Panel>
      </KitRow>
      <Panel material="plate" cut="sm" class="af-on-plate" style={{ padding: '0.6rem 1rem', marginTop: '0.8rem' }}>
        <StorageShips ships={SHIPS} />
      </Panel>
    </Panel>
  );
}
