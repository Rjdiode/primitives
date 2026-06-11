# Audio Catalog — handoff

Batch-scan audio folders, detect content (voice / drums / bass / orchestra), and search via DuckDB.

**Repo:** https://github.com/Rjdiode/audio-catalog  
**Stack:** Python 3.10+, DuckDB, Demucs, PANNs (AudioSet tags). Optional Essentia FSD-SINet.

---

## What this does

1. **Tier 1 — `scan.py`** — Walk folders, read container metadata (sample rate, duration, codec) and embedded tags. No audio decode. Fast.
2. **Tier 2 — `analyze_content.py`** — Demucs stem energy ratios + audio tagger → canonical flags (`has_voice`, `has_drums`, `has_bass`, `has_orchestra`).
3. **Search** — SQL against `content_catalog` view in `manifest.duckdb`.

Nothing runs as a service. Scan once, analyze incrementally, query locally.

---

## First run on a new machine

```bash
git clone https://github.com/Rjdiode/audio-catalog.git
cd audio-catalog   # repo root; run all commands from here

python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Required for Tier 1
brew install ffmpeg   # macOS
# sudo apt install ffmpeg   # Linux

# Initialize DB schema
python -m audio_catalog.analyze_content --init
```

First analysis run downloads Demucs + PANNs weights (~300MB each).

### Index your library

```bash
python -m audio_catalog.scan /path/to/audio/root
python -m audio_catalog.scan /path/to/second/root   # multiple roots OK
```

### Analyze content

Start small — Demucs is the slow step (~0.3–1× realtime per file on GPU, slower on CPU).

```bash
# Recommended: tag entire library first (fast)
python -m audio_catalog.analyze_content --skip-stems --limit 100

# Full stems + tags on a subset
python -m audio_catalog.analyze_content --limit 10

# 6-stem model adds guitar/piano separation
python -m audio_catalog.analyze_content --stem-model htdemucs_6s --limit 10
```

Re-run only changed files automatically (mtime/size). Force full re-analysis: `--force`.

### Search

```bash
python -m audio_catalog.analyze_content --query "
  SELECT path, content_profile, has_voice, has_drums, has_bass, has_orchestra
  FROM content_catalog
  WHERE has_drums AND NOT has_voice
"

# Or interactive
duckdb manifest.duckdb
```

---

## Files

| File | Role |
|------|------|
| `schema.sql` | DuckDB tables + `content_catalog` view |
| `content_taxonomy.yaml` | Stem/tag thresholds; maps labels → voice/drums/bass/orchestra |
| `scan.py` | Tier 1 indexer (ffprobe + mutagen) |
| `analyze_content.py` | Tier 2 analyzer CLI |
| `db.py` | DuckDB connect, upsert, stale-file detection |
| `stems.py` | Demucs separation → energy ratios |
| `taggers.py` | PANNs (default) or Essentia FSD-SINet backends |
| `taxonomy.py` | Presence scoring, voice_type, content_profile |
| `manifest.duckdb` | Created at repo root on first run (gitignored) |
| `audio_catalog/models/` | Optional Essentia weights (gitignored) |

---

## Architecture

```text
scan.py ──► files, tags ──► manifest.duckdb
                                │
analyze_content.py ──► Demucs stems ──┐
                     PANNs tags ─────┼──► content_runs, content_tag_scores
                     taxonomy.py ─────┘
                                │
                         content_catalog (view)
```

**Presence logic:** Each category (voice, drums, bass, orchestra) gets a confidence from the max of stem-ratio evidence and tag evidence. `present` when confidence ≥ 1.0 (i.e. ratio or tag score exceeds threshold in `content_taxonomy.yaml`).

**Voice sub-types:** `speech` vs `singing` vs `mixed` from AudioSet tag scores, independent of Demucs `vocals` stem.

---

## Tagger backends

| `--tagger` | Labels | When to use |
|------------|--------|-------------|
| `auto` | PANNs → Essentia fallback | Default |
| `panns` | AudioSet (527 classes) | Best match for taxonomy (`Speech`, `Orchestra`, etc.) |
| `essentia` | FSD50K | `conda install -c conda-forge essentia-tensorflow` + `python -m audio_catalog.download_models` |
| `none` | — | Stem-only mode |

---

## Useful SQL

```sql
-- Full band
SELECT path, stem_vocals_ratio, stem_drums_ratio, stem_bass_ratio
FROM content_catalog
WHERE has_voice AND has_drums AND has_bass;

-- Orchestral, no vocals
SELECT path, has_orchestra_conf, stem_other_ratio
FROM content_catalog
WHERE has_orchestra AND NOT has_voice;

-- Speech / podcast
SELECT path, voice_type, stem_vocals_ratio
FROM content_catalog
WHERE voice_type = 'speech';

-- By sample rate + content
SELECT path, sample_rate, content_profile
FROM content_catalog
WHERE sample_rate = 48000 AND has_drums;

-- Top tag evidence for a file
SELECT c.label, c.score_max, c.canonical
FROM content_tag_scores c
JOIN content_runs r ON r.run_id = c.run_id
JOIN files f ON f.file_id = r.file_id
WHERE f.path LIKE '%myfile%'
ORDER BY c.score_max DESC
LIMIT 20;
```

---

## Tuning for your library

Edit `content_taxonomy.yaml`:

- **SFX / foley libraries** — lower `stem_threshold` values cause false positives; raise them or use `--skip-stems` + tags only.
- **Classical** — `orchestra` relies on AudioSet tags + `other` stem heuristic; calibrate on ~20 known files.
- **Podcasts / speech** — `voice_type = speech` works well with PANNs; Demucs `vocals` stem also catches speech.

After threshold changes, re-run: `python -m audio_catalog.analyze_content --force`.

---

## Performance notes

| Step | Relative cost | Parallelism |
|------|---------------|-------------|
| `scan.py` | Very low | Single process fine |
| `--skip-stems` | Low–medium | One process per machine; batch with `--limit` |
| Full Demucs | High | GPU helps; use `--segment 10` if OOM |

Suggested workflow on a large library:

1. `scan.py` on all roots
2. `--skip-stems` on everything
3. Full analysis only on subsets you care about, or overnight with no `--limit`

---

## Known limitations

- **Orchestra** is inferred (tags + high `other` stem), not a Demucs stem.
- **Speech vs singing** both appear in Demucs `vocals`; use `voice_type` column for distinction.
- **Essentia** install is painful via pip; conda recommended. PANNs is the practical default.
- **ffprobe required** for Tier 1; analysis works without it if you insert `files` rows manually (not supported by CLI).
- TorchAudio/librosa/audioflux are **not** used; this pipeline is Demucs + PANNs/Essentia by design.

---

## Next steps (if continuing development)

- [ ] CLI `search` subcommand with preset filters (`--has-drums`, `--no-voice`)
- [ ] Parquet export of `content_catalog` for external tools
- [ ] Segment table (`content_segments`) for time ranges of detected voice/drums
- [ ] Web UI or TUI over DuckDB
- [ ] Watch folder / incremental scan on mtime

---

## Origin

Extracted from conversation comparing audioflux, torchaudio, essentia, and librosa for batch Python audio analysis and searchable manifests. Chose Demucs + PANNs for content detection over low-level MIR scalars.
