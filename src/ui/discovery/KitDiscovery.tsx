// Style guide (ui-kit.html): the M3.5b discovery components - KnowledgeGraph (every node state),
// Callout (info, warning, with analysis progress, with a key) and the scanner in the HUD.
import { useState } from 'preact/hooks';
import { CalloutLayer, KnowledgeGraph, Panel, type GraphNodeItem } from '../theme';
import { ScanWidget } from './ScanHud';
import type { ScanHudData } from '../../game/discovery/exploreUi';

const NODES: GraphNodeItem[] = [
  { id: 'scanner', title: 'Scanner', kindLabel: 'Topic', kind: 'topic', known: true, more: true, col: 0, row: 1 },
  { id: 'echo0Heard', title: 'The tone near home', kindLabel: 'Topic', kind: 'topic', known: true, more: false, col: 1, row: 0 },
  { id: 'echo0', title: 'Echo-0', kindLabel: 'Place', kind: 'place', known: true, more: true, col: 2, row: 0 },
  { id: 'ruleSling', title: 'Observation: sling', kindLabel: 'Observation', kind: 'observation', known: true, more: false, col: 2, row: 1 },
  { id: 'echo1', title: '?', kindLabel: 'Place', kind: 'place', known: false, more: false, col: 3, row: 0 },
  { id: 'anomalies', title: 'Anomalies', kindLabel: 'Topic', kind: 'topic', known: true, more: false, col: 1, row: 1 },
];
const EDGES: [string, string][] = [
  ['scanner', 'echo0Heard'],
  ['echo0Heard', 'echo0'],
  ['echo0', 'echo1'],
  ['scanner', 'anomalies'],
  ['anomalies', 'ruleSling'],
];

const SCAN: ScanHudData = { charge: 0.6, ready: false, cooldown: 3, analysis: null, pulse: null, dataFund: 135, buffs: [], storm: false };

export function KitDiscovery() {
  const [selected, setSelected] = useState<string>('echo0');
  return (
    <Panel material="band" cut="lg" as="section" class="kit-section">
      <h2 class="kit-h2">Discoveries (M3.5b)</h2>
      <p class="kit-note">
        KnowledgeGraph: a display, nodes = small plates (a place has an orange top edge, an observation an amber side edge), ✱ = an info lamp, ? = an unknown node,
        edges with a clue arrowhead. Callout: a label with a 1 px leader line at an object in the world, at most two at a time.
      </p>
      <div style={{ height: '200px', display: 'flex' }}>
        <KnowledgeGraph nodes={NODES} edges={EDGES} selected={selected} onSelect={setSelected} label="Knowledge graph" moreLabel="there is more here" unknownLabel="unknown" />
      </div>
      <div class="kit-callouts" style={{ position: 'relative', height: '150px', marginTop: '0.8rem', background: '#060b14' }}>
        <CalloutLayer
          items={[
            { id: 'kit-a', x: 40, y: 120, title: 'Anomaly · Ion', detail: 'Core flyby: Ion charge', keys: 'Tab', action: 'analyse', tone: 'info' },
            { id: 'kit-b', x: 330, y: 120, title: 'Giant asteroid', detail: 'Analysis 64%', tone: 'warn', progress: 0.64 },
          ]}
        />
      </div>
      <div class="kit-scan">
        <ScanWidget d={SCAN} />
      </div>
    </Panel>
  );
}
