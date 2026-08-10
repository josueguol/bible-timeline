-- ============================================================
-- Notes schema — isolated from the read-only biblical content
-- ============================================================
-- Apply after bible_timeline_schema.sql.
-- Never cross-FK with the public schema.

CREATE SCHEMA IF NOT EXISTS notes;

-- ── Users ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notes.users (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    email        TEXT        NOT NULL UNIQUE,
    pwd_hash     TEXT,                          -- NULL for OAuth-only accounts
    display_name TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON notes.users (email);

-- ── Refresh tokens (hashed, revocable) ───────────────────────
CREATE TABLE IF NOT EXISTS notes.refresh_tokens (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID        NOT NULL REFERENCES notes.users (id) ON DELETE CASCADE,
    token_hash  TEXT        NOT NULL,
    expires_at  TIMESTAMPTZ NOT NULL,
    revoked_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON notes.refresh_tokens (token_hash);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON notes.refresh_tokens (user_id);

-- ── OAuth linked accounts ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS notes.oauth_accounts (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID        NOT NULL REFERENCES notes.users (id) ON DELETE CASCADE,
    provider    TEXT        NOT NULL CHECK (provider IN ('google', 'facebook', 'twitter')),
    provider_id TEXT        NOT NULL,
    email       TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (provider, provider_id)
);

CREATE INDEX IF NOT EXISTS idx_oauth_accounts_user ON notes.oauth_accounts (user_id);

-- ── User notes (per verse, markdown) ─────────────────────────
CREATE TABLE IF NOT EXISTS notes.user_notes (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID        NOT NULL REFERENCES notes.users (id) ON DELETE CASCADE,
    verse_ref   TEXT        NOT NULL,
    content     TEXT        NOT NULL CHECK (char_length(content) BETWEEN 1 AND 10000),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notes_user_verse   ON notes.user_notes (user_id, verse_ref);
CREATE INDEX IF NOT EXISTS idx_notes_user_created ON notes.user_notes (user_id, created_at);
