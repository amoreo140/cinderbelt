// Style guide (ui-kit.html): contract slips in every state and the objective band (M3.5a).
import { ContractSlip, Button, Panel } from '../theme';
import { ObjectiveBand, type ObjectiveItem } from './Objectives';
import { SectorStrip } from './Board';

const BAND: ObjectiveItem[] = [
  { id: 'a', scale: 'now', trackName: 'Training', title: 'Mine 20 iron from the training rock', why: '', distance: 64, angle: 0.4, progress: { value: 12, max: 20 }, training: true },
  { id: 'b', scale: 'now', trackName: 'Contract', title: 'Deploy buoy 2/3 (F on the marker)', why: '', distance: 340, angle: 0.6, progress: { value: 1, max: 3 } },
];

export function KitCareer() {
  return (
    <Panel material="band" cut="lg" as="section" class="kit-section">
      <h2 class="kit-h2">Contracts and goals (M3.5a)</h2>
      <p class="kit-note">ContractSlip: a plate with a faction trim (Guild orange, Institute azure), the reward in a display, the risk as two slanted marks. State = a lamp + text.</p>
      <div class="kit-slips af-on-plate">
        <ContractSlip
          title="Deliver 45 Copper to Lyra-12 Harbour station"
          typeName="Delivery"
          factionName="Guild"
          faction="guild"
          emblem="assets/ui/emblems/cech.svg"
          reward={1840}
          rewardNote="incl. 252 cr for the goods"
          rep="+24 rep"
          meta="~7 min · 1,115 u"
          risk={1}
          riskLabel="Risk"
          tags={[{ text: '◷ Short', tone: 'info' }, { text: 'P2' }, { text: 'Ion season +25%', tone: 'warn' }]}
          state="offer"
          actions={<Button size="sm">Accept</Button>}
        />
        <ContractSlip
          title="Deploy 3 survey buoys in the area"
          typeName="Survey"
          factionName="Institute"
          faction="institute"
          emblem="assets/ui/emblems/institut.svg"
          reward={720}
          rep="+20 rep"
          part={{ partId: 'miningLaser', tier: 2 }}
          meta="~4 min · 340 u"
          risk={0}
          riskLabel="No risk"
          tags={[{ text: 'P1' }]}
          state="active"
          stateLabel="Active"
          next="Deploy buoy 2/3 (F on the marker)"
          progress={{ value: 1, max: 3 }}
          actions={
            <>
              <Button size="sm" variant="ghost">
                Cancel
              </Button>
              <Button size="sm" disabled reason="The objectives are not complete yet">
                Hand in
              </Button>
            </>
          }
        />
        <ContractSlip
          title="Destroy captain Korm “Widow”"
          typeName="Hunt"
          factionName="Guild"
          faction="guild"
          emblem="assets/ui/emblems/cech.svg"
          reward={26450}
          rewardNote="incl. 17,000 cr bounty"
          rep="+40 rep"
          meta="~14 min"
          risk={2}
          riskLabel="High risk"
          tags={[{ text: 'P2' }]}
          state="ready"
          stateLabel="Complete"
          next="Complete - hand in at any station"
          progress={{ value: 1, max: 1 }}
          actions={
            <Button size="sm" variant="primary">
              Hand in
            </Button>
          }
        />
        <ContractSlip
          compact
          title="Bring 18 u of fuel to a stranded trader"
          typeName="Rescue"
          factionName="Guild"
          faction="guild"
          emblem="assets/ui/emblems/cech.svg"
          reward={640}
          rep="+18 rep"
          meta="~3 min · 420 u"
          risk={0}
          riskLabel="No risk"
          state="active"
          stateLabel="Active"
          next="Fly to the stranded ship and hand over 18 u of fuel (F)"
        />
      </div>
      <div class="kit-band">
        <ObjectiveBand items={BAND} />
      </div>
      <SectorStrip
        sector={{
          minutesToChange: 12,
          modifiers: [
            { id: 'huntingGrounds', name: 'Hunting grounds', kind: 'warning', kindName: 'Warning', effect: 'Half again as many pirates.', bonus: 30 },
            { id: 'demand', name: 'Demand: Titanium', kind: 'market', kindName: 'Market', effect: 'Stations buy the resource 45% higher (up to 150 u).', bonus: 0 },
          ],
        }}
      />
    </Panel>
  );
}
