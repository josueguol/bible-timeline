CREATE TABLE IF NOT EXISTS bible_versions (
  version_id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  language TEXT NOT NULL,
  source_path TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bible_verses (
  version_id TEXT NOT NULL,
  ref TEXT NOT NULL,
  book TEXT NOT NULL,
  chapter INTEGER NOT NULL,
  verse INTEGER NOT NULL,
  text TEXT NOT NULL,
  PRIMARY KEY (version_id, ref),
  FOREIGN KEY (version_id) REFERENCES bible_versions(version_id)
);

CREATE TABLE IF NOT EXISTS timeline_manifests (
  manifest_id TEXT PRIMARY KEY,
  source_version_id TEXT NOT NULL,
  title TEXT NOT NULL,
  source_path TEXT NOT NULL,
  is_editable BOOLEAN NOT NULL,
  FOREIGN KEY (source_version_id) REFERENCES bible_versions(version_id)
);

CREATE TABLE IF NOT EXISTS timeline_chapter_entries (
  entry_id TEXT PRIMARY KEY,
  manifest_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  book TEXT NOT NULL,
  chapter INTEGER NOT NULL,
  source_line INTEGER NOT NULL,
  status TEXT NOT NULL,
  UNIQUE (manifest_id, sequence),
  UNIQUE (manifest_id, book, chapter),
  FOREIGN KEY (manifest_id) REFERENCES timeline_manifests(manifest_id)
);

CREATE TABLE IF NOT EXISTS timeline_verse_order (
  manifest_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  ref TEXT NOT NULL,
  book TEXT NOT NULL,
  chapter INTEGER NOT NULL,
  verse INTEGER NOT NULL,
  entry_id TEXT NOT NULL,
  status TEXT NOT NULL,
  PRIMARY KEY (manifest_id, sequence),
  UNIQUE (manifest_id, ref),
  FOREIGN KEY (manifest_id) REFERENCES timeline_manifests(manifest_id),
  FOREIGN KEY (entry_id) REFERENCES timeline_chapter_entries(entry_id)
);

CREATE TABLE IF NOT EXISTS timelines (
  timeline_id TEXT PRIMARY KEY,
  manifest_id TEXT NOT NULL,
  title TEXT NOT NULL,
  root_event_count INTEGER NOT NULL,
  expansion_mode TEXT NOT NULL,
  FOREIGN KEY (manifest_id) REFERENCES timeline_manifests(manifest_id)
);

CREATE TABLE IF NOT EXISTS timeline_zoom_levels (
  timeline_id TEXT NOT NULL,
  level INTEGER NOT NULL,
  label TEXT NOT NULL,
  min_zoom_factor REAL NOT NULL,
  max_zoom_factor REAL NOT NULL,
  target_visible_events INTEGER NOT NULL,
  description TEXT NOT NULL,
  PRIMARY KEY (timeline_id, level),
  FOREIGN KEY (timeline_id) REFERENCES timelines(timeline_id)
);

CREATE TABLE IF NOT EXISTS timeline_events (
  id TEXT PRIMARY KEY,
  timeline_id TEXT NOT NULL,
  parent_id TEXT,
  zoom_level INTEGER NOT NULL,
  sequence INTEGER NOT NULL,
  title TEXT NOT NULL,
  start_label TEXT NOT NULL,
  end_label TEXT NOT NULL,
  start_ref TEXT NOT NULL,
  end_ref TEXT NOT NULL,
  start_sequence INTEGER NOT NULL,
  end_sequence INTEGER NOT NULL,
  summary TEXT NOT NULL,
  importance INTEGER NOT NULL,
  canonical BOOLEAN NOT NULL,
  UNIQUE (timeline_id, parent_id, zoom_level, sequence),
  FOREIGN KEY (timeline_id) REFERENCES timelines(timeline_id),
  FOREIGN KEY (parent_id) REFERENCES timeline_events(id),
  CHECK (importance >= 1 AND importance <= 100),
  CHECK (start_sequence <= end_sequence)
);

CREATE TABLE IF NOT EXISTS timeline_event_sources (
  event_id TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  source_type TEXT NOT NULL,
  PRIMARY KEY (event_id, source_ref, source_type),
  FOREIGN KEY (event_id) REFERENCES timeline_events(id),
  CHECK (source_type IN ('scripture', 'historical-note'))
);

CREATE INDEX IF NOT EXISTS idx_bible_verses_version_book_chapter_verse
  ON bible_verses (version_id, book, chapter, verse);

CREATE INDEX IF NOT EXISTS idx_timeline_chapter_entries_manifest_sequence
  ON timeline_chapter_entries (manifest_id, sequence);

CREATE INDEX IF NOT EXISTS idx_timeline_verse_order_manifest_entry
  ON timeline_verse_order (manifest_id, entry_id, sequence);

CREATE INDEX IF NOT EXISTS idx_timeline_verse_order_manifest_ref
  ON timeline_verse_order (manifest_id, ref);

CREATE INDEX IF NOT EXISTS idx_timeline_events_timeline_parent_sequence
  ON timeline_events (timeline_id, parent_id, sequence);

CREATE INDEX IF NOT EXISTS idx_timeline_events_timeline_zoom_range
  ON timeline_events (timeline_id, zoom_level, start_sequence, end_sequence);

CREATE INDEX IF NOT EXISTS idx_timeline_event_sources_event
  ON timeline_event_sources (event_id);
