"""Per-ring art direction.  Directions are (azimuth, elevation) in degrees in
Blender space (azimuth from +X towards +Y).  The default game view is centred
on (90, -55) and spans roughly elevation -30..-80 and azimuth 20..160.
Colours are scene-linear."""

DEFAULT_LAYERS = [
    # faint dust of tiny stars
    dict(scale=430.0, density=0.05, radius=0.55, bright=0.30, bpow=3.0),
    # small stars
    dict(scale=171.3, density=0.09, radius=0.65, bright=1.3, bpow=4.0),
    # medium stars with a tiny halo
    dict(scale=61.7, density=0.16, radius=0.8, bright=3.0, bpow=4.0, halo=(0.02, 2.0)),
    # few bright stars: halo, soft glow and 4-point spikes (big cells, low jitter
    # so the glow never touches a cell border)
    dict(scale=6.13, density=0.45, randomness=0.6, window=0.18, radial_max=0.15, radius=1.15, bright=10.0, bpow=2.2,
         halo=(0.03, 4.0), glow=(0.006, 14.0), spikes=(0.035, 10.0, 0.5)),
]


def _ring1():
    return dict(
        name='ring1', seed=1.0, star_rotation=(0, 0, 0),
        haze=dict(scale=1.6, strength=0.010, floor=(0.0022, 0.0030, 0.0060),
                  colors=[(0.0, (0.25, 0.35, 0.9)), (0.5, (0.35, 0.25, 0.85)), (1.0, (0.15, 0.55, 0.75))]),
        band=dict(through=((205, -62), (330, 38)), width=0.16, wobble=0.07,
                  bulge=(320, 22), bulge_size=0.55, bulge_gain=1.6, base=0.35,
                  cloud_scale=5.0, lane_width=0.22, lane_depth=0.85,
                  colors=[(0.0, (0.060, 0.050, 0.080)), (0.5, (0.070, 0.060, 0.100)),
                          (1.0, (0.055, 0.068, 0.105))]),
        stars_base=1.0, stars_band=3.0,
        star_layers=DEFAULT_LAYERS,
        hero_stars=[
            dict(dir=(152, 21), color=(0.75, 0.92, 1.0), intensity=14.0, radius=1.6,
                 halo=(0.06, 7.0), glow=(0.012, 40.0), spikes=(0.06, 22.0, 0.6)),
            dict(dir=(52, -37), color=(0.85, 0.9, 1.0), intensity=7.0, radius=1.3,
                 halo=(0.04, 5.0), glow=(0.006, 26.0), spikes=(0.045, 14.0, 0.55)),
        ],
        nebula=dict(
            regions=[
                dict(dir=(150, 18), radius=75, strength=1.0),     # hero cloud (upper sky, IBL)
                dict(dir=(50, -36), radius=48, strength=0.6),     # in-view, upper-right of screen
                dict(dir=(275, -15), radius=65, strength=0.85),   # behind the camera
                dict(dir=(10, 58), radius=55, strength=0.6),
                dict(dir=(195, -68), radius=45, strength=0.4),
            ],
            region_base=0.10,
            patch_scale=1.3, patch_lo=0.35, patch_hi=0.65,
            warp_scale=1.6, warp_amount=0.45,
            scale=2.6, rough=0.62, lo=0.46, hi=0.66, gamma=1.7, wash_scale=1.6, wash_gain=0.18,
            fine_scale=11.0, erode=0.55,
            fil_scale=3.8, fil_sharp=6.0, fil_gain=0.9, edge_mix=1.2,
            color_scale=1.4,
            colors=[(0.00, (0.03, 0.07, 0.50)), (0.30, (0.00, 0.36, 0.42)),
                    (0.52, (0.04, 0.14, 0.65)), (0.75, (0.32, 0.06, 0.62)),
                    (1.00, (0.50, 0.08, 0.52))],
            hot_color=(0.25, 0.85, 1.0), hot_from_density=1.2, hot_from_pocket=0.18,
            edge_color=(0.32, 0.14, 0.70),
            emission=4.0,
            pockets=[
                dict(dir=(152, 21), size=0.17, gain=4.5),
                dict(dir=(52, -37), size=0.10, gain=1.2),
                dict(dir=(280, -10), size=0.14, gain=2.0),
            ],
            dust=dict(scale=3.4, lo=0.44, hi=0.64, fil_gain=0.8, region_base=0.15,
                      density=16.0, color=(0.50, 0.42, 0.40), pocket_clear=0.45),
        ),
        grade=dict(exposure=1.1, shoulder=1.0, saturation=1.25),
    )


