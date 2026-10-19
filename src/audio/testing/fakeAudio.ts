// A fake AudioContext for unit tests (the node environment has no Web Audio API).
// Records created nodes, connections and parameter automation.

export type ParamCall = { method: string; args: number[] };

export class FakeParam {
  value: number;
  readonly calls: ParamCall[] = [];

  constructor(value = 0) {
    this.value = value;
  }

  private record(method: string, args: number[], newValue?: number): this {
    this.calls.push({ method, args });
    if (newValue !== undefined) this.value = newValue;
    return this;
  }

  setValueAtTime(value: number, time: number) {
    return this.record('setValueAtTime', [value, time], value);
  }
  linearRampToValueAtTime(value: number, time: number) {
    return this.record('linearRampToValueAtTime', [value, time], value);
  }
  exponentialRampToValueAtTime(value: number, time: number) {
    return this.record('exponentialRampToValueAtTime', [value, time], value);
  }
  setTargetAtTime(target: number, time: number, tc: number) {
    // For tests we take the target as the immediate value.
    return this.record('setTargetAtTime', [target, time, tc], target);
  }
  cancelScheduledValues(time: number) {
    return this.record('cancelScheduledValues', [time]);
  }
  cancelAndHoldAtTime(time: number) {
    return this.record('cancelAndHoldAtTime', [time]);
  }
  setValueCurveAtTime(_curve: ArrayLike<number>, time: number, duration: number) {
    return this.record('setValueCurveAtTime', [time, duration]);
  }

  /** Last target value scheduled by any method. */
  get lastTarget(): number | undefined {
    for (let i = this.calls.length - 1; i >= 0; i--) {
      const c = this.calls[i]!;
      if (c.method !== 'cancelScheduledValues' && c.method !== 'cancelAndHoldAtTime') return c.args[0];
    }
    return undefined;
  }
}

export class FakeNode {
  readonly connections: unknown[] = [];
  disconnected = false;
  constructor(
    readonly ctx: FakeAudioContext,
    readonly kind: string,
  ) {}
  connect<T>(target: T): T {
    this.connections.push(target);
    return target;
  }
  disconnect(): void {
    this.disconnected = true;
  }
}

export class FakeGain extends FakeNode {
  readonly gain = new FakeParam(1);
}

export class FakeSource extends FakeNode {
  started = false;
  stopped = false;
  onended: (() => void) | null = null;
  start(): void {
    this.started = true;
  }
  stop(): void {
    this.stopped = true;
  }
}

export class FakeOscillator extends FakeSource {
  type = 'sine';
  readonly frequency = new FakeParam(440);
  readonly detune = new FakeParam(0);
}

export class FakeBufferSource extends FakeSource {
  buffer: FakeBuffer | null = null;
  loop = false;
  loopStart = 0;
  loopEnd = 0;
  readonly playbackRate = new FakeParam(1);
  readonly detune = new FakeParam(0);
}

export class FakeFilter extends FakeNode {
  type = 'lowpass';
  readonly frequency = new FakeParam(350);
  readonly Q = new FakeParam(1);
  readonly gain = new FakeParam(0);
  readonly detune = new FakeParam(0);
}

export class FakePanner extends FakeNode {
  readonly pan = new FakeParam(0);
}

export class FakeCompressor extends FakeNode {
  readonly threshold = new FakeParam(-24);
  readonly knee = new FakeParam(30);
  readonly ratio = new FakeParam(12);
  readonly attack = new FakeParam(0.003);
  readonly release = new FakeParam(0.25);
}

export class FakeConvolver extends FakeNode {
  buffer: FakeBuffer | null = null;
  normalize = true;
}

export class FakeAnalyser extends FakeNode {
  fftSize = 2048;
  smoothingTimeConstant = 0.8;
  get frequencyBinCount(): number {
    return this.fftSize / 2;
  }
  getByteTimeDomainData(): void {}
  getFloatTimeDomainData(): void {}
}

export class FakeWaveShaper extends FakeNode {
  curve: Float32Array | null = null;
  oversample = 'none';
}

export class FakeBuffer {
  private readonly channels: Float32Array[];
  constructor(
    readonly numberOfChannels: number,
    readonly length: number,
    readonly sampleRate: number,
  ) {
    this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }
  get duration(): number {
    return this.length / this.sampleRate;
  }
  getChannelData(channel: number): Float32Array {
    return this.channels[channel]!;
  }
}

export class FakeAudioContext {
  currentTime = 0;
  sampleRate = 8000;
  state: 'suspended' | 'running' | 'closed';
  readonly destination: FakeNode;
  readonly created: Record<string, number> = {};
  readonly nodes: FakeNode[] = [];
  resumeCalls = 0;
  suspendCalls = 0;

  constructor(initialState: 'suspended' | 'running' = 'running') {
    this.state = initialState;
    this.destination = new FakeNode(this, 'destination');
  }

  private track<T extends FakeNode>(node: T): T {
    this.created[node.kind] = (this.created[node.kind] ?? 0) + 1;
    this.nodes.push(node);
    return node;
  }

  count(kind: string): number {
    return this.created[kind] ?? 0;
  }

  resume(): Promise<void> {
    this.resumeCalls++;
    if (this.state !== 'closed') this.state = 'running';
    return Promise.resolve();
  }
  suspend(): Promise<void> {
    this.suspendCalls++;
    if (this.state !== 'closed') this.state = 'suspended';
    return Promise.resolve();
  }
  close(): Promise<void> {
    this.state = 'closed';
    return Promise.resolve();
  }

  createGain() {
    return this.track(new FakeGain(this, 'gain'));
  }
  createOscillator() {
    return this.track(new FakeOscillator(this, 'oscillator'));
  }
  createBufferSource() {
    return this.track(new FakeBufferSource(this, 'bufferSource'));
  }
  createBiquadFilter() {
    return this.track(new FakeFilter(this, 'biquad'));
  }
  createStereoPanner() {
    return this.track(new FakePanner(this, 'panner'));
  }
  createDynamicsCompressor() {
    return this.track(new FakeCompressor(this, 'compressor'));
  }
  createConvolver() {
    return this.track(new FakeConvolver(this, 'convolver'));
  }
  createAnalyser() {
    return this.track(new FakeAnalyser(this, 'analyser'));
  }
  createWaveShaper() {
    return this.track(new FakeWaveShaper(this, 'waveShaper'));
  }
  createBuffer(channels: number, length: number, sampleRate: number) {
    this.created['buffer'] = (this.created['buffer'] ?? 0) + 1;
    return new FakeBuffer(channels, length, sampleRate);
  }
}

/** A simple EventTarget + `hidden` as a stand-in for document. */
export class FakeDocument {
  hidden = false;
  private readonly listeners = new Map<string, Set<() => void>>();

  addEventListener(type: string, fn: () => void): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(fn);
  }
  removeEventListener(type: string, fn: () => void): void {
    this.listeners.get(type)?.delete(fn);
  }
  dispatch(type: string): void {
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn();
  }
  listenerCount(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }
}
