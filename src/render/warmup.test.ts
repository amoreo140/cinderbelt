import { BatchedMesh, BoxGeometry, BufferAttribute, BufferGeometry, Group, InstancedMesh, Line, LineDashedMaterial, Mesh, MeshBasicMaterial, MeshStandardMaterial, Points, PointsMaterial, ShaderMaterial, Texture, WebGLRenderTarget, type WebGLRenderer } from 'three';
import { describe, expect, it } from 'vitest';
import { coloredBatchSample, drawTwins, primeProgramsSliced, sceneTextures, ShaderZoo, uploadTexturesSliced, within } from './warmup';

const layout = (g: BufferGeometry): string[] =>
  Object.entries(g.attributes).map(([name, a]) => `${name}:${a.itemSize}:${(a.array.constructor as { name: string }).name}:${a.normalized}`);

describe('shader warm-up', () => {
  it('gives hidden and empty objects one drawn twin per material and vertex layout', () => {
    const scene = new Group();
    const shared = new MeshBasicMaterial();
    const box = new BoxGeometry();
    // a pool of hidden beams with one material: one twin
    const pool = new Group();
    pool.visible = false;
    pool.add(new Mesh(box, shared), new Mesh(box, shared));
    // a visible object draws itself: no twin
    const shown = new Mesh(box, new MeshStandardMaterial());
    // an instanced mesh with nothing to draw, with per-instance colours
    const rocks = new InstancedMesh(box, new MeshStandardMaterial(), 4);
    rocks.setColorAt(0, shown.material.color);
    rocks.count = 0;
    // an empty particle system with a byte colour attribute; a dashed line under a no-shadow group
    const pts = new BufferGeometry();
    pts.setAttribute('position', new BufferAttribute(new Float32Array(0), 3));
    pts.setAttribute('color', new BufferAttribute(new Uint8Array(0), 4, true));
    const points = new Points(pts, new PointsMaterial({ vertexColors: true }));
    const far = new Group();
    far.userData.noShadow = true;
    far.userData.noAO = true;
    const lineGeo = new BufferGeometry();
    lineGeo.setAttribute('position', new BufferAttribute(new Float32Array(6), 3));
    lineGeo.setAttribute('lineDistance', new BufferAttribute(new Float32Array(2), 1));
    const line = new Line(lineGeo, new LineDashedMaterial());
    line.visible = false;
    line.castShadow = true;
    far.add(line);
    scene.add(pool, shown, rocks, points, far);

    const zoo = new ShaderZoo();
    scene.add(zoo.group);
    expect(drawTwins(scene, zoo)).toBe(4);
    const twins = zoo.plain.children;
    expect(twins.map((t) => (t instanceof InstancedMesh ? 'InstancedMesh' : t.type)).sort()).toEqual(['InstancedMesh', 'Line', 'Mesh', 'Points']);
    const rockTwin = twins.find((t) => t instanceof InstancedMesh) as InstancedMesh;
    expect(rockTwin.count).toBe(1);
    expect(rockTwin.instanceColor).not.toBeNull();
    const pointTwin = twins.find((t) => t instanceof Points) as Points;
    expect(layout(pointTwin.geometry)).toEqual(layout(pts));
    expect(pointTwin.geometry.getAttribute('position').count).toBe(3);
    const lineTwin = twins.find((t) => t instanceof Line) as Line;
    expect(lineTwin.material).toBe(line.material);
    // a caster below a no-shadow group stays out of the shadow map, out of AO too
    expect(lineTwin.castShadow).toBe(false);
    expect(lineTwin.userData.noAO).toBe(true);
    // the zoo itself is not visited again
    expect(drawTwins(scene, zoo)).toBe(4);
  });

  it('frees its own geometries but never the materials (the programs must survive)', () => {
    const zoo = new ShaderZoo();
    const material = new MeshBasicMaterial();
    let materialDisposed = false;
    material.addEventListener('dispose', () => (materialDisposed = true));
    const own = zoo.geometry(new BoxGeometry());
    let geometryDisposed = false;
    own.addEventListener('dispose', () => (geometryDisposed = true));
    zoo.add(new Mesh(own, material));
    const parent = new Group();
    parent.add(zoo.group);
    zoo.dispose();
    expect(zoo.group.parent).toBeNull();
    expect(zoo.group.children.length).toBe(0);
    expect(geometryDisposed).toBe(true);
    expect(materialDisposed).toBe(false);
  });

  it('builds a tinted one-instance twin of a batch', () => {
    const source = new BatchedMesh(4, 24, 36, new MeshStandardMaterial());
    source.addGeometry(new BoxGeometry());
    const zoo = new ShaderZoo();
    const twin = coloredBatchSample(zoo, source);
    expect(twin.material).toBe(source.material);
    expect((twin as unknown as { _colorsTexture: unknown })._colorsTexture).not.toBeNull();
    expect(layout(twin.geometry)).toEqual(layout(source.geometry));
  });

  it('gives up waiting after the time limit', async () => {
    expect(await within(new Promise(() => {}), 5)).toBe(false);
    expect(await within(Promise.resolve(1), 50)).toBe(true);
    expect(await within(Promise.reject(new Error('x')), 50)).toBe(true);
  });
});

