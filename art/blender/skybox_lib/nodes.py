"""Tiny DSL for building shader node graphs from Python.

Every helper returns an output *socket*; every argument may be a socket or a
plain value (float / 3-tuple / 4-tuple).  Keeps the world + nebula graphs
readable as math instead of hundreds of lines of node plumbing.
"""
import bpy


class NB:
    def __init__(self, node_tree):
        self.nt = node_tree
        self.N = node_tree.nodes
        self.L = node_tree.links
        self._x = 0

    # -- plumbing ------------------------------------------------------------
    def node(self, kind, **props):
        n = self.N.new(kind)
        n.location = (self._x, 0)
        self._x += 40
        for k, v in props.items():
            setattr(n, k, v)
        return n

    def _set(self, sock, val):
        if isinstance(val, bpy.types.NodeSocket):
            self.L.new(val, sock)
        elif val is not None:
            if isinstance(val, (tuple, list)):
                if len(val) == 3 and sock.type == 'RGBA':
                    val = (*val, 1.0)
                sock.default_value = val
            else:
                if sock.type in ('VECTOR', 'RGBA'):
                    n = len(sock.default_value)
                    sock.default_value = [val] * n if sock.type == 'VECTOR' else (val, val, val, 1.0)
                else:
                    sock.default_value = val

    def inp(self, n, idx, val):
        self._set(n.inputs[idx], val)

    # -- scalar math -----------------------------------------------------------
    def math(self, op, a, b=None, c=None, clamp=False):
        n = self.node('ShaderNodeMath', operation=op, use_clamp=clamp)
        self._set(n.inputs[0], a)
        if b is not None:
            self._set(n.inputs[1], b)
        if c is not None:
            self._set(n.inputs[2], c)
        return n.outputs[0]

    def add(self, a, b): return self.math('ADD', a, b)
    def sub(self, a, b): return self.math('SUBTRACT', a, b)
    def mul(self, a, b): return self.math('MULTIPLY', a, b)
    def div(self, a, b): return self.math('DIVIDE', a, b)
    def pow(self, a, b): return self.math('POWER', a, b)
    def mad(self, a, b, c): return self.math('MULTIPLY_ADD', a, b, c)
    def maxf(self, a, b): return self.math('MAXIMUM', a, b)
    def minf(self, a, b): return self.math('MINIMUM', a, b)
    def absf(self, a): return self.math('ABSOLUTE', a)
    def exp(self, a): return self.math('EXPONENT', a)
    def sqrt(self, a): return self.math('SQRT', a)
    def clamp01(self, a): return self.math('ADD', a, 0.0, clamp=True)
    def lt(self, a, b): return self.math('LESS_THAN', a, b)

    def gauss(self, x, w):
        """exp(-(x/w)^2)"""
        t = self.div(x, w)
        return self.exp(self.mul(self.mul(t, t), -1.0))

    def maprange(self, v, a, b, c=0.0, d=1.0, interp='LINEAR', clamp=True):
        n = self.node('ShaderNodeMapRange', interpolation_type=interp, clamp=clamp)
        for i, val in enumerate((v, a, b, c, d)):
            self._set(n.inputs[i], val)
        return n.outputs[0]

    def smooth(self, v, a, b):
        return self.maprange(v, a, b, 0.0, 1.0, interp='SMOOTHSTEP')

    # -- vector math -----------------------------------------------------------
    def vmath(self, op, a, b=None, scale=None):
        n = self.node('ShaderNodeVectorMath', operation=op)
        self._set(n.inputs[0], a)
        if b is not None:
            self._set(n.inputs[1], b)
        if scale is not None:
            self._set(n.inputs['Scale'], scale)
        out = 'Value' if op in ('DOT_PRODUCT', 'DISTANCE', 'LENGTH') else 'Vector'
        return n.outputs[out]

    def vadd(self, a, b): return self.vmath('ADD', a, b)
    def vsub(self, a, b): return self.vmath('SUBTRACT', a, b)
    def vscale(self, a, s): return self.vmath('SCALE', a, scale=s)
    def dot(self, a, b): return self.vmath('DOT_PRODUCT', a, b)
    def dist(self, a, b): return self.vmath('DISTANCE', a, b)
    def length(self, a): return self.vmath('LENGTH', a)
    def normalize(self, a): return self.vmath('NORMALIZE', a)
    def cross(self, a, b): return self.vmath('CROSS_PRODUCT', a, b)

    def combine(self, x, y, z):
        n = self.node('ShaderNodeCombineXYZ')
        for i, v in enumerate((x, y, z)):
            self._set(n.inputs[i], v)
        return n.outputs[0]

    def separate(self, v):
        n = self.node('ShaderNodeSeparateXYZ')
        self._set(n.inputs[0], v)
        return n.outputs[0], n.outputs[1], n.outputs[2]

    # -- colour ------------------------------------------------------------------
    def mix_rgb(self, fac, a, b, blend='MIX'):
        n = self.node('ShaderNodeMix', data_type='RGBA', blend_type=blend, clamp_factor=True)
        self._set(n.inputs[0], fac)
        self._set(n.inputs[6], a)
        self._set(n.inputs[7], b)
        return n.outputs[2]

    def cmul(self, a, b):
        """colour * colour (or colour * scalar socket)"""
        return self.mix_rgb(1.0, a, b, blend='MULTIPLY')

    def cscale(self, col, s):
        return self.vmath('SCALE', col, scale=s)

    def cadd(self, a, b):
        return self.vadd(a, b)

    def ramp(self, fac, stops, interp='B_SPLINE'):
        """stops: [(pos, (r, g, b)), ...] in linear colour."""
        n = self.node('ShaderNodeValToRGB')
        cr = n.color_ramp
        cr.interpolation = interp
        while len(cr.elements) > 1:
            cr.elements.remove(cr.elements[-1])
        cr.elements[0].position = stops[0][0]
        cr.elements[0].color = (*stops[0][1], 1.0)
        for pos, col in stops[1:]:
            e = cr.elements.new(pos)
            e.color = (*col, 1.0)
        self._set(n.inputs[0], fac)
        return n.outputs[0]

    # -- textures ------------------------------------------------------------------
    def noise(self, vec, scale=1.0, detail=4.0, rough=0.5, lac=2.0, distortion=0.0,
              w=None, kind='FBM', out='Fac', offset=None, gain=None):
        n = self.node('ShaderNodeTexNoise', noise_dimensions='4D' if w is not None else '3D',
                      noise_type=kind)
        self._set(n.inputs['Vector'], vec)
        if w is not None:
            self._set(n.inputs['W'], w)
        self._set(n.inputs['Scale'], scale)
        self._set(n.inputs['Detail'], detail)
        self._set(n.inputs['Roughness'], rough)
        self._set(n.inputs['Lacunarity'], lac)
        self._set(n.inputs['Distortion'], distortion)
        if offset is not None:
            self._set(n.inputs['Offset'], offset)
        if gain is not None:
            self._set(n.inputs['Gain'], gain)
        return n.outputs[out]

    def voronoi(self, vec, scale, randomness=1.0, w=None, feature='F1'):
        n = self.node('ShaderNodeTexVoronoi', voronoi_dimensions='4D' if w is not None else '3D',
                      feature=feature, distance='EUCLIDEAN')
        self._set(n.inputs['Vector'], vec)
        if w is not None:
            self._set(n.inputs['W'], w)
        self._set(n.inputs['Scale'], scale)
        self._set(n.inputs['Randomness'], randomness)
        return n

    def value(self, v):
        n = self.node('ShaderNodeValue')
        n.outputs[0].default_value = v
        return n.outputs[0]

    def vec(self, v):
        return self.combine(*v)
