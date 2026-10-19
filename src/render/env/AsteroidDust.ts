// Life in the asteroid fields (visual polish): small rock chips that slowly orbit each rock near the
// camera, and faint dust motes drifting around them. Purely cosmetic and derived from the asteroid
// id (the same rock always has the same chips) – no simulation state, no collisions.
// The chips are the batch A rubble (`Rubble_0..7`, art/README §2.7.22: unit radius like the
// icosahedron they replaced, neutral grey × baked AO) in one BatchedMesh, tinted per resource.
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  MeshStandardMaterial,
  Points,
  PointsMaterial,
  type BatchedMesh,
  type Vector3,
} from 'three';
import type { World } from '../../sim/world/World';
import { RESOURCES, type ResourceId } from '../../data/resources';
import { vfxTexture } from '../fx/textures';
import { batchTextures, uploadPrefix, uploadTexturePrefix } from '../uploads';
import { hashString } from '../traffic/schedule';
import { BeltBed } from './BeltBed';
import { CHIP_STRIDE, chipConstants, MOTE_STRIDE, moteConstants, writeChipMatrix, writeMote } from './dustOrbits';
import { rubbleIndex } from './scenery';
import { batchOf, sceneryFile, sceneryManifest } from './sceneryAssets';

/** Asteroids within this distance of the camera target get chips and motes. */
const RANGE = 150;
const MAX_CHIPS = 900;
const MAX_MOTES = 1400;
const CHIPS_PER_ROCK = 7;
const MOTES_PER_ROCK = 9;
/** Rocks whose constants are kept (cleared beyond this). */
const ROCK_CACHE = 5000;
/** The motes drift slowly and faintly: they are re-placed at ~30 Hz (after at least this much time, s). */
const MOTE_STEP = 0.025;

/** What a rock's dust needs that depends only on its id (dustOrbits.ts), computed on first sight. */
interface RockDust {
  chips: Float64Array;
  motes: Float64Array;
  /** Rock colour (linear) the chip shades multiply, and the motes' grey dust with a hint of the ore. */
  rock: Color;
  dust: Color;
}

export class AsteroidDust {
  readonly object = new Group();
  /** The non-minable rocks deep under each field (render-only). */
  readonly bed = new BeltBed();
  /** Built once the rubble has loaded; until then there are no chips. */
  private chips: BatchedMesh | null = null;
  private readonly chipMaterial: MeshStandardMaterial;
  /** BatchedMesh geometry id per rubble mesh, and the one each chip slot shows now. */
  private rubbleIds: number[] = [];
  private readonly slotGeometry = new Int16Array(MAX_CHIPS).fill(-1);
  /** Colour each chip slot was last given (a slot keeps its rock while it stays in range – no re-upload). */
  private readonly slotColor = new Float64Array(MAX_CHIPS * 3).fill(-1);
  private shownChips = 0;
  private disposed = false;
  private readonly motes: Points;
  private readonly motePositions = new Float32Array(MAX_MOTES * 3);
  private readonly moteColors = new Float32Array(MAX_MOTES * 3);
  private readonly moteAttr: BufferAttribute;
  private readonly moteColorAttr: BufferAttribute;
  private readonly color = new Color();
  private readonly dustGrey = new Color(0.7, 0.72, 0.8);
  private readonly rocks = new Map<string, RockDust>();
  private density = 1;
  private time = 0;
  /** Time since the motes were last placed (∞ = place them this frame). */
  private moteAge = Infinity;