def _merge(base, over):
    out = dict(base)
    for k, v in over.items():
        out[k] = _merge(base[k], v) if isinstance(v, dict) and isinstance(base.get(k), dict) else v
    return out


def _ring2():
    """Vonkajsie pasy - warmer: magenta / orange gas, strong dust lanes."""
    return _merge(_ring1(), dict(
        name='ring2', seed=2.0, star_rotation=(23, -41, 67),
        haze=dict(floor=(0.0040, 0.0026, 0.0045),
                  colors=[(0.0, (0.75, 0.25, 0.55)), (0.5, (0.45, 0.20, 0.80)), (1.0, (0.9, 0.40, 0.30))]),
        band=dict(through=((120, -40), (300, -10)), bulge=(240, -35),
                  colors=[(0.0, (0.070, 0.050, 0.050)), (0.5, (0.075, 0.055, 0.065)),
                          (1.0, (0.080, 0.060, 0.045))]),
        hero_stars=[
            dict(dir=(200, 28), color=(1.0, 0.82, 0.6), intensity=14.0, radius=1.6,
                 halo=(0.06, 7.0), glow=(0.012, 40.0), spikes=(0.06, 22.0, 0.6)),
            dict(dir=(118, -30), color=(1.0, 0.9, 0.8), intensity=7.0, radius=1.3,
                 halo=(0.04, 5.0), glow=(0.006, 26.0), spikes=(0.045, 14.0, 0.55)),
        ],
        nebula=dict(
            regions=[
                dict(dir=(200, 25), radius=80, strength=1.0),
                dict(dir=(120, -32), radius=45, strength=0.6),
                dict(dir=(330, 5), radius=70, strength=0.9),
                dict(dir=(60, 55), radius=50, strength=0.55),
                dict(dir=(20, -65), radius=45, strength=0.45),
            ],
            region_base=0.06, lo=0.47, hi=0.68,
            scale=2.3, warp_amount=0.6, fil_scale=3.2, fil_gain=1.0,
            colors=[(0.00, (0.38, 0.03, 0.34)), (0.30, (0.60, 0.04, 0.28)),
                    (0.55, (0.22, 0.04, 0.48)), (0.78, (0.55, 0.06, 0.18)),
                    (1.00, (0.30, 0.05, 0.55))],
            hot_color=(1.0, 0.55, 0.18), hot_from_density=1.6, edge_color=(0.90, 0.20, 0.45),
            emission=3.6,
            pockets=[
                dict(dir=(200, 28), size=0.18, gain=2.4),
                dict(dir=(118, -30), size=0.10, gain=1.2),
                dict(dir=(335, 0), size=0.15, gain=2.0),
            ],
            dust=dict(scale=3.0, lo=0.40, hi=0.60, fil_gain=1.4, density=22.0,
                      color=(0.62, 0.42, 0.30), pocket_clear=0.35),
        ),
        grade=dict(exposure=1.1, saturation=1.2),
    ))


