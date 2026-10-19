"""Project paths used by all art scripts."""
import os

BLENDER_DIR = os.path.dirname(os.path.abspath(__file__))
ART = os.path.dirname(BLENDER_DIR)
ROOT = os.path.dirname(ART)
OUT = os.path.join(ART, 'out')
ATLAS = os.path.join(OUT, 'palette')          # generated palette atlas PNGs
PREVIEWS = os.path.join(OUT, 'previews')
BLEND = os.path.join(OUT, 'blend')
MODELS = os.path.join(ROOT, 'public', 'assets', 'models')
PARTS = os.path.join(MODELS, 'parts')
ASTEROIDS = os.path.join(MODELS, 'asteroids')
STATIONS = os.path.join(MODELS, 'stations')   # stations, outposts, dock clamp, hangar
DATA = os.path.join(BLENDER_DIR, 'data')      # station_layouts.json
ICONS = os.path.join(ROOT, 'public', 'assets', 'icons')
DEBRIS = os.path.join(MODELS, 'debris')       # debris_a..e.glb
TEXTURES = os.path.join(ROOT, 'public', 'assets', 'textures')   # palette liveries
PROPS = os.path.join(MODELS, 'props')           # loose props (cargo_container.glb)
PIRATES = os.path.join(MODELS, 'pirates')       # hrdzava_pevnost.glb, pirate_beacon.glb
KOVACI = os.path.join(MODELS, 'kovaci')         # ozvena_beacon.glb (ancient star-smiths)
ANOMALIES = os.path.join(MODELS, 'anomalies')   # anomaly_<type>.glb
UI = os.path.join(ROOT, 'public', 'assets', 'ui')
DERELICTS = os.path.join(MODELS, 'derelicts')     # derelict_a..d.glb, derelict_relay.glb (M4)
COMETS = os.path.join(MODELS, 'comets')           # comet_nucleus.glb, comet_tail.glb (M4)
NPC = os.path.join(MODELS, 'npc')                 # trader.glb (M4)
WARDENS = os.path.join(MODELS, 'kovaci')          # straznik_hliadka.glb, straznik_roj.glb, kolos.glb (M5a)
VFX = os.path.join(ROOT, 'public', 'assets', 'vfx')
BASE = os.path.join(MODELS, 'base')               # base_hub.glb, base_module_<id>.glb (M5b planetary bases)
DRONES = os.path.join(MODELS, 'drones')           # drone_<cargo|mining|repair|scout>.glb (M5b)
PLANET_MODELS = os.path.join(MODELS, 'planets')   # gas_giant_rings.glb (M5b)
