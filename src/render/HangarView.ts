// The ship editor's 3D hangar (spec M2, 4.6.2 and 4.6.4; conventions ch. 16): platform, azure 15 × 15
// grid, the ship through the same ShipView as in flight (hull connectors change live), the part ghost,
// highlights, layers (centre of mass, thrust, laser arcs) and the ship's dimension lines. Around it the
// hangar bay (HangarBay) and the ships stored at this station, parked on the bay deck (ParkedShips).
import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  DoubleSide,
  EdgesGeometry,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  HemisphereLight,
  LineBasicMaterial,
  LineDashedMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  RingGeometry,
  Scene,
  Shape,
  ShapeGeometry,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
  Vector2,
  type Material,
} from 'three';
import type { PaintId } from '../data/paints';
import type { ShapeId } from '../data/shapes';
import { parsePartKey, partDef } from '../data/parts';
import { CANNON_HALF_ARC } from '../sim/combat/weapons';
import { BLOCKED_EXHAUST_THRUST } from '../sim/ship/exhaust';
import { LASER_HALF_ARC } from '../sim/mining/laser';
import { facing, partCells, partCenter, rotatedSize } from '../sim/ship/grid';
import { computeProperties, type ShipProperties } from '../sim/ship/properties';
import { partSize, shapePolygon } from '../sim/ship/shape';
import { leverArms } from '../sim/ship/turnTime';
import type { PlacedPart, ShipGrid } from '../sim/ship/types';
import type { StoredShip } from '../sim/fleet/types';
import type { StationId } from '../sim/world/stations';
import { HANGAR_MAX, HANGAR_MIN } from '../sim/shipyard/editor';
import type { Ghost, HangarScene, MirrorScene } from '../game/shipyardEditor';
import { tierMaterial } from './assets/catalog';
import type { ModelLibrary } from './assets/ModelLibrary';
import { connectorPlacements, type ConnectorPlacement } from './connectors';
import { simToWorld } from './coords';
import { HangarBay } from './HangarBay';
import { HANGAR_FLOOR, HANGAR_FOV, HangarCamera, PITCH_DEFAULT, PITCH_MIN, pickCell, type Cell } from './hangarCamera';
import { hullShellVersion } from './hull/setting';
import { applyPaint } from './paint';
import { ParkedShips } from './ParkedShips';
import type { QualityPreset } from './quality';
import { ShipView } from './ShipView';

export { HANGAR_FLOOR };
const QUARTER = Math.PI / 2;

// colours of the UI language (tokens.css)
const GLOW = 0x62d9f4;
const OK = 0x6be38a;
const BAD = 0xff5a4a;
const WARN = 0xffb547;
const TRIM = 0xf27a2c;

/** Heights of the layers above the floor. */
const Y_GRID = HANGAR_FLOOR + 0.012;
const Y_MARK = HANGAR_FLOOR + 0.02;
const Y_LAYER = 0.3;
/** The shaped-armour ghost (SL2 E2): a flat slab of the shape polygon from the hull's belly to just over the deck. */
const SHAPE_GHOST_Z: readonly [number, number] = [-0.2, 0.24];
/** The slab is shrunk around the part centre like the box fallback, so neighbouring parts stay readable. */
const SHAPE_GHOST_SCALE = 0.94;

interface Viewport {
  left: number;
  top: number;
  width: number;
  height: number;
}

const cellKey = (p: { x: number; y: number }): string => `${p.x},${p.y}`;

export class HangarView {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(HANGAR_FOV, 1, 0.1, 400);
  /** Orbit / tilt / pan / zoom with a damped goal pose (hangarCamera.ts). */
  readonly view = new HangarCamera();
  /** The camera moved in the last update – the UI over the hangar and the hover cell follow it. */
  cameraMoved = false;
  /** Frame of the ship grid: local +x (bow) points up on the screen, +y (port) to the left. */
  private readonly yard = new Group();
  private readonly shipHolder = new Group();
  private ship: ShipView | null = null;
  private readonly ghostGroup = new Group();
  private readonly marks = new Group();
  private readonly layerGroup = new Group();
  private readonly dims = new Group();
  private readonly platform: Object3D;
  /** The hangar bay around the platform (deck, walls, assembly arms – art batch D). */
  private readonly bay = new HangarBay();
  /** Ships stored at this station, parked on the bay deck beside the platform (M4a). */
  private readonly parked: ParkedShips;
  /** The platform model loaded (the models are there – the bay may load too). */
  private readonly hasModels: boolean;
  private readonly owned: { geometries: BufferGeometry[]; materials: Material[] } = { geometries: [], materials: [] };
  private readonly labels = new Map<string, { texture: CanvasTexture; material: SpriteMaterial }>();
  private props: ShipProperties | null = null;
  /** Paint of the edited ship (M4c) and the hull shell setting it was put on with (setPaint). */
  private paint: PaintId = 'factory';
  private paintShell = hullShellVersion();

  // shared geometries and materials (owned by the view, freed by dispose())
  private readonly cellFill: PlaneGeometry;
  private readonly cellEdge: BufferGeometry;
  private readonly cellOutline: BufferGeometry;
  private readonly boxGeometry: BoxGeometry;
  private readonly boxEdges: EdgesGeometry;
  private readonly arrowGeometry: ShapeGeometry;
  private readonly edgeBar: BoxGeometry;
  private readonly cornerBar: BoxGeometry;
  private readonly mat: Record<string, Material>;

  private grid: ShipGrid | null = null;
  private sceneRef: HangarScene | null = null;
  private ghostKey = '';
  private time = 0;
  /** Frame the ship on the next sync (the editor opens). */
  private needsFrame = true;
  /** Occupied cells of the drawn grid – the part bodies the pointer ray can hit. */
  private bodies: Cell[] = [];
  private viewport: Viewport = { left: 0, top: 0, width: 1, height: 1 };
  private canvas = { width: 1, height: 1 };
  private readonly raycaster = new Raycaster();
  private readonly ndc = new Vector2();

