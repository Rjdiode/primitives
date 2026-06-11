"""Audio tagging backends for content detection."""

from __future__ import annotations

import json
import os
import urllib.request
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Any

import numpy as np

PACKAGE_DIR = Path(__file__).resolve().parent
MODELS_DIR = PACKAGE_DIR / "models"

ESSENTIA_FSD_MODEL = "fsd-sinet-vgg41-tlpf-1"
ESSENTIA_FSD_PB = MODELS_DIR / f"{ESSENTIA_FSD_MODEL}.pb"
ESSENTIA_FSD_JSON = MODELS_DIR / f"{ESSENTIA_FSD_MODEL}.json"
ESSENTIA_FSD_BASE = (
    "https://essentia.upf.edu/models/feature-extractors/fsd-sinet"
)


class TaggerBackend(ABC):
    name: str

    @abstractmethod
    def tag_file(self, path: Path) -> dict[str, float]:
        """Return label -> max activation score in [0, 1]."""


class EssentiaFSDSINetTagger(TaggerBackend):
    name = "essentia-fsd-sinet"

    def __init__(self, graph_path: Path | None = None, metadata_path: Path | None = None):
        import essentia.standard as es

        self._es = es
        pb = graph_path or ESSENTIA_FSD_PB
        meta = metadata_path or ESSENTIA_FSD_JSON
        if not pb.exists() or not meta.exists():
            raise FileNotFoundError(
                f"Essentia model files missing. Run: python -m audio_catalog.download_models"
            )
        with meta.open() as f:
            metadata = json.load(f)
        self.labels: list[str] = metadata["classes"]
        self._model = es.TensorflowPredictFSDSINet(graphFilename=str(pb))
        self._loader_cls = es.MonoLoader

    def tag_file(self, path: Path) -> dict[str, float]:
        audio = self._loader_cls(filename=str(path), sampleRate=22050)()
        activations = np.asarray(self._model(audio))
        if activations.ndim == 1:
            activations = activations.reshape(1, -1)
        max_scores = activations.max(axis=0)
        return {label: float(max_scores[i]) for i, label in enumerate(self.labels)}


class PANNsTagger(TaggerBackend):
    """Fallback tagger using AudioSet-trained PANNs (pip install panns-inference)."""

    name = "panns-audioset"

    def __init__(self, device: str | None = None):
        from panns_inference import AudioTagging, labels

        self._labels = labels
        self._model = AudioTagging(
            model_type="Cnn14",
            device=device or "cpu",
            checkpoint_path=None,
        )

    def tag_file(self, path: Path) -> dict[str, float]:
        import librosa

        audio, _ = librosa.load(path, sr=32000, mono=True)
        clip = audio.astype(np.float32)
        output = self._model.inference(clip[None, :])
        scores = output["clipwise_output"][0]
        return {label: float(scores[i]) for i, label in enumerate(self._labels)}


class TagOnlyTagger(TaggerBackend):
    """No-op tagger when models are unavailable (stem-only mode)."""

    name = "none"

    def tag_file(self, path: Path) -> dict[str, float]:
        return {}


def download_essentia_fsd_model() -> tuple[Path, Path]:
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    for suffix in (".pb", ".json"):
        url = f"{ESSENTIA_FSD_BASE}/{ESSENTIA_FSD_MODEL}{suffix}"
        dest = MODELS_DIR / f"{ESSENTIA_FSD_MODEL}{suffix}"
        if dest.exists():
            continue
        print(f"Downloading {url} ...")
        urllib.request.urlretrieve(url, dest)
    return ESSENTIA_FSD_PB, ESSENTIA_FSD_JSON


def create_tagger(prefer: str = "auto") -> tuple[TaggerBackend, str]:
    """
    Pick a tagging backend.
    prefer: auto | essentia | panns | none

    auto prefers PANNs (AudioSet labels) then Essentia FSD-SINet (FSD50K labels).
    """
    if prefer == "none":
        return TagOnlyTagger(), TagOnlyTagger.name

    if prefer in ("auto", "panns"):
        try:
            return PANNsTagger(), PANNsTagger.name
        except Exception as exc:
            if prefer == "panns":
                raise RuntimeError(f"PANNs tagger unavailable: {exc}") from exc

    if prefer in ("auto", "essentia"):
        try:
            import essentia  # noqa: F401
            if not ESSENTIA_FSD_PB.exists():
                download_essentia_fsd_model()
            return EssentiaFSDSINetTagger(), EssentiaFSDSINetTagger.name
        except Exception as exc:
            if prefer == "essentia":
                raise RuntimeError(f"Essentia tagger unavailable: {exc}") from exc

    print("Warning: no tagger backend available; using stem-only analysis.")
    return TagOnlyTagger(), TagOnlyTagger.name
