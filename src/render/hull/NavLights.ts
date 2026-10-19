// Nav lights of every visible ship (SL2 E1, spec §3.6, plan T5): white bow, red port, green
// starboard, amber aft. One global layer – a single InstancedMesh of small emissive lights for all ships
// (+1 draw call in total, outside the hull batches) – whose instance matrices are written every frame
// from the ships' group transforms. The lights grow with the camera distance (the instance scale); the
// bow light blinks at 1 Hz (steady with reduced motion); pirates have no lights on Low.
//
// Each light is a camera-facing quad built in clip space (readability pass 2026-10-16): an opaque lens
// disc of the light's projected radius but at least `NAV_CORE_MIN_PX`, inside a soft additive halo of
// `NAV_HALO_RATIO` × the lens but at least `NAV_HALO_MIN_PX` (CSS pixels × the pixel ratio). The halo
// does not depend on bloom (software GPUs, Low), so red / green / white / amber stay distinguishable at
// camera 48–100; with bloom the HDR lens glows on top. The quad is pulled towards the camera by its
// own radius so the deck around the light does not cut the halo.
//
// Colours come from the palette atlas (the `light_*` swatches, UVs from palette_swatches.json): every
// instance carries the UV of its swatch and samples the shared emissive atlas, times an HDR gain (the
// bloom picks it up). Until the atlas has loaded – or without a swatch table – the layer draws nothing.
//
// The input points are hull-local and already pulled onto the lip (`shipNavPoints` below, which
// ShipView.navPoints() serves once the shell is wired into the view – plan T4).
import {
  AddEquation,
  CustomBlending,
  DataTexture,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  MeshBasicMaterial,
  OneFactor,
  OneMinusSrcAlphaFactor,
  PlaneGeometry,
  SRGBColorSpace,
  Vector3,
  Vector4,
  type Object3D,
  type Texture,
  type WebGLRenderer,
} from 'three';
import type { Vec2 } from '../../sim/math/vec2';
import { partCells } from '../../sim/ship/grid';
import { hullOutline, type HullOutline, type NavPoint } from '../../sim/ship/outline';
import type { ShipGrid } from '../../sim/ship/types';
import { sharedPalette, type PaletteSource } from '../assets/gltf';
import type { GraphicsQuality } from '../quality';
import type { WarmUpZoo } from '../warmup';
import { LIGHT_BLINK_HZ, LIGHT_PULL, LIGHT_R, LIGHT_SCALE_EXP, LIGHT_SCALE_REF, LIGHT_Z, NAV_LIGHTS_CAPACITY } from './shellConstants';
import type { SwatchLookup } from './shellGeometry';

export type NavLightKind = NavPoint['kind'];

/** Palette swatch of each light (they exist in art/blender/lib/palette.py). */
export const NAV_LIGHT_SWATCH: Readonly<Record<NavLightKind, string>> = {
  bow: 'light_white',
  port: 'light_red',
  starboard: 'light_green',
  aft: 'light_amber',
};

/** HDR gain of a lit light over its emissive atlas texel (the bloom makes it glow). */
export const NAV_LIGHT_GAIN = 3;
/** Gain of the bow light in the dark half of its blink: an unlit lens, not a hole. */
export const NAV_LIGHT_OFF_GAIN = 0.12;
/** Smallest on-screen lens radius (CSS px): a light never shrinks to a 1 px dot. */
export const NAV_CORE_MIN_PX = 2;
/** Halo radius as a multiple of the lens radius, and its minimum (CSS px). */
export const NAV_HALO_RATIO = 2.6;
export const NAV_HALO_MIN_PX = 5.5;
/** Halo brightness at the lens rim relative to the lens (falls off quadratically to the quad edge). */
export const NAV_HALO_GAIN = 0.35;

