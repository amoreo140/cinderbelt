// One WebGL renderer for the whole app (I6 of code review M2a–M3b). Every new game / load gets the
// same renderer: shared resources (ModelLibrary model templates, VFX textures, liveries) are uploaded
// to the GPU once and no dispose listeners of old renderers hang on them. Shaders are not compiled
// again and skyboxes and effect models are not fetched on every start (M25).
import { ACESFilmicToneMapping, WebGLRenderer, type Texture } from 'three';
import { setPlanetTextureUploader } from './env/planetAssets';
import { FxModels } from './fx/fxModels';
import { setVfxTextureUploader } from './fx/textures';
import { SkyboxCache } from './skybox';
import { UploadQueue } from './textureUploads';

export class RenderContext {
  /** Renderers created (leak tests – stays 1 across games). */
  static created = 0;

  readonly renderer: WebGLRenderer;
  readonly skyboxes: SkyboxCache;
  readonly fxModels: FxModels;
  /** Big texture uploads and PMREM filters, one per frame-sized gap (audit 2026-10-16, issue #9). */
  readonly uploads = new UploadQueue();
  private disposed = false;

  constructor() {
    // no MSAA back buffer: everything is drawn through the post chain (PostStack), whose render
    // targets carry the antialiasing per quality – a multisampled canvas would only cost fill and memory
    this.renderer = new WebGLRenderer({ antialias: false });
    RenderContext.created++;
    // clipping of the hangar platform portal (materials with clippingPlanes; nothing else uses it)
    this.renderer.localClippingEnabled = true;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    // the composer makes several render calls per frame – we reset the stats ourselves
    this.renderer.info.autoReset = false;
    this.skyboxes = new SkyboxCache(this.renderer, undefined, this.uploads);
    this.fxModels = new FxModels();
    // decoded planet and effect textures reach the GPU through the queue, never in the frame that first
    // draws them
    const upload = (late: boolean) => (texture: Texture, apply: () => void): Promise<void> =>
      this.uploads.run(() => {
        apply();
        this.renderer.initTexture(texture);
      }, late);
    setPlanetTextureUploader(upload(false));
    // the effect textures after the sky and the planets (nothing waits for them – perf O14)
    setVfxTextureUploader(upload(true));
  }

  /** GPU resource and shader program counts (leak tests across games). */
  stats(): { created: number; geometries: number; textures: number; programs: number } {
    const { geometries, textures } = this.renderer.info.memory;
    return { created: RenderContext.created, geometries, textures, programs: this.renderer.info.programs?.length ?? 0 };
  }

  /** The game ended – the canvas leaves the page, the renderer and caches stay for the next game. */
  detach(): void {
    this.renderer.setRenderTarget(null);
    this.renderer.domElement.remove();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    setPlanetTextureUploader(null);
    setVfxTextureUploader(null);
    this.uploads.dispose();
    this.skyboxes.dispose();
    this.fxModels.dispose();
    this.renderer.dispose();
    // releases the WebGL context right away
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}