  constructor(private readonly library: ModelLibrary) {
    this.scene.background = new Color(0x060d16);
    this.yard.rotation.y = QUARTER;
    this.scene.add(this.yard);

    const hemi = new HemisphereLight(0xc4d8ff, 0x1b2230, 1.1);
    const key = new DirectionalLight(0xfff2de, 2.4);
    key.position.set(-10, 24, 14);
    const fill = new DirectionalLight(0x86b4ff, 0.7);
    fill.position.set(14, 10, -12);
    this.scene.add(hemi, key, fill);

    this.cellFill = this.geo(new PlaneGeometry(0.94, 0.94).rotateX(-QUARTER));
    this.cellEdge = this.geo(squareFrame(0.98, 0.07));
    this.cellOutline = this.geo(squareOutline(0.94));
    this.boxGeometry = this.geo(new BoxGeometry(1.02, 1.1, 1.02).translate(0, 0.25, 0));
    this.boxEdges = this.geo(new EdgesGeometry(this.boxGeometry));
    this.arrowGeometry = this.geo(arrowShape());
    this.edgeBar = this.geo(new BoxGeometry(0.16, 0.14, 0.72));
    this.cornerBar = this.geo(new BoxGeometry(0.22, 0.14, 0.22));

    const basic = (color: number, opacity: number, extra: Partial<MeshBasicMaterial> = {}) =>
      this.material(new MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: DoubleSide, forceSinglePass: true, ...extra }));
    const line = (color: number, opacity: number, depthTest = true) =>
      this.material(new LineBasicMaterial({ color, transparent: true, opacity, depthTest }));
    this.mat = {
      grid: line(GLOW, 0.3),
      gridMajor: line(GLOW, 0.55),
      frame: basic(GLOW, 0.75),
      outside: basic(0x02060b, 0.62),
      ghostOk: this.material(
        new MeshStandardMaterial({ color: OK, emissive: OK, emissiveIntensity: 0.55, transparent: true, opacity: 0.5, depthWrite: false, roughness: 0.6 }),
      ),
      ghostBad: this.material(
        new MeshStandardMaterial({ color: BAD, emissive: BAD, emissiveIntensity: 0.6, transparent: true, opacity: 0.5, depthWrite: false, depthTest: false, roughness: 0.6 }),
      ),
      cellOk: basic(OK, 0.22),
      cellBad: basic(BAD, 0.22),
      edgeOk: basic(OK, 0.95, { depthTest: false }),
      edgeBad: basic(BAD, 0.95, { depthTest: false }),
      joint: basic(GLOW, 0.9, { blending: AdditiveBlending }),
      tintBad: basic(BAD, 0.26),
      edgeTintBad: basic(BAD, 0.85, { depthTest: false }),
      focusError: line(BAD, 1, false),
      focusWarn: line(WARN, 1, false),
      fillWarn: basic(WARN, 0.22),
      hover: basic(GLOW, 0.9, { depthTest: false }),
      hoverLine: line(GLOW, 0.75, false),
      hoverFill: basic(GLOW, 0.12),
      origin: this.material(new LineDashedMaterial({ color: GLOW, dashSize: 0.14, gapSize: 0.1, transparent: true, opacity: 0.9, depthTest: false })),
      // sockets of parts the ship lost against its blueprint (M3.8) – the red dashed cell of the HUD
      socket: this.material(new LineDashedMaterial({ color: BAD, dashSize: 0.12, gapSize: 0.1, transparent: true, opacity: 0.95, depthTest: false })),
      socketFill: basic(BAD, 0.1),
      com: basic(TRIM, 0.95, { depthTest: false }),
      // lever arms (SL2 §5.1): thin dashed lines from the centre of mass to the heaviest far parts
      lever: this.material(new LineDashedMaterial({ color: TRIM, dashSize: 0.16, gapSize: 0.1, transparent: true, opacity: 0.9, depthTest: false })),
      leverEnd: basic(TRIM, 0.8, { depthTest: false }),
      thrust: basic(GLOW, 0.85, { depthTest: false }),
      // a covered nozzle (half thrust, burns the part in front of it – ship/exhaust.ts)
      thrustBlocked: basic(BAD, 0.9, { depthTest: false }),
      exhaustBurn: basic(BAD, 0.4, { depthTest: false }),
      arc: basic(GLOW, 0.16, { depthTest: false }),
      arcEdge: basic(GLOW, 0.6, { depthTest: false }),
      cannonArc: basic(TRIM, 0.1, { depthTest: false }),
      cannonArcEdge: basic(TRIM, 0.7, { depthTest: false }),
      dim: line(GLOW, 0.85, false),
    };

    const template = library.hangar();
    // platform v2 keeps everything below the floor's view cone – drawn solid, no clipping
    this.platform = template ? template.clone() : this.placeholderFloor();
    this.yard.add(this.platform);
    // the bay shares the platform's frame; without models (placeholder floor) there is no bay either
    // (loaded by setQuality – a software rasterizer leaves it out)
    this.hasModels = template !== null;
    this.yard.add(this.bay.object);
    // parked ships stand on the bay's deck – shown with the bay only
    this.parked = new ParkedShips(library);
    this.parked.object.visible = false;
    this.yard.add(this.parked.object);
    this.yard.add(this.buildGrid());
    this.shipHolder.name = 'hangar-ship';
    this.yard.add(this.shipHolder, this.marks, this.ghostGroup, this.dims, this.layerGroup);
  }

  // -------------------------------------------------------------------------
  // resource ownership helpers

  private geo<T extends BufferGeometry>(g: T): T {
    this.owned.geometries.push(g);
    return g;
  }

  private material<T extends Material>(m: T): T {
    this.owned.materials.push(m);
    return m;
  }

  private placeholderFloor(): Object3D {
    const floor = new Mesh(
      this.geo(new PlaneGeometry(17, 17).rotateX(-QUARTER)),
      this.material(new MeshStandardMaterial({ color: 0x1c2330, roughness: 0.85, metalness: 0.2 })),
    );
    floor.position.y = HANGAR_FLOOR;
    return floor;
  }

  /** The 15 × 15 grid (lines on half coordinates), its frame and the darkened border outside the hangar. */
  private buildGrid(): Object3D {
    const group = new Group();
    const minor: number[] = [];
    const major: number[] = [];
    const lo = HANGAR_MIN - 0.5;
    const hi = HANGAR_MAX + 0.5;
    for (let i = HANGAR_MIN - 0.5; i <= HANGAR_MAX + 0.5 + 1e-9; i++) {
      // the ship's axis (x = 0.5 / y = 0.5 around the centre) emphasised as on a drawing
      const list = Math.abs(i) === 0.5 ? major : minor;
      list.push(...simToWorld({ x: i, y: lo }, Y_GRID).toArray(), ...simToWorld({ x: i, y: hi }, Y_GRID).toArray());
      list.push(...simToWorld({ x: lo, y: i }, Y_GRID).toArray(), ...simToWorld({ x: hi, y: i }, Y_GRID).toArray());
    }
    group.add(new LineSegments(this.geo(lineGeometry(minor)), this.mat.grid!));
    group.add(new LineSegments(this.geo(lineGeometry(major)), this.mat.gridMajor!));

    // the 15 × 15 frame – solid bands along the edge
    const span = hi - lo;
    const bar = this.geo(new PlaneGeometry(span + 0.12, 0.06).rotateX(-QUARTER));
    for (const [x, y, rot] of [
      [hi + 0.03, 0, 1],
      [lo - 0.03, 0, 1],
      [0, hi + 0.03, 0],
      [0, lo - 0.03, 0],
    ] as const) {
      const m = new Mesh(bar, this.mat.frame!);
      simToWorld({ x, y }, Y_GRID + 0.002, m.position);
      m.rotation.y = rot * QUARTER;
      group.add(m);
    }
    // cells outside the hangar are dark (the platform is 17 × 17, the grid 15 × 15)
    const band = this.geo(new PlaneGeometry(20, 2.5).rotateX(-QUARTER));
    for (const [x, y, rot] of [
      [hi + 1.25, 0, 1],
      [lo - 1.25, 0, 1],
      [0, hi + 1.25, 0],
      [0, lo - 1.25, 0],
    ] as const) {
      const m = new Mesh(band, this.mat.outside!);
      simToWorld({ x, y }, Y_GRID - 0.004, m.position);
      m.rotation.y = rot * QUARTER;
      group.add(m);
    }
    return group;
  }

  // -------------------------------------------------------------------------
  // camera and coordinate conversion

  /** The editor's free area (window px) and the canvas size – the camera centres the hangar in it. */
  setViewport(rect: Viewport, canvas: { left: number; top: number; width: number; height: number }): void {
    const left = rect.left - canvas.left;
    const top = rect.top - canvas.top;
    const v = this.viewport;
    if (v.left === left && v.top === top && v.width === rect.width && v.height === rect.height && this.canvas.width === canvas.width && this.canvas.height === canvas.height) return;
    this.viewport = { left, top, width: Math.max(1, rect.width), height: Math.max(1, rect.height) };
    this.canvas = { width: Math.max(1, canvas.width), height: Math.max(1, canvas.height) };
  }

  zoomBy(deltaY: number): void {
    this.view.zoomBy(deltaY);
  }

  /** Pan by pixels (Shift + middle drag): the floor follows the pointer. */
  panBy(dx: number, dy: number): void {
    this.view.panBy(dx, dy);
  }

  /** Orbit (horizontal) and tilt (vertical) by pixels: middle drag or Alt + left drag. */
  orbitBy(dx: number, dy: number): void {
    this.view.orbitDrag(dx, dy);
  }

  /** Held camera keys for one frame: Q/E orbit, PgUp/PgDn tilt, arrows pan. */
  cameraKeys(dt: number, input: { orbit: number; tilt: number; panX: number; panY: number }): void {
    this.view.keys(dt, input);
  }

  /** Resolves once the hangar bay's model is in (or not wanted) – the shader warm-up compiles it with the hangar. */
  bayReady(): Promise<void> {
    return this.bay.ready();
  }

  /** Reduced motion: the camera jumps to the goal pose instead of easing; the bay's arms stay parked. */
  set reducedMotion(on: boolean) {
    this.view.reducedMotion = on;
    this.bay.reducedMotion = on;
  }

  /** Graphics quality: the hangar bay on or off, the share of its weld sparks. */
  setQuality(preset: Pick<QualityPreset, 'hangarBay' | 'particles'>): void {
    this.bay.object.visible = preset.hangarBay && this.hasModels;
    this.parked.object.visible = this.bay.object.visible;
    if (this.bay.object.visible) this.bay.load();
    this.bay.setParticles(preset.particles);
  }

  /** The hangar bay (tests, screenshots). */
  bayStats(): ReturnType<HangarBay['stats']> {
    return this.bay.stats();
  }

  /**
   * The ships stored at the docked station (null = not docked) park beside the platform; rebuilt only
   * when that list changes (cheap per-frame check, ParkedShips.sync). Called every hangar frame.
   */
  syncParked(stored: readonly StoredShip[], stationId: StationId | null): void {
    // without the bay (software preset) there is no deck to stand on – nothing is built
    if (this.parked.object.visible) this.parked.sync(stored, stationId);
  }

  /** The parked ships (tests, screenshots). */
  parkedStats(): ReturnType<ParkedShips['stats']> & { visible: boolean } {
    return { ...this.parked.stats(), visible: this.parked.object.visible };
  }

  /** C – centre the ship at the default zoom (the orbit and tilt stay). */
  resetView(): void {
    this.view.centre(this.shipCentre());
  }

  /** Home / "Top view": straight down, bow up, centred on the ship. */
  topView(): void {
    this.view.topView(this.shipCentre());
  }

  /** The editor opens – the next sync frames the ship. */
  frameOnOpen(): void {
    this.needsFrame = true;
  }

  /** World floor point (x, z) in the middle of the ship's bounding box (the hangar centre when empty). */
  private shipCentre(): { x: number; z: number } {
    const grid = this.grid;
    if (!grid || grid.parts.length === 0) return { x: 0, z: 0 };
    const cells = grid.parts.flatMap(partCells);
    const cx = (Math.min(...cells.map((c) => c.x)) + Math.max(...cells.map((c) => c.x))) / 2;
    const cy = (Math.min(...cells.map((c) => c.y)) + Math.max(...cells.map((c) => c.y))) / 2;
    this.yard.updateMatrixWorld();
    const p = this.yard.localToWorld(simToWorld({ x: cx, y: cy }));
    return { x: p.x, z: p.z };
  }

  private updateCamera(dt: number): void {
    const v = this.viewport;
    this.view.viewportHeight = v.height;
    this.view.aspect = v.width / v.height;
    this.cameraMoved = this.view.update(dt);
    this.view.apply(this.camera);
    this.camera.aspect = v.width / v.height;
    this.camera.setViewOffset(v.width, v.height, -v.left, -v.top, this.canvas.width, this.canvas.height);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    // a low view packs the grid lines tighter: lift them a little so the cells stay readable
    const low = Math.max(0, Math.min(1, (PITCH_DEFAULT - this.view.current.pitch) / (PITCH_DEFAULT - PITCH_MIN)));
    this.mat.grid!.opacity = 0.3 + 0.14 * low;
    this.mat.gridMajor!.opacity = 0.55 + 0.15 * low;
  }

  /** Grid cell under a window pixel (may be outside the hangar), or null – a ray onto the floor plane. */
  cellAt(ndcX: number, ndcY: number): { x: number; y: number } | null {
    this.ndc.set(ndcX, ndcY);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    return pickCell(this.raycaster.ray, this.bodies);
  }

  /**
   * A cell on the canvas: its floor centre and two half-cell axes (px) – `a` toward starboard (screen
   * right in the default view), `b` toward the stern (screen down). The training's suggested cells
   * take the cell's projected shape from them in any view.
   */
  cellQuad(x: number, y: number): { x: number; y: number; ax: number; ay: number; bx: number; by: number } {
    const c = this.cellToCanvas(x, y, HANGAR_FLOOR);
    const a = this.cellToCanvas(x, y - 0.5, HANGAR_FLOOR);
    const b = this.cellToCanvas(x - 0.5, y, HANGAR_FLOOR);
    return { x: c.x, y: c.y, ax: a.x - c.x, ay: a.y - c.y, bx: b.x - c.x, by: b.y - c.y };
  }

  /** Screen direction of the bow (degrees clockwise from up) – the bow marker over the hangar. */
  bowAngle(): number {
    const c = this.cellToCanvas(0, 0, HANGAR_FLOOR);
    const a = this.cellToCanvas(1, 0, HANGAR_FLOOR);
    return (Math.atan2(a.x - c.x, c.y - a.y) * 180) / Math.PI;
  }

  /** Canvas pixel (from the top left corner) of a cell centre – the label next to the ghost. */
  cellToCanvas(x: number, y: number, height = 0.6): { x: number; y: number } {
    const p = this.yard.localToWorld(simToWorld({ x, y }, height)).project(this.camera);
    return { x: ((p.x + 1) / 2) * this.canvas.width, y: ((1 - p.y) / 2) * this.canvas.height };
  }

  // -------------------------------------------------------------------------
  // scene content

  /** Brings the scene in line with the editor state; rebuilds only what changed. */
  sync(state: HangarScene): void {
    if (state.grid !== this.grid) {
      this.grid = state.grid;
      this.bodies = state.grid.parts.flatMap(partCells);
      this.rebuildShip(state.grid);
    }
    if (this.needsFrame) {
      this.needsFrame = false;
      this.view.frame(this.shipCentre());
    }
    if (state === this.sceneRef) return;
    this.sceneRef = state;
    this.updateGhost(state.ghost, state.grid);
    this.updateMirror(state.mirror, state.grid);
    this.rebuildMarks(state);
    this.rebuildLayers(state);
    this.syncSelection(state);
  }

  private rebuildShip(grid: ShipGrid): void {
    if (grid.parts.length === 0) {
      this.ship?.dispose();
      if (this.ship) this.shipHolder.remove(this.ship.group);
      this.ship = null;
      this.props = null;
      this.rebuildDims(grid);
      return;
    }
    const props = computeProperties(grid);
    this.props = props;
    if (this.ship) this.ship.rebuild(grid, props);
    else {
      this.ship = new ShipView(grid, props, this.library, null, { mode: 'shipyard' });
      this.shipHolder.add(this.ship.group);
    }
    applyPaint(this.ship.group, this.paint);
    // ShipView draws the ship around its centre of mass – in the hangar the grid origin belongs in the platform centre
    simToWorld(props.centerOfMass, 0, this.ship.group.position);
    this.rebuildDims(grid);
  }

  private updateGhost(ghost: Ghost | null, grid: ShipGrid): void {
    this.ghostKey = this.drawGhost(this.ghostGroup, this.ghostKey, ghost, grid, true);
  }

  /**
   * A part ghost in `group`: the translucent model (rebuilt only when `prevKey` changes), the cells under
   * it and, with `joints`, the connectors it would create. Returns the new key.
   */
  private drawGhost(group: Group, prevKey: string, ghost: Ghost | null, grid: ShipGrid, joints: boolean): string {
    const key = ghost ? `${ghost.key}|${ghost.shape ?? ''}|${ghost.rot}|${ghost.error === null}` : '';
    if (key !== prevKey) {
      group.clear();
      if (ghost) group.add(this.ghostModel(ghost));
    }
    // the floor under the ghost and the connectors it would create
    const model = group.children[0];
    group.children.slice(1).forEach((c) => group.remove(c));
    if (!ghost || !model) return key;
    const { partId, tier } = parsePartKey(ghost.key);
    const part: PlacedPart = { id: -1, partId, tier, x: ghost.x, y: ghost.y, rot: ghost.rot, ...(ghost.shape ? { shape: ghost.shape } : {}) };
    simToWorld(partCenter(part), 0, model.position);
    const valid = ghost.error === null;
    for (const c of partCells(part)) {
      const edge = new Mesh(this.cellEdge, valid ? this.mat.edgeOk! : this.mat.edgeBad!);
      simToWorld(c, Y_MARK, edge.position);
      edge.renderOrder = 3;
      group.add(edge);
      // a shaped ghost keeps only the cell frame – a full-cell fill would hide the shape's empty part
      if (ghost.shape) continue;
      const fill = new Mesh(this.cellFill, valid ? this.mat.cellOk! : this.mat.cellBad!);
      simToWorld(c, Y_MARK, fill.position);
      group.add(fill);
    }
    if (valid && joints) {
      const others = grid.parts.filter((p) => p.id !== ghost.movingId);
      for (const j of newJoints(others, part)) {
        const bar = new Mesh(j.kind === 'edge' ? this.edgeBar : this.cornerBar, this.mat.joint!);
        simToWorld(j, 0.05, bar.position);
        bar.rotation.y = j.rot * QUARTER;
        bar.renderOrder = 4;
        group.add(bar);
      }
    }
    return key;
  }

  // -------------------------------------------------------------------------
  // mirror mode (SL2 E1): the axis on the floor and the ghost of the mirror copy

  private readonly mirrorGroup = new Group();
  private mirrorGhostKey = '';
  private mirrorAxisLine: Object3D | null = null;

  private updateMirror(mirror: MirrorScene | null, grid: ShipGrid): void {
    if (!this.mirrorGroup.parent) this.yard.add(this.mirrorGroup);
    if (mirror) {
      const axis = this.axisLine();
      axis.visible = true;
      let tag = axis.children.find((c) => c instanceof Sprite);
      if (axis.userData.label !== mirror.label) {
        // the tag follows the language
        if (tag) axis.remove(tag);
        tag = this.tag(mirror.label, { x: 0, y: 0 }, '#f27a2c');
        tag.scale.multiplyScalar(0.8);
        axis.add(tag);
        axis.userData.label = mirror.label;
      }
      // the tag stands on the axis just ahead of the bow (in view in the default camera)
      const bow = grid.parts.length > 0 ? Math.max(...grid.parts.flatMap(partCells).map((c) => c.x)) : 0;
      simToWorld({ x: Math.min(bow + 2, HANGAR_MAX + 0.5), y: 0 }, Y_MARK + 0.45, tag!.position);
      // the line runs along the ship (x) at y = axis2 / 2
      simToWorld({ x: 0, y: mirror.axis2 / 2 }, 0, axis.position);
    } else if (this.mirrorAxisLine) {
      this.mirrorAxisLine.visible = false;
    }
    this.mirrorGhostKey = this.drawGhost(this.mirrorGroup, this.mirrorGhostKey, mirror?.ghost ?? null, grid, false);
  }

  /**
   * The mirror axis: a dashed trim-orange strip on the floor across the whole hangar (one mesh); the
   * "OS" tag ahead of the bow is added by `updateMirror`. Built once, moved to the axis row.
   */
  private axisLine(): Object3D {
    if (this.mirrorAxisLine) return this.mirrorAxisLine;
    const group = new Group();
    group.name = 'mirror-axis';
    const from = HANGAR_MIN - 0.5;
    const to = HANGAR_MAX + 0.5;
    const dash = 0.36;
    const gap = 0.18;
    const half = 0.035;
    const pos: number[] = [];
    const index: number[] = [];
    for (let x = from; x < to - 1e-6; x += dash + gap) {
      const x1 = Math.min(x + dash, to);
      const i = pos.length / 3;
      // floor plane: world (x, 0, −y); the strip is ±half around y = 0
      pos.push(x, 0, -half, x1, 0, -half, x1, 0, half, x, 0, half);
      index.push(i, i + 2, i + 1, i, i + 3, i + 2);
    }
    const geometry = this.geo(new BufferGeometry());
    geometry.setAttribute('position', new Float32BufferAttribute(pos, 3));
    geometry.setIndex(index);
    const material = this.material(
      new MeshBasicMaterial({ color: TRIM, transparent: true, opacity: 0.85, depthWrite: false, depthTest: false, side: DoubleSide, forceSinglePass: true }),
    );
    const strip = new Mesh(geometry, material);
    strip.position.y = Y_MARK + 0.008;
    strip.renderOrder = 6;
    group.add(strip);
    this.yard.add(group);
    this.mirrorAxisLine = group;
    return group;
  }

  /**
   * Translucent part model (green / red material), geometry shared with the template; a shaped armour is
   * the flat slab of its polygon (`shapeGhostGeometry`).
   */
  private ghostModel(ghost: Pick<Ghost, 'key' | 'rot' | 'shape' | 'error'>): Object3D {
    const { partId, tier } = parsePartKey(ghost.key);
    const material = ghost.error === null ? this.mat.ghostOk! : this.mat.ghostBad!;
    const template = ghost.shape ? null : this.library.part(partId, tierMaterial(tier));
    let node: Object3D;
    if (ghost.shape) {
      node = new Mesh(this.shapeGhostGeometry(ghost.shape), material);
      node.rotation.y = ghost.rot * QUARTER;
    } else if (template) {
      node = template.clone();
      node.traverse((o) => {
        if (o instanceof Mesh) o.material = material;
      });
      node.rotation.y = ghost.rot * QUARTER;
    } else {
      const { w, h } = rotatedSize(partSize({ partId, tier }), ghost.rot);
      node = new Mesh(this.boxGeometry, material);
      node.scale.set(w * 0.9, 0.6, h * 0.9);
    }
    node.renderOrder = 2;
    return node;
  }

  private readonly shapeGhostGeometries = new Map<ShapeId, BufferGeometry>();

  /**
   * The ghost slab of a shape at rot 0 (part-centred; the node turns it): the render-detail polygon
   * extruded over `SHAPE_GHOST_Z`. Built once per shape and owned by the view.
   */
  private shapeGhostGeometry(shape: ShapeId): BufferGeometry {
    let geometry = this.shapeGhostGeometries.get(shape);
    if (!geometry) {
      const outline = new Shape(shapePolygon(shape, 0, 'render').map((v) => new Vector2(v.x * SHAPE_GHOST_SCALE, v.y * SHAPE_GHOST_SCALE)));
      const [bottom, top] = SHAPE_GHOST_Z;
      // the shape lies in the x/y plane: −90° about x puts sim y on world −z and the extrusion upwards
      geometry = this.geo(new ExtrudeGeometry(outline, { depth: top - bottom, bevelEnabled: false, curveSegments: 1 }).rotateX(-QUARTER).translate(0, bottom, 0));
      this.shapeGhostGeometries.set(shape, geometry);
    }
    return geometry;
  }

  private rebuildMarks(state: HangarScene): void {
    this.marks.clear();
    const byId = new Map(state.grid.parts.map((p) => [p.id, p]));
    const cellsOf = (ids: readonly number[]) =>
      ids.flatMap((id) => {
        const p = byId.get(id);
        return p ? partCells(p) : [];
      });
    // disconnected parts: a red tint over the whole volume + an outline on the floor
    for (const c of cellsOf(state.disconnected)) {
      const box = new Mesh(this.boxGeometry, this.mat.tintBad!);
      simToWorld(c, 0, box.position);
      box.renderOrder = 2;
      const edge = new Mesh(this.cellEdge, this.mat.edgeTintBad!);
      simToWorld(c, Y_MARK, edge.position);
      this.marks.add(box, edge);
    }
    if (state.focus) {
      const error = state.focus.tone === 'error';
      for (const c of cellsOf(state.focus.ids)) {
        const box = new LineSegments(this.boxEdges, error ? this.mat.focusError! : this.mat.focusWarn!);
        simToWorld(c, 0, box.position);
        box.renderOrder = 5;
        box.userData.pulse = true;
        const fill = new Mesh(this.boxGeometry, error ? this.mat.tintBad! : this.mat.fillWarn!);
        simToWorld(c, 0, fill.position);
        this.marks.add(box, fill);
      }
    }
    if (state.hoverId !== null) {
      for (const c of cellsOf([state.hoverId])) {
        const edge = new Mesh(this.cellEdge, this.mat.hover!);
        simToWorld(c, Y_MARK, edge.position);
        edge.renderOrder = 3;
        const fill = new Mesh(this.cellFill, this.mat.hoverFill!);
        simToWorld(c, Y_MARK, fill.position);
        const box = new LineSegments(this.boxEdges, this.mat.hoverLine!);
        simToWorld(c, 0, box.position);
        this.marks.add(edge, fill, box);
      }
    }
    if (state.blueprint) {
      for (const c of state.blueprint) {
        const edge = new LineSegments(this.cellOutline, this.mat.socket!);
        edge.computeLineDistances();
        simToWorld(c, Y_MARK, edge.position);
        edge.renderOrder = 3;
        const fill = new Mesh(this.cellFill, this.mat.socketFill!);
        simToWorld(c, Y_MARK, fill.position);
        this.marks.add(edge, fill);
      }
    }
    if (state.origin) {
      for (const c of state.origin) {
        const edge = new LineSegments(this.cellOutline, this.mat.origin!);
        edge.computeLineDistances();
        simToWorld(c, Y_MARK, edge.position);
        edge.renderOrder = 3;
        this.marks.add(edge);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Shipyard 2.0: group selection, selection box, dragged group ghost, "not connected" tags

  private readonly selectionGroup = new Group();
  private readonly groupModels = new Map<string, Object3D>();
  private selectionMat: { frame: Material; line: Material; boxFill: Material; boxEdge: Material } | null = null;

  /** Materials of the selection (the trim orange of a selected palette row) and of the selection box. */
  private selMat(): NonNullable<HangarView['selectionMat']> {
    if (!this.selectionMat) {
      const basic = (color: number, opacity: number, depthTest = true) =>
        this.material(new MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, depthTest, side: DoubleSide, forceSinglePass: true }));
      this.selectionMat = {
        frame: basic(TRIM, 0.95, false),
        line: this.material(new LineBasicMaterial({ color: TRIM, transparent: true, opacity: 0.85, depthTest: false })),
        boxFill: basic(GLOW, 0.1),
        boxEdge: basic(GLOW, 0.9, false),
      };
      this.yard.add(this.selectionGroup);
    }
    return this.selectionMat;
  }

  private syncSelection(state: HangarScene): void {
    const m = this.selMat();
    for (const child of [...this.selectionGroup.children]) {
      this.selectionGroup.remove(child);
      if (child.userData.ownGeometry) (child as LineSegments).geometry.dispose();
    }
    const byId = new Map(state.grid.parts.map((p) => [p.id, p]));
    // selected parts: trim frame on the floor + the part's volume outlined
    for (const id of state.selection) {
      const p = byId.get(id);
      if (!p) continue;
      for (const c of partCells(p)) {
        const edge = new Mesh(this.cellEdge, m.frame);
        simToWorld(c, Y_MARK + 0.004, edge.position);
        edge.renderOrder = 4;
        const box = new LineSegments(this.boxEdges, m.line);
        simToWorld(c, 0, box.position);
        box.renderOrder = 4;
        this.selectionGroup.add(edge, box);
      }
    }
    // Shift + drag box: azure tint of the covered cells and a frame around them
    if (state.box) {
      const { min, max } = state.box;
      for (let x = min.x; x <= max.x; x++) {
        for (let y = min.y; y <= max.y; y++) {
          const fill = new Mesh(this.cellFill, m.boxFill);
          simToWorld({ x, y }, Y_MARK + 0.002, fill.position);
          this.selectionGroup.add(fill);
        }
      }
      const pts: number[] = [];
      const lo = { x: min.x - 0.5, y: min.y - 0.5 };
      const hi = { x: max.x + 0.5, y: max.y + 0.5 };
      const corners = [lo, { x: hi.x, y: lo.y }, hi, { x: lo.x, y: hi.y }];
      for (let i = 0; i < 4; i++) pts.push(...simToWorld(corners[i]!, Y_MARK + 0.01).toArray(), ...simToWorld(corners[(i + 1) % 4]!, Y_MARK + 0.01).toArray());
      const frame = new LineSegments(lineGeometry(pts), m.line);
      frame.renderOrder = 5;
      frame.userData.ownGeometry = true;
      this.selectionGroup.add(frame);
    }
    this.updateGroupGhost(state.group);
    // "not connected" tags over each loose piece
    if (state.loose) {
      for (const c of state.loose.cells) this.selectionGroup.add(this.tag(state.loose.label, c));
    }
  }

  /** Ghost of a dragged group: each part green / red by its own cells, every cell coloured by itself. */
  private updateGroupGhost(group: HangarScene['group']): void {
    const used = new Set<string>();
    if (group) {
      for (const p of group.parts) {
        const key = `${p.id}|${p.key}|${p.shape ?? ''}|${p.rot}|${p.ok}`;
        used.add(key);
        let model = this.groupModels.get(key);
        if (!model) {
          model = this.ghostModel({ key: p.key, rot: p.rot, ...(p.shape ? { shape: p.shape } : {}), error: p.ok ? null : 'occupied' });
          this.groupModels.set(key, model);
        }
        const { partId, tier } = parsePartKey(p.key);
        simToWorld(partCenter({ id: -1, partId, tier, x: p.x, y: p.y, rot: p.rot, ...(p.shape ? { shape: p.shape } : {}) }), 0, model.position);
        this.selectionGroup.add(model);
      }
      for (const c of group.cells) {
        const fill = new Mesh(this.cellFill, c.ok ? this.mat.cellOk! : this.mat.cellBad!);
        simToWorld(c, Y_MARK, fill.position);
        const edge = new Mesh(this.cellEdge, c.ok ? this.mat.edgeOk! : this.mat.edgeBad!);
        simToWorld(c, Y_MARK, edge.position);
        edge.renderOrder = 3;
        this.selectionGroup.add(fill, edge);
      }
    }
    for (const key of [...this.groupModels.keys()]) if (!used.has(key)) this.groupModels.delete(key);
  }

  /** A "not connected" tag standing over a cell (sprite – it faces the camera in any view); red edge by default. */
  private tag(text: string, at: { x: number; y: number }, edge = '#ff5a4a'): Sprite {
    const id = `tag:${edge}:${text}`;
    let entry = this.labels.get(id);
    if (!entry) {
      const texture = tagTexture(text, edge);
      entry = { texture, material: new SpriteMaterial({ map: texture, transparent: true, depthTest: false }) };
      this.labels.set(id, entry);
    }
    const sprite = new Sprite(entry.material);
    simToWorld(at, 1.25, sprite.position);
    const aspect = entry.texture.image.width / entry.texture.image.height;
    sprite.scale.set(0.62 * aspect, 0.62, 1);
    sprite.renderOrder = 9;
    return sprite;
  }

  /**
   * Layers: the centre of mass (orange crosshair), engine thrust arrows (red and shorter for a covered
   * nozzle, with the burnt cell in red), laser arcs, cannon arcs and the lever arms (the 2 parts with the
   * largest m·r² – what makes the "Turn 180°" time long).
   */
  private rebuildLayers(state: HangarScene): void {
    for (const child of [...this.layerGroup.children]) {
      this.layerGroup.remove(child);
      // the lever-arm lines own their geometry, everything else uses cached geometry
      if (child instanceof LineSegments) child.geometry.dispose();
    }
    this.layerGroup.visible = state.layers;
    const grid = this.grid;
    const props = this.props;
    if (!state.layers || !grid || !props) return;
    const maxThrust = Math.max(1, ...grid.parts.map((p) => partDef(p.partId, p.tier, p.variant).thrust ?? 0));
    const covered = new Set(props.exhaustBurns.map((b) => b.engineId));
    for (const p of grid.parts) {
      const def = partDef(p.partId, p.tier, p.variant);
      const c = partCenter(p);
      if (def.thrust) {
        const f = facing(p.rot);
        const blocked = covered.has(p.id);
        const arrow = new Mesh(this.arrowGeometry, blocked ? this.mat.thrustBlocked! : this.mat.thrust!);
        const len = 0.55 + 0.45 * ((blocked ? def.thrust * BLOCKED_EXHAUST_THRUST : def.thrust) / maxThrust);
        if (blocked) {
          // the cell the flame hits
          const burn = new Mesh(this.cellFill, this.mat.exhaustBurn!);
          simToWorld({ x: c.x - f.x, y: c.y - f.y }, Y_LAYER - 0.01, burn.position);
          burn.renderOrder = 6;
          this.layerGroup.add(burn);
        }
        simToWorld({ x: c.x + f.x * 0.05, y: c.y + f.y * 0.05 }, Y_LAYER, arrow.position);
        arrow.rotation.y = p.rot * QUARTER;
        arrow.scale.set(len, 1, 1);
        arrow.renderOrder = 6;
        this.layerGroup.add(arrow);
      }
      if (def.mining) {
        const arc = new Mesh(this.arcGeometry(), this.mat.arc!);
        const f = facing(p.rot);
        simToWorld({ x: c.x + f.x * 0.45, y: c.y + f.y * 0.45 }, Y_LAYER - 0.02, arc.position);
        arc.rotation.y = p.rot * QUARTER;
        arc.renderOrder = 6;
        this.layerGroup.add(arc);
      }
      if (def.weapon) {
        // EFFECTIVE cannon arc (±60° minus the own hull, user decision 2026-10-17) – orange fill and
        // edge so it does not blend with the lasers; a walled-in cannon shows no arc at all
        const arcs = props.weapons.find((w) => w.partId === p.id)?.arcs ?? [];
        const f = facing(p.rot);
        for (const [from, to] of arcs) {
          const { fill, edge } = this.cannonArcGeometry(from, to);
          for (const [geometry, material] of [[fill, this.mat.cannonArc!], [edge, this.mat.cannonArcEdge!]] as const) {
            const arc = new Mesh(geometry, material);
            simToWorld({ x: c.x + f.x * 0.3, y: c.y + f.y * 0.3 }, Y_LAYER - 0.03, arc.position);
            arc.rotation.y = p.rot * QUARTER;
            arc.renderOrder = 6;
            this.layerGroup.add(arc);
          }
        }
      }
    }
    this.addLeverArms(grid, props);
    const com = this.comMarker();
    simToWorld(props.centerOfMass, Y_LAYER + 0.02, com.position);
    this.layerGroup.add(com);
  }

  private leverEndCache: BufferGeometry | null = null;
  /** Lever arms: a dashed line from the centre of mass to each of the heaviest far parts, a ring on the part. */
  private addLeverArms(grid: ShipGrid, props: ShipProperties): void {
    const arms = leverArms(grid, props.centerOfMass);
    if (arms.length === 0) return;
    this.leverEndCache ??= this.geo(new RingGeometry(0.18, 0.24, 24).rotateX(-QUARTER));
    const pts: number[] = [];
    for (const arm of arms) {
      pts.push(...simToWorld(props.centerOfMass, Y_LAYER + 0.01).toArray(), ...simToWorld(arm.at, Y_LAYER + 0.01).toArray());
      const end = new Mesh(this.leverEndCache, this.mat.leverEnd!);
      simToWorld(arm.at, Y_LAYER + 0.01, end.position);
      end.renderOrder = 7;
      this.layerGroup.add(end);
    }
    const lines = new LineSegments(new BufferGeometry().setAttribute('position', new Float32BufferAttribute(pts, 3)), this.mat.lever!);
    lines.computeLineDistances();
    lines.renderOrder = 7;
    lines.name = 'lever-arms';
    this.layerGroup.add(lines);
  }

  private arcCache: BufferGeometry | null = null;
  private arcGeometry(): BufferGeometry {
    // the ±60° sector in front of the laser (in the horizontal plane, open toward +x)
    this.arcCache ??= this.geo(new RingGeometry(0.15, 1.6, 24, 1, -LASER_HALF_ARC, 2 * LASER_HALF_ARC).rotateX(-QUARTER));
    return this.arcCache;
  }

  private readonly cannonArcCache = new Map<string, { fill: BufferGeometry; edge: BufferGeometry }>();
  /** Wedge of one effective cannon arc [from, to] (rad, relative to the facing). */
  private cannonArcGeometry(from: number, to: number): { fill: BufferGeometry; edge: BufferGeometry } {
    const key = `${from.toFixed(4)},${to.toFixed(4)}`;
    let g = this.cannonArcCache.get(key);
    if (!g) {
      const width = Math.max(0.01, to - from);
      const segs = Math.max(2, Math.ceil((32 * width) / (2 * CANNON_HALF_ARC)));
      g = {
        fill: this.geo(new RingGeometry(0.2, 2.3, segs, 1, from, width).rotateX(-QUARTER)),
        edge: this.geo(new RingGeometry(2.24, 2.3, segs, 1, from, width).rotateX(-QUARTER)),
      };
      this.cannonArcCache.set(key, g);
    }
    return g;
  }

  private comCache: { ring: BufferGeometry; bar: BufferGeometry } | null = null;
  private comMarker(): Object3D {
    this.comCache ??= {
      ring: this.geo(new RingGeometry(0.2, 0.28, 32).rotateX(-QUARTER)),
      bar: this.geo(new PlaneGeometry(0.9, 0.06).rotateX(-QUARTER)),
    };
    const g = new Group();
    const ring = new Mesh(this.comCache.ring, this.mat.com!);
    const a = new Mesh(this.comCache.bar, this.mat.com!);
    const b = new Mesh(this.comCache.bar, this.mat.com!);
    b.rotation.y = QUARTER;
    for (const m of [ring, a, b]) m.renderOrder = 7;
    g.add(ring, a, b);
    return g;
  }

  /** Dimension lines: the ship's size in cells along the bottom and right edge of its outline (as on a drawing). */
  private rebuildDims(grid: ShipGrid): void {
    for (const child of [...this.dims.children]) {
      this.dims.remove(child);
      if (child instanceof LineSegments) child.geometry.dispose();
    }
    if (grid.parts.length === 0) return;
    const cells = grid.parts.flatMap(partCells);
    const minX = Math.min(...cells.map((c) => c.x)) - 0.5;
    const maxX = Math.max(...cells.map((c) => c.x)) + 0.5;
    const minY = Math.min(...cells.map((c) => c.y)) - 0.5;
    const maxY = Math.max(...cells.map((c) => c.y)) + 0.5;
    const h = Y_GRID + 0.01;
    // width (the ship's y axis = horizontal on the screen) below the stern, length (x axis) on the right
    const wX = minX - 0.55;
    const lY = minY - 0.55;
    const tick = 0.22;
    const pts: number[] = [];
    const seg = (a: { x: number; y: number }, b: { x: number; y: number }) =>
      pts.push(...simToWorld(a, h).toArray(), ...simToWorld(b, h).toArray());
    seg({ x: wX, y: minY }, { x: wX, y: maxY });
    seg({ x: wX - tick, y: minY }, { x: wX + tick, y: minY });
    seg({ x: wX - tick, y: maxY }, { x: wX + tick, y: maxY });
    seg({ x: minX, y: lY }, { x: maxX, y: lY });
    seg({ x: minX, y: lY - tick }, { x: minX, y: lY + tick });
    seg({ x: maxX, y: lY - tick }, { x: maxX, y: lY + tick });
    // extension lines from the outline to the dimension line
    seg({ x: minX, y: minY }, { x: wX - tick, y: minY });
    seg({ x: minX, y: maxY }, { x: wX - tick, y: maxY });
    seg({ x: minX, y: minY }, { x: minX, y: lY - tick });
    seg({ x: maxX, y: minY }, { x: maxX, y: lY - tick });
    const lines = new LineSegments(lineGeometry(pts), this.mat.dim!);
    lines.renderOrder = 4;
    this.dims.add(lines);
    const width = Math.round(maxY - minY);
    const length = Math.round(maxX - minX);
    this.dims.add(this.label(String(width), { x: wX - 0.55, y: (minY + maxY) / 2 }, h));
    this.dims.add(this.label(String(length), { x: (minX + maxX) / 2, y: lY - 0.6 }, h));
  }

  private label(text: string, at: { x: number; y: number }, height: number): Sprite {
    let entry = this.labels.get(text);
    if (!entry) {
      const texture = labelTexture(text);
      entry = { texture, material: new SpriteMaterial({ map: texture, transparent: true, depthTest: false }) };
      this.labels.set(text, entry);
    }
    const sprite = new Sprite(entry.material);
    simToWorld(at, height + 0.05, sprite.position);
    sprite.scale.set(1.5, 0.75, 1);
    sprite.renderOrder = 8;
    return sprite;
  }

  /** Hull connectors of the ship in the hangar (tests: they change live with the design). */
  get connectorCount(): number {
    return this.ship?.connectorCount ?? 0;
  }

  /**
   * Paint of the edited ship (M4c: its record's paint, or the paint shop preview). Call after update():
   * a hull shell self-rebuild there puts back the paint worn at bake time – this re-applies the current one.
   */
  setPaint(paint: PaintId): void {
    if (paint === this.paint && this.paintShell === hullShellVersion()) return;
    this.paint = paint;
    this.paintShell = hullShellVersion();
    if (this.ship) applyPaint(this.ship.group, paint);
  }

  /** Animations: gyros and the radar idle-spin, highlighted parts pulse. */
  update(dt: number): void {
    this.time += dt;
    this.updateCamera(dt);
    if (this.ship && this.props) this.ship.update(dt, { x: 0, y: 0 }, this.props, null, 0);
    if (this.bay.object.visible) this.bay.update(dt);
    const pulse = 0.55 + 0.45 * Math.sin(this.time * 6);
    this.mat.focusError!.opacity = pulse;
    this.mat.focusWarn!.opacity = pulse;
  }

  dispose(): void {
    this.ship?.dispose();
    this.ship = null;
    this.bay.dispose();
    this.parked.dispose();
    for (const g of this.owned.geometries) g.dispose();
    for (const m of this.owned.materials) m.dispose();
    for (const l of this.labels.values()) {
      l.texture.dispose();
      l.material.dispose();
    }
    for (const child of this.dims.children) if (child instanceof LineSegments) child.geometry.dispose();
    for (const child of this.layerGroup.children) if (child instanceof LineSegments) child.geometry.dispose();
    this.labels.clear();
    this.scene.clear();
  }
}

