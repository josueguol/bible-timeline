import { fetchVerses } from "@api/bible.ts";
import type { VerseRangeRow } from "@api/types.ts";

/**
 * Debounced fetcher for the verse window that the user is currently looking
 * at. Only active once zoom reaches the verse level — below that, we show
 * event cards instead and this fetcher stays idle.
 *
 * The window is padded on both sides so panning a few verses doesn't trigger
 * a refetch, and aborts any in-flight request when the window shifts.
 */

const DEBOUNCE_MS = 180;
const WINDOW_PAD  = 10;        // extra verses fetched on each side

export type VerseWindowCallback  = (rows: VerseRangeRow[], versions: string[]) => void;
export type VerseWindowErrorCb   = (err: Error) => void;
export type VerseLoadingCallback = (loading: boolean) => void;

export class VerseWindowFetcher {
  private abort: AbortController | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastKey = "";

  constructor(
    private readonly onSuccess: VerseWindowCallback,
    private readonly onError:   VerseWindowErrorCb,
    private readonly onLoading: VerseLoadingCallback = () => {},
  ) {}

  /** Ask for verses in [fromSeq..toSeq] using the given version codes. */
  request(fromSeq: number, toSeq: number, versionCodes: string[]): void {
    if (versionCodes.length === 0) return;

    const from = Math.max(1, Math.floor(fromSeq) - WINDOW_PAD);
    const to   = Math.max(from, Math.ceil(toSeq) + WINDOW_PAD);
    const key  = `${from}-${to}:${versionCodes.join(",")}`;
    if (key === this.lastKey) return;

    this.clearTimer();
    this.onLoading(true);
    this.timer = setTimeout(() => this.doFetch(from, to, versionCodes, key), DEBOUNCE_MS);
  }

  private doFetch(fromSeq: number, toSeq: number, versionCodes: string[], key: string): void {
    this.abort?.abort();
    this.abort = new AbortController();
    this.lastKey = key;

    fetchVerses(
      {
        versions: versionCodes.join(","),
        fromSequence: fromSeq,
        toSequence:   toSeq,
        limit:        Math.min(250, toSeq - fromSeq + 1),
      },
      this.abort.signal,
    )
      .then((res) => {
        this.onLoading(false);
        this.onSuccess(res.rows, versionCodes);
      })
      .catch((err: unknown) => {
        if ((err as Error).name === "AbortError") return;
        this.onLoading(false);
        this.onError(err as Error);
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

  /** Drop the memoized key so the next request always fires. */
  invalidate(): void {
    this.lastKey = "";
  }
}
