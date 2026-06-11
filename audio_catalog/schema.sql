-- Audio catalog manifest schema (DuckDB)
-- Run once: python -c "from audio_catalog.db import init_db; init_db()"

CREATE TABLE IF NOT EXISTS roots (
    root_id     INTEGER PRIMARY KEY,
    root_path   VARCHAR NOT NULL UNIQUE,
    label       VARCHAR,
    added_at    TIMESTAMP NOT NULL DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS files_id_seq START 1;

CREATE TABLE IF NOT EXISTS files (
    file_id           BIGINT PRIMARY KEY DEFAULT nextval('files_id_seq'),
    path              VARCHAR NOT NULL UNIQUE,
    rel_path          VARCHAR NOT NULL,
    root_id           INTEGER NOT NULL,

    size_bytes        BIGINT NOT NULL,
    mtime_ns          BIGINT NOT NULL,
    sha256            VARCHAR,

    format_name       VARCHAR,
    format_long_name  VARCHAR,
    duration_sec      DOUBLE,
    bit_rate          INTEGER,
    nb_streams        INTEGER,

    sample_rate       INTEGER,
    channels          SMALLINT,
    channel_layout    VARCHAR,
    codec_name        VARCHAR,
    bits_per_sample   SMALLINT,
    is_lossless       BOOLEAN,

    scan_status       VARCHAR NOT NULL DEFAULT 'ok',
    scan_error        VARCHAR,
    first_seen_at     TIMESTAMP NOT NULL DEFAULT now(),
    last_scanned_at   TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tags (
    file_id     BIGINT NOT NULL,
    namespace   VARCHAR NOT NULL,
    tag_key     VARCHAR NOT NULL,
    tag_value   VARCHAR NOT NULL,
    PRIMARY KEY (file_id, namespace, tag_key)
);

CREATE TABLE IF NOT EXISTS content_pipelines (
    pipeline_id       INTEGER PRIMARY KEY,
    name              VARCHAR NOT NULL UNIQUE,
    stem_model          VARCHAR,
    tag_model           VARCHAR,
    taxonomy_version    VARCHAR NOT NULL,
    config_json         JSON NOT NULL,
    created_at          TIMESTAMP NOT NULL DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS content_runs_id_seq START 1;

CREATE TABLE IF NOT EXISTS content_runs (
    run_id                BIGINT PRIMARY KEY DEFAULT nextval('content_runs_id_seq'),
    file_id               BIGINT NOT NULL,
    pipeline_id           INTEGER NOT NULL,
    source_mtime_ns       BIGINT NOT NULL,
    source_size_bytes     BIGINT NOT NULL,
    status                VARCHAR NOT NULL,
    error_message         VARCHAR,
    analyzed_at           TIMESTAMP NOT NULL DEFAULT now(),
    wall_time_ms          INTEGER,
    is_current            BOOLEAN NOT NULL DEFAULT TRUE,

    stem_vocals_ratio     DOUBLE,
    stem_drums_ratio      DOUBLE,
    stem_bass_ratio       DOUBLE,
    stem_other_ratio      DOUBLE,
    stem_guitar_ratio     DOUBLE,
    stem_piano_ratio      DOUBLE,

    has_voice             BOOLEAN,
    has_voice_conf        DOUBLE,
    has_drums             BOOLEAN,
    has_drums_conf        DOUBLE,
    has_bass              BOOLEAN,
    has_bass_conf         DOUBLE,
    has_orchestra         BOOLEAN,
    has_orchestra_conf    DOUBLE,

    voice_type            VARCHAR,
    voice_type_conf       DOUBLE,
    primary_content       VARCHAR,
    content_profile       VARCHAR
);

CREATE TABLE IF NOT EXISTS content_tag_scores (
    run_id          BIGINT NOT NULL,
    label           VARCHAR NOT NULL,
    score_max       DOUBLE NOT NULL,
    score_mean      DOUBLE NOT NULL,
    canonical       VARCHAR,
    PRIMARY KEY (run_id, label)
);

CREATE INDEX IF NOT EXISTS idx_files_sample_rate ON files(sample_rate);
CREATE INDEX IF NOT EXISTS idx_files_duration ON files(duration_sec);
CREATE INDEX IF NOT EXISTS idx_files_format ON files(format_name);
CREATE INDEX IF NOT EXISTS idx_content_voice ON content_runs(has_voice);
CREATE INDEX IF NOT EXISTS idx_content_drums ON content_runs(has_drums);
CREATE INDEX IF NOT EXISTS idx_content_bass ON content_runs(has_bass);
CREATE INDEX IF NOT EXISTS idx_content_orchestra ON content_runs(has_orchestra);
CREATE INDEX IF NOT EXISTS idx_content_profile ON content_runs(content_profile);

CREATE OR REPLACE VIEW content_catalog AS
SELECT
    f.file_id,
    f.path,
    f.rel_path,
    r.label AS root_label,
    f.format_name,
    f.duration_sec,
    f.sample_rate,
    f.channels,
    f.codec_name,
    f.is_lossless,
    f.size_bytes,
    cr.has_voice,
    cr.has_voice_conf,
    cr.voice_type,
    cr.has_drums,
    cr.has_drums_conf,
    cr.has_bass,
    cr.has_bass_conf,
    cr.has_orchestra,
    cr.has_orchestra_conf,
    cr.content_profile,
    cr.primary_content,
    cr.stem_vocals_ratio,
    cr.stem_drums_ratio,
    cr.stem_bass_ratio,
    cr.stem_other_ratio,
    cr.stem_guitar_ratio,
    cr.stem_piano_ratio,
    cr.analyzed_at,
    cp.name AS pipeline_name
FROM files f
JOIN roots r ON r.root_id = f.root_id
LEFT JOIN content_runs cr
    ON cr.file_id = f.file_id AND cr.is_current = TRUE
LEFT JOIN content_pipelines cp ON cp.pipeline_id = cr.pipeline_id
WHERE f.scan_status = 'ok';
