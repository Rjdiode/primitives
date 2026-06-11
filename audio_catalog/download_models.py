#!/usr/bin/env python3
"""Download optional model weights for content analysis."""

from audio_catalog.taggers import download_essentia_fsd_model


def main() -> None:
    pb, meta = download_essentia_fsd_model()
    print(f"Essentia FSD-SINet model ready:\n  {pb}\n  {meta}")
    print("\nPANNs weights download automatically on first panns-inference use.")
    print("Demucs weights download automatically on first separation run.")


if __name__ == "__main__":
    main()
