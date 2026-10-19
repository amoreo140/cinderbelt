import { describe, expect, it } from 'vitest';
import { tx } from '../i18n';
import type { SimEvent } from '../sim/Simulation';
import type { Silhouette, SilhouetteCell } from './combatView';
import { blastToast, combatToast, SilhouetteTrack } from './combatHudState';

const cell = (x: number, y: number, part: number, fraction = 1): SilhouetteCell => ({ x, y, part, partId: part === 1 ? 'cockpit' : 'armor', tier: 1, fraction });

const sil = (cells: SilhouetteCell[]): Silhouette => ({
  cells,
  minX: Math.min(...cells.map((c) => c.x)),
  maxX: Math.max(...cells.map((c) => c.x)),
  minY: Math.min(...cells.map((c) => c.y)),
  maxY: Math.max(...cells.map((c) => c.y)),
  damaged: new Set(cells.filter((c) => c.fraction < 1).map((c) => c.part)).size,
});

describe('SilhouetteTrack', () => {
  it('keeps parts that broke off and marks them destroyed in the order they were lost', () => {
    const t = new SilhouetteTrack();
    t.observe(sil([cell(1, 0, 1), cell(0, 0, 2, 0.4), cell(-1, 0, 3), cell(0, 1, 4)]));
    // part 3 destroyed, part 4 broke off – they are no longer in the grid
    t.lose([3]);
    t.lose([4, 3]);
    const current = sil([cell(1, 0, 1), cell(0, 0, 2, 0.4)]);
    const snap = t.snapshot(current);
    expect(snap.order).toEqual([3, 4]);
    expect(snap.silhouette.cells.map((c) => [c.part, c.fraction])).toEqual([
      [1, 1],
      [2, 0.4],
      [3, 0],
      [4, 0],
    ]);
    expect(snap.silhouette.minX).toBe(-1);
    expect(snap.silhouette.maxY).toBe(1);
    expect(snap.silhouette.damaged).toBe(3);
    expect(snap.total).toBe(4);
  });

  it('shows lost parts as destroyed even when the grid still lists them (cockpit lost at death)', () => {
    const t = new SilhouetteTrack();
    t.observe(sil([cell(1, 0, 1, 0.2), cell(0, 0, 2)]));
    t.lose([1]);
    // on death the grid stays whole and the HP of destroyed parts is cleared (full HP)
    const snap = t.snapshot(sil([cell(1, 0, 1), cell(0, 0, 2)]));
    expect(snap.silhouette.cells.find((c) => c.part === 1)!.fraction).toBe(0);
  });

  it('reads the silhouette only when the grid version changes (not every simulation step)', () => {
    const t = new SilhouetteTrack();
    let reads = 0;
    const read = () => (reads++, sil([cell(1, 0, 1), cell(0, 0, 2)]));
    for (let i = 0; i < 60; i++) t.sync(7, read);
    expect(reads).toBe(1);
    t.sync(8, read);
    expect(reads).toBe(2);
    t.reset();
    t.sync(8, read);
    expect(reads).toBe(3);
  });

  it('records parts that broke off without partDestroyed (detached) after the destroyed ones', () => {
    const t = new SilhouetteTrack();
    t.sync(1, () => sil([cell(1, 0, 1), cell(0, 0, 2), cell(-1, 0, 3), cell(-2, 0, 4), cell(-3, 0, 5)]));
    // step: part 3 destroyed, parts 4 and 5 broke off with it (no partDestroyed event)
    t.lose([3]);
    t.sync(2, () => sil([cell(1, 0, 1), cell(0, 0, 2)]));
    expect(t.lostCount).toBe(3);
    const snap = t.snapshot(sil([cell(1, 0, 1), cell(0, 0, 2)]));
    expect(snap.order).toEqual([3, 4, 5]);
    expect(snap.silhouette.cells.filter((c) => c.fraction === 0).map((c) => c.part)).toEqual([3, 4, 5]);
  });

  it('keeps the outline of the whole ship from the first record of the flight (SL2 E1 T10)', () => {
    const t = new SilhouetteTrack();
    t.sync(1, () => ({ ...sil([cell(1, 0, 1), cell(0, 0, 2), cell(0, 1, 4)]), outline: 'whole' }));
    t.lose([4]);
    t.sync(2, () => ({ ...sil([cell(1, 0, 1), cell(0, 0, 2)]), outline: 'shrunk' }));
    expect(t.snapshot({ ...sil([cell(1, 0, 1), cell(0, 0, 2)]), outline: 'shrunk' }).silhouette.outline).toBe('whole');
    t.reset();
    t.sync(3, () => ({ ...sil([cell(1, 0, 1)]), outline: 'next' }));
    expect(t.snapshot({ ...sil([cell(1, 0, 1)]), outline: 'next' }).silhouette.outline).toBe('next');
    // nothing recorded yet → the current ship's outline
    expect(new SilhouetteTrack().snapshot({ ...sil([cell(1, 0, 1)]), outline: 'now' }).silhouette.outline).toBe('now');
  });

  it('forgets everything on reset (new ship, repairs)', () => {
    const t = new SilhouetteTrack();
    t.observe(sil([cell(0, 0, 2)]));
    t.lose([2]);
    t.reset();
    const snap = t.snapshot(sil([cell(1, 0, 1)]));
    expect(snap.order).toEqual([]);
    expect(snap.silhouette.cells).toHaveLength(1);
  });
});

