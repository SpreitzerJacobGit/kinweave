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

/**
 * Real-time clock for production nodes. `now()` returns Unix ms (used for
 * wall-clock gate/stage deadlines); `tick()` is a strictly-increasing ms stamp
 * (ties broken by +1) so the append-only ledger keeps a total order. Tests keep
 * using the deterministic `Clock`.
 */
export class WallClock extends Clock {
  private last = 0;
  override tick(): number {
    const n = Math.max(Date.now(), this.last + 1);
    this.last = n;
    return n;
  }
  override now(): number {
    return Date.now();
  }
}
