// Shader warm-up (audit 2026-10-16, issue #1): the first sight of an effect used to compile its shader
// program inside the frame that showed it – 100–770 ms freezes on the first game frame, the first
// mining beam, the first fortress fight, the first salvage. Before the first game frame (behind the
// loading overlay) the game now builds a "shader zoo": one sample of every material variant the
// layers create later (beams, impacts, explosions, salvage, fortress, shields, scan wave, markers,
// landmarks, planets, decals, liveries…), compiles the whole scene with `compileAsync` (parallel,
// KHR_parallel_shader_compile) and draws one hidden frame of it through the real post chain, so the
// shadow, AO and post-pass variants exist too. The guard: `renderer.info.programs` stays constant
// for the rest of the session (tests/e2e/shaderWarmup.spec.ts).
//
// Program cache keys depend on the material AND the frame state (lights, shadows, the environment
// map, the render target), so the warm-up runs on the game's own scene once those are final.
// The samples' materials are never disposed: three releases a program when the last material using
// it is disposed, so a sample keeps the program alive when a layer frees its own copy (an enemy's
// marker after the fight) – the next fight does not compile it again.
import {
  BatchedMesh,
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Line,
  LineLoop,
  LineSegments,
  Mesh,
  Points,
  Scene,
  Sprite,
  type Camera,
  type Texture,
  type Material,
  type Object3D,
  type SpriteMaterial,
  type WebGLRenderer,
  type WebGLRenderTarget,
} from 'three';

/** What a layer gets to add its samples to (`warmUp(zoo)` on the layers). */
export interface WarmUpZoo {
  /**
   * A gameplay sample built with the layer's real materials (it gets the rim light like the gameplay
   * layers): drawn once in the hidden warm-up frame, then dropped.
   */
  add(object: Object3D): void;
  /** A sample of an unwatched lit layer (rubble, scatter): no rim light, but shadows and AO. */
  addPlain(object: Object3D): void;
  /** A backdrop sample (planets, landmarks): no rim light, no shadows, no AO – like the zone environment. */
  addBackdrop(object: Object3D): void;
  /** A geometry made only for a sample (freed after the warm-up; its material is not). */
  geometry<T extends BufferGeometry>(geometry: T): T;
  /** Frees a sample's own resources after the warm-up (a whole ship view, SL2 E1); its materials stay. */
  onDispose(release: () => void): void;
}

export class ShaderZoo implements WarmUpZoo {
  readonly group = new Group();
  /** Gameplay samples (the rim light patches them like the watched layers). */
  readonly gameplay = new Group();
  /** Samples without the rim. */
  readonly plain = new Group();
  /** Backdrop samples. */
  readonly backdrop = new Group();
  private readonly geometries: BufferGeometry[] = [];
  private readonly releases: (() => void)[] = [];

  constructor() {
    this.group.name = 'shader-zoo';
    this.backdrop.userData.noShadow = true;
    this.backdrop.userData.noAO = true;
    this.group.add(this.gameplay, this.plain, this.backdrop);
  }

  add(object: Object3D): void {
    this.gameplay.add(object);
  }

  addPlain(object: Object3D): void {
    this.plain.add(object);
  }

  addBackdrop(object: Object3D): void {
    this.backdrop.add(object);
  }

  geometry<T extends BufferGeometry>(geometry: T): T {
    this.geometries.push(geometry);
    return geometry;
  }

  onDispose(release: () => void): void {
    this.releases.push(release);
  }

  /** Every sample is drawn in the warm-up frame wherever it sits (main pass, shadow map, AO). */
  showAll(): void {
    this.group.traverse((o) => {
      o.visible = true;
      o.frustumCulled = false;
    });
  }

  /** Samples counted (meshes, points, lines, sprites) – the warm-up report. */
  get size(): number {
    let n = 0;
    this.group.traverse((o) => {
      if ((o as { material?: unknown }).material) n++;
    });
    return n;
  }

  dispose(): void {
    this.group.removeFromParent();
    // instance buffers and batch textures are the samples' own (their materials are not)
    this.group.traverse((o) => {
      if (o instanceof InstancedMesh || o instanceof BatchedMesh) o.dispose();
    });
    this.group.clear();
    for (const g of this.geometries) g.dispose();
    this.geometries.length = 0;
    for (const release of this.releases) release();
    this.releases.length = 0;
  }
}

/**
 * A BatchedMesh's program changes once it gets per-instance colours (`setColorAt` creates its colour
 * texture): a one-instance twin with a colour, same material and attribute layout, so the first tint
 * compiles nothing.
 */