describe('the warm-up frame sliced', () => {
  const image = (width: number, height: number) => ({ width, height });
  const texture = (width: number, height: number): Texture => {
    const t = new Texture(image(width, height) as unknown as HTMLImageElement);
    t.generateMipmaps = false;
    return t;
  };

  it('finds the textures of maps and shader uniforms, hidden objects included, without render targets or empty ones', () => {
    const map = texture(4, 4);
    const normal = texture(4, 4);
    const uniform = texture(8, 8);
    const target = new WebGLRenderTarget(4, 4);
    const scene = new Group();
    const hidden = new Mesh(new BoxGeometry(), new MeshStandardMaterial({ map, normalMap: normal }));
    hidden.visible = false;
    const shader = new ShaderMaterial({ uniforms: { tex: { value: uniform }, list: { value: [map] }, rt: { value: target.texture }, none: { value: new Texture() } } });
    scene.add(hidden, new Mesh(new BoxGeometry(), shader), new Mesh(new BoxGeometry(), new MeshBasicMaterial({ map })));
    expect([...sceneTextures(scene)]).toEqual([map, normal, uniform]);
  });

  it('uploads them about a byte budget per task and stops when the game goes away', async () => {
    const scene = new Group();
    const textures = [texture(64, 64), texture(64, 64), texture(64, 64)]; // 16 KB each
    for (const t of textures) scene.add(new Mesh(new BoxGeometry(), new MeshBasicMaterial({ map: t })));
    const uploaded: Texture[] = [];
    const renderer = { initTexture: (t: Texture) => uploaded.push(t) } as unknown as WebGLRenderer;
    const run = uploadTexturesSliced(renderer, [scene], 32 * 1024, () => false);
    // the first slice (32 KB) runs at once, the rest after a task break
    expect(uploaded).toEqual(textures.slice(0, 2));
    expect(await run).toBe(true);
    expect(uploaded).toEqual(textures);

    let stop = false;
    const cut = uploadTexturesSliced({ initTexture: () => (stop = true) } as unknown as WebGLRenderer, [scene], 1, () => stop);
    expect(await cut).toBe(false);
  });

  it('gives every compiled program its first use, a few per task', async () => {
    const used: number[] = [];
    const programs = Array.from({ length: 5 }, (_, i) => ({ getUniforms: () => used.push(i) }));
    const renderer = { info: { programs } } as unknown as WebGLRenderer;
    const run = primeProgramsSliced(renderer, 2, () => false);
    expect(used).toEqual([0, 1]);
    expect(await run).toBe(true);
    expect(used).toEqual([0, 1, 2, 3, 4]);
  });

  it('leaves a program the driver is still compiling for a later round instead of waiting on it', async () => {
    const used: number[] = [];
    let ready = false;
    const programs = [
      { getUniforms: () => used.push(0), isReady: () => ready },
      { getUniforms: () => used.push(1), isReady: () => true },
    ];
    const renderer = { info: { programs }, extensions: { has: () => true } } as unknown as WebGLRenderer;
    const run = primeProgramsSliced(renderer, 8, () => false);
    expect(used).toEqual([1]);
    ready = true;
    expect(await run).toBe(true);
    expect(used).toEqual([1, 0]);
  });
});
