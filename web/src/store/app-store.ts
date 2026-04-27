import type { ViewportResponse } from "@api/types.ts";
import type { ThemeName } from "../theme.ts";

export type AppStatus = "idle" | "loading-viewport" | "panning" | "zooming" | "focusing";
export type LangCode = "es" | "en";
export type DensityMode = "compact" | "regular" | "comfy";

export type FloatType = "context" | "prophecy" | "xref" | "note" | "map" | "people";

export interface AppState {
  status: AppStatus;
  timelineId: string;
  zoomFactor: number;
  focusEventId: string | null;
  focusRef: string | null;
  /** Version codes shown in verse cards — order determines display column order. */
  activeVersions: string[];
  viewport: ViewportResponse | null;
  online: boolean;
  theme: ThemeName;
  lang: LangCode;
  density: DensityMode;
  sidebarOpen: boolean;
  showFloats: boolean;
  floatTypes: readonly FloatType[];
  /** Stable bookmarks — {sequence, ref, label}. */
  bookmarks: readonly { id: string; sequence: number; ref: string; label: string }[];
}

type StateChangeListener = (state: Readonly<AppState>) => void;

const INITIAL_STATE: AppState = {
  status: "idle",
  timelineId: "bible-history-hierarchy-seed",
  zoomFactor: 0.05,
  focusEventId: null,
  focusRef: null,
  activeVersions: ["RV60"],
  viewport: null,
  online: navigator.onLine,
  theme: "inkwell",
  lang: "es",
  density: "regular",
  sidebarOpen: false,
  showFloats: true,
  floatTypes: ["context", "prophecy", "xref", "note", "map", "people"],
  bookmarks: [],
};

class AppStore extends EventTarget {
  private state: AppState = { ...INITIAL_STATE };

  getState(): Readonly<AppState> {
    return this.state;
  }

  update(patch: Partial<AppState>): void {
    this.state = { ...this.state, ...patch };
    this.dispatchEvent(new CustomEvent("change", { detail: this.state }));
  }

  subscribe(listener: StateChangeListener): () => void {
    const handler = (e: Event) => listener((e as CustomEvent<AppState>).detail);
    this.addEventListener("change", handler);
    return () => this.removeEventListener("change", handler);
  }
}

export const store = new AppStore();

// reflect online/offline in store automatically
window.addEventListener("online", () => store.update({ online: true }));
window.addEventListener("offline", () => store.update({ online: false }));