export function coloredBatchSample(zoo: WarmUpZoo, source: BatchedMesh): BatchedMesh {
  const g = zoo.geometry(new BufferGeometry());
  for (const [name, attr] of Object.entries(source.geometry.attributes)) {
    g.setAttribute(name, new BufferAttribute(new Float32Array(3 * attr.itemSize), attr.itemSize, attr.normalized));
  }
  if (source.geometry.index) g.setIndex([0, 1, 2]);
  const batch = new BatchedMesh(1, 3, source.geometry.index ? 3 : 0, source.material);
  batch.addInstance(batch.addGeometry(g));
  batch.setColorAt(0, new Color(1, 1, 1));
  return batch;
}

type TypedArrayCtor = new (length: number) => ArrayLike<number> & { length: number };

/** A three-vertex geometry with the attribute layout (names, sizes, array types) of `source`. */
function layoutTwin(zoo: WarmUpZoo, source: BufferGeometry): BufferGeometry {
  const g = zoo.geometry(new BufferGeometry());
  for (const [name, attr] of Object.entries(source.attributes)) {
    const Ctor = (attr.array.constructor as TypedArrayCtor | undefined) ?? Float32Array;
    const array = new Ctor(3 * attr.itemSize) as unknown as Float32Array;
    g.setAttribute(name, attr instanceof InstancedBufferAttribute ? new InstancedBufferAttribute(array, attr.itemSize, attr.normalized) : new BufferAttribute(array, attr.itemSize, attr.normalized));
  }
  if (source.index) g.setIndex([0, 1, 2]);
  return g;
}

const layoutKey = (g: BufferGeometry): string =>
  Object.entries(g.attributes)
    .map(([name, a]) => `${name}:${a.itemSize}:${(a.array.constructor as { name?: string }).name ?? ''}:${a.normalized ? 1 : 0}${a instanceof InstancedBufferAttribute ? 'i' : ''}`)
    .join(',') + (g.index ? '|i' : '');

function drawsNothing(o: Object3D): boolean {
  if (o instanceof InstancedMesh) return o.count === 0;
  const g = (o as { geometry?: BufferGeometry }).geometry;
  if (!g) return false;
  const n = g.index ? g.index.count : (g.getAttribute('position')?.count ?? 0);
  return n === 0 || g.drawRange.count === 0;
}

/**
 * Hidden or empty objects (pooled beams, flames, particle systems with nothing alive, markers) get a
 * drawn twin: the program exists after `compileAsync`, but the GPU driver (ANGLE on D3D11) still builds
 * its draw-time variant for the vertex layout on the first real draw – a 100+ ms stall when the
 * first beam fires. One twin per material and layout, drawn in the warm-up frame, removes it.
 * The twins keep their originals' shadow and AO flags.
 */
export function drawTwins(root: Object3D, zoo: ShaderZoo): number {
  const done = new Set<string>();
  let n = 0;
  const visit = (o: Object3D, hidden: boolean, noShadow: boolean, noAO: boolean): void => {
    const h = hidden || !o.visible;
    const ns = noShadow || o.userData.noShadow === true;
    const na = noAO || o.userData.noAO === true;
    const material = (o as { material?: Material | Material[] }).material;
    if (material && !Array.isArray(material) && (h || drawsNothing(o)) && !(o instanceof BatchedMesh)) {
      const g = (o as { geometry?: BufferGeometry }).geometry;
      const key = `${o.type}${o instanceof InstancedMesh ? ':instanced' : ''}|${material.uuid}|${g ? layoutKey(g) : ''}`;
      if (!done.has(key)) {
        done.add(key);
        const twin = makeTwin(o, material, g, zoo);
        if (twin) {
          twin.castShadow = o.castShadow && !ns;
          twin.receiveShadow = o.receiveShadow;
          twin.userData.shadowTagged = material;
          if (na) twin.userData.noAO = true;
          zoo.plain.add(twin);
          n++;
        }
      }
    }
    for (const c of o.children) if (c !== zoo.group) visit(c, h, ns, na);
  };
  visit(root, false, false, false);
  return n;
}

function makeTwin(o: Object3D, material: Material, g: BufferGeometry | undefined, zoo: WarmUpZoo): Object3D | null {
  if (o instanceof Sprite) return new Sprite(material as SpriteMaterial);
  if (!g) return null;
  const geometry = layoutTwin(zoo, g);
  if (o instanceof InstancedMesh) {
    const twin = new InstancedMesh(geometry, material, 1);
    if (o.instanceColor) twin.setColorAt(0, new Color(1, 1, 1));
    return twin;
  }
  if (o instanceof Points) return new Points(geometry, material);
  if (o instanceof LineSegments) return new LineSegments(geometry, material);
  if (o instanceof LineLoop) return new LineLoop(geometry, material);
  if (o instanceof Line) return new Line(geometry, material);
  if (o instanceof Mesh) return new Mesh(geometry, material);
  return null;
}

