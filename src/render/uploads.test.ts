import { BatchedMesh, BoxGeometry, BufferAttribute, Color, DataTexture, FloatType, InstancedBufferAttribute, Matrix4, MeshBasicMaterial, RGBAFormat } from 'three';
import { describe, expect, it } from 'vitest';
import { batchTextures, batchUsed, uploadBatchColors, uploadBatchMatrices, uploadPrefix, uploadTexturePrefix } from './uploads';

describe('uploadPrefix', () => {
  it('uploads only the items in use', () => {
    const attr = new InstancedBufferAttribute(new Float32Array(3000 * 16), 16);
    const version = attr.version;
    uploadPrefix(attr, 40);
    expect(attr.updateRanges).toEqual([{ start: 0, count: 40 * 16 }]);
    expect(attr.version).toBe(version + 1);
  });

  it('keeps one range when called again before the upload', () => {
    const attr = new BufferAttribute(new Float32Array(30), 3);
    uploadPrefix(attr, 4);
    uploadPrefix(attr, 7);
    expect(attr.updateRanges).toEqual([{ start: 0, count: 21 }]);
  });

  it('clamps to the buffer and skips the upload when nothing is drawn', () => {
    const attr = new BufferAttribute(new Float32Array(30), 3);
    uploadPrefix(attr, 50);
    expect(attr.updateRanges).toEqual([{ start: 0, count: 30 }]);
    attr.clearUpdateRanges();
    const version = attr.version;
    uploadPrefix(attr, 0);
    expect(attr.version).toBe(version);
    expect(attr.updateRanges).toEqual([]);
  });
});

describe('uploadTexturePrefix', () => {
  const texture = (size: number) => new DataTexture(new Float32Array(size * size * 4), size, size, RGBAFormat, FloatType);
  /** What three does with a texture on upload: reads the image it is shown, then calls onUpdate. */
  const upload = (tex: DataTexture) => {
    const shown = { width: tex.image.width, height: tex.image.height, data: tex.image.data };
    tex.onUpdate?.(tex);
    return shown;
  };

  it('shows three the full image for the first upload (it allocates the storage at that size)', () => {
    const tex = texture(60);
    const version = tex.version;
    uploadTexturePrefix(tex, 20, 16);
    expect(tex.version).toBe(version + 1);
    expect(tex.updateRanges).toEqual([]);
    expect(upload(tex)).toMatchObject({ width: 60, height: 60 });
  });

  it('then sends the prefix as whole texel rows in one upload, and puts the full image back', () => {
    const tex = texture(60);
    const data = tex.image.data;
    uploadTexturePrefix(tex, 20, 16);
    upload(tex);
    // 60 RGBA texels = 240 floats per row; 20 matrices of 16 floats = 320 floats → 2 rows
    uploadTexturePrefix(tex, 20, 16);
    expect(tex.updateRanges).toEqual([]);
    const shown = upload(tex);
    expect(shown).toMatchObject({ width: 60, height: 2 });
    expect(shown.data).toBe(data);
    expect(tex.image).toMatchObject({ width: 60, height: 60 });
    expect(tex.image.data).toBe(data);
  });

  it('clamps to the texture and does nothing for an empty prefix', () => {
    const tex = texture(4);
    uploadTexturePrefix(tex, 1, 16);
    upload(tex);
    uploadTexturePrefix(tex, 99, 16);
    expect(upload(tex).height).toBe(4);
    const version = tex.version;
    uploadTexturePrefix(tex, 0, 16);
    expect(tex.version).toBe(version);
    expect(tex.image.height).toBe(4);
  });

  it('keeps an onUpdate set before, and starts over with the full image after a dispose', () => {
    const tex = texture(8);
    let calls = 0;
    tex.onUpdate = () => calls++;
    uploadTexturePrefix(tex, 1, 16);
    upload(tex);
    expect(calls).toBe(1);
    uploadTexturePrefix(tex, 1, 16);
    expect(tex.image.height).toBe(1);
    tex.dispose();
    expect(tex.image.height).toBe(8);
    uploadTexturePrefix(tex, 1, 16);
    expect(upload(tex).height).toBe(8);
    expect(calls).toBe(2);
  });
});

describe('uploadBatchMatrices', () => {
  const batch = () => {
    const mesh = new BatchedMesh(768, 24, 36, new MeshBasicMaterial());
    const geometry = mesh.addGeometry(new BoxGeometry());
    return { mesh, geometry };
  };
  /** Texel rows the next upload sends (after a first, full upload has allocated the texture). */
  const rows = (tex: DataTexture) => tex.image.height;
  const uploaded = (mesh: BatchedMesh) => {
    const { matrices, colors } = batchTextures(mesh);
    uploadTexturePrefix(matrices, 1, 16);
    matrices.onUpdate?.(matrices);
    if (colors) {
      uploadTexturePrefix(colors, 1, 4);
      colors.onUpdate?.(colors);
    }
    return mesh;
  };

  // the 768-slot matrices texture is 56 × 56 texels: 14 matrices per row; the colours 28 × 28

  it('uploads the ids handed out so far, not the 768-slot texture', () => {
    const { mesh, geometry } = batch();
    uploaded(mesh);
    for (let i = 0; i < 20; i++) mesh.setMatrixAt(mesh.addInstance(geometry), new Matrix4());
    uploadBatchMatrices(mesh);
    expect(batchUsed(mesh)).toBe(20);
    expect(rows(batchTextures(mesh).matrices)).toBe(2);
  });

  it('keeps covering ids freed and handed out again (the high-water mark)', () => {
    const { mesh, geometry } = batch();
    uploaded(mesh);
    const ids = Array.from({ length: 30 }, () => mesh.addInstance(geometry));
    for (const id of ids.slice(5)) mesh.deleteInstance(id);
    expect(mesh.instanceCount).toBe(5);
    // freed ids come back lowest first, so the in-use ids stay below the mark
    expect(mesh.addInstance(geometry)).toBe(5);
    expect(batchUsed(mesh)).toBe(30);
    uploadBatchMatrices(mesh);
    expect(rows(batchTextures(mesh).matrices)).toBe(3);
  });

  it('uploads nothing when no matrix was written since the last call', () => {
    const { mesh, geometry } = batch();
    uploaded(mesh);
    const id = mesh.addInstance(geometry);
    mesh.setMatrixAt(id, new Matrix4());
    const tex = batchTextures(mesh).matrices;
    uploadBatchMatrices(mesh);
    tex.onUpdate?.(tex);
    const version = tex.version;
    uploadBatchMatrices(mesh);
    expect(tex.version).toBe(version);
    expect(rows(tex)).toBe(56);
    mesh.setMatrixAt(id, new Matrix4());
    uploadBatchMatrices(mesh);
    expect(tex.version).toBe(version + 2);
    expect(rows(tex)).toBe(1);
  });

  it('uploads the colours in use too', () => {
    const { mesh, geometry } = batch();
    for (let i = 0; i < 30; i++) mesh.setColorAt(mesh.addInstance(geometry), new Color(1, 0, 0));
    uploaded(mesh);
    uploadBatchColors(mesh);
    expect(rows(batchTextures(mesh).colors!)).toBe(2);
  });
});
