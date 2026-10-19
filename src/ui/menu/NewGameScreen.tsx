import { useMemo, useState } from 'preact/hooks';
import { defaultNewGameSlot, formatPlayTime, formatSavedAt, newGameSlots, slotWritable, type SlotCell } from '../../game/save/slotView';
import { formatFactor } from '../format';
import { sameSlot } from '../../game/storage/slots';
import { tx } from '../../i18n';
import type { SlotRef } from '../../sim/save/types';
import {
  DEATH_PENALTIES,
  DIFFICULTY_PRESET_IDS,
  DIFFICULTY_PRESETS,
  ENEMY_DENSITIES,
  matchingPreset,
  MINING_YIELDS,
  type DeathPenalty,
  type DifficultyChoice,
  type DifficultyPresetId,
} from '../../sim/settings';
import { Button, Lamp, Modal, Panel, Segmented } from '../theme';
import { Sheet } from './Sheet';
import type { OverlayData, OverlayHandlers } from './types';

const t = () => tx().app.newGame;
const yieldLabel = (y: number) => formatFactor(y);

/** Arrow keys in an option group (role=radiogroup) – move and select at once. */
function radioKeys(e: KeyboardEvent): void {
  if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
  const group = e.currentTarget as HTMLElement;
  const items = [...group.querySelectorAll<HTMLElement>('[role="radio"]:not([aria-disabled="true"])')];
  const i = items.indexOf(document.activeElement as HTMLElement);
  if (i < 0) return;
  e.preventDefault();
  const dir = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1;
  const next = items[(i + dir + items.length) % items.length]!;
  next.focus();
  next.click();
}

function slotStateText(cell: SlotCell): { text: string; tone: '' | 'is-warn' | 'is-bad' | 'is-ok' } {
  const s = cell.state;
  if (!s) return { text: t().slotFree, tone: 'is-ok' };
  if (s.kind === 'tooNew') return { text: t().slotLocked, tone: 'is-bad' };
  if (s.kind === 'corrupt') return { text: t().slotCorrupt, tone: 'is-bad' };
  return { text: t().slotOverwrite, tone: 'is-warn' };
}