describe('combatToast – lost parts (M3.8)', () => {
  const ctx = { stationName: (id: string) => id };
  it('names the part and the cause', () => {
    expect(combatToast({ type: 'partsLost', cause: 'impact', parts: [{ partId: 4, key: 'armor:1', detached: false }] }, ctx)).toEqual({
      text: 'Stratený diel: Pancier T1 (náraz)',
      kind: 'error',
      seconds: 5,
    });
  });

  it('groups several parts of one blow', () => {
    const t = combatToast(
      {
        type: 'partsLost',
        cause: 'shot',
        parts: [
          { partId: 4, key: 'armor:1', detached: false },
          { partId: 5, key: 'engine:1', detached: true },
          { partId: 6, key: 'armor:1', detached: true },
        ],
      },
      ctx,
    );
    expect(t?.text).toBe('Stratené diely: 2× Pancier T1, Motor T1 (zásah)');
  });
});

describe('combatToast', () => {
  const ctx = { stationName: (id: string) => `Stanica ${id}` };

  it('lists what was loaded from a wreck', () => {
    const t = combatToast({ type: 'salvaged', wreckId: 1, cargo: { iron: 12, copper: 3.5 }, parts: { 'cannon:1': 1 }, cargoFull: false }, ctx);
    expect(t).toEqual({ text: 'Naložené z vraku: 12 Fe, 3,5 Cu, 1× Kanón T1', kind: 'ok', seconds: 4 });
  });

  it('warns when the hold filled up and loot stayed in the wreck', () => {
    expect(combatToast({ type: 'salvaged', wreckId: 1, cargo: { iron: 4 }, parts: {}, cargoFull: true }, ctx)).toMatchObject({
      text: 'Naložené z vraku: 4 Fe – náklad je plný, zvyšok ostal vo vraku',
      kind: 'info',
    });
    expect(combatToast({ type: 'salvaged', wreckId: 1, cargo: {}, parts: {}, cargoFull: true }, ctx)).toMatchObject({
      text: 'Náklad je plný – korisť ostala vo vraku',
      kind: 'error',
    });
  });

  it('M21: says how much Data the intact parts of a dismantled wreck paid', () => {
    const t = combatToast({ type: 'salvaged', wreckId: 1, cargo: {}, parts: { 'radar:1': 1 }, cargoFull: false, data: 4 }, ctx);
    expect(t).toEqual({ text: 'Naložené z vraku: 1× Radar T1 · +4 Dát za neporušené diely', kind: 'ok', seconds: 4 });
  });

  it('reports salvaged parts stored at the station', () => {
    expect(combatToast({ type: 'salvageStored', stationId: 'home', parts: { 'armor:2': 2 } }, ctx)).toMatchObject({
      text: 'Diely z vrakov uložené na stanici Stanica home: 2× Pancier T2',
      kind: 'ok',
    });
  });

  it('reports spilled cargo', () => {
    expect(combatToast({ type: 'cargoSpilled', cargo: { iron: 10.25, ice: 2 }, toWreck: 4 }, ctx)).toMatchObject({
      text: 'Prišiel si o nákladný priestor – 12,3 j surovín sa vysypalo do vraku',
      kind: 'error',
    });
  });

  it('ignores other events', () => {
    expect(combatToast({ type: 'cargoFull' }, ctx)).toBeNull();
  });
});

describe('blastToast – the player reactor blast (M4c)', () => {
  const ctx = { stationName: (id: string) => id };
  const blast: SimEvent = { type: 'partBlast', ref: 'player', partId: 3, pos: { x: 0, y: 0 }, damage: 40 };
  const lost: SimEvent = { type: 'partsLost', cause: 'blast', parts: [{ partId: 4, key: 'armor:1', detached: false }] };
  const spilled: SimEvent = { type: 'cargoSpilled', cargo: { iron: 10 }, toWreck: 4 };

  it('one toast says the blast first, then the parts and the cargo it took in the same step', () => {
    const t = blastToast([blast, lost, spilled], ctx);
    expect(t?.kind).toBe('error');
    const head = tx().home.workshop.blast(tx().parts.largeReactor, 40);
    expect(head).toMatch(/^Veľký reaktor vybuchol/);
    expect(t?.text.startsWith(`${head} `)).toBe(true);
    // each note is a sentence of its own
    expect(t?.text).toContain(`${combatToast(lost, ctx)!.text}. `);
    expect(t?.text).toContain(combatToast(lost, ctx)!.text);
    expect(t?.text).toContain(combatToast(spilled, ctx)!.text);
    expect(t!.seconds).toBeGreaterThanOrEqual(6);
  });

  it('no player blast in the step → null (an enemy reactor does not count)', () => {
    expect(blastToast([lost, spilled], ctx)).toBeNull();
    expect(blastToast([{ ...blast, ref: 'e7' }, lost], ctx)).toBeNull();
  });
});
