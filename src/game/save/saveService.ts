// Saving and loading games over SaveStorage (M2, 2.6, 2.8, 9 and 12.4; slots 15.7).
// The game layer holds a `GameSession` (slot + game identity) and calls `save` from autosave, the pause and
// on leaving; the UI uses `overview`, `load`, `delete`, `exportSlot` and `importFile`.
import { loadSave, type LoadError, type LoadWarning } from '../../sim/save/load';
import { slotMetaFor, type SlotMeta } from '../../sim/save/meta';
import { restoreSimulation, toEnvelope, toSave, type RestoreOptions } from '../../sim/save/serialize';
import type { SaveEnvelope, SaveGame, SaveReason, SlotRef } from '../../sim/save/types';
import { seedFromText, type DeathPenalty, type DifficultyChoice } from '../../sim/settings';
import { Simulation } from '../../sim/Simulation';
import { beginTraining } from '../../sim/training/training';
import type { SaveStorage } from '../storage/SaveStorage';
import { nextFreeSlot, SLOTS_PER_DIFFICULTY } from '../storage/slots';
import { exportFileName, exportSlot, parseImport } from '../storage/transfer';
import { SaveQueue } from './saveQueue';

/** Identity of the running game – what is not in the simulation but belongs in the save. */
export interface GameSession {
  slot: SlotRef;
  gameId: string;
  name: string;
  /** ISO 8601. */
  createdAt: string;
}

export type SaveOutcome = { status: 'saved'; meta: SlotMeta } | { status: 'superseded' } | { status: 'failed'; error: string };

export type SlotLoadResult =
  | { ok: true; sim: Simulation; session: GameSession; save: SaveGame; warnings: LoadWarning[] }
  | { ok: false; error: LoadError | 'empty' | 'backupNotAllowed'; version: number | null; details: string[] };

/** Slot state for the Load game screen (4.3 and 12.4). */
export type SlotState =
  | { kind: 'ok'; meta: SlotMeta }
  /** Saved by a newer version of the game – loading is blocked, the slot is not overwritten (delete only). */
  | { kind: 'tooNew'; meta: SlotMeta | null; version: number | null }
  /** The main record cannot be loaded; `backup` = the backup can be loaded (null = "The game could not be restored"). */
  | { kind: 'corrupt'; meta: SlotMeta | null; error: LoadError; details: string[]; backup: { savedAt: string } | null };

export interface SlotOverview {
  slot: SlotRef;
  state: SlotState;
}

export interface NewGameInput {
  slot: SlotRef;
  /** The seed text (a number or any text); the UI generates a random one if the player enters nothing. */
  seedText: string;
  choice: DifficultyChoice;
  /** Predvolene text seedu. */
  name?: string;
  /** Start with the Guild Training (M3.7) – the training hull instead of the starter ship. */
  training?: boolean;
}

export type NewGameResult =
  | { ok: true; sim: Simulation; session: GameSession; outcome: SaveOutcome }
  | { ok: false; error: 'wrongDifficulty' | 'invalidSlot' | 'emptySeed' | 'slotLocked' };

export type ImportOutcome =
  | { ok: true; meta: SlotMeta; usedBackup: boolean; warnings: LoadWarning[] }
  | { ok: false; error: 'json' | LoadError | 'noFreeSlot' | 'slotLocked' | 'writeFailed'; details: string[]; version?: number | null };

export interface SaveServiceOptions {
  /** Build version (informational in the save). */
  gameVersion: string;
  now?: () => Date;
  newId?: () => string;
  /** Tests only – a replacement of the world generator on restore. */
  restore?: RestoreOptions;
}