/**
 * Waits until the GPU has executed everything submitted so far (WebGL2 fence, polled – the main
 * thread stays free). The warm-up frame's first draws make the driver build its variants; the game
 * loop starts after that, not into a busy GPU process.
 */
export async function gpuIdle(renderer: WebGLRenderer, timeoutMs: number): Promise<boolean> {
  const gl = renderer.getContext();
  if (!('fenceSync' in gl)) return true;
  const gl2 = gl as WebGL2RenderingContext;
  const sync = gl2.fenceSync(gl2.SYNC_GPU_COMMANDS_COMPLETE, 0);
  if (!sync) return true;
  gl2.flush();
  const end = performance.now() + timeoutMs;
  try {
    while (performance.now() < end) {
      if (gl2.getSyncParameter(sync, gl2.SYNC_STATUS) === gl2.SIGNALED) return true;
      await delay(4);
    }
    return false;
  } finally {
    gl2.deleteSync(sync);
  }
}

/** Resolves after `ms` (the warm-up never waits forever for a slow download or compile). */
export const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** `p`, or nothing once `ms` passed. */
export async function within(p: Promise<unknown>, ms: number): Promise<boolean> {
  let done = false;
  await Promise.race([p.then(() => (done = true)).catch(() => (done = true)), delay(ms)]);
  return done;
}

/**
 * Compiles every material of `scene` (hidden objects included) for frames drawn into `target` (the
 * post chain's HDR buffer: no tone mapping, linear output – the same program keys as the real frame)
 * and waits for the driver to finish them.
 */
export async function compileScene(renderer: WebGLRenderer, scene: Scene, camera: Camera, target: WebGLRenderTarget, timeoutMs: number): Promise<boolean> {
  const previous = renderer.getRenderTarget();
  renderer.setRenderTarget(target);
  let compiled: Promise<unknown>;
  try {
    // the synchronous part creates the programs; the promise waits for the parallel compile (without
    // the extension – software rasterizers – there is nothing to wait for)
    if (renderer.extensions.has('KHR_parallel_shader_compile')) compiled = renderer.compileAsync(scene, camera);
    else {
      renderer.compile(scene, camera);
      compiled = Promise.resolve();
    }
  } finally {
    renderer.setRenderTarget(previous);
  }
  return within(compiled, timeoutMs);
}

/** One draw a render call would make: what decides its program (perf O14, compileDraws). */
interface DrawRecord {
  camera: Camera;
  /** The scene whose lights (and, unless `bare`, environment and fog) the program sees. */
  scene: Object3D;
  /** A shadow-map draw: three draws it with an empty scene (no environment, no fog). */
  bare: boolean;
  geometry: BufferGeometry;
  material: Material;
  object: Object3D;
  target: WebGLRenderTarget | null;
}

const ids = new WeakMap<object, number>();
let nextId = 1;
const idOf = (o: object | null): number => {
  if (!o) return 0;
  let id = ids.get(o);
  if (id === undefined) ids.set(o, (id = nextId++));
  return id;
};

/** What of a draw goes into its program's key besides the material (three r186, WebGLPrograms.getParameters). */
function drawKey(d: DrawRecord): string {
  const o = d.object as Object3D & { isInstancedMesh?: boolean; isBatchedMesh?: boolean; isSkinnedMesh?: boolean; isPoints?: boolean; instanceColor?: unknown; morphTexture?: unknown; _colorsTexture?: unknown };
  const g = d.geometry;
  const attrs = Object.keys(g.attributes).sort().join(',');
  const morph = Object.keys(g.morphAttributes).join(',');
  const flags = `${o.isInstancedMesh ? `i${o.instanceColor ? 'c' : ''}${o.morphTexture ? 'm' : ''}` : ''}${o.isBatchedMesh ? `b${o._colorsTexture ? 'c' : ''}` : ''}${o.isSkinnedMesh ? 's' : ''}${o.isPoints ? 'p' : ''}`;
  return `${idOf(d.material)}|${idOf(d.target)}|${idOf(d.scene)}${d.bare ? 'x' : ''}|${flags}|${attrs}|${g.attributes.color?.itemSize ?? 0}|${morph}`;
}

