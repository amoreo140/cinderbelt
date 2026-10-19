// GPU time of a frame from EXT_disjoint_timer_query_webgl2 (dynamic resolution, optimisation research
// R3). A few queries in flight: the result of a frame arrives some frames later, polled without
// waiting. A disjoint event (power state change, another context) drops the results that were open.
// Without the extension (Firefox, Safari, software rasterizers) there is no timer: `create` returns null.

/** The constants of EXT_disjoint_timer_query_webgl2 this timer uses. */
export interface TimerQueryExt {
  readonly TIME_ELAPSED_EXT: number;
  readonly GPU_DISJOINT_EXT: number;
}

/** What the timer needs of a WebGL2 context (a fake in the unit tests). */
export type TimerGl = Pick<WebGL2RenderingContext, 'createQuery' | 'deleteQuery' | 'beginQuery' | 'endQuery' | 'getQueryParameter' | 'getParameter' | 'QUERY_RESULT' | 'QUERY_RESULT_AVAILABLE'>;

/** Queries in flight at most (results lag 1–3 frames; more frames in flight are not measured). */
export const GPU_TIMER_QUERIES = 5;

export class GpuTimer {
  private readonly free: WebGLQuery[] = [];
  private readonly pending: WebGLQuery[] = [];
  private active: WebGLQuery | null = null;
  private created = 0;
  private disposed = false;

  constructor(
    private readonly gl: TimerGl,
    private readonly ext: TimerQueryExt,
  ) {}

  /** A timer on `gl`, or null when the context has no timer queries. */
  static create(gl: WebGL2RenderingContext): GpuTimer | null {
    try {
      const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerQueryExt | null;
      return ext ? new GpuTimer(gl, ext) : null;
    } catch {
      return null;
    }
  }

  /** Starts measuring (skipped while every query is still in flight). */
  begin(): void {
    if (this.active || this.disposed) return;
    let q = this.free.pop() ?? null;
    if (!q && this.created < GPU_TIMER_QUERIES) {
      q = this.gl.createQuery();
      if (q) this.created++;
    }
    if (!q) return;
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q);
    this.active = q;
  }

  end(): void {
    if (!this.active) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.pending.push(this.active);
    this.active = null;
  }

  /** Mean GPU time (ms) of the measurements finished since the last poll, or null when none did. */
  poll(): number | null {
    if (this.pending.length === 0) return null;
    const gl = this.gl;
    const disjoint = Boolean(gl.getParameter(this.ext.GPU_DISJOINT_EXT));
    let sum = 0;
    let n = 0;
    while (this.pending.length > 0) {
      const q = this.pending[0]!;
      // results arrive in order: the first one still running stops the poll
      if (!disjoint && !gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      this.pending.shift();
      if (!disjoint) {
        sum += Number(gl.getQueryParameter(q, gl.QUERY_RESULT)) / 1e6;
        n++;
      }
      this.free.push(q);
    }
    return n > 0 ? sum / n : null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.active) this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    for (const q of [...this.free, ...this.pending, ...(this.active ? [this.active] : [])]) this.gl.deleteQuery(q);
    this.free.length = 0;
    this.pending.length = 0;
    this.active = null;
  }
}
