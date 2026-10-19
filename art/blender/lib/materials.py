"""Shared materials: logical per-swatch materials for authoring, and the single
atlas material ("AF_Palette") that every exported asset uses."""
import os
import bpy

from . import palette as P

ATLAS_MAT = 'AF_Palette'
_IMG_NAMES = ('AF_Palette_BaseColor', 'AF_Palette_ORM', 'AF_Palette_Emissive')


def _lin(c):
    """sRGB [0..1] -> linear (for Principled colour sockets)."""
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


# --------------------------------------------------------------------------
# Logical materials (authoring only - replaced at bake time)
# --------------------------------------------------------------------------
def mat(key):
    """Return the logical material for palette swatch `key`."""
    name = 'PAL_' + key
    m = bpy.data.materials.get(name)
    if m:
        return m
    s = P.BY_KEY[key]
    m = bpy.data.materials.new(name)
    m['palette_key'] = key
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*_lin(P.hex_rgb(s.base)), 1)
    bsdf.inputs['Metallic'].default_value = s.metal
    bsdf.inputs['Roughness'].default_value = s.rough
    if s.emit:
        bsdf.inputs['Emission Color'].default_value = (*_lin(P.hex_rgb(s.emit)), 1)
        bsdf.inputs['Emission Strength'].default_value = s.emit_strength
    m.diffuse_color = (*_lin(P.hex_rgb(s.base)), 1)
    return m


