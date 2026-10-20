import { expect, test, type CDPSession, type Page, type TestInfo } from '@playwright/test';
import { loadFixture, type FixtureName } from './fixtures';

// Perf regression guard (optimisation plan O8, research R10): the CLAUDE.md performance budget asserted
// in key fixtures on the PRODUCTION bundle with dev hooks – `npm run test:perf` builds it
// (tools/perf/build.mjs), serves it and runs this spec through playwright.perf.config.ts (the default e2e
// run ignores this file: the dev server's numbers mean nothing).
//
// Per scene, after the warm-up (fixture loaded, scene set up, a few seconds settled), while the scene is
// driven (flying, fighting, hovering the UI):
//   structural (always):  draw calls ≤ 250 at High and ≤ 180 at Medium, triangles ≤ 700k, no new shader
//                         program, buffer + texture uploads ≤ 256 KB/frame (p95 and mean; max reported)
//   timing (real GPU):    no long animation frame > 50 ms (`window.__cinder.loaf`); under SwiftShader
//                         frame times mean nothing, so the check is skipped (annotated)
//   soft:                 JS heap after a forced GC ≤ 32 MB – a warning annotation, not a failure
// Every measurement goes into the test's annotations and a `perf-<scene>.json` attachment.

const BUDGET = { callsHigh: 250, callsMedium: 180, triangles: 700_000, uploadBytes: 256 * 1024, loafMs: 50, heapMB: 32 } as const;

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
/** Recording time per scene at High (s). */
const RECORD_S = Number(env.PERF_SECONDS ?? 6);
/** Settling time after the scene set-up, before recording (s): streaming, far tiers, first UI frames. */
const SETTLE_S = 4;

/**
 * Installed before the page's scripts: per-frame GL upload counters (bufferData/bufferSubData and every
 * tex(Sub)Image call) and, once `install()` wraps `game.tick`, one sample per game frame.
 * Texture bytes = width × height (× depth) × texel size of format/type – a partial texSubImage2D of a
 * big DataTexture (BatchedMesh matrices, three's update ranges) counts the rows it sends, not the
 * whole source array.
 */
