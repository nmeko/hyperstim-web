# Development

How to work on HyperStim: what's where, running it locally, and releasing. What the site is: [`README.md`](README.md).

How dev, CI, prod and the outside services fit together, in diagrams: [`ARCHITECTURE.md`](ARCHITECTURE.md).

- [`frontend/`](frontend/README.md): Next.js static site (GitHub Pages)
- [`backend/`](backend/README.md): Python API (FastAPI) with the video dataset and analysis pipeline
- [`deploy/`](deploy/README.md): prod setup on the server and GitHub Pages
- [`plans/`](plans/): numbered design and implementation plans

Bugs, data that looks wrong, and ideas: open an issue with one of the [issue forms](../../issues/new/choose) ([plan 016](plans/016-community.md)).

## Run locally

Install the tools once (nvm + Node, uv, and for live analysis ffmpeg and deno, at the versions in `tools.env`; uses `apt` or Homebrew; plus Chromium and WebKit for the end-to-end tests, with the system libraries they need, and the Safari check's own WebKit), then start both apps:

```sh
./dev.sh --install-tools   # once, and after tools.env changes
./dev.sh          # backend on :8000 and frontend on :3000, using the real backend
./dev.sh --mock   # frontend only, with mock data
```

It installs missing dependencies, prefixes each line of output with `[backend]` or `[frontend]`, and stops both apps on Ctrl+C or when either one exits. Change the ports with `BACKEND_PORT` / `FRONTEND_PORT`. The settings that must match the ports or suit local development (`NEXT_PUBLIC_API_BASE`, `NEXT_PUBLIC_API_MOCK`, `CORS_ORIGIN`, `DATASET_PATH`, `ANALYSIS_DIR`, `THUMBNAIL_DIR`, and `ANALYSIS_LIMIT_PER_IP=0`, `ANALYSIS_LIMIT_PER_DAY=0`: no limits on live analyses) are set by the script for that run and override `backend/.env` and `frontend/.env.local`; everything else in those files still applies. To run one app on its own, see its README.

`./dev.sh` also turns on the `commit-msg` hook that checks commit messages; without it, run `git config core.hooksPath .githooks` once.

## Contributing

Work to pick up is in the [issues labelled `task`](../../issues?q=is%3Aopen+label%3Atask) (new here? try [`good first issue`](../../issues?q=is%3Aopen+label%3A%22good+first+issue%22)). Each has a **Goal** and a **Done when** checklist.

1. Comment on the issue to take it; a maintainer assigns it to you. Ask there if anything is unclear, and agree on bigger choices before building.
2. Branch from the latest `main`: `issue-<number>-short-title`, e.g. `issue-1-category-classification`.
3. Follow the project rules in [`AGENTS.md`](AGENTS.md) (they apply to people too) and the visual style in [`frontend/design/STYLE.md`](frontend/design/STYLE.md) for UI work. Add tests with every change (plan 012).
4. Open a pull request; the template asks for the linked issue, the problem and solution, and a checklist. CI must pass.
5. A maintainer reviews it and merges it with "Rebase and merge", so history stays linear and each of your commits lands on `main` as written. Before merging, rebase onto the latest `main` if asked.

Maintainers open new tasks as blank issues ("Blank issue", shown to maintainers only) labelled `task`, with two sections: `## Goal` and `## Done when` ([plan 016](plans/016-community.md)).

## Commit messages

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/): the release script builds the next version number and the release notes from them ([plan 010](plans/010-deployment.md)). The `commit-msg` hook (turned on by `./dev.sh`, or `git config core.hooksPath .githooks`) checks the first line, and CI checks every commit in a pull request.

```
<type>[!]: <subject> (plan NNN)

<optional body>
```

- **Subject:** imperative, capitalized, no period. Say what changes and why, in words a reader of the release notes understands. End with the plan(s) it belongs to, `(plan 007)` or `(plans 007, 008)`; leave it out for changes outside any plan.
- **Type**, by what the change means for the live site. Pick the first that fits; if a change is two things, make two commits.

  | Type | For | Version |
  | --- | --- | --- |
  | `feat` | Something new visitors can see or use: pages, features, text, API endpoints | minor |
  | `fix` | The site or API didn't work as intended, or an existing feature is adjusted to work better (how it behaves, looks or is laid out); security fixes, also a dependency upgrade done for one; a new blog post (content on an existing page) | patch |
  | `perf` | Faster or lighter, same behavior | patch |
  | `refactor` | Code change with no visible change | patch |
  | `style` | Formatting only | patch |
  | `test` | Tests only | patch |
  | `docs` | Plans, READMEs, `STYLE.md`, `AGENTS.md`, code comments | patch |
  | `build` | Dependencies, build config, dev scripts | patch |
  | `ci` | CI, release and server setup (`.github/`, `release.sh`, `deploy/`) | patch |
  | `chore` | Anything else | patch |
  | `data` | Only the server's daily commit of the collected dataset ([plan 013](plans/013-growing-dataset.md)); never by hand. Not in the release notes, no version bump; CI rejects a `data:` commit that changes any other file. | none |

- **Breaking change:** add `!` after the type and a body line `BREAKING CHANGE: <what stops working, and what to do instead>` when a page URL or shareable link stops working (removed, or moved without a redirect), or scores or measurements change meaning so they can't be compared with earlier ones. This bumps the major version. Redesigns, new text and new pages aren't breaking.

Examples:

- `feat: Add the compare page for two videos or two channels (plan 008)`
- `fix: Show a count of 0 as 0 and silent clips as "No sound" (plan 004)`
- `fix: Upgrade Next.js to 16.4.2 for its security fixes`
- `docs: Record human decisions in place in plans`
- `feat!: Score videos with the v3 feature set (plan 002)`, with the body `BREAKING CHANGE: scores are not comparable with earlier releases.`

## Release

`main` is the latest dev version; prod (the site on GitHub Pages and the API on our server) runs the latest release tag, a version `vMAJOR.MINOR.PATCH`. One command releases both, on the server, from any clone of this repo:

```sh
hyperstim-release          # release the latest main on GitHub
hyperstim-release v1.2.0   # roll back: release an older tag again, under the next patch version
```

The version and the release notes come from the commit messages since the last release, which follow Conventional Commits (see [Commit messages](#commit-messages)): a breaking change (`feat!:`) bumps the major version, a `feat:` the minor, anything else the patch. The notes are the tag's message and appear on the repo's [Releases](../../releases) page.

It releases what's on GitHub's `main`, not your clone's branch or uncommitted changes. It stops unless CI passed on that commit (this includes SonarQube Cloud's quality gate, [plan 012](plans/012-code-quality.md)); then it installs and tests the backend in a fresh checkout, switches the service over and checks `/api/health` (going back to the previous release if it doesn't answer), and only then pushes the tag, which deploys the frontend. You need to be in the server's release group and able to push to GitHub. The server's one-time setup: [`deploy/README.md`](deploy/README.md).