/** One ship as the layer sees it (GameRenderer collects them each frame; no allocation per frame). */
export interface NavLightShip {
  /** The ship's root (ShipView.group): its world matrix places the lights. */
  readonly object: Object3D;
  /**
   * The lights in the root's local frame (ShipView.navPoints(): hull-local, already pulled onto the lip,
   * sim units with the centre of mass at the origin). Empty = no lights (shell off, no outline).
   */
  readonly points: readonly NavPoint[];
  /** Pirate / clan ship – no lights on Low. */
  readonly pirate: boolean;
  /** Hidden ships (culled, docked away, destroyed) get no lights. */
  readonly visible: boolean;
}

export interface NavLightsFrame {
  /** Distance of the camera from its target (world units) – sets the light scale. */
  cameraDistance: number;
  /** Seconds since start – the bow light's blink. */
  time: number;
  reducedMotion: boolean;
  quality: GraphicsQuality;
}

/** Light scale for a camera distance: 1 up close, max(1, d / 48)^0.75 beyond (spec §3.6). */
export function navLightScale(cameraDistance: number): number {
  return Math.pow(Math.max(1, cameraDistance / LIGHT_SCALE_REF), LIGHT_SCALE_EXP);
}

/** Is the bow light lit at `time`? Steady with reduced motion, else on for the first half of each 1 Hz period. */
export function bowLightOn(time: number, reducedMotion: boolean): boolean {
  if (reducedMotion) return true;
  const phase = time * LIGHT_BLINK_HZ;
  return phase - Math.floor(phase) < 0.5;
}

// --- points: outline → lip → ship group frame ----------------------------------------------------------

/** Centroid of the hull for the light pull: the mean of the cell centres (grid frame, mock-up `_centroid`). */
export function hullCentroid(grid: ShipGrid): Vec2 {
  let x = 0;
  let y = 0;
  let n = 0;
  for (const p of grid.parts) {
    for (const c of partCells(p)) {
      x += c.x;
      y += c.y;
      n++;
    }
  }
  return n > 0 ? { x: x / n, y: y / n } : { x: 0, y: 0 };
}

/**
 * Pulls outline nav points (grid frame) `LIGHT_PULL` towards `centroid` (onto the lip, mock-up `_lights`)
 * and moves them into the ship group's frame (centre of mass at the origin). Pure; a point on the
 * centroid stays where it is.
 */
export function pullNavPoints(nav: readonly NavPoint[], centroid: Vec2, centerOfMass: Vec2): NavPoint[] {
  return nav.map((p) => {
    const dx = centroid.x - p.at.x;
    const dy = centroid.y - p.at.y;
    const len = Math.hypot(dx, dy);
    const k = len > 1e-9 ? LIGHT_PULL / len : 0;
    return { at: { x: p.at.x + dx * k - centerOfMass.x, y: p.at.y + dy * k - centerOfMass.y }, kind: p.kind, owner: p.owner };
  });
}

interface NavMemo {
  comX: number;
  comY: number;
  points: readonly NavPoint[];
}
const NAV_MEMO = new WeakMap<HullOutline, NavMemo>();

/**
 * The nav lights of a ship in its group's frame (the `NavLightShip.points` / ShipView.navPoints()
 * contract), memoised per outline (outlines are memoised per grid, grids are replaced on change) –
 * cheap to call every frame. `outline` defaults to the untorn player outline of the grid.
 */
export function shipNavPoints(
  grid: ShipGrid,
  centerOfMass: Vec2,
  outline: HullOutline = hullOutline(grid, { tornFrom: null, bevelArmour: true }),
): readonly NavPoint[] {
  const memo = NAV_MEMO.get(outline);
  if (memo && memo.comX === centerOfMass.x && memo.comY === centerOfMass.y) return memo.points;
  const points = pullNavPoints(outline.nav, hullCentroid(grid), centerOfMass);
  NAV_MEMO.set(outline, { comX: centerOfMass.x, comY: centerOfMass.y, points });
  return points;
}

// --- the layer -------------------------------------------------------------------------------------------

/** Per-instance attribute with the swatch UV of the light. */
const NAV_UV = 'navUv';
const KINDS: readonly NavLightKind[] = ['bow', 'port', 'starboard', 'aft'];