function lineGeometry(points: number[]): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(points, 3));
  return g;
}

/** A cell frame in the floor plane (centred on the origin) – thicker than a 1 px line (WebGL lines are always 1 px). */
function squareFrame(size: number, width: number): BufferGeometry {
  const s = size / 2;
  const i = s - width;
  const shape = new Shape();
  shape.moveTo(-s, -s);
  shape.lineTo(s, -s);
  shape.lineTo(s, s);
  shape.lineTo(-s, s);
  shape.closePath();
  const hole = new Shape();
  hole.moveTo(-i, -i);
  hole.lineTo(-i, i);
  hole.lineTo(i, i);
  hole.lineTo(i, -i);
  hole.closePath();
  shape.holes.push(hole);
  return new ShapeGeometry(shape).rotateX(-QUARTER);
}

/** A square outline (1 px lines) – the dashed outline of a moved part's original place. */
function squareOutline(size: number): BufferGeometry {
  const s = size / 2;
  const c = [
    [-s, -s],
    [s, -s],
    [s, s],
    [-s, s],
  ] as const;
  const pts: number[] = [];
  for (let i = 0; i < 4; i++) {
    const a = c[i]!;
    const b = c[(i + 1) % 4]!;
    pts.push(a[0], 0, a[1], b[0], 0, b[1]);
  }
  return lineGeometry(pts);
}

