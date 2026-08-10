// ── Viewport ─────────────────────────────────────────────────────────────────

export interface ZoomLevel {
  level: number;
  label: string;
  minZoomFactor: number;
  maxZoomFactor: number;
  targetVisibleEvents: number;
  description: string;
}

export interface ViewportFocus {
  requestedFocusSequence: number | null;
  requestedFocusRef: string | null;
  requestedFocusEventId: string | null;
  resolvedFocusSequence: number;
  resolvedFocusRef: string | null;
  focusedEventId: string;
  focusPath: string[];
}

export type EventState = "expanded" | "collapsed";

export interface VisibleEvent {
  id: string;
  parentId: string | null;
  zoomLevel: number;
  sequence: number;
  title: string;
  startSequence: number;
  endSequence: number;
  state: EventState;
  isFocused: boolean;
  isFocusAncestor: boolean;
  displayOrder: number;
  path: string[];
  // optional extras the server may include
  summary?: string;
  importance?: number;
  canonical?: boolean;
  scriptureRefs?: string[];
}

export interface ViewportStats {
  visibleCount: number;
  targetVisibleEvents: number;
  viewportEventBudget: number;
}

export interface ViewportResponse {
  timelineId: string;
  zoomLevel: ZoomLevel;
  focus: ViewportFocus;
  visibleEvents: VisibleEvent[];
  stats: ViewportStats;
}

// ── Viewport request params ───────────────────────────────────────────────────

export interface ViewportRequest {
  zoomFactor: number;
  focusSequence?: number;
  focusRef?: string;
  focusEventId?: string;
  viewportEventBudget?: number;
  includeAncestors?: boolean;
}

// ── Bible versions ────────────────────────────────────────────────────────────

export interface BibleVersion {
  versionId: string;
  code: string;
  title: string;
  language: string;
  languageFamily: string;   // "es" | "original-greek" | "original-hebrew" | "other"
  isPrimary: boolean;
  verseCount: number | null;
}

export interface VersionsListResponse {
  versions: BibleVersion[];
}

// ── Verses range ──────────────────────────────────────────────────────────────

export interface StrongEntry {
  strongNumber: string;
  language: "hebrew" | "greek";
  lemma: string;
  transliteration: string | null;
  pronunciation: string | null;
  definition: string;
  derivation: string | null;
  kjvDefinition: string | null;
  definitionLanguage: "es" | "en";
  translationStatus: "source" | "machine" | "reviewed" | "fallback";
  source: string;
}

export interface VerseSegmentStrong {
  strongNumber: string;
  strongRaw: string;
}

export interface VerseSegment {
  position: number;
  text: string;
  strongs: VerseSegmentStrong[];
}

export interface VerseRangeRow {
  sequence: number;
  ref: string;
  book: string;
  chapter: number;
  verse: number;
  texts: Record<string, string | null>;
  segments?: Record<string, VerseSegment[]>;
}

export interface VerseRangeDto {
  fromSequence: number;
  toSequence: number;
  fromRef: string | null;
  toRef: string | null;
}

export interface VersesRangeRequest {
  versions: string;        // comma-separated codes, e.g. "RV60" or "RV60,NTV"
  fromRef?: string;
  toRef?: string;
  fromSequence?: number;
  toSequence?: number;
  manifestId?: string;
  limit?: number;
  includeStrong?: boolean;
  strongLang?: "es" | "en";
}

export interface VersesRangeResponse {
  manifestId: string;
  versions: string[];
  range: VerseRangeDto;
  rows: VerseRangeRow[];
  lexicon?: Record<string, StrongEntry>;
}

// ── Search ────────────────────────────────────────────────────────────────────

export interface SearchFocus {
  focusRef: string | null;
  focusSequence: number | null;
  focusEventId: string | null;
}

export interface SearchResult {
  category: "reference" | "event" | "text";
  label: string;
  description: string | null;
  focus: SearchFocus;
  score: number | null;
  preview: string | null;
}

export interface SearchResponse {
  query: string;
  results: SearchResult[];
}

// ── Event detail ──────────────────────────────────────────────────────────────

export interface EventDetailSource {
  sourceRef: string;
  sourceType: string;
}

export interface EventDetailEvent {
  id: string;
  parentId: string | null;
  zoomLevel: number;
  sequence: number;
  title: string;
  startLabel: string;
  endLabel: string;
  startRef: string;
  endRef: string;
  startSequence: number;
  endSequence: number;
  summary: string;
  importance: number;
  canonical: boolean;
  scriptureRefs: string[] | null;
  sources: EventDetailSource[] | null;
}

export interface EventDetailAncestor {
  id: string;
  title: string;
  zoomLevel: number;
}

export interface ChildrenSummary {
  total: number;
  byZoomLevel: Record<string, number>;
}

export interface EventDetailResponse {
  timelineId: string;
  event: EventDetailEvent;
  ancestors: EventDetailAncestor[];
  childrenSummary: ChildrenSummary;
}
