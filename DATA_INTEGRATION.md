# Data Integration Guide

How to plug the real research dataset into this site. Everything here is
run **locally, once (or on a schedule), offline from the browser** — the
live site never talks to GitHub, YouTube, or Google Drive directly. That's
what keeps a private repo private and keeps API keys off the client.

```
[private GitHub repo]  --clone-->  local machine
[Google Drive folder]  --optional-->     |
[YouTube Data API]     --optional-->     |
                                          v
                          scripts/build_dataset.py
                                          |
                                          v
                          assets/js/data.js  (checked into the site, deployed as-is)
```

---

## 1. Clone the private GitHub repo

The repo is private, so plain `https://` cloning with just a username/password
won't work — GitHub dropped that. Use one of these two:

### Option A: SSH key (recommended if this is your own long-term machine)

```bash
# generate a key if you don't already have one
ssh-keygen -t ed25519 -C "you@example.com"

# print the public key and add it at https://github.com/settings/keys
cat ~/.ssh/id_ed25519.pub
```

Then clone:

```bash
git clone --depth 1 --single-branch --branch hyperstim/mar13-init \
  git@github.com:AISmithLab/HyperStimulation.git
```

### Option B: Personal Access Token (quick, works anywhere)

1. GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate new token.
2. Scope it to just the `AISmithLab/HyperStimulation` repo, read-only contents access.
3. Clone using the token as the password:

```bash
git clone --depth 1 --single-branch --branch hyperstim/mar13-init \
  https://<your-username>:<your-token>@github.com/AISmithLab/HyperStimulation.git
```

`--depth 1 --single-branch` keeps the clone small — you don't need full history or every branch for this.

**No git access at all / just want the files?** Ask whoever administers the repo for a zip export (GitHub → Code → Download ZIP works too, if you already have collaborator access in the browser) and skip straight to step 3 below, pointing `--repo` at the unzipped folder.

---

## 2. Verify what's actually in the repo (don't assume)

Branches drift. Before trusting any file list (including the one in the build guide), check for yourself:

```bash
cd HyperStimulation
find data -maxdepth 2 -type f
for f in data/*.tsv; do echo "=== $f ==="; head -1 "$f" | tr '\t' '\n' | nl; done
```

---

## 3. Run the build script

```bash
cd /path/to/HyperStimProject/website
python3 scripts/build_dataset.py --repo /path/to/HyperStimulation
```

This reads the TSVs, joins them on `video_id`, computes percentiles, and
**overwrites `assets/js/data.js`** with the real dataset in the exact shape
the site expects. Re-run it any time the repo updates — nothing else in
the site needs to change.

---

## 4. Optional: YouTube Data API enrichment

The site's video *embeds* and *thumbnails* never needed an API key — those
are public URLs. But if you want the site to double-check that each
`video_id` still resolves, and pull the current official title/channel
name instead of trusting the manifest text, you can enrich with the
YouTube Data API v3.

1. Go to the [Google Cloud Console](https://console.cloud.google.com/), create (or pick) a project.
2. Enable **YouTube Data API v3** for that project.
3. Create credentials → **API key**. Restrict it to the YouTube Data API v3 to be safe.
4. Run the build script with it:

```bash
python3 scripts/build_dataset.py --repo /path/to/HyperStimulation \
  --youtube-api-key YOUR_API_KEY
```

This is read-only (`videos.list`), needs no OAuth flow, and the free quota
(10,000 units/day, ~1 unit per video in a batched call) comfortably covers
even the full 5,298-video corpus in a handful of calls. The script batches
up to 50 video IDs per request.

**Never put this key in `assets/js/*.js` or any file the browser loads** —
it's only ever passed as a command-line flag on your machine.

---

## 5. Optional: pulling supplementary files from Google Drive

If the research team also drops files in a shared Google Drive folder
(this matches the `research/google_drive/` folder in the original project
scaffold) rather than committing everything to GitHub, you can have the
build script pull those in too:

1. In Google Cloud Console (same project as above, or a new one), enable the **Google Drive API**.
2. Create a **Service Account** → Keys → Add key → JSON. Download it.
3. Share the Google Drive folder with the service account's email address (looks like `something@project-id.iam.gserviceaccount.com`), Viewer access.
4. Install the client libraries and point the script at both:

```bash
pip install --break-system-packages google-api-python-client google-auth

export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account-key.json

python3 scripts/build_dataset.py --repo /path/to/HyperStimulation \
  --gdrive-folder-id YOUR_DRIVE_FOLDER_ID \
  --youtube-api-key YOUR_API_KEY
```

The folder ID is the long string in the Drive folder's URL:
`https://drive.google.com/drive/folders/`**`THIS_PART`**.

The script downloads any `.tsv`/`.csv` files it finds in that folder into
the repo's `data/` directory before joining, so they participate in the
same percentile computation as everything else.

---

## 6. Automating this (optional, recommended once it's working manually)

Once the manual run works, the natural next step is a **GitHub Actions
workflow inside the private research repo** that runs this same script on
a schedule (or on push to the data branch) and pushes the regenerated
`assets/js/data.js` to the public site repo automatically. That keeps
your GitHub token / API key / service-account key living only in GitHub's
encrypted Actions secrets — never in a browser, never in a client-side
file. Happy to set that workflow up once you've confirmed the manual
build works end-to-end.
