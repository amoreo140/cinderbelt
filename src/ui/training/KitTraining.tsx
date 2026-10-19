// Style guide (ui-kit.html): the Guild Training layer (M3.7) – the step panel in flight, the
// checklist step, the shipyard step with the highlight clamp and a suggested cell, the done card.
import type { TrainingHandlers, TrainingUiData } from '../../game/training/trainingUi';
import type { TrainingGuide } from '../../game/training/trainingView';
import { tx } from '../../i18n';
import { Button, Panel } from '../theme';
import { TrainingLayer } from './TrainingLayer';

const noop = (): void => {};
const ON: TrainingHandlers = { skip: noop, confirmSkip: noop, cancelSkip: noop, toggle: noop, closeDone: noop };

const base = (patch: Partial<TrainingGuide>): TrainingGuide => ({
  index: 1,
  total: 9,
  stepLabel: tx().training.stepOf(2, 9),
  title: 'Mine 20 iron from the training rock',
  why: '',
  lines: [{ keys: ['Right button'], text: 'hold the cursor on the rock - the laser mines' }],
  note: 'Aim at the glowing vein: it mines half again as fast.',
  progress: { value: 12, max: 20 },
  reward: tx().training.reward('100 cr'),
  highlight: [],
  cells: [],
  ...patch,
});

const data = (guide: TrainingGuide | null, patch: Partial<TrainingUiData> = {}): TrainingUiData => ({
  guide,
  cells: [],
  confirmSkip: false,
  collapsed: false,
  done: false,
  docked: false,
  yard: false,
  ...patch,
});

function Stage({ label, children }: { label: string; children: preact.ComponentChildren }) {
  return (
    <div class="kit-tr-stage">
      <span class="af-label kit-tr-label">{label}</span>
      {children}
    </div>
  );
}

export function KitTraining() {
  return (
    <Panel material="band" cut="lg" as="section" class="kit-section">
      <h2 class="kit-h2">Guild Training (M3.7)</h2>
      <p class="kit-note">
        The step panel: a dark band with an orange trim (the screen's one bold touch), a track of 9 steps as slanted segments (done orange, current azure),
        instructions with keycaps, a progress display, the reward. Highlight: an orange clamp around the element with a “HERE” label, suggested cells in the hangar green
        and dashed; with reduced motion, no pulsing.
      </p>
      <div class="kit-tr-grid">
        <Stage label="In flight - mining">
          <TrainingLayer d={data(base({}))} on={ON} />
        </Stage>
        <Stage label="Checklist">
          <TrainingLayer
            d={data(
              base({
                index: 7,
                stepLabel: tx().training.stepOf(8, 9),
                title: 'Refuel and look at the map and objectives',
                lines: [
                  { keys: [], text: 'Refuel to full', done: true },
                  { keys: ['M'], text: 'Open the map', done: false },
                  { keys: ['G'], text: 'Open the objectives', done: true },
                ],
                note: 'The map opens in flight - undock and press M.',
                progress: null,
                reward: tx().training.reward('1× Reactor T1, 1× Radar T1, 1× Gyroscope T1 · 150 cr'),
              }),
              { docked: true },
            )}
            on={ON}
          />
        </Stage>
        <Stage label="Shipyard - highlighted element">
          <div class="kit-tr-target">
            <Button variant="primary" testId="kit-training-target">
              Confirm changes
            </Button>
          </div>
          <TrainingLayer
            d={data(
              base({
                index: 3,
                stepLabel: tx().training.stepOf(4, 9),
                title: 'Fit 2 side engines',
                lines: [{ keys: ['Enter'], text: 'Confirm the changes' }],
                note: null,
                progress: { value: 1, max: 2 },
                highlight: ['[data-testid="kit-training-target"]'],
              }),
              { docked: true },
            )}
            on={ON}
          />
        </Stage>
        <Stage label="Done">
          <TrainingLayer d={data(null, { done: true, docked: true })} on={ON} />
        </Stage>
      </div>
    </Panel>
  );
}