function guardInit(): void {
  type Sample = { js: number; calls: number; tris: number; programs: number; upload: number; alloc: number };
  const w = window as unknown as { __perfGuard: unknown; __cinder?: { game: { tick: (now: number) => void }; renderer: { renderer: { info: { render: { calls: number; triangles: number }; programs: unknown[] | null } } } } };
  const G = { buf: 0, tex: 0, alloc: 0, recording: false, samples: [] as Sample[], installed: false };
  const GL = WebGL2RenderingContext;
  const CHANNELS: Record<number, number> = {
    [GL.RGBA]: 4, [GL.RGB]: 3, [GL.RG]: 2, [GL.RED]: 1, [GL.ALPHA]: 1, [GL.LUMINANCE]: 1, [GL.LUMINANCE_ALPHA]: 2,
    [GL.RGBA_INTEGER]: 4, [GL.RGB_INTEGER]: 3, [GL.RG_INTEGER]: 2, [GL.RED_INTEGER]: 1, [GL.DEPTH_COMPONENT]: 1, [GL.DEPTH_STENCIL]: 1,
  };
  const BYTES: Record<number, number> = {
    [GL.UNSIGNED_BYTE]: 1, [GL.BYTE]: 1, [GL.UNSIGNED_SHORT]: 2, [GL.SHORT]: 2, [GL.UNSIGNED_INT]: 4, [GL.INT]: 4, [GL.HALF_FLOAT]: 2, [GL.FLOAT]: 4,
    // OES_texture_half_float (WebGL1)
    0x8d61: 2,
  };
  // packed types: bytes per texel whatever the format
  const PACKED: Record<number, number> = {
    [GL.UNSIGNED_SHORT_5_6_5]: 2, [GL.UNSIGNED_SHORT_4_4_4_4]: 2, [GL.UNSIGNED_SHORT_5_5_5_1]: 2, [GL.UNSIGNED_INT_2_10_10_10_REV]: 4,
    [GL.UNSIGNED_INT_10F_11F_11F_REV]: 4, [GL.UNSIGNED_INT_5_9_9_9_REV]: 4, [GL.UNSIGNED_INT_24_8]: 4, [GL.FLOAT_32_UNSIGNED_INT_24_8_REV]: 8,
  };
  const texel = (format: unknown, type: unknown): number =>
    PACKED[type as number] ?? (CHANNELS[format as number] ?? 4) * (BYTES[type as number] ?? 1);
  const bpe = (d: unknown): number => (d as { BYTES_PER_ELEMENT?: number } | null)?.BYTES_PER_ELEMENT ?? 1;
  type Src = { naturalWidth?: number; naturalHeight?: number; videoWidth?: number; videoHeight?: number; displayWidth?: number; displayHeight?: number; width?: number; height?: number };
  const srcSize = (s: unknown): number => {
    const o = s as Src | null;
    if (!o || typeof o !== 'object') return 0;
    return (o.naturalWidth || o.videoWidth || o.displayWidth || o.width || 0) * (o.naturalHeight || o.videoHeight || o.displayHeight || o.height || 0);
  };
  const isData = (d: unknown) => d !== null && d !== undefined;
  const num = (...xs: unknown[]) => xs.every((x) => typeof x === 'number');
  // bytes a call sends to the GPU, per entry point (WebGL1 and WebGL2 overloads)
  const texBytes: Record<string, (a: unknown[]) => number> = {
    texImage2D: (a) => (a.length >= 9 && num(a[3], a[4]) ? (isData(a[8]) ? (a[3] as number) * (a[4] as number) * texel(a[6], a[7]) : 0) : srcSize(a[5]) * texel(a[3], a[4])),
    texSubImage2D: (a) => (a.length >= 9 && num(a[4], a[5]) ? (a[4] as number) * (a[5] as number) * texel(a[6], a[7]) : srcSize(a[6]) * texel(a[4], a[5])),
    texImage3D: (a) => (isData(a[9]) ? (a[3] as number) * (a[4] as number) * (a[5] as number) * texel(a[7], a[8]) : 0),
    texSubImage3D: (a) => (a[5] as number) * (a[6] as number) * (a[7] as number) * texel(a[8], a[9]),
    compressedTexImage2D: (a) => (a[6] as { byteLength?: number } | null)?.byteLength ?? 0,
    compressedTexSubImage2D: (a) => (a[7] as { byteLength?: number } | null)?.byteLength ?? 0,
    compressedTexImage3D: (a) => (a[7] as { byteLength?: number } | null)?.byteLength ?? 0,
    compressedTexSubImage3D: (a) => (a[9] as { byteLength?: number } | null)?.byteLength ?? 0,
  };
  const viewBytes = (data: unknown, srcOffset: unknown, length: unknown): number => {
    const b = bpe(data);
    if (typeof length === 'number' && length > 0) return length * b;
    return ((data as { byteLength?: number }).byteLength ?? 0) - (typeof srcOffset === 'number' ? srcOffset * b : 0);
  };
  for (const C of [window.WebGL2RenderingContext, window.WebGLRenderingContext]) {
    if (!C) continue;
    const p = C.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;
    const sub = p.bufferSubData!;
    p.bufferSubData = function (this: unknown, ...a: unknown[]) {
      G.buf += viewBytes(a[2], a[3], a[4]);
      return sub.apply(this, a);
    };
    const data = p.bufferData!;
    p.bufferData = function (this: unknown, ...a: unknown[]) {
      if (typeof a[1] === 'number') G.alloc += a[1];
      else if (a[1]) G.buf += viewBytes(a[1], a[3], a[4]);
      return data.apply(this, a);
    };
    for (const name of Object.keys(texBytes)) {
      const orig = p[name];
      if (!orig) continue;
      const count = texBytes[name]!;
      p[name] = function (this: unknown, ...a: unknown[]) {
        try {
          G.tex += count(a);
        } catch {
          /* a counting slip must never break the game */
        }
        return orig.apply(this, a);
      };
    }
  }
  w.__perfGuard = {
    counters: G,
    /** Wraps the game's frame (once per game instance): one sample per tick while recording. */
    install(): boolean {
      const a = w.__cinder;
      if (!a || G.installed) return G.installed;
      const game = a.game;
      const info = a.renderer.renderer.info;
      const tick = game.tick;
      game.tick = (now: number) => {
        const b0 = G.buf + G.tex;
        const a0 = G.alloc;
        const t0 = performance.now();
        tick(now);
        const js = performance.now() - t0;
        if (G.recording)
          G.samples.push({ js, calls: info.render.calls, tris: info.render.triangles, programs: info.programs?.length ?? 0, upload: G.buf + G.tex - b0, alloc: G.alloc - a0 });
      };
      G.installed = true;
      return true;
    },
    start(): void {
      G.samples = [];
      G.recording = true;
    },
    stop(): Sample[] {
      G.recording = false;
      return G.samples;
    },
  };
}

