# Audio Catalog

Scan folders of audio files, analyze content (voice / drums / bass / orchestra), and search via DuckDB.

## Prerequisites

- **Python 3.10+**
- **ffmpeg** (`ffprobe` on PATH) for Tier 1 metadata scanning

```bash
# macOS
brew install ffmpeg
```

## Install

```bash
cd /path/to/primitives
python3 -m venv .venv-audio
source .venv-audio/bin/activate
pip install -r audio_catalog/requirements.txt
```

First Demucs/PANNs run downloads model weights automatically (~300MB each).

Optional Essentia FSD-SINet (alternative tagger):

```bash
# conda recommended
conda install -c conda-forge essentia-tensorflow
python -m audio_catalog.download_models
```

## Quick start

```bash
# 1. Index a folder (sample rate, duration, codec, embedded tags)
python -m audio_catalog.scan ~/Music/my-library

# 2. Analyze content — start small
python -m audio_catalog.analyze_content --limit 3

# 3. Search
python -m audio_catalog.analyze_content --query "
  SELECT path, content_profile, has_voice, has_drums, has_bass, has_orchestra
  FROM content_catalog
  WHERE has_drums AND NOT has_voice
"
```

## Analysis modes

| Command | Speed | What you get |
|---------|-------|----------------|
| `--skip-stems` | Fast | Tag-based only (speech, orchestra, etc.) |
| `--skip-tags` | Medium | Demucs stem ratios only |
| (default) | Slow | Both stems + tags (best accuracy) |

```bash
# Tags only on whole library first
python -m audio_catalog.analyze_content --skip-stems

# Full analysis with 6-stem model (adds guitar/piano)
python -m audio_catalog.analyze_content --stem-model htdemucs_6s --limit 10

# Force re-analysis after file changes
python -m audio_catalog.analyze_content --force
```

## Tagger backends

| `--tagger` | Labels | Install |
|------------|--------|---------|
| `auto` (default) | AudioSet via PANNs | `pip install panns-inference` |
| `panns` | AudioSet | same |
| `essentia` | FSD50K | conda `essentia-tensorflow` |
| `none` | — | stem-only |

## Database

Default path: `manifest.duckdb` (repo root)

Main view: `content_catalog`

```sql
-- Voice + drums + bass (full band)
SELECT path, content_profile, stem_vocals_ratio, stem_drums_ratio
FROM content_catalog
WHERE has_voice AND has_drums AND has_bass;

-- Orchestral, no vocals
SELECT path, has_orchestra_conf, stem_other_ratio
FROM content_catalog
WHERE has_orchestra AND NOT has_voice;

-- Speech / podcast-ish
SELECT path, voice_type FROM content_catalog
WHERE voice_type = 'speech' AND NOT has_drums;
```

Open interactively:

```bash
duckdb manifest.duckdb
```

## Tuning

Edit `content_taxonomy.yaml` to adjust stem/tag thresholds for your library (SFX vs music vs classical).

## Project layout

```
audio_catalog/
  schema.sql              # DuckDB tables + content_catalog view
  content_taxonomy.yaml   # voice/drums/bass/orchestra mapping
  scan.py                 # Tier 1: ffprobe + mutagen → files/tags
  analyze_content.py      # Tier 2: Demucs + tagger → content_runs
  db.py                   # DuckDB helpers
  stems.py                # Demucs stem energy ratios
  taggers.py              # PANNs / Essentia backends
  taxonomy.py             # Presence scoring logic
manifest.duckdb           # created at repo root on first run (gitignored)
audio_catalog/models/     # optional Essentia weights (gitignored)
```
