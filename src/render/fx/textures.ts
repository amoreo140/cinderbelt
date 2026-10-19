// VFX textures from public/assets/vfx (README there): loaded lazily and once. Until a texture has
// loaded the material already holds it (it uploads once its image is set). The images decode off the
// main thread (createImageBitmap, textureUploads.ts): a 2k explosion flipbook decoded inside its first
// upload cost the warm-up a ~0.5 s long task at 4× CPU (audit 2026-10-17, P10).
import { ClampToEdgeWrapping, NoColorSpace, RepeatWrapping, SRGBColorSpace, Texture } from 'three';
import { assetUrl } from '../assets/url';
import { decodeImage } from '../textureUploads';

export type VfxTexture =
  | 'flame_gradient'
  | 'flame_noise'
  | 'explosion_small'
  | 'explosion_large'
  | 'smoke_puff'
  | 'shockwave_ring'
  | 'spark'
  | 'glow_soft'
  | 'flare_star'
  | 'ember'
  | 'muzzle_flash'
  | 'bolt'
  | 'shield_hex'
  | 'impact_dust'
  | 'beam'
  | 'nebula_cloud'
  | 'damage_decals'
  | 'comet_coma';

/** Every effect texture (the boot list downloads them ahead of the game, assets/bootAssets.ts). */
export const VFX_TEXTURES = Object.keys({
  flame_gradient: 1,
  flame_noise: 1,
  explosion_small: 1,
  explosion_large: 1,
  smoke_puff: 1,
  shockwave_ring: 1,
  spark: 1,
  glow_soft: 1,
  flare_star: 1,
  ember: 1,
  muzzle_flash: 1,
  bolt: 1,
  shield_hex: 1,
  impact_dust: 1,
  beam: 1,
  nebula_cloud: 1,
  damage_decals: 1,
  comet_coma: 1,
} satisfies Record<VfxTexture, 1>) as VfxTexture[];

/** Textures in WebP (art/tools/optimize_assets.mjs VFX_WEBP), the rest PNG. */
export const VFX_WEBP: ReadonlySet<VfxTexture> = new Set(['explosion_small', 'explosion_large']);

/** File of an effect texture (relative to BASE_URL). */
export const vfxTexturePath = (name: VfxTexture): string => `assets/vfx/${name}.${VFX_WEBP.has(name) ? 'webp' : 'png'}`;

/** Data textures (no sRGB) and tiling textures (repeat). */
const DATA: ReadonlySet<VfxTexture> = new Set(['flame_noise']);
const REPEAT: ReadonlySet<VfxTexture> = new Set(['flame_noise', 'shield_hex', 'nebula_cloud']);

const cache = new Map<VfxTexture, Texture>();

/** Puts a decoded effect image on its texture and on the GPU (RenderContext: one upload per queue turn). */
export type VfxTextureUploader = (texture: Texture, apply: () => void) => Promise<void>;
let uploader: VfxTextureUploader | null = null;

/**
 * How decoded effect textures reach the GPU; null = set in place (three uploads them at the first draw).
 * With the queue (RenderContext) a 2k flipbook uploads in a gap of its own, after the sky and the planets
 * (perf O14).
 */
export function setVfxTextureUploader(fn: VfxTextureUploader | null): void {
  uploader = fn;
}

const missing = (name: VfxTexture): void => console.warn(`VFX texture missing: ${vfxTexturePath(name)} – the effect has no texture`);

/** An effect texture (shared – do not change its settings, never dispose it). */
export function vfxTexture(name: VfxTexture): Texture {
  let tex = cache.get(name);
  if (!tex) {
    const t = new Texture();
    tex = t;
    // low network priority, like an <img>: the start zone's sky and models come first
    decodeImage(assetUrl(vfxTexturePath(name)), Infinity, undefined, 'low').then(
      async (decoded) => {
        if (!decoded) return missing(name);
        const apply = (): void => {
          t.image = decoded.image;
          t.flipY = decoded.flipY;
          t.needsUpdate = true;
        };
        if (uploader) await uploader(t, apply).catch(apply);
        else apply();
      },
      () => missing(name),
    );
    tex.colorSpace = DATA.has(name) ? NoColorSpace : SRGBColorSpace;
    const wrap = REPEAT.has(name) ? RepeatWrapping : ClampToEdgeWrapping;
    tex.wrapS = wrap;
    tex.wrapT = wrap;
    cache.set(name, tex);
  }
  return tex;
}