type Sample = { js: number; calls: number; tris: number; programs: number; upload: number; alloc: number };
type Guard = { install(): boolean; start(): void; stop(): Sample[] };
const guard = (page: Page) => page.evaluate(() => (window as unknown as { __perfGuard: Guard }).__perfGuard.install());

interface SceneDef {
  name: string;
  fixture: FixtureName;
  /** Camera distance held while recording (the far zoom of the graveyard). */
  zoom?: number;
  drive: 'flight' | 'fight' | 'ui';
  setup?: (page: Page) => Promise<void>;
}

const SCENES: SceneDef[] = [
  {
    name: 'hour2 flight',
    fixture: 'hour2',
    drive: 'flight',
    setup: async (page) => {
      await page.getByTestId('undock').click();
      await page.waitForFunction(() => window.__cinder!.sim.state.player.dock.mode === 'flying', undefined, { timeout: 30_000 });
    },
  },
  { name: 'shapes-fight', fixture: 'shapes-fight', drive: 'fight', setup: (page) => godMode(page) },
  { name: 'graveyard zoom 140', fixture: 'graveyard', drive: 'flight', zoom: 140 },
  {
    name: 'home-built docked',
    fixture: 'home-built',
    drive: 'ui',
    setup: async (page) => {
      // the station's Development tab, the trophy hall shown in the dock scene
      await page.keyboard.press('Digit6');
      await page.getByTestId('dev-module-trophyHall').click();
      await page.getByTestId('dev-show').click();
      await page.waitForFunction(() => window.__cinder!.home?.focus?.() === 'trophyHall', undefined, { timeout: 30_000 });
    },
  },
  { name: 'convoy-linked', fixture: 'convoy-linked', drive: 'ui' },
  {
    name: 'map-notes map open',
    fixture: 'map-notes',
    drive: 'ui',
    setup: async (page) => {
      await page.keyboard.press('KeyM');
      await page.getByTestId('map').waitFor({ timeout: 30_000 });
      const box = await page.getByTestId('map-canvas').boundingBox();
      // a planned route (right click on the map) – the costly map state of the audit
      if (box) await page.mouse.click(box.x + box.width * 0.72, box.y + box.height * 0.3, { button: 'right' });
    },
  },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The player cannot die or run dry (a long fight must not end the recording). */
const godMode = (page: Page) =>
  page.evaluate(() => {
    type Sim = { step(cmd: unknown): unknown; state: { player: { hp: Map<unknown, unknown>; energy: number; props: { batteryCapacity: number }; heat?: { clear(): void } } } };
    const sim = window.__cinder!.sim as unknown as Sim & { __perfGod?: boolean };
    if (sim.__perfGod) return;
    sim.__perfGod = true;
    const step = sim.step.bind(sim);
    sim.step = (cmd) => {
      const p = sim.state.player;
      if (p.hp.size > 0) p.hp = new Map();
      p.energy = p.props.batteryCapacity;
      p.heat?.clear?.();
      return step(cmd);
    };
  });

const setZoom = (page: Page, d: number) =>
  page.evaluate((v) => {
    (window.__cinder!.renderer as unknown as { rig: { distance: number } }).rig.distance = v;
  }, d);

/** Drives the scene for `ms`: a cruise pattern, a fight at the nearest foe, or the mouse sweeping the UI. */
async function drive(page: Page, scene: SceneDef, ms: number): Promise<void> {
  const W = 1920;
  const H = 1080;
  const t0 = Date.now();
  const el = () => Date.now() - t0;
  if (scene.drive === 'fight') {
    await page.mouse.move(W / 2, H / 2 - 150);
    await page.mouse.down({ button: 'left' });
    while (el() < ms) {
      const foe = await page.evaluate(() => {
        const s = window.__cinder!.sim.state;
        const me = s.player.body.pos;
        let best: { x: number; y: number } | null = null;
        let bestD = Infinity;
        for (const e of s.combat.enemies) {
          if (e.ai.mode === 'dormant') continue;
          const d = Math.hypot(e.body.pos.x - me.x, e.body.pos.y - me.y);
          if (d < bestD) {
            bestD = d;
            best = e.body.pos;
          }
        }
        return best ? window.__cinder!.renderer.worldToScreen(best) : null;
      });
      if (foe) await page.mouse.move(Math.max(5, Math.min(W - 5, foe.x)), Math.max(5, Math.min(H - 5, foe.y)));
      const key = ['KeyA', null, 'KeyD', null][Math.floor(el() / 1500) % 4];
      if (key) {
        await page.keyboard.down(key);
        await sleep(150);
        await page.keyboard.up(key);
      } else await sleep(150);
    }
    await page.mouse.up({ button: 'left' });
  } else if (scene.drive === 'ui') {
    while (el() < ms) {
      await page.mouse.move(W / 2 + 500 * Math.sin(el() / 700), H / 2 + 250 * Math.cos(el() / 900));
      await sleep(100);
    }
  } else {
    const cruise: [string, number][] = [['KeyW', 1500], ['KeyA', 900], ['KeyS', 1200], ['KeyD', 1200], ['KeyW', 800], ['KeyS', 900]];
    let i = 0;
    while (el() < ms) {
      const [key, len] = cruise[i++ % cruise.length]!;
      await page.keyboard.down(key);
      const end = Math.min(ms, el() + len);
      while (el() < end) {
        await page.mouse.move(W / 2 + 200 * Math.sin(el() / 900), H / 2 - 120 + 80 * Math.cos(el() / 1300));
        if (scene.zoom) await setZoom(page, scene.zoom);
        await sleep(100);
      }
      await page.keyboard.up(key);
    }
  }
}

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] ?? 0;
};
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const KB = (b: number) => Math.round(b / 1024);