/** A flat arrow in the floor plane pointing to +x (length 1, scaled by the thrust). */
function arrowShape(): ShapeGeometry {
  const s = new Shape();
  s.moveTo(0, -0.05);
  s.lineTo(0.68, -0.05);
  s.lineTo(0.68, -0.17);
  s.lineTo(1, 0);
  s.lineTo(0.68, 0.17);
  s.lineTo(0.68, 0.05);
  s.lineTo(0, 0.05);
  s.closePath();
  // the shape is in the xy plane; into the floor (xz), with the ship's local +y = world −z
  return new ShapeGeometry(s).rotateX(-QUARTER);
}

/** Hull connectors that placing the part would add (a live preview of the rule from ch. 10). */
function newJoints(parts: readonly PlacedPart[], ghost: PlacedPart): ConnectorPlacement[] {
  const before = new Set(connectorPlacements({ parts: [...parts], nextId: 0 }).map((c) => `${c.kind}|${cellKey(c)}`));
  return connectorPlacements({ parts: [...parts, ghost], nextId: 0 }).filter((c) => !before.has(`${c.kind}|${cellKey(c)}`));
}

/** "Not connected" tag: upper-case Archivo on the dark band with the red edge of the UI's error labels. */
function tagTexture(text: string, edge: string): CanvasTexture {
  const canvas = document.createElement('canvas');
  const font = "800 30px 'Archivo Variable', 'Bahnschrift', sans-serif";
  const probe = canvas.getContext('2d');
  if (probe) probe.font = font;
  const width = Math.ceil((probe?.measureText(text).width ?? text.length * 18) + 40);
  canvas.width = width;
  canvas.height = 52;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = 'rgba(6, 13, 22, 0.9)';
    ctx.fillRect(0, 0, width, 52);
    ctx.fillStyle = edge;
    ctx.fillRect(0, 0, 6, 52);
    ctx.font = font;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 20, 28);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** A dimension number – Archivo on a dark plate, in azure. */
function labelTexture(text: string): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = 'rgba(6, 13, 22, 0.85)';
    ctx.fillRect(34, 10, 60, 44);
    ctx.font = "800 40px 'Archivo Variable', 'Bahnschrift', sans-serif";
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#62d9f4';
    ctx.fillText(text, 64, 34);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}
