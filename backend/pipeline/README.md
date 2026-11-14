# Analysis pipeline

Copied from the research repo (`AISmithLab/HyperStimulation`, `code/pipeline/`, commit `87acb4a`), which produced the dataset in `../data/`. Only the scripts needed for live analysis and the collector (plan 013) are here. Keep them identical to the research versions, so a live video's features are measured exactly like the dataset's; list every change below.

| File | What it does | Changes from the research version |
|---|---|---|
| `58_download_clips_v2.py` | Downloads one clip per manifest row with yt-dlp: from 0:30, 5 minutes, ≤ 360p (format 18), source frame rate. | `--clips-dir` is required (its default was a server path). yt-dlp runs with `--verbose` (was `--quiet --no-warnings`), and each failed try's full output goes to `<clips-dir>/<video_id>.<client>.log`; the logged message is the last `ERROR:` line (plan 013: the old 180-character tail couldn't explain failures). Neither changes the downloaded clip. |
| `04_extract_features_v2.py` | Computes the 12 features from a clip. `CACHE_VERSION 11`. | None. |
| `63_classify_categories.py` | v2's category classifier: title, then tags, then description, matched against one keyword set (commit `615cfad`). The collector imports its `classify()`; a video no keyword places gets no category. | None. |
| `config.yaml` | Output and clip folders, read by `04_extract_features_v2.py`. | Only those two keys; the research config also holds collection settings. |

Python dependencies are in `../pyproject.toml` at the research pipeline's exact pins; ffmpeg/ffprobe 6.1.1 and deno are system tools (see `../README.md`). Both scripts read a manifest TSV with at least a `video_id` column.

## Usage

Run from `backend/` with `uv run python pipeline/<script>`.

```sh
# 1. Download clips
uv run python pipeline/58_download_clips_v2.py --manifest M.tsv --clips-dir CLIPS [--cookies cookies.txt]

# 2. Extract: the expensive decode, once per clip; writes a per-clip .npz cache
uv run python pipeline/04_extract_features_v2.py extract --manifest M.tsv --clips-dir CLIPS --cache-dir CACHE

# 3. Derive: the cheap threshold step, re-runnable; cache -> features TSV
uv run python pipeline/04_extract_features_v2.py derive --manifest M.tsv --cache-dir CACHE --out F.tsv
```

Keep `derive`'s default thresholds: they are the ones the dataset was derived with. The 12 feature columns of `F.tsv` are what `src/hyperstim_api/scoring.py` scores against the dataset.