interface Measured {
  scene: string;
  gpu: string;
  realGpu: boolean;
  frames: number;
  high: { callsMax: number; callsMean: number; trisMax: number; trisMean: number; uploadKBMean: number; uploadKBP95: number; uploadKBMax: number; allocKBMax: number; jsMean: number; jsP95: number };
  medium: { frames: number; callsMax: number; trisMax: number };
  programs: { before: number; after: number; min: number; max: number };
  loaf: { supported: boolean; over: { duration: number; scripts: string }[] };
  heapMB: number | null;
  errors: string[];
}

async function measure(page: Page, scene: SceneDef): Promise<Measured> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(guardInit);
  await page.addInitScript(() => {
    try {
      localStorage.setItem('cinderbelt.settings', JSON.stringify({ graphicsQuality: 'high', showControlsHelp: false, masterVolume: 0 }));
    } catch {
      /* private mode: the default settings */
    }
  });
  await loadFixture(page, scene.fixture, { ticks: 10, timeout: 120_000 });
  expect(await guard(page)).toBe(true);
  const gpuInfo = await page.evaluate(() => {
    const r = window.__cinder!.renderer as unknown as { renderer: { getContext(): WebGL2RenderingContext }; graphicsQuality: { level: string } };
    const gl = r.renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return { gpu: String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)), level: r.graphicsQuality.level };
  });
  expect(gpuInfo.level, 'the guard measures at High first').toBe('high');
  const realGpu = !/swiftshader|llvmpipe|softpipe|software|basic render/i.test(gpuInfo.gpu);

  // ---- warm-up: scene set-up and settling; nothing of it is measured
  await scene.setup?.(page);
  if (scene.zoom) await setZoom(page, scene.zoom);
  await sleep(SETTLE_S * 1000);

  // ---- High: the driven recording window
  const programsBefore = await page.evaluate(() => window.__cinder!.renderer.shaderPrograms());
  const recStart = await page.evaluate(() => {
    (window as unknown as { __perfGuard: Guard }).__perfGuard.start();
    return performance.now();
  });
  await drive(page, scene, RECORD_S * 1000);
  const high = await page.evaluate(() => (window as unknown as { __perfGuard: Guard }).__perfGuard.stop());
  const programsAfter = await page.evaluate(() => window.__cinder!.renderer.shaderPrograms());
  const loaf = await page.evaluate(
    ([t, limit]) => {
      const m = window.__cinder!.loaf;
      if (!m) return { supported: false, over: [] };
      return {
        supported: m.supported,
        over: m
          .since(t)
          .filter((e) => e.duration > limit)
          .map((e) => ({ duration: Math.round(e.duration), scripts: e.scripts.map((s) => `${s.invoker}${s.fn ? ` ${s.fn}` : ''} ${s.duration}ms`).join(', ') })),
      };
    },
    [recStart, BUDGET.loafMs] as const,
  );

  // ---- heap after a forced GC (soft)
  let heapMB: number | null = null;
  let cdp: CDPSession | null = null;
  try {
    cdp = await page.context().newCDPSession(page);
    await cdp.send('HeapProfiler.collectGarbage');
    await cdp.send('HeapProfiler.collectGarbage');
    const h = await cdp.send('Runtime.getHeapUsage');
    heapMB = +(h.usedSize / 1048576).toFixed(1);
  } catch {
    heapMB = null;
  }

  // ---- Medium: draw calls and triangles of the same scene (the switch itself may compile – not counted)
  await page.evaluate(() => (window.__cinder!.game as unknown as { setGraphicsQuality(s: string): void }).setGraphicsQuality('medium'));
  await sleep(1500);
  await page.evaluate(() => (window as unknown as { __perfGuard: Guard }).__perfGuard.start());
  await drive(page, scene, 2500);
  const medium = await page.evaluate(() => (window as unknown as { __perfGuard: Guard }).__perfGuard.stop());
  await cdp?.detach().catch(() => {});

  const col = (xs: Sample[], k: keyof Sample) => xs.map((s) => s[k]);
  const progs = col(high, 'programs');
  return {
    scene: scene.name,
    gpu: gpuInfo.gpu,
    realGpu,
    frames: high.length,
    high: {
      callsMax: Math.max(...col(high, 'calls')),
      callsMean: Math.round(mean(col(high, 'calls'))),
      trisMax: Math.max(...col(high, 'tris')),
      trisMean: Math.round(mean(col(high, 'tris'))),
      uploadKBMean: KB(mean(col(high, 'upload'))),
      uploadKBP95: KB(pct(col(high, 'upload'), 95)),
      uploadKBMax: KB(Math.max(...col(high, 'upload'))),
      allocKBMax: KB(Math.max(...col(high, 'alloc'))),
      jsMean: +mean(col(high, 'js')).toFixed(2),
      jsP95: +pct(col(high, 'js'), 95).toFixed(2),
    },
    medium: { frames: medium.length, callsMax: Math.max(...col(medium, 'calls')), trisMax: Math.max(...col(medium, 'tris')) },
    programs: { before: programsBefore, after: programsAfter, min: Math.min(...progs), max: Math.max(...progs) },
    loaf,
    heapMB,
    errors,
  };
}

