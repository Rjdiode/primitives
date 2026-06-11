"""DuckDB helpers for the audio catalog manifest."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import duckdb

PACKAGE_DIR = Path(__file__).resolve().parent
REPO_ROOT = PACKAGE_DIR.parent
DEFAULT_DB_PATH = REPO_ROOT / "manifest.duckdb"
SCHEMA_PATH = PACKAGE_DIR / "schema.sql"

AUDIO_EXTENSIONS = {
    ".wav", ".mp3", ".flac", ".ogg", ".oga", ".opus", ".m4a", ".aac",
    ".aiff", ".aif", ".wma", ".wv", ".ape",
}


def connect(db_path: Path | str | None = None) -> duckdb.DuckDBPyConnection:
    path = Path(db_path) if db_path else DEFAULT_DB_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    return duckdb.connect(str(path))


def init_db(db_path: Path | str | None = None) -> Path:
    path = Path(db_path) if db_path else DEFAULT_DB_PATH
    con = connect(path)
    con.execute(SCHEMA_PATH.read_text())
    con.close()
    return path


def ensure_root(con: duckdb.DuckDBPyConnection, root_path: Path, label: str | None = None) -> int:
    root_path = root_path.resolve()
    row = con.execute(
        "SELECT root_id FROM roots WHERE root_path = ?",
        [str(root_path)],
    ).fetchone()
    if row:
        return int(row[0])
    con.execute(
        "INSERT INTO roots (root_path, label) VALUES (?, ?)",
        [str(root_path), label or root_path.name],
    )
    return int(con.execute(
        "SELECT root_id FROM roots WHERE root_path = ?",
        [str(root_path)],
    ).fetchone()[0])


def get_or_create_pipeline(
    con: duckdb.DuckDBPyConnection,
    name: str,
    stem_model: str,
    tag_model: str,
    taxonomy_version: str,
    config: dict[str, Any],
) -> int:
    row = con.execute(
        "SELECT pipeline_id FROM content_pipelines WHERE name = ?",
        [name],
    ).fetchone()
    if row:
        return int(row[0])
    con.execute(
        """
        INSERT INTO content_pipelines (name, stem_model, tag_model, taxonomy_version, config_json)
        VALUES (?, ?, ?, ?, ?)
        """,
        [name, stem_model, tag_model, taxonomy_version, json.dumps(config)],
    )
    return int(con.execute(
        "SELECT pipeline_id FROM content_pipelines WHERE name = ?",
        [name],
    ).fetchone()[0])


def files_needing_content_analysis(
    con: duckdb.DuckDBPyConnection,
    pipeline_id: int,
    root_id: int | None = None,
    limit: int | None = None,
    force: bool = False,
) -> list[dict[str, Any]]:
    root_clause = "AND f.root_id = ?" if root_id is not None else ""
    params: list[Any] = [pipeline_id]
    if root_id is not None:
        params.append(root_id)

    stale_clause = ""
    if not force:
        stale_clause = """
            AND (
                ar.run_id IS NULL
                OR f.mtime_ns > ar.source_mtime_ns
                OR f.size_bytes != ar.source_size_bytes
            )
        """

    limit_clause = f"LIMIT {int(limit)}" if limit else ""
    query = f"""
        SELECT
            f.file_id,
            f.path,
            f.mtime_ns,
            f.size_bytes,
            f.duration_sec
        FROM files f
        LEFT JOIN content_runs ar
            ON ar.file_id = f.file_id
           AND ar.pipeline_id = ?
           AND ar.is_current = TRUE
           AND ar.status = 'ok'
        WHERE f.scan_status = 'ok'
        {root_clause}
        {stale_clause}
        ORDER BY f.rel_path
        {limit_clause}
    """
    rows = con.execute(query, params).fetchall()
    cols = ["file_id", "path", "mtime_ns", "size_bytes", "duration_sec"]
    return [dict(zip(cols, row)) for row in rows]


def mark_runs_not_current(con: duckdb.DuckDBPyConnection, file_id: int, pipeline_id: int) -> None:
    con.execute(
        """
        UPDATE content_runs
        SET is_current = FALSE
        WHERE file_id = ? AND pipeline_id = ? AND is_current = TRUE
        """,
        [file_id, pipeline_id],
    )


def insert_content_run(
    con: duckdb.DuckDBPyConnection,
    *,
    file_id: int,
    pipeline_id: int,
    source_mtime_ns: int,
    source_size_bytes: int,
    status: str,
    error_message: str | None,
    wall_time_ms: int,
    stem_ratios: dict[str, float | None],
    presence: dict[str, Any],
    voice_type: str | None,
    voice_type_conf: float | None,
    primary_content: str,
    content_profile: str,
    tag_scores: list[dict[str, Any]],
) -> int:
    mark_runs_not_current(con, file_id, pipeline_id)
    row = con.execute(
        """
        INSERT INTO content_runs (
            file_id, pipeline_id, source_mtime_ns, source_size_bytes,
            status, error_message, wall_time_ms,
            stem_vocals_ratio, stem_drums_ratio, stem_bass_ratio, stem_other_ratio,
            stem_guitar_ratio, stem_piano_ratio,
            has_voice, has_voice_conf,
            has_drums, has_drums_conf,
            has_bass, has_bass_conf,
            has_orchestra, has_orchestra_conf,
            voice_type, voice_type_conf,
            primary_content, content_profile
        ) VALUES (
            ?, ?, ?, ?,
            ?, ?, ?,
            ?, ?, ?, ?,
            ?, ?,
            ?, ?,
            ?, ?,
            ?, ?,
            ?, ?,
            ?, ?,
            ?, ?
        )
        RETURNING run_id
        """,
        [
            file_id, pipeline_id, source_mtime_ns, source_size_bytes,
            status, error_message, wall_time_ms,
            stem_ratios.get("vocals"), stem_ratios.get("drums"),
            stem_ratios.get("bass"), stem_ratios.get("other"),
            stem_ratios.get("guitar"), stem_ratios.get("piano"),
            presence["voice"]["present"], presence["voice"]["confidence"],
            presence["drums"]["present"], presence["drums"]["confidence"],
            presence["bass"]["present"], presence["bass"]["confidence"],
            presence["orchestra"]["present"], presence["orchestra"]["confidence"],
            voice_type, voice_type_conf,
            primary_content, content_profile,
        ],
    ).fetchone()
    run_id = int(row[0])

    if tag_scores:
        con.executemany(
            """
            INSERT INTO content_tag_scores (run_id, label, score_max, score_mean, canonical)
            VALUES (?, ?, ?, ?, ?)
            """,
            [
                (run_id, t["label"], t["score_max"], t["score_mean"], t.get("canonical"))
                for t in tag_scores
            ],
        )

    return run_id