# --------------------------------------------------------------------------
# Atlas textures
# --------------------------------------------------------------------------
def _mix(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


def build_atlas_images(out_dir, swatches=None, names=_IMG_NAMES, files=None):
    """Create (or refresh) the three atlas images, save them as PNG in
    out_dir and return (base, orm, emissive) bpy images.
    swatches: alternative swatch list in the SAME order/layout (liveries).
    files: optional explicit output file paths (base, orm, emissive)."""
    os.makedirs(out_dir, exist_ok=True)
    swatches = swatches or P.SWATCHES
    W, H = P.SIZE_X, P.SIZE_Y
    base = [0.0] * (W * H * 4)
    orm = [0.0] * (W * H * 4)
    emi = [0.0] * (W * H * 4)
    # unused cells: magenta so mistakes are obvious
    for i in range(W * H):
        base[i * 4:i * 4 + 4] = (1, 0, 1, 1)
        orm[i * 4:i * 4 + 4] = (1, 0.5, 0, 1)
        emi[i * 4:i * 4 + 4] = (0, 0, 0, 1)
    for idx, s in enumerate(swatches):
        col, row = idx % P.COLS, idx // P.COLS
        b0 = P.hex_rgb(s.base)
        b1 = P.hex_rgb(s.grad) if s.grad else b0
        e0 = P.hex_rgb(s.emit) if s.emit else (0, 0, 0)
        e1 = P.hex_rgb(s.grad_emit) if s.grad_emit else e0
        k = s.emit_strength / P.EMIT_MAX if s.emit else 0.0
        for py in range(P.CELL):
            for px in range(P.CELL):
                # gradient parameter matches swatch_uv(): pad 3px each side
                t = min(1.0, max(0.0, (px + 0.5 - 3.0) / (P.CELL - 6.0)))
                x = col * P.CELL + px
                y = row * P.CELL + py
                o = (y * W + x) * 4
                bc = _mix(b0, b1, t)
                ec = _mix(e0, e1, t)
                base[o:o + 4] = (*bc, 1)
                orm[o:o + 4] = (1.0, s.rough, s.metal, 1)
                emi[o:o + 4] = (ec[0] * k, ec[1] * k, ec[2] * k, 1)
    imgs = []
    for i, (name, data, cs) in enumerate(zip(names, (base, orm, emi), ('sRGB', 'Non-Color', 'sRGB'))):
        img = bpy.data.images.get(name)
        if img is not None and tuple(img.size) != (W, H):
            bpy.data.images.remove(img)
            img = None
        if img is None:
            img = bpy.data.images.new(name, W, H, alpha=False)
        img.colorspace_settings.name = cs
        img.pixels.foreach_set(data)
        path = files[i] if files else os.path.join(out_dir, name + '.png')
        img.filepath_raw = path
        img.file_format = 'PNG'
        img.save()
        imgs.append(img)
    return tuple(imgs)


def load_atlas_images(out_dir):
    imgs = []
    for name, cs in zip(_IMG_NAMES, ('sRGB', 'Non-Color', 'sRGB')):
        img = bpy.data.images.get(name)
        if img is None:
            img = bpy.data.images.load(os.path.join(out_dir, name + '.png'))
            img.name = name
        img.colorspace_settings.name = cs
        imgs.append(img)
    return tuple(imgs)


def atlas_material(atlas_dir):
    """The single shared PBR material.  Node layout follows what the glTF
    exporter understands: image->BaseColor, image->SeparateColor(G=rough,
    B=metal), image->Emission Color with Emission Strength = EMIT_MAX."""
    m = bpy.data.materials.get(ATLAS_MAT)
    if m:
        return m
    base_img, orm_img, emi_img = load_atlas_images(atlas_dir)
    m = bpy.data.materials.new(ATLAS_MAT)
    m.use_backface_culling = True   # exported as doubleSided = false
    nt = m.node_tree
    bsdf = nt.nodes.get('Principled BSDF')
    uv = nt.nodes.new('ShaderNodeUVMap')
    uv.uv_map = 'UVMap'
    uv.location = (-900, 0)

    def tex(img, y):
        n = nt.nodes.new('ShaderNodeTexImage')
        n.image = img
        n.interpolation = 'Closest'
        n.extension = 'EXTEND'
        n.location = (-600, y)
        nt.links.new(uv.outputs['UV'], n.inputs['Vector'])
        return n

    tb = tex(base_img, 300)
    to = tex(orm_img, 0)
    te = tex(emi_img, -300)
    sep = nt.nodes.new('ShaderNodeSeparateColor')
    sep.location = (-300, 0)
    nt.links.new(tb.outputs['Color'], bsdf.inputs['Base Color'])
    nt.links.new(to.outputs['Color'], sep.inputs['Color'])
    nt.links.new(sep.outputs['Green'], bsdf.inputs['Roughness'])
    nt.links.new(sep.outputs['Blue'], bsdf.inputs['Metallic'])
    nt.links.new(te.outputs['Color'], bsdf.inputs['Emission Color'])
    bsdf.inputs['Emission Strength'].default_value = P.EMIT_MAX
    return m


# --------------------------------------------------------------------------
# Bake logical materials -> atlas UVs
# --------------------------------------------------------------------------
GRAD_ATTR = 'af_grad'


def bake_to_atlas(obj, atlas_dir):
    """Collapse every face's UVs onto its swatch and swap all material slots
    for the single atlas material.  Faces using a gradient swatch read the
    per-vertex float attribute `af_grad` (0..1) for their position along it."""
    me = obj.data
    keys = []
    for slot in obj.material_slots:
        m = slot.material
        keys.append(m.get('palette_key') if m else None)
    if not me.uv_layers:
        me.uv_layers.new(name='UVMap')
    uvl = me.uv_layers[0]
    uvl.name = 'UVMap'
    grad = me.attributes.get(GRAD_ATTR)
    gvals = None
    if grad is not None and grad.domain == 'POINT':
        gvals = [d.value for d in grad.data]
    baked = [bool(slot.material and slot.material.name.startswith(ATLAS_MAT)) for slot in obj.material_slots]
    for poly in me.polygons:
        if poly.material_index < len(baked) and baked[poly.material_index]:
            continue        # already on the atlas (detail pass joins new parts into finished assets)
        key = keys[poly.material_index] if poly.material_index < len(keys) else None
        if key is None:
            key = 'hull_light'
        sw = P.BY_KEY[key]
        for li in poly.loop_indices:
            t = 0.5
            if sw.grad and gvals is not None:
                t = gvals[me.loops[li].vertex_index]
            uvl.data[li].uv = P.swatch_uv(key, t)
    if grad is not None:
        me.attributes.remove(grad)
    me.materials.clear()
    me.materials.append(atlas_material(atlas_dir))
    for poly in me.polygons:
        poly.material_index = 0