function randomId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.floor(Math.random() * 2 ** 32).toString(36)}`;
}

const errorText = (e: unknown): string => (e instanceof Error ? `${e.name}: ${e.message}` : String(e));

/** A snapshot that could not be loaded (error in the game state) → result `failed`, else null. */
function invalidSnapshot(envelope: SaveEnvelope): SaveOutcome | null {
  const check = loadSave(envelope);
  return check.ok ? null : { status: 'failed', error: `invalid snapshot (${check.error}): ${check.details.join('; ')}` };
}

export class SaveService {
  private readonly queue = new SaveQueue();
  private readonly now: () => Date;
  private readonly newId: () => string;

  constructor(
    private readonly storage: SaveStorage,
    private readonly options: SaveServiceOptions,
  ) {
    this.now = options.now ?? (() => new Date());
    this.newId = options.newId ?? randomId;
  }

  /** The storage is persistent (IndexedDB), or in-memory only (a warning bar + export). */
  get storageKind(): SaveStorage['kind'] {
    return this.storage.kind;
  }

  /** Creates a game in a slot and saves it right away (reason `new`). Overwrites an existing game in the slot (the UI confirms). */
  async newGame(input: NewGameInput): Promise<NewGameResult> {
    const { slot, choice } = input;
    if (slot.difficulty !== choice.deathPenalty) return { ok: false, error: 'wrongDifficulty' };
    if (!Number.isInteger(slot.index) || slot.index < 0 || slot.index >= SLOTS_PER_DIFFICULTY) return { ok: false, error: 'invalidSlot' };
    const seedText = input.seedText.trim();
    if (!seedText) return { ok: false, error: 'emptySeed' };
    if ((await this.slotState(slot))?.kind === 'tooNew') return { ok: false, error: 'slotLocked' };

    const sim = new Simulation({ seed: seedFromText(seedText), settings: { seedText, ...choice, fallenFromHardcore: false } });
    if (input.training) beginTraining(sim.state);
    const session: GameSession = { slot: { ...slot }, gameId: this.newId(), name: input.name?.trim() || seedText, createdAt: this.now().toISOString() };
    const outcome = await this.save(sim, session, 'new');
    return { ok: true, sim, session, outcome };
  }

  /**
   * Saves the simulation state. The snapshot is taken right away (synchronously), the write runs asynchronously in the queue;
   * the game need not wait for the result. Works anywhere, even in space (15.6).
   */
  save(sim: Simulation, session: GameSession, reason: SaveReason): Promise<SaveOutcome> {
    const save = this.snapshot(sim, session, reason);
    const envelope = toEnvelope(save);
    // an invalid state is not written – it would overwrite a good save and push the backup out on the next write
    const invalid = invalidSnapshot(envelope);
    if (invalid) return Promise.resolve(invalid);
    const meta = slotMetaFor(save, session.slot, false);
    const slot = { ...session.slot };
    return this.queue.enqueue(() => this.storage.write(slot, envelope, meta)).then((r) => this.outcome(r));
  }

  /**
   * After death in hardcore (applyDeath already switched the settings to Hard): moves the game to the difficulty
   * of its settings – always, even when full (15.7) – and saves it. The snapshot and the write are queued
   * right away (the storage picks the target slot in the same transaction), so closing the card does not
   * drop the move. Returns the new session (on error the original – the next save repeats the move).
   */
  fallFromHardcore(sim: Simulation, session: GameSession, reason: SaveReason = 'death'): Promise<{ session: GameSession; outcome: SaveOutcome }> {
    const difficulty = sim.state.settings.deathPenalty;
    const save = this.snapshot(sim, session, reason);
    const envelope = toEnvelope(save);
    const invalid = invalidSnapshot(envelope);
    if (invalid) return Promise.resolve({ session, outcome: invalid });
    const meta = slotMetaFor(save, session.slot, false);
    const from = { ...session.slot };
    return this.queue.enqueue(() => this.storage.moveToFree(from, difficulty, envelope, meta), { coalesce: false }).then((result) => {
      const outcome = this.outcome(result);
      return { session: outcome.status === 'saved' ? { ...session, slot: { ...outcome.meta.slot } } : session, outcome };
    });
  }

  /** Waits for all queued writes to finish (e.g. before leaving to the menu). */
  flush(): Promise<void> {
    return this.queue.idle();
  }

  /**
   * Loads a slot. The backup can be loaded only when the main record cannot be loaded
   * (the backup serves recovery after corruption, not going back in time – 2.8).
   */
  async load(slot: SlotRef, which: 'current' | 'backup' = 'current'): Promise<SlotLoadResult> {
    const record = await this.storage.read(slot);
    if (!record.current && !record.backup) return { ok: false, error: 'empty', version: null, details: [] };
    if (which === 'backup') {
      const main = record.current ? loadSave(record.current) : null;
      if (main?.ok) return { ok: false, error: 'backupNotAllowed', version: null, details: [] };
      if (!record.backup) return { ok: false, error: 'empty', version: null, details: ['no backup'] };
    }
    const envelope = which === 'current' ? record.current : record.backup;
    if (!envelope) return { ok: false, error: 'empty', version: null, details: [] };
    const result = loadSave(envelope);
    if (!result.ok) {
      if (result.error === 'migration') console.error(`Save migration failed (version ${result.version}):`, result.details.join('; '));
      return result;
    }
    const save = result.save;
    const sim = restoreSimulation(save, this.options.restore);
    const session: GameSession = { slot: { ...slot }, gameId: save.gameId, name: save.name, createdAt: save.createdAt };
    return { ok: true, sim, session, save, warnings: result.warnings };
  }

  /** All occupied slots with their state (loads and checks every save). */
  async overview(): Promise<SlotOverview[]> {
    const metas = await this.storage.list();
    const out: SlotOverview[] = [];
    for (const meta of metas) out.push({ slot: meta.slot, state: (await this.slotState(meta.slot))! });
    return out;
  }

  /** The slot for "Continue" – the last saved one (null = no game). */
  async latest(): Promise<SlotMeta | null> {
    let best: SlotMeta | null = null;
    for (const m of await this.storage.list()) if (!best || m.savedAt > best.savedAt) best = m;
    return best;
  }

  /** The lowest free slot of a difficulty for a new game (null = all 4 occupied). */
  async freeSlot(difficulty: DeathPenalty): Promise<SlotRef | null> {
    return nextFreeSlot((await this.storage.list()).map((m) => m.slot), difficulty);
  }

  delete(slot: SlotRef): Promise<void> {
    return this.queue
      .enqueue(() => this.storage.delete(slot), { coalesce: false })
      .then((r) => {
        if (r.status === 'failed') throw r.error;
      });
  }

  /** The file with a slot export (works for a corrupted slot too – raw data). */
  async exportSlot(slot: SlotRef): Promise<{ fileName: string; text: string } | null> {
    const record = await this.storage.read(slot);
    if (!record.current && !record.backup) return null;
    const exportedAt = this.now().toISOString();
    return { fileName: exportFileName(record.meta?.name ?? '', exportedAt), text: exportSlot(record, exportedAt) };
  }

  /** Imports a file into the given slot, otherwise into the first free slot of the save's difficulty. */
  async importFile(text: string, target?: SlotRef): Promise<ImportOutcome> {
    const parsed = parseImport(text);
    if (!parsed.ok) return parsed;
    const used = (await this.storage.list()).map((m) => m.slot);
    const slot = target ?? nextFreeSlot(used, parsed.save.settings.deathPenalty, { ignoreLimit: parsed.save.settings.fallenFromHardcore });
    if (!slot) return { ok: false, error: 'noFreeSlot', details: [] };
    if ((await this.slotState(slot))?.kind === 'tooNew') return { ok: false, error: 'slotLocked', details: [] };
    const meta = slotMetaFor(parsed.save, slot, parsed.backup !== null);
    const result = await this.queue.enqueue(() => this.storage.replace(slot, { current: parsed.current, backup: parsed.backup, meta }), {
      coalesce: false,
    });
    if (result.status !== 'done') return { ok: false, error: 'writeFailed', details: result.status === 'failed' ? [errorText(result.error)] : [] };
    return { ok: true, meta: result.value, usedBackup: parsed.usedBackup, warnings: parsed.warnings };
  }

  private snapshot(sim: Simulation, session: GameSession, reason: SaveReason): SaveGame {
    return toSave(sim, {
      gameId: session.gameId,
      name: session.name,
      createdAt: session.createdAt,
      savedAt: this.now().toISOString(),
      reason,
      gameVersion: this.options.gameVersion,
    });
  }

  private outcome(r: Awaited<ReturnType<SaveQueue['enqueue']>>): SaveOutcome {
    if (r.status === 'done') return { status: 'saved', meta: r.value as SlotMeta };
    if (r.status === 'superseded') return { status: 'superseded' };
    return { status: 'failed', error: errorText(r.error) };
  }

  private async slotState(slot: SlotRef): Promise<SlotState | null> {
    const record = await this.storage.read(slot);
    if (!record.current && !record.backup && !record.meta) return null;
    const main = record.current ? loadSave(record.current) : null;
    if (main?.ok) return { kind: 'ok', meta: record.meta ?? slotMetaFor(main.save, slot, record.backup !== null) };
    if (main && main.error === 'tooNew') return { kind: 'tooNew', meta: record.meta, version: main.version };
    const backup = record.backup ? loadSave(record.backup) : null;
    return {
      kind: 'corrupt',
      meta: record.meta,
      error: main ? main.error : 'format',
      details: main ? main.details : ['missing main record'],
      backup: backup?.ok ? { savedAt: backup.save.savedAt } : null,
    };
  }
}