  constructor() {
    this.object.name = 'asteroid-dust';
    this.object.add(this.bed.object);
    // the baked AO (vertex colours) darkens the chips a little – the base is a touch lighter than before
    this.chipMaterial = new MeshStandardMaterial({ color: 0x9a9288, roughness: 0.9, metalness: 0.1, flatShading: true, vertexColors: true });
    void this.loadRubble();

    const geometry = new BufferGeometry();
    this.moteAttr = new BufferAttribute(this.motePositions, 3);
    this.moteColorAttr = new BufferAttribute(this.moteColors, 3);
    geometry.setAttribute('position', this.moteAttr);
    geometry.setAttribute('color', this.moteColorAttr);
    geometry.setDrawRange(0, 0);
    const material = new PointsMaterial({
      map: vfxTexture('glow_soft'),
      size: 0.55,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    material.userData.noAO = true;
    this.motes = new Points(geometry, material);
    this.motes.frustumCulled = false;
    this.object.add(this.motes);
  }

  private async loadRubble(): Promise<void> {
    const manifest = await sceneryManifest();
    const set = manifest?.sets.rubble;
    const file = set ? await sceneryFile(set.file) : null;
    if (!set || !file || this.disposed) return;
    const geometries = set.meshes.map((m) => file.geometries.get(m.name)).filter((g): g is BufferGeometry => g !== undefined);
    const batch = batchOf(geometries, MAX_CHIPS, this.chipMaterial);
    if (!batch) return;
    const { mesh } = batch;
    mesh.name = 'rubble-chips';
    // chips sit around the rocks in view: no per-chip culling or sorting (the CPU cost would exceed the draw)
    mesh.frustumCulled = false;
    mesh.perObjectFrustumCulled = false;
    mesh.sortObjects = false;
    for (let i = 0; i < MAX_CHIPS; i++) {
      mesh.addInstance(batch.ids[0]!);
      mesh.setVisibleAt(i, false);
    }
    this.rubbleIds = batch.ids;
    this.chips = mesh;
    this.object.add(mesh);
  }

  setQuality(particles: number): void {
    this.density = particles;
    this.bed.setQuality(particles);
  }

  /** The rock's constants, with room for at least `chips` chips and `motes` motes. */
  private rockOf(id: string, resource: ResourceId, chips: number, motes: number): RockDust {
    let d = this.rocks.get(id);
    if (!d) {
      if (this.rocks.size > ROCK_CACHE) this.rocks.clear();
      const res = RESOURCES[resource];
      d = { chips: new Float64Array(0), motes: new Float64Array(0), rock: new Color(res.rockColor), dust: new Color(res.color).lerp(this.dustGrey, 0.6) };
      this.rocks.set(id, d);
    }
    if (d.chips.length < chips * CHIP_STRIDE) d.chips = chipConstants(hashString(id), chips);
    if (d.motes.length < motes * MOTE_STRIDE) d.motes = moteConstants(hashString(id), motes);
    return d;
  }

  /** `haze` = the zone haze colour of this frame (the belt beds mix it in). */
  update(world: World, target: Vector3, dt: number, haze = 0): void {
    this.bed.update(world, target, haze);
    this.time += dt;
    this.moteAge += dt;
    const t = this.time;
    let chips = 0;
    let motes = 0;
    let colorsChanged = false;
    const chipMesh = this.chips;
    const chipsPer = chipMesh ? Math.round(CHIPS_PER_ROCK * this.density) : 0;
    // motes only from Medium up (a Points draw with its own shader – cheap, but not free on weak GPUs)
    const motesPer = this.density < 0.5 ? 0 : Math.round(MOTES_PER_ROCK * this.density);
    // (a frozen clock – paused – places them every frame: the camera may still move)
    const placeMotes = this.moteAge >= MOTE_STEP || dt <= 0;
    if (placeMotes) this.moteAge = 0;
    // chip matrices go straight into the batch texture (setMatrixAt would copy a Matrix4 per chip)
    const matrices = chipMesh ? (batchTextures(chipMesh).matrices.image.data as Float32Array) : null;
    const cosZ = Math.cos(t * 0.2);
    const sinZ = Math.sin(t * 0.2);
    for (const a of world.asteroids()) {
      const dx = a.pos.x - target.x;
      const dz = -a.pos.y - target.z;
      if (dx * dx + dz * dz > RANGE * RANGE) continue;
      const r = world.radiusOf(a);
      if (r <= 0) continue;
      const n = Math.min(chipsPer, Math.round(chipsPer * Math.min(1.5, 0.35 + r / 6)));
      const m = placeMotes ? Math.round(motesPer * Math.min(1.6, 0.4 + r / 5)) : 0;
      if (n <= 0 && m <= 0) continue;
      const rock = this.rockOf(a.id, a.resource, n, m);
      const x = a.pos.x;
      const z = -a.pos.y;
      for (let i = 0; i < n && chips < MAX_CHIPS; i++) {
        writeChipMatrix(matrices!, chips * 16, rock.chips, i, x, z, r, t, cosZ, sinZ);
        const o = i * CHIP_STRIDE;
        const geometry = this.rubbleIds[rubbleIndex(rock.chips[o + 10]!, this.rubbleIds.length)]!;
        if (this.slotGeometry[chips] !== geometry) {
          this.slotGeometry[chips] = geometry;
          chipMesh!.setGeometryIdAt(chips, geometry);
        }
        const shade = rock.chips[o + 11]!;
        const cr = rock.rock.r * shade;
        const cg = rock.rock.g * shade;
        const cb = rock.rock.b * shade;
        const c = chips * 3;
        if (this.slotColor[c] !== cr || this.slotColor[c + 1] !== cg || this.slotColor[c + 2] !== cb) {
          this.slotColor[c] = cr;
          this.slotColor[c + 1] = cg;
          this.slotColor[c + 2] = cb;
          chipMesh!.setColorAt(chips, this.color.setRGB(cr, cg, cb));
          colorsChanged = true;
        }
        chips++;
      }
      for (let i = 0; i < m && motes < MAX_MOTES; i++) {
        // twinkle; mostly grey dust with a hint of the ore colour
        const k = 0.05 + 0.1 * writeMote(this.motePositions, motes * 3, rock.motes, i, x, z, r, t);
        this.moteColors[motes * 3] = rock.dust.r * k;
        this.moteColors[motes * 3 + 1] = rock.dust.g * k;
        this.moteColors[motes * 3 + 2] = rock.dust.b * k;
        motes++;
      }
    }
    // nothing to draw = no draw call (and no shader compiled until there is)
    if (chipMesh) {
      for (let i = chips; i < this.shownChips; i++) chipMesh.setVisibleAt(i, false);
      for (let i = this.shownChips; i < chips; i++) chipMesh.setVisibleAt(i, true);
      this.shownChips = chips;
      chipMesh.visible = chips > 0;
      // upload the chips in use, not the 900-slot textures (audit 2026-10-16 #5)
      const tex = batchTextures(chipMesh);
      uploadTexturePrefix(tex.matrices, chips, 16);
      if (colorsChanged && tex.colors) uploadTexturePrefix(tex.colors, chips, 4);
    }
    // between mote steps the last placement stays drawn (and nothing is uploaded)
    if (placeMotes) {
      this.motes.visible = motes > 0;
      this.motes.geometry.setDrawRange(0, motes);
      uploadPrefix(this.moteAttr, motes);
      uploadPrefix(this.moteColorAttr, motes);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.bed.dispose();
    this.chipMaterial.dispose();
    this.chips?.dispose();
    this.motes.geometry.dispose();
    (this.motes.material as PointsMaterial).dispose();
    this.object.removeFromParent();
  }
}
