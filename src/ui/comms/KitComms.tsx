// Style guide (ui-kit.html): the communicator – a station's traffic control, a pirate's toll demand with
// the answers, a captain's taunt, the Echo with a journal link, the comm log.
import type { CommsHandlers, CommsLogItem, CommsPanelData } from '../../game/comms/commsUi';
import { captainSpeaker, echoSpeaker, pirateSpeaker, stationSpeaker } from '../../game/comms/speakers';
import { tx } from '../../i18n';
import { homeStation } from '../../sim/world/stations';
import { Panel } from '../theme';
import { CommLog, CommPanel } from './CommPanel';

const noop = (): void => {};
const ON: CommsHandlers = { dismiss: noop, toll: noop, closeLog: noop, click: noop };
const t = () => tx().comms;

const panel = (id: string, patch: Partial<CommsPanelData> & Pick<CommsPanelData, 'speaker' | 'lines'>): CommsPanelData => ({
  id,
  note: null,
  channel: 'station',
  journal: false,
  queued: 0,
  toll: null,
  docked: false,
  ...patch,
});

export function KitComms() {
  const traffic = stationSpeaker(homeStation(), t());
  const hammer = pirateSpeaker('hammer', t());
  const captain = captainSpeaker(1337, 4, t());
  const echo = echoSpeaker(false, t());
  const log: CommsLogItem[] = [
    { id: 'l3', tick: 9000, time: '2:30', speaker: captain, lines: [t().lines.captain.appear[0]!], channel: 'danger' },
    { id: 'l2', tick: 7000, time: '1:56', speaker: hammer, lines: [t().lines.pirate.tollPaid[0]!], note: 'Toll paid (650 cr) - they let you go', channel: 'danger' },
    { id: 'l1', tick: 4000, time: '1:06', speaker: echo, lines: [t().lines.echo.heard[0]!], note: 'Echo-0: heard from 1/3 places', channel: 'story', journal: true },
    { id: 'l0', tick: 600, time: '0:10', speaker: traffic, lines: [t().lines.station.undocked[0]!], channel: 'flavour' },
  ];
  return (
    <Panel material="band" cut="lg" as="section" class="kit-section">
      <h2 class="kit-h2">Communicator</h2>
      <p class="kit-note">
        The radio sits on the top edge of the flight console (bottom left when docked): a portrait in a recessed display with the voice colour on
        its lower edge, the role as a template label in the voice colour, the name, the speech types out quickly. Under the speech a quiet factual
        line (what used to be a toast). A side band in the voice colour, the enemy has warning stripes. “+N” = more messages waiting. The toll is
        answered right in the radio (Y / X as before). The log (L) keeps the last 30 messages.
      </p>
      <div class="cm-kit">
        <CommPanel d={panel('k1', { speaker: traffic, lines: [t().lines.station.rejected[2]!], note: 'Too far from the docking clamp: 7.0 u (need within 4 u)', queued: 2 })} on={ON} />
        <CommPanel
          d={panel('k2', {
            speaker: hammer,
            lines: [t().lines.pirate.tollDemand[2]!('650 cr')],
            channel: 'danger',
            toll: { amount: '650 cr', seconds: 14, fraction: 0.7, canPay: true, escape: 250 },
          })}
          on={ON}
        />
        <CommPanel d={panel('k3', { speaker: captain, lines: [t().lines.captain.fled[1]!], note: 'Korm “Reaper” fled and got promoted', channel: 'danger' })} on={ON} />
        <CommPanel d={panel('k4', { speaker: echo, lines: [t().lines.echo.journal[0]!], note: 'Journal: The tone near home (J)', channel: 'story', journal: true })} on={ON} />
        <CommLog items={log} docked={false} on={ON} />
      </div>
    </Panel>
  );
}
