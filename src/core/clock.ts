/**
 * Deterministic logical clock. The simulation avoids wall-clock time so runs
 * and tests are reproducible. `tick()` returns a monotonically increasing tick.
 */
export class Clock {
  private t = 0;
  tick(): number {
    return ++this.t;
  }
  now(): number {
    return this.t;
  }
}
