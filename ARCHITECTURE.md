# Architecture

How the pieces fit together: dev, CI, prod, and the services outside. The details live in the plans (`plans/001-architecture.md` and the plan named on each diagram) and the READMEs; these diagrams are the map. Start with [`DEVELOPMENT.md`](DEVELOPMENT.md) to set up.

The diagrams are [Mermaid](https://mermaid.js.org/): GitHub renders them; in VS Code, install the "Markdown Preview Mermaid Support" extension (`bierner.markdown-mermaid`) and open the Markdown preview.

**Legend:** cylinders hold data, rounded boxes are outside services (GitHub's parts are grouped in a box of their own), dotted lines happen only sometimes (on a visitor's click, once a day, on a release).

## 1. The big picture

```mermaid
flowchart TB
    dev["Developer<br>clone + ./dev.sh"]
    visitor["Visitor's browser"]

    subgraph github["GitHub"]
        repo[("Repo<br>main + tags vX.Y.Z")]
        actions["Actions<br>CI · Deploy · Release page"]
        pages["Pages<br>the static site"]
    end

    subgraph server["Our server (prod)"]
        api["API<br>behind nginx"]
        collector["Collector"]
        bot["Data bot"]
    end

    subgraph outside["Outside services"]
        sonar("SonarQube Cloud")
        youtube("YouTube")
        ga("Google Analytics")
    end

    dev -- "git push" --> repo --> actions
    actions -- "coverage" --> sonar
    actions -- "on a release tag" --> pages
    dev -. "hyperstim-release" .-> api

    visitor -- "pages" --> pages
    visitor -- "data" --> api
    visitor -. "player, on click" .-> youtube
    visitor -. "only with consent" .-> ga

    api -- "live checks, thumbnails" --> youtube
    collector -- "new videos" --> youtube
    collector -- "files" --> api
    bot -. "daily" .-> repo
```

- The **site** is static files on GitHub Pages; everything dynamic goes through our **API**.
- The **collector** grows the dataset on the server; the **data bot** copies it to the repo once a day, so every clone gets it with `git pull` (plan 013).
- Nothing reaches prod without a **release** (section 4).

## 2. The dev environment

```mermaid
flowchart TB
    subgraph clone["Your clone"]
        devsh["./dev.sh"]

        subgraph be["backend/ · uv · Python"]
            uvicorn["API on :8000<br>uvicorn --reload"]
            ref[("data/videos.tsv<br>reference set")]
            col[("data/collected/<br>daily copy from the bot")]
            envb[".env<br>(from .env.example)"]
        end

        subgraph fe["frontend/ · npm · Next.js"]
            next["Site on :3000<br>next dev"]
            mock["Mock data<br>(./dev.sh --mock)"]
        end

        hook[".githooks/commit-msg<br>Conventional Commits"]
    end

    browser["Your browser"]
    yt("YouTube<br>live checks, thumbnails")

    devsh --> uvicorn
    devsh --> next
    devsh -. "--mock: no backend" .-> mock
    devsh --> hook
    ref --> uvicorn
    col --> uvicorn
    envb --> uvicorn
    browser --> next
    next -- "api.ts" --> uvicorn
    uvicorn -. "needs YOUTUBE_API_KEY" .-> yt
```

- One command starts both apps: `./dev.sh` (`--install-tools` once for Node, uv, ffmpeg, deno and the test browsers; versions in `tools.env`).
- The frontend talks to the backend only through `frontend/src/lib/api.ts`.
- No collector runs locally: dev reads the committed `data/collected/` (plan 013).

## 3. Tests and CI

What runs where. Locally you run the same commands (each README lists them); CI runs them on every push to `main` and on pull requests.

```mermaid
flowchart LR
    push(["push to main<br>or pull request"])

    subgraph ci["GitHub Actions · ci.yml"]
        fejob["frontend<br>ESLint · tsc<br>Vitest + Testing Library + axe"]
        bejob["backend<br>Ruff · mypy · pytest<br>data: commit check"]
        e2e["e2e<br>Playwright + axe<br>Chromium & WebKit<br>desktop & phone"]
        sonarjob["sonar<br>waits for the quality gate"]
    end

    sonar("SonarQube Cloud")

    push --> fejob & bejob
    fejob & bejob --> e2e
    fejob -- "coverage" --> sonarjob
    bejob -- "coverage" --> sonarjob
    sonarjob <--> sonar
```

```mermaid
flowchart TB
    subgraph levels["Test levels (plan 012)"]
        unit["Unit<br>logic<br>Vitest · pytest"]
        comp["Component<br>one component, api.ts mocked<br>Vitest + Testing Library + axe"]
        e2espec["End-to-end<br>built site + real backend<br>Playwright (frontend/e2e/)"]
    end
    unit --> comp --> e2espec
```

- Tests find elements by role and name, and every component and page gets an axe accessibility check.
- `release.sh` releases a commit only when all four jobs passed, including the end-to-end tests and the quality gate.

## 4. A release

`hyperstim-release`, run by a team member on the server (plan 010). Claude never starts one.

```mermaid
sequenceDiagram
    actor you as Team member (on the server)
    participant rel as release.sh
    participant gh as GitHub
    participant srv as API + collector
    participant pages as GitHub Pages

    you->>rel: hyperstim-release
    rel->>gh: fetch main and tags
    rel->>rel: next version + notes<br>from commit messages
    rel->>gh: did CI pass on this commit?
    rel->>srv: check out releases/vX.Y.Z, uv sync, pytest
    rel->>srv: point releases/current at it, restart the API
    rel->>srv: /api/health
    alt not healthy
        rel->>srv: back to the previous release, stop
    end
    rel->>srv: restart the collector
    rel->>gh: push tag vX.Y.Z
    gh->>pages: Deploy: build the site, publish
    gh->>gh: Release page: notes from the tag
    rel->>pages: wait until live, print the URL
```

```mermaid
flowchart LR
    feat["feat!: …<br>BREAKING CHANGE"] --> major["v2.0.0"]
    f["feat: …"] --> minor["v1.1.0"]
    fix["fix · perf · docs · test · …"] --> patch["v1.0.1"]
    data["data: (the bot)"] --> none["no bump, not listed"]
```

The highest type since the last release wins; the notes list every commit by section.

## 5. The prod server

What runs on our server (plan 010; layout in `deploy/README.md`). `deploy/setup.sh` sets it all up from `deploy/server.env`.

```mermaid
flowchart TB
    internet["Visitors' browsers"]

    subgraph server["Our server"]
        nginx["nginx<br>/v2/api → 127.0.0.1"]

        subgraph svc["service user · sandboxed"]
            api["API<br>releases/current"]
            collector["Collector<br>1 core, low priority"]
        end

        subgraph apifiles["data/ · the API's"]
            analysis[("analysis/<br>live checks")]
            thumbs[("thumbnails/")]
            usage[("usage/<br>daily counts")]
        end

        subgraph colfiles["data/collector/ · the collector's"]
            cdb[("collector.db")]
            collected[("collected/<br>exported TSVs")]
        end

        clips[("clips volume<br>clips, caches, db backups")]

        subgraph botuser["data bot user · SSH deploy key"]
            timer["Timer, 23:59:59 UTC"] --> commit["commit-data.sh<br>+ growth chart"] --> datarepo[("data-repo/")]
        end
    end

    gh("GitHub main")
    yt("YouTube")

    internet --> nginx --> api
    api --> apifiles
    api -- "reads every 5 min" --> collected
    collector --> colfiles
    collector --> clips
    collector -. "waits while a live check runs" .-> analysis
    api & collector --> yt
    collected -- "read" --> commit
    datarepo -- "push" --> gh
```

- The API and the collector run as one service user that can write only to `data/` (and the clips volume, for the collector).
- Only the data bot holds a key that can push, and only admins can create release tags, so the key can't start a deployment.
- The release group can read `analysis/`, `usage/` and `collector/` (plan 014); nobody else can.

## 6. How the dataset grows

Plan 013. One collector, on prod; everyone else gets its output from the repo.

```mermaid
flowchart LR
    yt("YouTube")
    collector["Collector<br>(prod)"]
    files[("collected/<br>TSV files")]
    api["Prod API"]
    site["Live site"]
    bot["Data bot<br>daily"]
    main[("GitHub main<br>backend/data/collected/")]
    clone["Your clone<br>git pull"]
    devapi["Dev API"]

    yt -- "~150 videos a day" --> collector --> files
    files -- "within 5 min" --> api --> site
    files --> bot -- "data: commit" --> main --> clone --> devapi
```

- New videos are on the live site within minutes, with no release.
- Dev is up to a day behind prod.

## 7. A visitor's request

```mermaid
sequenceDiagram
    actor v as Visitor
    participant pages as GitHub Pages
    participant api as Our API
    participant yt as YouTube
    participant ga as Google Analytics

    v->>pages: open a page
    pages-->>v: static HTML, JS, fonts
    v->>api: data (videos, channels, rankings)
    api-->>v: JSON
    v->>api: thumbnail
    api->>yt: fetch once, then cached
    api-->>v: image
    opt checks a video not in the dataset
        v->>api: start a live check
        api->>yt: look up, download, measure
        api-->>v: score (polled)
    end
    opt clicks play
        v->>yt: youtube-nocookie.com player
    end
    opt accepts analytics cookies
        v->>ga: page views
    end
```

What visitors' data goes where is in the privacy policy (`/privacy`, plan 009).
