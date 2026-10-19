/** Runs the simulation in fixed steps and returns the alpha for interpolation (0..1). */
export class FixedLoop {
  private accumulator = 0;

  constructor(
    private readonly dt: number,
    private readonly step: () => void,
    private readonly maxStepsPerFrame = 5,
  ) {}

  advance(elapsedSeconds: number): number {
    this.accumulator += elapsedSeconds;
    let steps = 0;
    while (this.accumulator >= this.dt - 1e-9 && steps < this.maxStepsPerFrame) {
      this.step();
      this.accumulator -= this.dt;
      steps++;
    }
    // on overload we drop the unprocessed time (guard against the "spiral of death")
    if (this.accumulator >= this.dt) this.accumulator = 0;
    if (this.accumulator < 0) this.accumulator = 0;
    return this.accumulator / this.dt;
  }
}
