"""Contract buoys (M3.5a, spec 8.3 "Meranie": deploy 3 buoys in an area with the
tractor beam).  Human hull language (light chamfered plates, dark core,
faction accent), ~1.1-1.5 units, origin = centre of the float body.

buoy_survey.glb   Kartograficky institut measuring buoy (cyan/blue accent)
    Buoy_Survey        float + three deployed sensor arms (tri-star from above)
      Buoy_Sensor      sensor head (dish + ring), spin around local +Y (glTF)
      beacon_0         cyan status lamp on the mast top (blink in code)
buoy_marker.glb   Mining Guild marker / delivery buoy (orange hazard band)
    Buoy_Marker        float with tow ring (tractor grab point) + keel spike
      beacon_0         amber lamp (blink in code)
"""
import math

from lib import geo as G


def _float(name, r, h, band, verts=8):
    """Octagonal capsule float: dark core, light upper/lower shells, band."""
    prof = [(-h / 2, 0.0), (-h / 2, r * 0.55), (-h * 0.3, r * 0.95), (-h * 0.08, r), (h * 0.08, r),
            (h * 0.3, r * 0.95), (h / 2, r * 0.55), (h / 2, 0.0)]
    out = [G.lathe(name, prof, [0, 1, 2, 3, 4, 5, 6], ['hull_dark', 'hull_light', band, 'hull_dark', band, 'hull_light',
                                                      'hull_dark'],
                   axis='Z', verts=verts, closed=False, smooth=False)]
    return out


def build_survey(atlas_dir):
    p = _float('Float', 0.38, 0.62, 'accent_titanium')
    p.append(G.ring_band('GlowBand', 0.385, 0.33, -0.02, 0.02, 'engine_glow', verts=8, smooth=False))
    p.append(G.cyl('Mast', 0.05, 0.7, 'metal_bare', loc=(0, 0, 0.62), verts=8))
    p.append(G.cyl('Keel', 0.14, 0.32, 'hull_dark', loc=(0, 0, -0.45), verts=8, r2=0.05))
    # three deployed sensor arms (tri-star silhouette from above)
    for i in range(3):
        a = math.radians(90 + i * 120)
        c, s = math.cos(a), math.sin(a)
        arm = G.box(f'Arm{i}', 0.3, 1.05, -0.035, 0.035, -0.03, 0.03, 'hull_mid', bevel=0.01, seg=1)
        G.transform(arm, loc=(0, 0, 0.05), rot=(0, -8, math.degrees(a)))
        p.append(arm)
        p.append(G.cyl(f'Pod{i}', 0.07, 0.14, 'accent_titanium', loc=(1.08 * c, 1.08 * s, 0.2), verts=8))
        p.append(G.ellipsoid(f'PodLamp{i}', 0.04, 0.04, 0.04, 'engine_glow', loc=(1.08 * c, 1.08 * s, 0.29),
                             seg=8, rings=4))
    root = G.join(p, 'Buoy_Survey')
    G.finalize(root, atlas_dir)
    h = [G.cyl('Hub', 0.08, 0.08, 'hull_dark', verts=8),
         G.lathe('Dish', [(0.0, 0.0), (0.02, 0.1), (0.07, 0.22), (0.055, 0.23), (0.0, 0.11)], [0, 0, 1, 1],
                 ['hull_white', 'accent_titanium'], loc=(0.05, 0, 0.08), axis='Z', verts=12, closed=False,
                 rot=(0, 60, 0)),
         G.torus('Ring', 0.16, 0.015, 'engine_glow', loc=(0, 0, 0.02), maj=16, mnr=4)]
    sensor = G.join(h, 'Buoy_Sensor')
    G.finalize(sensor, atlas_dir)
    sensor.location = (0, 0, 0.98)
    sensor.parent = root
    lamp = G.ellipsoid('beacon_0', 0.06, 0.06, 0.06, 'engine_glow', seg=8, rings=5)
    G.finalize(lamp, atlas_dir)
    lamp.location = (0, 0, 1.22)
    lamp.parent = root
    return root


def build_marker(atlas_dir):
    p = _float('Float', 0.42, 0.7, 'accent_iron')
    # hazard chevron band
    for i in range(0, 8, 2):   # black hazard blocks on every other face of the orange belt
        a = i * 45 + 22.5
        st = G.box(f'Haz{i}', -0.012, 0.012, -0.15, 0.15, -0.115, 0.115, 'trim_black')
        G.transform(st, loc=(0.405 * math.cos(math.radians(a)), 0.405 * math.sin(math.radians(a)), 0), rot=(0, 0, a))
        p.append(st)
    # tow ring on top (tractor grab point) + lamp cage
    p.append(G.torus('TowRing', 0.2, 0.035, 'metal_bare', loc=(0, 0, 0.5), rot=(90, 0, 0), maj=16, mnr=6))
    p.append(G.cyl('TowPost', 0.06, 0.18, 'hull_dark', loc=(0, 0, 0.36), verts=8))
    p.append(G.cyl('LampBase', 0.09, 0.05, 'hull_dark', loc=(0.22, 0, 0.36), verts=8))
    for i in range(3):
        a = math.radians(i * 120)
        p.append(G.box(f'Cage{i}', -0.008, 0.008, -0.008, 0.008, 0.0, 0.14, 'trim_black'))
        G.transform(p[-1], loc=(0.22 + 0.07 * math.cos(a), 0.07 * math.sin(a), 0.38))
    p.append(G.cyl('LampCap', 0.085, 0.02, 'hull_dark', loc=(0.22, 0, 0.53), verts=8))
    # keel spike + stencil plates
    p.append(G.cyl('Keel', 0.16, 0.42, 'hull_dark', loc=(0, 0, -0.55), verts=8, r2=0.02))
    for i in range(2):
        a = math.radians(i * 180 + 90)
        p.append(G.box(f'Stencil{i}', -0.12, 0.12, -0.015, 0.015, 0.14, 0.24, 'hull_white'))
        G.transform(p[-1], loc=(0.385 * math.cos(a), 0.385 * math.sin(a), 0), rot=(0, 0, math.degrees(a) + 90))
    root = G.join(p, 'Buoy_Marker')
    G.finalize(root, atlas_dir)
    lamp = G.ellipsoid('beacon_0', 0.055, 0.055, 0.06, 'light_amber', seg=8, rings=5)
    G.finalize(lamp, atlas_dir)
    lamp.location = (0.22, 0, 0.45)
    lamp.parent = root
    return root


BUILDERS = {'buoy_survey': build_survey, 'buoy_marker': build_marker}