/** Annotations + a JSON attachment: the numbers are visible in every report, pass or fail. */
async function report(info: TestInfo, m: Measured): Promise<void> {
  const h = m.high;
  info.annotations.push({
    type: 'perf',
    description:
      `${m.frames} frames on ${m.realGpu ? 'GPU' : 'software'} (${m.gpu.slice(0, 60)}) | High calls ${h.callsMean}/${h.callsMax} (mean/max), ` +
      `tris ${Math.round(h.trisMean / 1000)}k/${Math.round(h.trisMax / 1000)}k, uploads ${h.uploadKBMean}/${h.uploadKBP95}/${h.uploadKBMax} KB (mean/p95/max), ` +
      `JS ${h.jsMean}/${h.jsP95} ms | Medium calls max ${m.medium.callsMax}, tris max ${Math.round(m.medium.trisMax / 1000)}k | ` +
      `programs ${m.programs.before}→${m.programs.after} | LoAF > ${BUDGET.loafMs} ms: ${m.loaf.supported ? m.loaf.over.length : 'n/a'} | heap ${m.heapMB ?? '?'} MB`,
  });
  if (m.heapMB !== null && m.heapMB > BUDGET.heapMB) {
    info.annotations.push({ type: 'warning', description: `JS heap after GC ${m.heapMB} MB > ${BUDGET.heapMB} MB (soft budget)` });
    console.warn(`[perf guard] ${m.scene}: JS heap after GC ${m.heapMB} MB > ${BUDGET.heapMB} MB (soft budget)`);
  }
  if (!m.realGpu) info.annotations.push({ type: 'skip-timing', description: `no real GPU (${m.gpu}): long-animation-frame check skipped` });
  else if (!m.loaf.supported) info.annotations.push({ type: 'skip-timing', description: 'long-animation-frame entries not supported by this browser' });
  await info.attach(`perf-${m.scene.replace(/\W+/g, '-')}.json`, { body: JSON.stringify(m, null, 1), contentType: 'application/json' });
  console.log(`[perf guard] ${m.scene}: ${info.annotations.find((a) => a.type === 'perf')!.description}`);
}

