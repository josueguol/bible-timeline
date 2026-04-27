import { fetchViewport } from "@api/viewport.ts";
import type { ViewportResponse } from "@api/types.ts";
import { zoomFactorToLevel } from "./zoom-math.ts";

const DEBOUNCE_MS = 150;

export type ViewportCallback = (vp: ViewportResponse) => void;
export type ErrorCallback    = (err: Error) => void;

export class ViewportFetcher {
  private abort: AbortController | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastLevel = -1;

  constructor(
    private readonly timelineId: string,
    private readonly onSuccess: ViewportCallback,
    private readonly onError: ErrorCallback,
  ) {}

  /** Call on every zoom/pan change. Fetches immediately on level crossing, debounces otherwise. */
  request(zoomFactor: number, focusSeq: number): void {
    const level = zoomFactorToLevel(zoomFactor);
    const levelCrossed = level !== this.lastLevel;

    this.clearTimer();

    if (levelCrossed) {
      this.doFetch(zoomFactor, focusSeq, level);
    } else {
      this.timer = setTimeout(() => this.doFetch(zoomFactor, focusSeq, level), DEBOUNCE_MS);
    }
  }

  private doFetch(zoomFactor: number, focusSeq: number, level: number): void {
    this.abort?.abort();
    this.abort = new AbortController();
    this.lastLevel = level;

    const req = { zoomFactor, focusSequence: focusSeq };

    fetchViewport(req, this.timelineId, this.abort.signal)
      .then(vp => this.onSuccess(vp))
      .catch(err => {
        if ((err as Error).name !== "AbortError") {
          this.onError(err as Error);
        }
      });
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  destroy(): void {
    this.clearTimer();
    this.abort?.abort();
  }
}