/** Current viewport (drawing-buffer px) and pixel ratio for the lights' clip-space quads. */
interface ViewUniform {
  value: Vector3;
}

/**
 * The lights' material: unlit, the emissive atlas sampled at each instance's swatch UV, drawn as
 * camera-facing lens + halo quads (see the header). Premultiplied blending: the lens (alpha 1) covers
 * what is behind it, the halo (alpha 0) adds light.
 */
function navLightMaterial(map: Texture, view: ViewUniform): MeshBasicMaterial {
  const m = new MeshBasicMaterial({ map, transparent: true, depthWrite: false });
  m.name = 'AF_NavLights';
  m.blending = CustomBlending;
  m.blendEquation = AddEquation;
  m.blendSrc = OneFactor;
  m.blendDst = OneMinusSrcAlphaFactor;
  m.blendSrcAlpha = OneFactor;
  m.blendDstAlpha = OneMinusSrcAlphaFactor;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uNavView = view;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec2 ${NAV_UV};
uniform vec3 uNavView;
varying vec2 vNavCorner;
varying float vNavCore;
varying float vNavPx;`,
      )
      .replace('#include <uv_vertex>', `#include <uv_vertex>\nvMapUv = ${NAV_UV};`)
      .replace('#include <project_vertex>', NAV_PROJECT_VERTEX);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec2 vNavCorner;
varying float vNavCore;
varying float vNavPx;`,
      )
      .replace('#include <opaque_fragment>', NAV_OPAQUE_FRAGMENT);
  };
  m.customProgramCacheKey = () => 'cinder-nav-lights-v2';
  m.userData.noAO = true;
  return m;
}

const glslFloat = (x: number): string => (Number.isInteger(x) ? x.toFixed(1) : String(x));

/** Vertex: the lens + halo quad around the instance's centre, sized in pixels (replaces project_vertex). */
const NAV_PROJECT_VERTEX = `// the light's centre and world radius from its instance matrix (translation, uniform scale)
vec4 navCentre = modelViewMatrix * (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0));
float navWorldR = ${glslFloat(LIGHT_R)} * length((modelMatrix * instanceMatrix)[0].xyz);
vec4 navClip = projectionMatrix * navCentre;
// world units -> drawing-buffer px at the light's depth (perspective and orthographic)
float navPxPerUnit = projectionMatrix[1][1] * 0.5 * uNavView.y / max(navClip.w, 1e-4);
float navCorePx = max(navWorldR * navPxPerUnit, ${glslFloat(NAV_CORE_MIN_PX)} * uNavView.z);
float navHaloPx = max(navCorePx * ${glslFloat(NAV_HALO_RATIO)}, ${glslFloat(NAV_HALO_MIN_PX)} * uNavView.z);
// pull the quad towards the camera by the halo's world radius: the deck around the light stays behind it
navCentre.xyz -= normalize(navCentre.xyz) * (navHaloPx / max(navPxPerUnit, 1e-4));
navClip = projectionMatrix * navCentre;
vNavCorner = position.xy / ${glslFloat(LIGHT_R)};
vNavCore = navCorePx / navHaloPx;
vNavPx = navHaloPx;
navClip.xy += vNavCorner * navHaloPx * 2.0 / uNavView.xy * navClip.w;
vec4 mvPosition = navCentre;
gl_Position = navClip;`;

/** Fragment: opaque lens disc, additive halo (replaces opaque_fragment; premultiplied output). */
const NAV_OPAQUE_FRAGMENT = `float navD = length(vNavCorner);
if (navD > 1.0) discard;
// the lens: a disc with a one-pixel soft rim; the halo: quadratic falloff to the quad's edge
float navAa = 1.0 / vNavPx;
float navLens = 1.0 - smoothstep(vNavCore - navAa, vNavCore + navAa, navD);
float navHalo = (1.0 - navD) / max(1.0 - vNavCore, 1e-3);
navHalo = ${glslFloat(NAV_HALO_GAIN)} * navHalo * navHalo;
gl_FragColor = vec4(outgoingLight * (navLens + navHalo * (1.0 - navLens)), navLens);`;

/** A 1×1 white stand-in for the atlas until it loads: the program is the same with the real map. */
function placeholderMap(): DataTexture {
  const t = new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  t.colorSpace = SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

/** The global nav light layer. */
export class NavLights {
  /** Most lights drawn at once (all ships together). */
  readonly capacity: number;
  /** The instanced domes (tests, perf hooks). */
  readonly mesh: InstancedMesh;
  private readonly geometry: PlaneGeometry;
  private readonly material: MeshBasicMaterial;
  private readonly placeholder: DataTexture;
  private readonly uv: InstancedBufferAttribute;
  /** Viewport (drawing-buffer px) and pixel ratio, refreshed before each draw of the layer. */
  private readonly view: ViewUniform = { value: new Vector3(1920, 1080, 1) };
  /** Swatch UV per light kind (index = KINDS order); null = no swatch table → the layer stays empty. */
  private readonly swatches: Float32Array | null;
  /** The atlas has arrived (until then nothing is drawn). */
  private ready = false;
  private drawn = 0;
  private disposed = false;

  /**
   * @param parent where the instanced mesh goes (the gameplay scene)
   * @param swatchUv palette swatch UVs (the lights' colours); null = no swatch table → the layer stays empty
   * @param palette source of the shared emissive atlas (tests pass their own)
   */
  constructor(parent: Object3D, swatchUv: SwatchLookup | null, capacity = NAV_LIGHTS_CAPACITY, palette: PaletteSource = sharedPalette) {
    this.capacity = capacity;
    this.swatches = swatchUv ? swatchTable(swatchUv) : null;
    // one quad, ±LIGHT_R: the vertex shader takes only its corner directions (anything drawing the mesh
    // without that shader – nothing does: transparent, no AO, no shadow – would see a lens-sized square)
    this.geometry = new PlaneGeometry(LIGHT_R * 2, LIGHT_R * 2);
    this.uv = new InstancedBufferAttribute(new Float32Array(capacity * 2), 2);
    this.uv.setUsage(DynamicDrawUsage);
    this.geometry.setAttribute(NAV_UV, this.uv);
    this.placeholder = placeholderMap();
    this.material = navLightMaterial(this.placeholder, this.view);
    this.mesh = new InstancedMesh(this.geometry, this.material, capacity);
    this.mesh.name = 'nav-lights';
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.mesh.instanceColor.setUsage(DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.visible = false;
    // the instances move every frame: no stale bounding sphere culling them
    this.mesh.frustumCulled = false;
    this.mesh.userData.noShadow = true;
    this.mesh.userData.noAO = true;
    this.mesh.onBeforeRender = (renderer) => this.syncView(renderer);
    parent.add(this.mesh);
    if (this.swatches) {
      void palette('emissive').then((atlas) => {
        if (!atlas || this.disposed) return;
        this.material.map = atlas;
        this.ready = true;
      });
    }
  }

  /** Writes the instance matrices for this frame (no allocation). */
  update(ships: Iterable<NavLightShip>, frame: NavLightsFrame): void {
    let n = 0;
    const swatches = this.swatches;
    if (this.ready && swatches) {
      const scale = navLightScale(frame.cameraDistance);
      const bowGain = bowLightOn(frame.time, frame.reducedMotion) ? NAV_LIGHT_GAIN : NAV_LIGHT_OFF_GAIN;
      const noPirates = frame.quality === 'low';
      const mat = this.mesh.instanceMatrix.array as Float32Array;
      const col = this.mesh.instanceColor!.array as Float32Array;
      const uv = this.uv.array as Float32Array;
      ships: for (const ship of ships) {
        if (!ship.visible || ship.points.length === 0 || (ship.pirate && noPirates)) continue;
        ship.object.updateWorldMatrix(true, false);
        const w = ship.object.matrixWorld.elements;
        for (const p of ship.points) {
          if (n >= this.capacity) break ships;
          // instance = shipWorld × translate(local) × scale(s): the dome sits on the lip and turns with the ship
          const lx = p.at.x;
          const ly = LIGHT_Z;
          const lz = -p.at.y;
          const o = n * 16;
          for (let c = 0; c < 3; c++) {
            mat[o + c * 4] = w[c * 4]! * scale;
            mat[o + c * 4 + 1] = w[c * 4 + 1]! * scale;
            mat[o + c * 4 + 2] = w[c * 4 + 2]! * scale;
            mat[o + c * 4 + 3] = 0;
          }
          mat[o + 12] = w[0]! * lx + w[4]! * ly + w[8]! * lz + w[12]!;
          mat[o + 13] = w[1]! * lx + w[5]! * ly + w[9]! * lz + w[13]!;
          mat[o + 14] = w[2]! * lx + w[6]! * ly + w[10]! * lz + w[14]!;
          mat[o + 15] = 1;
          const k = kindIndex(p.kind);
          uv[n * 2] = swatches[k * 2]!;
          uv[n * 2 + 1] = swatches[k * 2 + 1]!;
          const gain = k === 0 ? bowGain : NAV_LIGHT_GAIN;
          col[n * 3] = gain;
          col[n * 3 + 1] = gain;
          col[n * 3 + 2] = gain;
          n++;
        }
      }
    }
    this.drawn = n;
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    if (n > 0) {
      markRange(this.mesh.instanceMatrix, n * 16);
      markRange(this.mesh.instanceColor!, n * 3);
      markRange(this.uv, n * 2);
    }
  }

  /**
   * The viewport the quads are sized for: the current render target's (the post stack's) or the canvas.
   * The pixel ratio follows the target's share of the canvas: with dynamic resolution the post stack
   * renders below the canvas size and the lights keep their size on screen.
   */
  private syncView(renderer: WebGLRenderer): void {
    renderer.getCurrentViewport(VIEWPORT);
    const canvasWidth = renderer.domElement.width;
    const ratio = renderer.getPixelRatio() * (canvasWidth > 0 ? VIEWPORT.z / canvasWidth : 1);
    this.view.value.set(Math.max(1, VIEWPORT.z), Math.max(1, VIEWPORT.w), ratio);
  }

  /** Lights drawn in the last update (tests, perf hook). */
  get count(): number {
    return this.drawn;
  }

  /** Shader warm-up sample: one light with the layer's real material (plan T11). */
  warmUp(zoo: WarmUpZoo): void {
    if (!this.swatches) return;
    const sample = new InstancedMesh(this.geometry, this.material, 1);
    sample.instanceColor = new InstancedBufferAttribute(new Float32Array([NAV_LIGHT_GAIN, NAV_LIGHT_GAIN, NAV_LIGHT_GAIN]), 3);
    sample.frustumCulled = false;
    sample.userData.noShadow = true;
    sample.userData.noAO = true;
    zoo.add(sample);
  }

  dispose(): void {
    this.disposed = true;
    this.mesh.removeFromParent();
    this.mesh.dispose();
    this.geometry.dispose();
    this.material.dispose();
    this.placeholder.dispose();
  }
}

const VIEWPORT = new Vector4();

function kindIndex(kind: NavLightKind): number {
  return kind === 'bow' ? 0 : kind === 'port' ? 1 : kind === 'starboard' ? 2 : 3;
}

/** Swatch UVs in KINDS order; a missing swatch falls back to the white light's (or the atlas corner). */
function swatchTable(lookup: SwatchLookup): Float32Array {
  const out = new Float32Array(KINDS.length * 2);
  const white = lookup(NAV_LIGHT_SWATCH.bow);
  KINDS.forEach((kind, i) => {
    const uv = lookup(NAV_LIGHT_SWATCH[kind]) ?? white ?? ([0, 0] as const);
    out[i * 2] = uv[0];
    out[i * 2 + 1] = uv[1];
  });
  return out;
}

/** Uploads only the first `count` floats of a per-instance attribute this frame. */
function markRange(attr: InstancedBufferAttribute, count: number): void {
  attr.clearUpdateRanges();
  attr.addUpdateRange(0, count);
  attr.needsUpdate = true;
}