/**
 * A scene with only the lights (in order), environment and fog of `scene` – what `compile` needs of the
 * scene an object is compiled for (`bare`: lights only, like a shadow-map draw). Without it every compile
 * call would walk the whole scene for its lights.
 */
export function lightsOf(scene: Object3D, camera: Camera, bare = false): Scene {
  const stand = new Scene();
  if (!bare) {
    const s = scene as Partial<Scene>;
    stand.environment = s.environment ?? null;
    stand.fog = s.fog ?? null;
  }
  const lights: Object3D[] = [];
  scene.traverseVisible((o) => {
    if ((o as { isLight?: boolean }).isLight && o.layers.test(camera.layers)) lights.push(o);
  });
  stand.traverseVisible = (fn) => {
    for (const light of lights) fn(light);
  };
  return stand;
}

/**
 * Creates the programs of a render call without drawing it (perf O14): `render` runs as usual, but each
 * draw is only recorded (three's `renderBufferDirect`); then every new one is compiled with
 * `compileAsync` under the target it would draw into. That reaches what `compileScene` cannot: the
 * shadow map's depth variants, the AO pass's override materials, the background and every post pass –
 * a hidden warm-up frame used to create ~25 programs as it drew them, each waiting for the driver
 * (~0.6 s at 4× CPU). `seen` = the draws compiled so far (kept across calls). Resolves when the
 * programs are ready, or false after `timeoutMs`.
 */
export async function compileDraws(renderer: WebGLRenderer, render: () => void, seen: Set<string>, timeoutMs: number): Promise<boolean> {
  const records = new Map<string, DrawRecord>();
  const r = renderer as WebGLRenderer & { renderBufferDirect: WebGLRenderer['renderBufferDirect']; render: WebGLRenderer['render'] };
  const draw = r.renderBufferDirect;
  const frame = r.render;
  const scenes: Object3D[] = [];
  r.render = (scene, camera) => {
    scenes.push(scene);
    try {
      frame.call(renderer, scene, camera);
    } finally {
      scenes.pop();
    }
  };
  r.renderBufferDirect = (camera, scene, geometry, material, object) => {
    const outer = scenes[scenes.length - 1];
    const d: DrawRecord = { camera, scene: scene ?? outer ?? object, bare: !scene, geometry, material, object, target: renderer.getRenderTarget() };
    const key = drawKey(d);
    if (!seen.has(key) && !records.has(key)) records.set(key, d);
  };
  try {
    render();
  } finally {
    r.renderBufferDirect = draw;
    r.render = frame;
  }
  const stands = new Map<string, Scene>();
  const compiled: Promise<unknown>[] = [];
  const previous = renderer.getRenderTarget();
  try {
    for (const [key, d] of records) {
      seen.add(key);
      const standKey = `${idOf(d.scene)}${d.bare ? 'x' : ''}`;
      let stand = stands.get(standKey);
      if (!stand) stands.set(standKey, (stand = lightsOf(d.scene, d.camera, d.bare)));
      // the object as drawn, with the material it was drawn with (a depth variant, an override)
      const proxy = Object.create(d.object, {
        material: { value: d.material },
        geometry: { value: d.geometry },
        children: { value: [] },
        visible: { value: true },
      }) as Object3D;
      renderer.setRenderTarget(d.target);
      compiled.push(
        renderer.extensions.has('KHR_parallel_shader_compile')
          ? renderer.compileAsync(proxy, d.camera, stand)
          : Promise.resolve(renderer.compile(proxy, d.camera, stand)),
      );
    }
  } finally {
    renderer.setRenderTarget(previous);
  }
  return within(Promise.all(compiled), timeoutMs);
}

/**
 * Compiles only what under `scene` has a material without any program yet (perf O14) – `compileScene`
 * for a scene already compiled once: three computes every object's program key there, ~0.1 s at 4× CPU
 * even when nothing is new. A known material drawn in a new way (instanced, another target) is left to
 * `compileDraws`.
 */
export async function compileUncompiled(renderer: WebGLRenderer, scene: Scene, camera: Camera, target: WebGLRenderTarget, timeoutMs: number): Promise<boolean> {
  const fresh: Object3D[] = [];
  scene.traverse((o) => {
    const m = (o as { material?: Material | Material[] }).material;
    if (!m) return;
    for (const material of Array.isArray(m) ? m : [m]) {
      if (!(renderer.properties.get(material) as { currentProgram?: unknown }).currentProgram) {
        fresh.push(o);
        return;
      }
    }
  });
  if (fresh.length === 0) return true;
  const stand = lightsOf(scene, camera);
  const previous = renderer.getRenderTarget();
  const compiled: Promise<unknown>[] = [];
  renderer.setRenderTarget(target);
  try {
    const parallel = renderer.extensions.has('KHR_parallel_shader_compile');
    for (const o of fresh) compiled.push(parallel ? renderer.compileAsync(o, camera, stand) : Promise.resolve(renderer.compile(o, camera, stand)));
  } finally {
    renderer.setRenderTarget(previous);
  }
  return within(Promise.all(compiled), timeoutMs);
}

