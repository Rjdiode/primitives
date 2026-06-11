#!/usr/bin/env python3
"""Tier 1: walk audio folders and index file/container metadata into DuckDB."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

from audio_catalog.db import AUDIO_EXTENSIONS, connect, ensure_root, init_db

try:
    import mutagen
except ImportError:
    mutagen = None


def probe_file(path: Path) -> dict:
    cmd = [
        "ffprobe", "-v", "quiet", "-print_format", "json",
        "-show_format", "-show_streams", str(path),
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        return json.loads(result.stdout)
    except (subprocess.CalledProcessError, FileNotFoundError, json.JSONDecodeError) as exc:
        return {"error": str(exc)}


def parse_probe(data: dict) -> dict:
    if "error" in data:
        return {"scan_status": "unreadable", "scan_error": data["error"]}

    fmt = data.get("format", {})
    streams = data.get("streams", [])
    audio_streams = [s for s in streams if s.get("codec_type") == "audio"]
    primary = audio_streams[0] if audio_streams else {}

    codec = primary.get("codec_name", "")
    lossless_codecs = {"pcm_s16le", "pcm_s24le", "pcm_s32le", "pcm_f32le", "flac", "alac", "wavpack"}

    duration = fmt.get("duration")
    sample_rate = primary.get("sample_rate")

    return {
        "scan_status": "ok",
        "scan_error": None,
        "format_name": fmt.get("format_name"),
        "format_long_name": fmt.get("format_long_name"),
        "duration_sec": float(duration) if duration else None,
        "bit_rate": int(fmt["bit_rate"]) if fmt.get("bit_rate") else None,
        "nb_streams": len(streams),
        "sample_rate": int(sample_rate) if sample_rate else None,
        "channels": int(primary["channels"]) if primary.get("channels") else None,
        "channel_layout": primary.get("channel_layout"),
        "codec_name": codec or None,
        "bits_per_sample": int(primary["bits_per_sample"]) if primary.get("bits_per_sample") else None,
        "is_lossless": codec in lossless_codecs if codec else None,
    }


def read_tags(path: Path) -> list[tuple[str, str, str]]:
    if mutagen is None:
        return []
    try:
        meta = mutagen.File(path, easy=True)
    except Exception:
        return []
    if meta is None:
        return []

    rows = []
    for key, values in meta.items():
        if not values:
            continue
        val = values[0] if isinstance(values, list) else str(values)
        rows.append(("embedded", key, str(val)))
    return rows


def iter_audio_files(root: Path) -> list[Path]:
    files = []
    for path in sorted(root.rglob("*")):
        if path.is_file() and path.suffix.lower() in AUDIO_EXTENSIONS:
            files.append(path)
    return files


def upsert_file(con, root_id: int, root_path: Path, path: Path, meta: dict) -> int:
    stat = path.stat()
    rel_path = str(path.relative_to(root_path))
    abs_path = str(path.resolve())

    existing = con.execute(
        "SELECT file_id FROM files WHERE path = ?",
        [abs_path],
    ).fetchone()

    fields = [
        rel_path, root_id,
        stat.st_size, int(stat.st_mtime_ns),
        meta.get("format_name"), meta.get("format_long_name"),
        meta.get("duration_sec"), meta.get("bit_rate"), meta.get("nb_streams"),
        meta.get("sample_rate"), meta.get("channels"), meta.get("channel_layout"),
        meta.get("codec_name"), meta.get("bits_per_sample"), meta.get("is_lossless"),
        meta.get("scan_status"), meta.get("scan_error"),
    ]

    if existing:
        file_id = int(existing[0])
        con.execute(
            """
            UPDATE files SET
                rel_path = ?, root_id = ?, size_bytes = ?, mtime_ns = ?,
                format_name = ?, format_long_name = ?, duration_sec = ?, bit_rate = ?,
                nb_streams = ?, sample_rate = ?, channels = ?, channel_layout = ?,
                codec_name = ?, bits_per_sample = ?, is_lossless = ?,
                scan_status = ?, scan_error = ?, last_scanned_at = now()
            WHERE file_id = ?
            """,
            fields + [file_id],
        )
        return file_id

    row = con.execute(
        """
        INSERT INTO files (
            path, rel_path, root_id, size_bytes, mtime_ns,
            format_name, format_long_name, duration_sec, bit_rate, nb_streams,
            sample_rate, channels, channel_layout, codec_name, bits_per_sample,
            is_lossless, scan_status, scan_error
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING file_id
        """,
        [abs_path] + fields,
    ).fetchone()
    return int(row[0])


def upsert_tags(con, file_id: int, tags: list[tuple[str, str, str]]) -> None:
    con.execute("DELETE FROM tags WHERE file_id = ?", [file_id])
    if tags:
        con.executemany(
            "INSERT INTO tags (file_id, namespace, tag_key, tag_value) VALUES (?, ?, ?, ?)",
            [(file_id, ns, key, val) for ns, key, val in tags],
        )


def scan_root(con, root_path: Path, label: str | None = None) -> dict:
    root_path = root_path.resolve()
    if not root_path.is_dir():
        raise FileNotFoundError(root_path)

    root_id = ensure_root(con, root_path, label)
    counts = {"ok": 0, "unreadable": 0, "total": 0}

    for path in iter_audio_files(root_path):
        counts["total"] += 1
        probe = parse_probe(probe_file(path))
        file_id = upsert_file(con, root_id, root_path, path, probe)
        upsert_tags(con, file_id, read_tags(path))
        counts[probe["scan_status"]] = counts.get(probe["scan_status"], 0) + 1
        print(f"  [{probe['scan_status']}] {path.relative_to(root_path)}")

    return counts


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Scan audio folders into DuckDB manifest")
    parser.add_argument("roots", nargs="+", type=Path, help="Audio folder(s) to catalog")
    parser.add_argument("--db", type=Path, default=None, help="DuckDB path (default: audio_catalog/manifest.duckdb)")
    parser.add_argument("--label", type=str, default=None, help="Label for the first root")
    args = parser.parse_args(argv)

    db_path = init_db(args.db)
    con = connect(db_path)
    print(f"Database: {db_path}")
    print(f"Started: {datetime.now(timezone.utc).isoformat()}")

    for i, root in enumerate(args.roots):
        label = args.label if i == 0 else None
        print(f"\nScanning {root.resolve()} ...")
        counts = scan_root(con, root, label)
        print(f"Done: {counts['total']} files ({counts.get('ok', 0)} ok, {counts.get('unreadable', 0)} unreadable)")

    con.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
