"""glTF export helper (Blender 5.2 io_scene_gltf2).

The export is the plain source GLB (embedded AF_Palette atlas, float attributes). The shipped
form comes from the optimizer post-step (lib/optimize.py -> art/tools/optimize_assets.mjs,
art/README.md 2.9): atlas referenced from public/assets/textures, meshopt compression."""
import os
import bpy


def export_glb(root, filepath, vertex_colors=False):
    """Export `root` and its children as a .glb.  Modifiers must already be
    applied (we also pass export_apply=True as a safety net)."""
    os.makedirs(os.path.dirname(filepath), exist_ok=True)
    objs = [root] + list(root.children_recursive)
    for o in bpy.context.scene.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = root
    bpy.ops.export_scene.gltf(
        filepath=filepath,
        export_format='GLB',
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_texcoords=True,
        export_normals=True,
        export_materials='EXPORT',
        export_image_format='AUTO',
        export_cameras=False,
        export_lights=False,
        export_animations=False,
        export_extras=False,
        export_vertex_color='ACTIVE' if vertex_colors else 'MATERIAL',
    )
    return filepath
