// Survey points in the world (sectors design §4.1, stage 2): a subtle surveyor's reticle on the plane
// at each point of a sector the player has not Charted yet, near the ship – the same glyph as the radar
// and the map (a ring with four ticks; a marked point is a small green disc). Around the nearest
// unmarked point a faint ring shows how close a pulse must be (150 u). Render only: reads the
// simulation (survey points of the frozen generator, `regions.points`), three instanced draws at most.
import {
  AdditiveBlending,
  CircleGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  PlaneGeometry,
  RingGeometry,
  type BufferGeometry,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { REGION_GEN } from '../../sim/regions/constants';
import { sectorKnowledge } from '../../sim/regions/knowledge';
import { surveyPoints, surveyPointsNear } from '../../sim/regions/survey';
import type { SimState } from '../../sim/Simulation';

/** Points are drawn within this distance of the ship (u). */
export const SURVEY_VIEW_RANGE = 600;
/** At most this many markers of each kind. */
const MAX = 12;
/** The point list is refreshed this often (s) – points never move, only marks change. */
const REFRESH = 0.25;
const RETICLE = 3.6;
const WHITE = 0xeef1f5;
const OK = 0x6be38a;

function reticleGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [new RingGeometry(RETICLE * 0.62, RETICLE * 0.72, 40)];
  for (let i = 0; i < 4; i++) {
    const tick = new PlaneGeometry(RETICLE * 0.62, RETICLE * 0.09);
    tick.translate(RETICLE * 1.05, 0, 0);
    tick.rotateZ((i * Math.PI) / 2);
    parts.push(tick.toNonIndexed());
  }
  parts[0] = parts[0]!.toNonIndexed();
  const merged = mergeGeometries(parts)!;
  for (const p of parts) p.dispose();
  // lie on the plane (sim x, y → three x, -z)
  merged.rotateX(-Math.PI / 2);
  return merged;
}

const flat = (g: BufferGeometry): BufferGeometry => g.rotateX(-Math.PI / 2);

export class SurveyMarkers {
  readonly object = new Group();
  private readonly open: InstancedMesh;
  private readonly done: InstancedMesh;
  private readonly reach: InstancedMesh;
  private readonly materials: MeshBasicMaterial[];
  private timer = 0;
  private time = 0;
  private readonly m = new Matrix4();

  constructor() {
    this.object.name = 'surveyMarkers';
    const mat = (color: number, opacity: number) =>
      new MeshBasicMaterial({ color, transparent: true, opacity, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, forceSinglePass: true });
    const openMat = mat(WHITE, 0.32);
    const doneMat = mat(OK, 0.35);
    const reachMat = mat(WHITE, 0.07);
    this.materials = [openMat, doneMat, reachMat];
    this.open = new InstancedMesh(reticleGeometry(), openMat, MAX);
    this.done = new InstancedMesh(flat(new CircleGeometry(RETICLE * 0.32, 24)), doneMat, MAX);
    const range = REGION_GEN.survey.range;
    this.reach = new InstancedMesh(flat(new RingGeometry(range - 0.8, range, 96)), reachMat, 1);
    for (const mesh of [this.open, this.done, this.reach]) {
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.renderOrder = 2;
      this.object.add(mesh);
    }
  }

  /** Called every frame; the points are looked up 4× a second. */
  update(state: SimState, frameDt: number, reducedMotion = false): void {
    this.time += frameDt;
    this.timer -= frameDt;
    if (this.timer <= 0) {
      this.timer = REFRESH;
      this.refresh(state);
    }
    if (!reducedMotion) (this.materials[0] as MeshBasicMaterial).opacity = 0.26 + 0.1 * Math.sin(this.time * 2.4);
  }

  private refresh(state: SimState): void {
    const player = state.player;
    this.open.count = 0;
    this.done.count = 0;
    this.reach.count = 0;
    if (player.dock.mode !== 'flying' || player.destroyed) return;
    const pos = player.body.pos;
    const charted = new Map<string, boolean>();
    let nearest: { x: number; y: number; d: number } | null = null;
    for (const p of surveyPointsNear(state.seed, pos, SURVEY_VIEW_RANGE)) {
      let c = charted.get(p.sector);
      if (c === undefined) {
        c = sectorKnowledge(state, p.sector) === 'charted';
        charted.set(p.sector, c);
      }
      if (c) continue;
      const total = surveyPoints(state.seed, p.sector).length;
      const mask = (state.regions.points.get(p.sector) ?? 0) & ((1 << total) - 1);
      const marked = (mask & (1 << p.index)) !== 0;
      const mesh = marked ? this.done : this.open;
      if (mesh.count >= MAX) continue;
      // three: (x, height, -y)
      this.m.makeTranslation(p.pos.x, 0.08, -p.pos.y);
      mesh.setMatrixAt(mesh.count++, this.m);
      if (!marked) {
        const d = Math.hypot(p.pos.x - pos.x, p.pos.y - pos.y);
        if (!nearest || d < nearest.d) nearest = { x: p.pos.x, y: p.pos.y, d };
      }
    }
    // the pulse's reach around the nearest unmarked point, once the ship is getting close
    if (nearest && nearest.d < REGION_GEN.survey.range * 2.5) {
      this.m.makeTranslation(nearest.x, 0.06, -nearest.y);
      this.reach.setMatrixAt(0, this.m);
      this.reach.count = 1;
    }
    for (const mesh of [this.open, this.done, this.reach]) mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    for (const mesh of [this.open, this.done, this.reach]) {
      mesh.geometry.dispose();
      mesh.dispose();
    }
    for (const m of this.materials) m.dispose();
  }
}
