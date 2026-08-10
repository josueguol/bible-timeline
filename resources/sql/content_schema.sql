-- Content schema: float cards CMS + admin auth + url unfurls
-- Apply: docker exec -i local-dev-postgres psql -U postgres -d bible_timeline < resources/sql/content_schema.sql

CREATE SCHEMA IF NOT EXISTS content;

-- ── Admin users ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS content.admin_users (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    email      TEXT        NOT NULL UNIQUE,
    pwd_hash   TEXT        NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Float cards ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS content.float_cards (
    id                    UUID     PRIMARY KEY DEFAULT gen_random_uuid(),
    type                  TEXT     NOT NULL CHECK (type IN ('context','prophecy','xref','note','map','people')),
    sequence              INTEGER  NOT NULL CHECK (sequence BETWEEN 1 AND 31102),
    lane                  SMALLINT NOT NULL DEFAULT 0 CHECK (lane IN (0, 1)),
    title_es              TEXT     NOT NULL,
    title_en              TEXT     NOT NULL DEFAULT '',
    body_es               TEXT     NOT NULL,
    body_en               TEXT     NOT NULL DEFAULT '',
    linked_event_id       TEXT,
    fulfilled_by_event_id TEXT,
    published             BOOLEAN  NOT NULL DEFAULT true,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_content_float_cards_sequence  ON content.float_cards (sequence);
CREATE INDEX IF NOT EXISTS idx_content_float_cards_published ON content.float_cards (published) WHERE published = true;

-- ── URL unfurls ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS content.url_unfurls (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    url         TEXT        NOT NULL UNIQUE,
    title       TEXT,
    description TEXT,
    image_url   TEXT,
    site_name   TEXT,
    fetched_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── auto-update updated_at ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION content.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_float_cards_updated_at ON content.float_cards;
CREATE TRIGGER trg_float_cards_updated_at
    BEFORE UPDATE ON content.float_cards
    FOR EACH ROW EXECUTE FUNCTION content.set_updated_at();

-- ── Seed: existing hardcoded float cards ─────────────────────────────────────
-- Only when the table is empty: this file is re-applied on every start.sh run
-- and there is no unique constraint, so a plain INSERT duplicates the seed.

INSERT INTO content.float_cards (type, sequence, lane, title_es, body_es, published)
SELECT * FROM (VALUES
('context',  1,     0, 'Contexto · Relato cosmogónico',    'Narración hebrea del origen del mundo en siete días. Estructura poética con paralelismos (días 1–3 formación, días 4–6 llenado).', true),
('prophecy', 68,    1, 'Profecía · Protoevangelio',        'Primera mención mesiánica. Se cumplirá en la encarnación de Cristo (Mt 1:23, Gl 4:4).', true),
('people',   1400,  0, 'Personaje · Abraham',              'Padre de la fe. Origen: Ur de los caldeos. Pacto eterno con descendencia innumerable.', true),
('map',      2800,  1, 'Mapa · Ruta del Éxodo',            'De Ramsés en Egipto hacia el Monte Sinaí. ~40 años en el desierto antes de entrar en Canaán.', true),
('xref',     5800,  0, 'Referencia cruzada · Ley y Sermón','La Ley del Sinaí y el Sermón del Monte: Jesús interpreta los mandamientos desde el corazón.', true),
('note',     14200, 1, 'Nota · Poesía hebrea',             'Los Salmos usan paralelismo (sinonímico, antitético, sintético). Salmo 23 es pastoril; Dios como pastor.', true),
('prophecy', 17900, 0, 'Profecía · Emanuel',               'Anuncio del nacimiento virginal. Cumplimiento explícito 700 años después en Mateo 1:23.', true),
('context',  19800, 0, 'Contexto · Cautividad babilónica', 'Destrucción del templo en 586 a.C. por Nabucodonosor. 70 años en el exilio, profetizados por Jeremías.', true),
('context',  23200, 1, 'Contexto · 400 años de silencio',  'Entre Malaquías y Mateo: ascenso de Grecia y Roma, helenización, surgimiento de fariseos y saduceos.', true),
('people',   24200, 0, 'Personaje · Jesús de Nazaret',     'Mesías anunciado. Ministerio público ~3 años en Galilea y Judea.', true),
('map',      27800, 1, 'Mapa · Viajes de Pablo',           'Tres viajes misioneros + viaje a Roma. Antioquía, Éfeso, Corinto, Tesalónica, Filipos.', true),
('note',     30800, 1, 'Nota · Género apocalíptico',       'Visiones simbólicas, números con valor teológico (7, 12, 1000). Esperanza de la nueva creación.', true)
) AS seed(type, sequence, lane, title_es, body_es, published)
WHERE NOT EXISTS (SELECT 1 FROM content.float_cards);