def _ring3():
    """Krystalove hmloviny - vivid cyan / green, crystalline veins."""
    return _merge(_ring1(), dict(
        name='ring3', seed=3.0, star_rotation=(-37, 12, 141),
        haze=dict(floor=(0.0015, 0.0030, 0.0070),
                  colors=[(0.0, (0.10, 0.45, 0.9)), (0.5, (0.15, 0.30, 0.95)), (1.0, (0.1, 0.8, 0.6))]),
        band=dict(through=((60, -70), (250, 20)), bulge=(170, -20),
                  colors=[(0.0, (0.035, 0.055, 0.055)), (0.5, (0.040, 0.060, 0.070)),
                          (1.0, (0.045, 0.065, 0.055))]),
        hero_stars=[
            dict(dir=(30, 30), color=(0.75, 1.0, 0.95), intensity=16.0, radius=1.6,
                 halo=(0.06, 7.0), glow=(0.012, 40.0), spikes=(0.07, 24.0, 0.6)),
            dict(dir=(70, -42), color=(0.8, 1.0, 0.9), intensity=7.0, radius=1.3,
                 halo=(0.04, 5.0), glow=(0.006, 26.0), spikes=(0.05, 14.0, 0.55)),
        ],
        nebula=dict(
            regions=[
                dict(dir=(30, 25), radius=80, strength=1.0),
                dict(dir=(75, -40), radius=48, strength=0.65),
                dict(dir=(210, -10), radius=70, strength=0.9),
                dict(dir=(140, 60), radius=50, strength=0.6),
                dict(dir=(290, -60), radius=45, strength=0.5),
            ],
            region_base=0.06,
            scale=2.8, rough=0.55, lo=0.48, hi=0.66, fil_scale=4.2, fil_sharp=9.0, fil_gain=0.7,
            facet_gain=1.1, facet_scale=9.0, facet_width=0.03, facet_mask_lo=0.49, edge_mix=1.6,
            color_scale=2.0,
            colors=[(0.00, (0.00, 0.12, 0.70)), (0.35, (0.00, 0.55, 0.75)),
                    (0.60, (0.05, 0.70, 0.15)), (0.85, (0.02, 0.25, 0.80)),
                    (1.00, (0.25, 0.80, 0.10))],
            hot_color=(0.30, 1.0, 0.75), edge_color=(0.25, 1.0, 0.60),
            emission=2.2,
            pockets=[
                dict(dir=(30, 30), size=0.18, gain=4.5),
                dict(dir=(70, -42), size=0.10, gain=1.4),
                dict(dir=(215, -5), size=0.15, gain=2.2),
            ],
            dust=dict(density=12.0, color=(0.45, 0.50, 0.55)),
        ),
        grade=dict(exposure=1.05, saturation=1.35),
    ))


def _ring4():
    """Mrtve zony - dark, desaturated crimson / purple, ominous, few stars."""
    layers = [dict(L) for L in DEFAULT_LAYERS]
    for L in layers:
        L['density'] *= 0.6
    return _merge(_ring1(), dict(
        name='ring4', seed=4.0, star_rotation=(71, 33, -12),
        haze=dict(strength=0.006, floor=(0.0030, 0.0016, 0.0026),
                  colors=[(0.0, (0.6, 0.15, 0.25)), (0.5, (0.35, 0.15, 0.55)), (1.0, (0.4, 0.3, 0.4))]),
        band=dict(through=((10, -50), (170, 30)), bulge=(90, 5), base=0.25, bulge_gain=0.8,
                  colors=[(0.0, (0.030, 0.022, 0.025)), (0.5, (0.030, 0.024, 0.032)),
                          (1.0, (0.032, 0.022, 0.022))]),
        stars_base=0.7, star_layers=layers,
        hero_stars=[
            # a swollen dim red giant
            dict(dir=(250, 15), color=(1.0, 0.30, 0.16), intensity=30.0, radius=2.6,
                 halo=(0.08, 9.0), glow=(0.015, 60.0), spikes=(0.02, 18.0, 0.7)),
            dict(dir=(45, -40), color=(1.0, 0.55, 0.5), intensity=4.0, radius=1.3,
                 halo=(0.04, 5.0), glow=(0.008, 26.0), spikes=(0.03, 12.0, 0.55)),
        ],
        nebula=dict(
            regions=[
                dict(dir=(250, 10), radius=80, strength=1.0),
                dict(dir=(50, -40), radius=45, strength=0.5),
                dict(dir=(100, 40), radius=60, strength=0.7),
                dict(dir=(330, -50), radius=50, strength=0.55),
            ],
            region_base=0.12, scale=2.2, lo=0.47, hi=0.70, warp_amount=0.7,
            fil_scale=3.0, fil_sharp=8.0, fil_gain=0.8,
            colors=[(0.00, (0.22, 0.02, 0.04)), (0.30, (0.35, 0.04, 0.10)),
                    (0.55, (0.16, 0.04, 0.26)), (0.80, (0.30, 0.10, 0.18)),
                    (1.00, (0.14, 0.06, 0.20))],
            hot_color=(0.80, 0.10, 0.07), edge_color=(0.40, 0.06, 0.28),
            emission=6.0,
            pockets=[
                dict(dir=(250, 15), size=0.2, gain=3.0),
                dict(dir=(45, -40), size=0.10, gain=0.8),
            ],
            dust=dict(scale=2.8, lo=0.42, hi=0.62, fil_gain=1.2, density=14.0, region_base=0.2,
                      color=(0.45, 0.38, 0.40), pocket_clear=0.3),
        ),
        grade=dict(exposure=1.25, saturation=0.9),
    ))


MOODS = {1: _ring1, 2: _ring2, 3: _ring3, 4: _ring4}


def get(ring):
    return MOODS[ring]()