function assertBudget(m: Measured, { triangles = true } = {}): void {
  expect(m.errors, 'no uncaught page error while measuring').toEqual([]);
  // SwiftShader draws a 1080p frame in ~0.2–2 s: a handful of frames is all a software run gets
  expect(m.frames, 'enough frames recorded').toBeGreaterThanOrEqual(m.realGpu ? 30 : 5);
  expect.soft(m.high.callsMax, 'draw calls at High').toBeLessThanOrEqual(BUDGET.callsHigh);
  expect.soft(m.medium.callsMax, 'draw calls at Medium').toBeLessThanOrEqual(BUDGET.callsMedium);
  if (triangles) {
    expect.soft(m.high.trisMax, 'triangles at High').toBeLessThanOrEqual(BUDGET.triangles);
    expect.soft(m.medium.trisMax, 'triangles at Medium').toBeLessThanOrEqual(BUDGET.triangles);
  }
  expect.soft(m.programs.after, 'no new shader program after the warm-up').toBe(m.programs.before);
  expect.soft(m.programs.max, 'no new shader program after the warm-up (per frame)').toBe(m.programs.before);
  // a few software frames make the p95 the max – the mean still applies there
  if (m.realGpu) expect.soft(m.high.uploadKBP95 * 1024, 'uploads per frame (p95)').toBeLessThanOrEqual(BUDGET.uploadBytes);
  expect.soft(m.high.uploadKBMean * 1024, 'uploads per frame (mean)').toBeLessThanOrEqual(BUDGET.uploadBytes);
  if (m.realGpu && m.loaf.supported) expect.soft(m.loaf.over, `long animation frames > ${BUDGET.loafMs} ms after the warm-up`).toEqual([]);
}

for (const scene of SCENES) {
  test(`perf budget: ${scene.name}`, async ({ page }, info) => {
    const m = await measure(page, scene);
    await report(info, m);
    // the graveyard at zoom 140 is inside the triangle budget since the far tier (cad2578)
    assertBudget(m, { triangles: true });
  });
}
