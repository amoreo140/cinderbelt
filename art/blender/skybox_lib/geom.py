"""Direction helpers.  Everything is in Blender world space (Z up).

Mapping to three.js (glTF convention): three = (bx, bz, -by).
The panorama is rendered so that it matches three.js' equirect lookup
(u = atan2(z, x)/2pi + 0.5, v = asin(y)/pi + 0.5):
  image centre (u=0.5) = Blender +X = three +X
  u = 0.25             = Blender +Y = three -Z   <- where the game camera looks
  top row              = Blender +Z = three +Y
"""
import math

from mathutils import Vector

GAME_PITCH = 55.0
# game camera looks towards three -Z (Blender +Y), tilted 55 deg down
GAME_VIEW = (0.0, math.cos(math.radians(GAME_PITCH)), -math.sin(math.radians(GAME_PITCH)))
GAME_UP = (0.0, math.sin(math.radians(GAME_PITCH)), math.cos(math.radians(GAME_PITCH)))


def dir_vec(az_deg, el_deg):
    """Azimuth from +X towards +Y (deg), elevation above the horizon (deg)."""
    a, e = math.radians(az_deg), math.radians(el_deg)
    return Vector((math.cos(e) * math.cos(a), math.cos(e) * math.sin(a), math.sin(e)))


def band_normal(a, b):
    """Normal of the great circle passing through two (az, el) directions."""
    return dir_vec(*a).cross(dir_vec(*b)).normalized()