/** Texture bytes on the GPU, roughly (RGBA8; with mipmaps a third more) – the slice budget's measure. */
function textureBytes(texture: Texture): number {
  const image = texture.image as { width?: number; height?: number; data?: ArrayBufferView } | null | undefined;
  if (!image) return 0;
  if (image.data) return image.data.byteLength;
  const bytes = (image.width ?? 0) * (image.height ?? 0) * 4;
  return texture.generateMipmaps ? Math.round(bytes * 1.34) : bytes;
}

const isTexture = (value: unknown): value is Texture => (value as { isTexture?: boolean } | null)?.isTexture === true;

/** Every texture with image data a material under `root` uses (maps and shader uniforms; hidden objects too). */
export function sceneTextures(root: Object3D): Set<Texture> {
  const out = new Set<Texture>();
  const add = (value: unknown): void => {
    if (isTexture(value)) {
      if (value.image && !(value as { isRenderTargetTexture?: boolean }).isRenderTargetTexture) out.add(value);
    } else if (Array.isArray(value)) for (const v of value) add(v);
  };
  const seen = new Set<Material>();
  root.traverse((o) => {
    const m = (o as { material?: Material | Material[] }).material;
    for (const material of Array.isArray(m) ? m : m ? [m] : []) {
      if (seen.has(material)) continue;
      seen.add(material);
      for (const value of Object.values(material)) add(value);
      const uniforms = (material as { uniforms?: Record<string, { value: unknown }> }).uniforms;
      if (uniforms) for (const u of Object.values(uniforms)) add(u?.value);
    }
  });
  return out;
}

/**
 * The warm-up frame sliced (audit 2026-10-17, P10): the textures the scene draws go to the GPU before it,
 * about `bytesPerSlice` per task (a 2k explosion flipbook is 16 MB with its mipmaps), instead of all
 * inside the one hidden frame – a ~1 s long task at 4× CPU. Textures already on the GPU cost nothing.
 * Returns false when `stopped()` cut it short.
 */
export async function uploadTexturesSliced(renderer: WebGLRenderer, roots: readonly Object3D[], bytesPerSlice: number, stopped: () => boolean): Promise<boolean> {
  let budget = bytesPerSlice;
  for (const root of roots) {
    for (const texture of sceneTextures(root)) {
      if (stopped()) return false;
      // the version check inside makes a texture already uploaded a no-op
      renderer.initTexture(texture);
      budget -= textureBytes(texture);
      if (budget <= 0) {
        budget = bytesPerSlice;
        await delay(0);
      }
    }
  }
  return !stopped();
}

/** How long priming waits for the driver to finish a program before it takes it anyway (ms). */
const PRIME_WAIT_MS = 4000;

/**
 * The first use of every compiled program (link status check, uniform and attribute lookup – three does
 * it lazily in the first draw), `perSlice` programs per task, so the warm-up frame does not do them all.
 * A program the driver is still compiling (KHR_parallel_shader_compile) waits for a later round instead
 * of blocking the main thread on it (perf O14).
 */
export async function primeProgramsSliced(renderer: WebGLRenderer, perSlice: number, stopped: () => boolean): Promise<boolean> {
  const parallel = renderer.extensions?.has('KHR_parallel_shader_compile') === true;
  const end = performance.now() + PRIME_WAIT_MS;
  let pending = [...(renderer.info.programs ?? [])];
  let n = 0;
  while (pending.length > 0) {
    const later: typeof pending = [];
    for (const program of pending) {
      if (stopped()) return false;
      const wait = parallel && performance.now() < end && !(program as { isReady?: () => boolean }).isReady?.();
      if (wait) {
        later.push(program);
        continue;
      }
      program.getUniforms();
      if (++n % perSlice === 0) await delay(0);
    }
    pending = later;
    if (pending.length > 0) await delay(4);
  }
  return !stopped();
}

/** Program count of the renderer (the warm-up report and its e2e guard). */
export const programCount = (renderer: WebGLRenderer): number => renderer.info.programs?.length ?? 0;