export function NewGameScreen({ data, on }: { data: OverlayData; on: OverlayHandlers }) {
  const [choice, setChoice] = useState<DifficultyChoice>(() =>
    data.newGameSlot ? { ...DIFFICULTY_PRESETS[presetFor(data.newGameSlot.difficulty)] } : { ...DIFFICULTY_PRESETS.standard },
  );
  const [seed, setSeed] = useState('');
  const [placeholder, setPlaceholder] = useState(() => on.randomSeed());
  const [picked, setPicked] = useState<SlotRef | null>(data.newGameSlot);
  const [confirm, setConfirm] = useState(false);
  const [skipTraining, setSkipTraining] = useState(data.skipTraining);

  const overview = data.slots ?? [];
  const cells = useMemo(() => newGameSlots(overview, choice.deathPenalty), [overview, choice.deathPenalty]);
  // the chosen slot applies only within its difficulty; otherwise the default one (the first free)
  const slot = picked && picked.difficulty === choice.deathPenalty ? picked : defaultNewGameSlot(cells);
  const cell = slot ? cells.find((c) => sameSlot(c.slot, slot)) : undefined;
  const preset = matchingPreset(choice);

  const update = (patch: Partial<DifficultyChoice>) => {
    on.click();
    setChoice((c) => ({ ...c, ...patch }));
  };
  const usePreset = (id: DifficultyPresetId) => {
    on.click();
    setChoice({ ...DIFFICULTY_PRESETS[id] });
  };

  const seedText = seed.trim() || placeholder;
  const start = () => {
    if (!slot || !cell || !slotWritable(cell) || data.slots === null) return;
    if (cell.state && !confirm) {
      setConfirm(true);
      return;
    }
    setConfirm(false);
    on.click();
    on.newGame({ slot, seedText, choice, skipTraining });
  };
  const blocked = !slot || !cell || !slotWritable(cell);
  const occupied = cell?.state?.kind === 'ok' ? cell.state.meta : (cell?.state?.meta ?? null);

  return (
    <Sheet
      title={t().title}
      onBack={on.back}
      testId="new-game"
      footer={
        <>
          <span class="sheet-note">
            <Lamp state="warn" />
            {t().locked}
          </span>
          <span class="grow" />
          <Button variant="primary" size="lg" keyHint="Enter" testId="new-game-start" disabled={blocked} reason={t().noSlot} onClick={start}>
            {t().start}
          </Button>
        </>
      }
    >
      <form
        class="ng-grid"
        onSubmit={(e) => {
          e.preventDefault();
          start();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !(e.target as HTMLElement).closest('button')) {
            e.preventDefault();
            start();
          }
        }}
      >
        <div class="ng-col">
          <section>
            <span class="pl-label" id="ng-diff">
              {t().difficulty}
              {preset === null && <span class="ng-custom"> · {t().custom}</span>}
            </span>
            <div class="ng-presets" role="radiogroup" aria-labelledby="ng-diff" onKeyDown={radioKeys}>
              {DIFFICULTY_PRESET_IDS.map((id) => (
                <button
                  type="button"
                  key={id}
                  role="radio"
                  aria-checked={preset === id}
                  tabIndex={preset === id || (preset === null && id === 'standard') ? 0 : -1}
                  class="ng-preset"
                  data-testid={`preset-${id}`}
                  data-autofocus={preset === id ? '' : undefined}
                  onClick={() => usePreset(id)}
                >
                  <span class="ng-preset-name">{t().presets[id]}</span>
                  <span class="ng-preset-sub">{tx().saves.difficulties[DIFFICULTY_PRESETS[id].deathPenalty]}</span>
                </button>
              ))}
            </div>
            <p class="pl-hint" data-testid="preset-hint">
              {preset ? t().presetHints[preset] : tx().saves.difficultyHints[choice.deathPenalty]}
            </p>
          </section>

          <section>
            <span class="pl-label" id="ng-penalty">
              {t().deathPenalty}
            </span>
            <Panel material="screen" cut="md" class="ng-penalties-wrap" style={{ padding: '0' }}>
              <div class="ng-penalties" role="radiogroup" aria-labelledby="ng-penalty" onKeyDown={radioKeys}>
                {DEATH_PENALTIES.map((p) => (
                  <button
                    type="button"
                    key={p}
                    role="radio"
                    aria-checked={choice.deathPenalty === p}
                    tabIndex={choice.deathPenalty === p ? 0 : -1}
                    class="ng-penalty"
                    data-testid={`penalty-${p}`}
                    onClick={() => update({ deathPenalty: p })}
                  >
                    <Lamp state={choice.deathPenalty === p ? 'info' : 'off'} />
                    <span class="ng-penalty-name">{tx().saves.difficulties[p]}</span>
                    <span>{tx().saves.difficultyHints[p]}</span>
                  </button>
                ))}
              </div>
            </Panel>
          </section>

          <div class="ng-row">
            <span class="pl-label">{t().enemies}</span>
            <Segmented
              label={t().enemies}
              options={ENEMY_DENSITIES.map((d) => ({ value: d, label: t().densities[d] }))}
              value={choice.enemyDensity}
              onChange={(enemyDensity) => update({ enemyDensity })}
            />
            <span class="pl-hint">{t().enemiesNote}</span>
          </div>
          <div class="ng-row">
            <span class="pl-label">{t().miningYield}</span>
            <Segmented
              label={t().miningYield}
              options={MINING_YIELDS.map((y) => ({ value: y, label: yieldLabel(y) }))}
              value={choice.miningYield}
              onChange={(miningYield) => update({ miningYield })}
            />
          </div>
          <div class="ng-row" data-testid="ng-training">
            <span class="pl-label">{tx().training.newGame.label}</span>
            <Segmented
              label={tx().training.newGame.label}
              options={[
                { value: 'play', label: tx().training.newGame.play },
                { value: 'skip', label: tx().training.newGame.skip },
              ]}
              value={skipTraining ? 'skip' : 'play'}
              onChange={(v) => {
                on.click();
                setSkipTraining(v === 'skip');
              }}
            />
            <span class="pl-hint" data-testid="ng-training-hint">
              {skipTraining ? tx().training.newGame.hintSkip : tx().training.newGame.hint}
            </span>
          </div>
        </div>

        <div class="ng-col">
          <section>
            <label class="pl-label" for="ng-seed">
              {t().seed}
            </label>
            <div class="ng-seed">
              <input
                id="ng-seed"
                class="af-input"
                data-testid="seed-input"
                value={seed}
                placeholder={placeholder}
                maxLength={64}
                autocomplete="off"
                spellcheck={false}
                onInput={(e) => setSeed((e.currentTarget as HTMLInputElement).value)}
              />
              <Button
                variant="secondary"
                testId="seed-random"
                onClick={() => {
                  on.click();
                  const next = on.randomSeed();
                  setPlaceholder(next);
                  setSeed('');
                }}
              >
                {t().randomSeed}
              </Button>
            </div>
            <p class="pl-hint">{t().seedHint}</p>
          </section>

          <section>
            <span class="pl-label" id="ng-slot">
              {t().slotFor(tx().saves.difficulties[choice.deathPenalty])}
            </span>
            <div class="slot-list" role="radiogroup" aria-labelledby="ng-slot" onKeyDown={radioKeys}>
              {cells.map((c) => {
                const selected = slot !== null && sameSlot(c.slot, slot);
                const state = slotStateText(c);
                const m = c.state?.meta ?? null;
                return (
                  <button
                    type="button"
                    key={c.slot.index}
                    role="radio"
                    aria-checked={selected}
                    aria-disabled={!slotWritable(c) ? 'true' : undefined}
                    tabIndex={selected ? 0 : -1}
                    class={`slot-pick${c.state ? '' : ' is-empty'}`}
                    data-testid={`ng-slot-${c.slot.index}`}
                    onClick={() => {
                      if (!slotWritable(c)) return;
                      on.click();
                      setPicked(c.slot);
                    }}
                  >
                    <span class="slot-pick-no">{c.slot.index + 1}</span>
                    <span class="slot-pick-main">
                      {m ? (
                        <>
                          {m.name}
                          <small>
                            {formatSavedAt(m.savedAt, new Date(), tx().app.load)} · {formatPlayTime(m.playTimeTicks)}
                          </small>
                        </>
                      ) : (
                        <span class="hub-dim">{tx().saves.emptySlot}</span>
                      )}
                    </span>
                    <span class={`slot-pick-state ${state.tone}`}>{state.text}</span>
                  </button>
                );
              })}
            </div>
            {blocked && <p class="pl-hint">{t().noSlot}</p>}
          </section>
        </div>
      </form>

      {confirm && slot && occupied && (
        <Modal
          tone="danger"
          title={t().overwriteTitle}
          confirmLabel={t().overwriteConfirm}
          cancelLabel={tx().app.menu.back}
          cancelKey="Esc"
          onCancel={() => setConfirm(false)}
          onConfirm={start}
        >
          {t().overwriteBody(tx().app.load.slotName(tx().saves.difficulties[slot.difficulty], slot.index), occupied.name, formatPlayTime(occupied.playTimeTicks))}
        </Modal>
      )}
      {confirm && slot && !occupied && (
        <Modal
          tone="danger"
          title={t().overwriteTitle}
          confirmLabel={t().overwriteConfirm}
          cancelLabel={tx().app.menu.back}
          cancelKey="Esc"
          onCancel={() => setConfirm(false)}
          onConfirm={start}
        >
          {tx().saves.corrupt}
        </Modal>
      )}
    </Sheet>
  );
}

/** The preset whose penalty matches the slot's difficulty ("New game here"). */
function presetFor(difficulty: DeathPenalty): DifficultyPresetId {
  return DIFFICULTY_PRESET_IDS.find((id) => DIFFICULTY_PRESETS[id].deathPenalty === difficulty) ?? 'standard';
}
