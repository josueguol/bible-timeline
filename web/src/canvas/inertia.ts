// Frame-rate-independent friction decay.
// Targets 0.92 attenuation per 16 ms frame → per-ms: 0.92^(1/16) ≈ 0.9948

const FRICTION_PER_MS = Math.pow(0.92, 1 / 16);
const STOP_THRESHOLD_PX_PER_MS = 0.05;

export class InertiaEngine {
  private _velocity = 0;   // px/ms, positive = moving right
  private _active = false;

  get isActive(): boolean { return this._active; }
  get velocity(): number  { return this._velocity; }

  start(velocityPxPerMs: number): void {
    if (Math.abs(velocityPxPerMs) < STOP_THRESHOLD_PX_PER_MS) {
      this._active = false;
      return;
    }
    this._velocity = velocityPxPerMs;
    this._active = true;
  }

  /** Returns displacement (px) for this tick. Call every RAF frame. */
  tick(dt: number): number {
    if (!this._active) return 0;
    const delta = this._velocity * dt;
    this._velocity *= Math.pow(FRICTION_PER_MS, dt);
    if (Math.abs(this._velocity) < STOP_THRESHOLD_PX_PER_MS) {
      this._active = false;
      this._velocity = 0;
    }
    return delta;
  }

  stop(): void {
    this._active = false;
    this._velocity = 0;
  }
}
