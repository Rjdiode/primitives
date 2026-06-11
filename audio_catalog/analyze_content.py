#!/usr/bin/env python3
"""
Tier 2: content analysis — Demucs stem ratios + audio tagging.

Usage:
  python -m audio_catalog.scan /path/to/music
  python -m audio_catalog.analyze_content --limit 5
  python -m audio_catalog.analyze_content --query "has_drums AND NOT has_voice"
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from audio_catalog.db import (
    connect,
    files_needing_content_analysis,
    get_or_create_pipeline,
    init_db,
    insert_content_run,
)
from audio_catalog.stems import analyze_stems, create_separator
from audio_catalog.taggers import create_tagger
from audio_catalog.taxonomy import (
    build_tag_score_rows,
    classify_voice_type,
    derive_profile,
    evaluate_presence,
    load_taxonomy,
)


DEFAULT_PIPELINE = "demucs_htdemucs+panns_v1"


def analyze_file(
    path: Path,
    *,
    separator,
    tagger,
    taxonomy: dict,
    skip_stems: bool = False,
    skip_tags: bool = False,
) -> dict:
    stem_ratios: dict[str, float | None] = {
        "vocals": None, "drums": None, "bass": None, "other": None,
        "guitar": None, "piano": None,
    }
    tag_scores: dict[str, float] = {}

    if not skip_stems:
        stem_ratios = analyze_stems(path, separator)
    if not skip_tags:
        tag_scores = tagger.tag_file(path)

    presence = evaluate_presence(taxonomy, stem_ratios, tag_scores, tagger.name)
    voice_type, voice_conf = classify_voice_type(taxonomy, tag_scores)
    if presence["voice"]["present"] and voice_type == "none":
        voice_type = "unknown"
        voice_conf = presence["voice"]["confidence"]

    primary, profile = derive_profile(presence, voice_type)
    tag_rows = build_tag_score_rows(taxonomy, tag_scores)

    return {
        "stem_ratios": stem_ratios,
        "presence": presence,
        "voice_type": voice_type if presence["voice"]["present"] else "none",
        "voice_type_conf": voice_conf,
        "primary_content": primary,
        "content_profile": profile,
        "tag_scores": tag_rows,
    }


def run_analysis(
    *,
    db_path: Path,
    pipeline_name: str,
    stem_model: str,
    tag_backend: str,
    taxonomy_path: Path | None,
    root_id: int | None,
    limit: int | None,
    force: bool,
    skip_stems: bool,
    skip_tags: bool,
    segment: float | None,
) -> dict:
    taxonomy = load_taxonomy(taxonomy_path)
    con = connect(db_path)

    tagger, tag_model_name = create_tagger(tag_backend)
    config = {
        "stem_model": stem_model,
        "tag_backend": tag_backend,
        "segment": segment,
        "skip_stems": skip_stems,
        "skip_tags": skip_tags,
    }
    pipeline_id = get_or_create_pipeline(
        con,
        pipeline_name,
        stem_model=stem_model,
        tag_model=tag_model_name,
        taxonomy_version=taxonomy.get("version", "unknown"),
        config=config,
    )

    queue = files_needing_content_analysis(
        con, pipeline_id, root_id=root_id, limit=limit, force=force,
    )
    print(f"Pipeline: {pipeline_name} (id={pipeline_id})")
    print(f"Tagger: {tag_model_name} | Stem model: {stem_model}")
    print(f"Files to analyze: {len(queue)}")

    separator = None
    if not skip_stems:
        separator = create_separator(model=stem_model, segment=segment)

    stats = {"ok": 0, "failed": 0}
    for item in queue:
        path = Path(item["path"])
        t0 = time.perf_counter()
        print(f"\n→ {path.name}")
        try:
            result = analyze_file(
                path,
                separator=separator,
                tagger=tagger,
                taxonomy=taxonomy,
                skip_stems=skip_stems,
                skip_tags=skip_tags,
            )
            elapsed_ms = int((time.perf_counter() - t0) * 1000)
            insert_content_run(
                con,
                file_id=item["file_id"],
                pipeline_id=pipeline_id,
                source_mtime_ns=item["mtime_ns"],
                source_size_bytes=item["size_bytes"],
                status="ok",
                error_message=None,
                wall_time_ms=elapsed_ms,
                stem_ratios=result["stem_ratios"],
                presence=result["presence"],
                voice_type=result["voice_type"],
                voice_type_conf=result["voice_type_conf"],
                primary_content=result["primary_content"],
                content_profile=result["content_profile"],
                tag_scores=result["tag_scores"],
            )
            stats["ok"] += 1
            p = result["presence"]
            print(
                f"  profile={result['content_profile']} "
                f"voice={p['voice']['present']}({p['voice']['confidence']:.2f}) "
                f"drums={p['drums']['present']} bass={p['bass']['present']} "
                f"orch={p['orchestra']['present']} "
                f"type={result['voice_type']} [{elapsed_ms}ms]"
            )
        except Exception as exc:
            elapsed_ms = int((time.perf_counter() - t0) * 1000)
            insert_content_run(
                con,
                file_id=item["file_id"],
                pipeline_id=pipeline_id,
                source_mtime_ns=item["mtime_ns"],
                source_size_bytes=item["size_bytes"],
                status="failed",
                error_message=str(exc),
                wall_time_ms=elapsed_ms,
                stem_ratios={},
                presence={
                    "voice": {"present": False, "confidence": 0},
                    "drums": {"present": False, "confidence": 0},
                    "bass": {"present": False, "confidence": 0},
                    "orchestra": {"present": False, "confidence": 0},
                },
                voice_type=None,
                voice_type_conf=None,
                primary_content="error",
                content_profile="error",
                tag_scores=[],
            )
            stats["failed"] += 1
            print(f"  FAILED: {exc}")

    con.close()
    return stats


def run_query(db_path: Path, sql: str) -> None:
    con = connect(db_path)
    rows = con.execute(sql).fetchall()
    cols = [d[0] for d in con.description]
    for row in rows:
        print(dict(zip(cols, row)))
    print(f"\n{len(rows)} row(s)")
    con.close()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Analyze audio content (stems + tags)")
    parser.add_argument("--db", type=Path, default=None)
    parser.add_argument("--pipeline", default=DEFAULT_PIPELINE)
    parser.add_argument("--stem-model", default="htdemucs",
                        help="Demucs model: htdemucs | htdemucs_6s | htdemucs_ft")
    parser.add_argument("--tagger", default="auto",
                        choices=["auto", "essentia", "panns", "none"])
    parser.add_argument("--taxonomy", type=Path, default=None)
    parser.add_argument("--root-id", type=int, default=None)
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--force", action="store_true", help="Re-analyze all files")
    parser.add_argument("--skip-stems", action="store_true", help="Tags only (fast)")
    parser.add_argument("--skip-tags", action="store_true", help="Stems only")
    parser.add_argument("--segment", type=float, default=10.0,
                        help="Demucs chunk seconds (lower = less RAM)")
    parser.add_argument("--query", type=str, default=None,
                        help="SQL against content_catalog view")
    parser.add_argument("--init", action="store_true", help="Initialize DB schema only")
    args = parser.parse_args(argv)

    db_path = init_db(args.db)
    if args.init:
        print(f"Initialized {db_path}")
        return 0

    if args.query:
        run_query(db_path, args.query)
        return 0

    print(f"Database: {db_path}")
    print(f"Started: {datetime.now(timezone.utc).isoformat()}")

    stats = run_analysis(
        db_path=db_path,
        pipeline_name=args.pipeline,
        stem_model=args.stem_model,
        tag_backend=args.tagger,
        taxonomy_path=args.taxonomy,
        root_id=args.root_id,
        limit=args.limit,
        force=args.force,
        skip_stems=args.skip_stems,
        skip_tags=args.skip_tags,
        segment=args.segment,
    )
    print(f"\nFinished: {stats['ok']} ok, {stats['failed']} failed")
    print("\nExample queries:")
    print(f'  python -m audio_catalog.analyze_content --query "SELECT path, content_profile FROM content_catalog WHERE has_drums"')
    return 0 if stats["failed"] == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
