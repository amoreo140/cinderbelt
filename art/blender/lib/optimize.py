"""Post-step of the pipeline: the asset optimizer (art/tools/optimize_assets.mjs, README §2.9).

Blender exports plain GLBs (embedded AF_Palette atlas, float attributes) and JPG/PNG textures;
`run()` turns them into what the game ships: meshopt-compressed GLBs that reference the shared
atlas in public/assets/textures, WebP planets/skybox backgrounds/explosion flipbooks, RLE env maps.
Needs Node.js and `npm install` in the repo root. The optimizer skips files that are already
optimized, so calling it after every build is cheap.
"""
import os
import shutil
import subprocess

import paths

SCRIPT = os.path.join(paths.ART, 'tools', 'optimize_assets.mjs')


def run(only=None, force=False):
    """Run the optimizer for the given stages ('models', 'skybox', 'planets', 'vfx'; None = all).
    Returns True on success; never raises (the build result stays usable, just unoptimized)."""
    node = shutil.which('node')
    if not node:
        print('WARNING optimize: node not found - run `npm run assets:optimize` before shipping')
        return False
    cmd = [node, SCRIPT]
    if only:
        cmd += ['--only', ','.join(only)]
    if force:
        cmd.append('--force')
    result = subprocess.run(cmd, cwd=paths.ROOT)
    if result.returncode != 0:
        print('WARNING optimize: the optimizer failed - run `npm run assets:optimize` and check its output')
        return False
    return True


def shipped(path):
    """The shipped file for a source name: the optimizer replaces some PNG/JPG with a WebP of
    the same stem (planets, skybox backgrounds, explosion flipbooks)."""
    if os.path.exists(path):
        return path
    webp = os.path.splitext(path)[0] + '.webp'
    return webp if os.path.exists(webp) else path
