"""Demucs stem separation and energy ratios."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np


def create_separator(
    model: str = "htdemucs",
    segment: float | None = 10.0,
    device: str | None = None,
) -> Any:
    import demucs.api
    import torch

    dev = device or ("cuda" if torch.cuda.is_available() else "cpu")
    kwargs: dict[str, Any] = {"model": model}
    if segment is not None:
        kwargs["segment"] = segment
    return demucs.api.Separator(**kwargs)


def stem_energy_ratios(separated: dict[str, Any]) -> dict[str, float]:
    """Energy share per stem; values sum to ~1."""
    energies: dict[str, float] = {}
    for name, wav in separated.items():
        arr = _to_numpy(wav)
        energies[name] = float(np.mean(arr ** 2))

    total = sum(energies.values())
    if total <= 0:
        return {name: 0.0 for name in energies}
    return {name: e / total for name, e in energies.items()}


def analyze_stems(path: Path, separator: Any) -> dict[str, float | None]:
    _, separated = separator.separate_audio_file(str(path))
    ratios = stem_energy_ratios(separated)
    return {
        "vocals": ratios.get("vocals"),
        "drums": ratios.get("drums"),
        "bass": ratios.get("bass"),
        "other": ratios.get("other"),
        "guitar": ratios.get("guitar"),
        "piano": ratios.get("piano"),
    }


def _to_numpy(wav: Any) -> np.ndarray:
    if hasattr(wav, "detach"):
        wav = wav.detach().cpu().numpy()
    arr = np.asarray(wav, dtype=np.float64)
    if arr.ndim == 2:
        arr = arr.mean(axis=0)
    return arr
