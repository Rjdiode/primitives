"""Map stem ratios + tag scores to canonical content categories."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

PACKAGE_DIR = Path(__file__).resolve().parent
DEFAULT_TAXONOMY_PATH = PACKAGE_DIR / "content_taxonomy.yaml"


def load_taxonomy(path: Path | None = None) -> dict[str, Any]:
    taxonomy_path = path or DEFAULT_TAXONOMY_PATH
    with taxonomy_path.open() as f:
        return yaml.safe_load(f)


def _labels_for_category(category_cfg: dict[str, Any], tagger_name: str) -> list[str]:
    labels = list(category_cfg.get("tags", []))
    if "fsd" in tagger_name or "essentia" in tagger_name:
        labels.extend(category_cfg.get("fsd_tags", []))
    return labels


def _tag_scores_for_category(
    category_cfg: dict[str, Any],
    tag_scores: dict[str, float],
    tagger_name: str = "",
) -> float:
    threshold = category_cfg.get("tag_threshold", 0.25)
    best = 0.0
    for label in _labels_for_category(category_cfg, tagger_name):
        score = tag_scores.get(label, 0.0)
        if score > best:
            best = score
    if threshold <= 0:
        return 0.0
    return min(1.0, best / threshold)


def _stem_score_for_category(
    category_cfg: dict[str, Any],
    stem_ratios: dict[str, float | None],
) -> float:
    stem_name = category_cfg.get("stem")
    if not stem_name:
        return 0.0
    ratio = stem_ratios.get(stem_name)
    if ratio is None:
        return 0.0
    threshold = category_cfg.get("stem_threshold", 0.1)
    if threshold <= 0:
        return 0.0
    return min(1.0, ratio / threshold)


def evaluate_presence(
    taxonomy: dict[str, Any],
    stem_ratios: dict[str, float | None],
    tag_scores: dict[str, float],
    tagger_name: str = "",
) -> dict[str, dict[str, Any]]:
    categories = taxonomy["categories"]
    results: dict[str, dict[str, Any]] = {}

    for name, cfg in categories.items():
        stem_evidence = _stem_score_for_category(cfg, stem_ratios)
        tag_evidence = _tag_scores_for_category(cfg, tag_scores, tagger_name)
        confidence = max(stem_evidence, tag_evidence)

        if name == "orchestra":
            other = stem_ratios.get("other") or 0.0
            vocals = stem_ratios.get("vocals") or 0.0
            drums = stem_ratios.get("drums") or 0.0
            heuristic = (
                other >= cfg.get("other_stem_min", 0.35)
                and vocals <= cfg.get("vocals_stem_max", 0.15)
                and drums <= cfg.get("drums_stem_max", 0.15)
            )
            if heuristic:
                confidence = max(confidence, 0.6)

        results[name] = {
            "present": confidence >= 1.0,
            "confidence": confidence,
            "stem_evidence": stem_evidence,
            "tag_evidence": tag_evidence,
        }

    return results


def classify_voice_type(
    taxonomy: dict[str, Any],
    tag_scores: dict[str, float],
) -> tuple[str, float]:
    speech_tags = taxonomy.get("speech_tags", [])
    singing_tags = taxonomy.get("singing_tags", [])

    speech_score = max((tag_scores.get(t, 0.0) for t in speech_tags), default=0.0)
    singing_score = max((tag_scores.get(t, 0.0) for t in singing_tags), default=0.0)

    if speech_score < 0.15 and singing_score < 0.15:
        return "none", max(speech_score, singing_score)
    if speech_score >= 0.25 and singing_score >= 0.25:
        return "mixed", max(speech_score, singing_score)
    if speech_score > singing_score:
        return "speech", speech_score
    if singing_score > speech_score:
        return "singing", singing_score
    return "unknown", max(speech_score, singing_score)


def derive_profile(
    presence: dict[str, dict[str, Any]],
    voice_type: str,
) -> tuple[str, str]:
    parts: list[str] = []
    if presence["voice"]["present"]:
        parts.append("speech" if voice_type == "speech" else "voice")
    if presence["drums"]["present"]:
        parts.append("drums")
    if presence["bass"]["present"]:
        parts.append("bass")
    if presence["orchestra"]["present"]:
        parts.append("orchestra")

    if not parts:
        return "unknown", "unknown"
    if len(parts) == 1:
        return parts[0], parts[0]
    profile = "+".join(sorted(set(parts)))
    return "mixed", profile


def build_tag_score_rows(
    taxonomy: dict[str, Any],
    tag_scores: dict[str, float],
    top_n: int = 30,
) -> list[dict[str, Any]]:
    label_to_canonical: dict[str, str] = {}
    for canonical, cfg in taxonomy["categories"].items():
        for label in cfg.get("tags", []):
            label_to_canonical[label] = canonical

    ranked = sorted(tag_scores.items(), key=lambda kv: kv[1], reverse=True)[:top_n]
    rows = []
    for label, score in ranked:
        rows.append({
            "label": label,
            "score_max": score,
            "score_mean": score,
            "canonical": label_to_canonical.get(label),
        })
    return rows
