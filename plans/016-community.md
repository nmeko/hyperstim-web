# 016 — Community

**Area:** How people outside the team take part on GitHub: issue templates and the files that point people to them (contact links, later a security policy), and how contributors pick up tasks and send pull requests _(human decision, 2026-11-13)_.

## Goal

Make it easy for parents, researchers and developers to report problems and suggest ideas on GitHub, and get reports we can act on without back-and-forth. Keep personal data out of public issues.

## Decisions

- **GitHub issue forms** (YAML in `.github/ISSUE_TEMPLATE/`), not Markdown templates: required fields, dropdowns and checkboxes, so reports arrive complete and labelled.
- **Three forms** _(human decision, 2026-10-29)_, each adding its own label plus `triage`:

  | Form | For | Fields | Labels |
  | --- | --- | --- | --- |
  | **Bug report** | The site or API doesn't work as it should | Where (dropdown: website, API, dev setup/docs) · page link · what happened · what you expected · steps to reproduce · device and browser with their versions, or for dev setup the OS and tool versions (required) _(human decision, 2026-10-29)_ · screenshot (optional) | `bug` |
  | **A score or detail looks wrong** | A video's or channel's data: score, measurements, category, channel name, missing or wrong metadata | Video or channel link · what looks wrong (dropdown: score, a measurement, category, channel/title, other) · why you think so | `data` |
  | **Idea or feature request** | Something new or better | What problem it solves · your idea · alternatives considered (optional) _(human decision, 2026-10-29: no "who it helps")_ | `enhancement` |

- **The "New issue" page lists only the three forms** _(human decision, 2026-10-29)_: no contact links on it. GitHub's "Open a blank issue" option is turned off (`config.yml`), so every issue comes through a form.
- **Linked from the About page's "Get in touch"** _(human decision, 2026-10-29)_: plan 015 has the text.
- **No intro text on the data form** _(human decision, 2026-10-29)_: it starts with its first field.
- **Every form ends with a required checkbox:** "I haven't included personal information (names, emails, children's details). Issues are public."
- **Rules for us, not shown to visitors:**
  - Form text in American English and plain words (site rule; parents may file the data and idea forms).
  - Labels don't clash with plan 013's alert labels (`alert`, `alert:<kind>`); the bot's issues don't use these forms.
  - Privacy policy unchanged: the forms live on GitHub, not on the site or backend, and the site already links GitHub (plan 015). Nothing new is stored or sent by us.

### Contributors: tasks and pull requests _(human decision, 2026-11-13)_

- **Task pool as issues labelled `task`**, written by maintainers, for collaborators to pick up and send PRs for. Claiming: comment on the issue, a maintainer assigns you.
- **No Task form:** GitHub can't limit a form to maintainers, and every form shows on the public "New issue" page. Maintainers open tasks as blank issues ("maintainers only" with blank issues off) with a prefilled link: `issues/new?labels=task&body=…` with the two headings below.
- **A task has two sections** _(human decision, 2026-11-13: other fields don't matter)_: **Goal** (what and why, with constraints) and **Done when** (a checklist). Kept brief. The first: #1, Improve video category classification.
- **Pull request template** (`.github/pull_request_template.md`): related issue (`Closes #`), type of change (matching the commit types: fix, feature, improvement, breaking, docs/tests/refactor only), problem, solution (incl. alternatives tried), visitor-facing changes (interface; claims and text), screenshots at 360/768/1280 px for UI changes, and a checklist (tests, checks pass, the changed lines' test coverage for frontend and backend _(human decision, 2026-11-13)_, UI at three sizes + keyboard + Safari check, docs updated, privacy policy still true, nothing secret, Conventional Commits). No plan field _(human decision, 2026-11-13)_.
- **`DEVELOPMENT.md` is the contributing guide** _(human decision, 2026-11-13)_: no separate `CONTRIBUTING.md`. It gets a **Commit messages** section for people (format, types table with version bump, breaking changes, examples, the hook); `AGENTS.md`'s rules point to it instead of repeating it, and the `commit-msg` hook's message points there too.
- **PRs are merged with "Rebase and merge"** _(human decision, 2026-11-13)_, keeping history linear, so each commit message in a PR must follow the format.
- **Collaborators get write access** _(human decision, 2026-11-13)_ and push branches here, one per task: `issue-<number>-short-title` (e.g. `issue-1-category-classification`), so two people on one plan don't share its `NNN-short-title` branch.
- **CI checks every commit message in a PR** _(human decision, 2026-11-13)_: `scripts/check-commit-messages.sh` runs the `commit-msg` hook on each commit of the pushed range, next to the data-commit check; the hook only runs locally where `./dev.sh` turned it on.

## Steps

1. Create the labels `bug`, `data`, `enhancement`, `triage` if missing (GitHub's defaults cover `bug` and `enhancement`).
2. ~~Add `.github/ISSUE_TEMPLATE/bug-report.yml`, `data-report.yml`, `feature-request.yml`, `config.yml` (blank issues off).~~
3. ~~About page link~~ (plan 015, step 7).
4. ~~`DEVELOPMENT.md`~~: one line pointing to the issue forms for bugs and ideas.
5. Check: open each form on GitHub after merge (forms only render from the default branch); validate the YAML locally before (`python -c "import yaml…"` via `uv run`).
6. Commit: `ci: Add issue forms for bugs, data corrections and ideas (plan 016)` and `feat: Point to the GitHub issue forms from the About page (plans 015, 016)`, on `016-community`.
7. ~~Create the `task` label and issue #1~~ (2026-11-13).
8. ~~Add `.github/pull_request_template.md`.~~
9. ~~`DEVELOPMENT.md`: a Contributing section (pick a `task` issue, branch, PR with the template, rebase merge) and the Commit messages section; `AGENTS.md` points to it; the hook's message and `release-notes.sh`'s comment too.~~
10. ~~`scripts/check-commit-messages.sh` in CI's backend job, tested in `backend/tests/test_commit_messages.py`.~~
11. Repo settings (admin, by hand; written down in `deploy/README.md`, GitHub step 5): rebase merge only, a `main` ruleset (PRs with 1 approval and passing CI, linear history, branches not required to be up to date _(human decision, 2026-11-13: `main` moves fast)_; admins and the data bot's deploy key bypass it), collaborators with write access.
12. Commit, on `016-community`: `ci: Add a pull request template and check every commit message in CI (plan 016)` and `docs: Explain contributing and commit messages in DEVELOPMENT.md (plan 016)`.

## Open questions

1. **More forms?** Candidates: "Add a video or channel" (ask the collector to include one, plan 013), "Documentation" (separate from bugs), "Research question" (about the method or dataset). I'd start with three and add when real issues show the need.
2. **GitHub Discussions** for open questions instead of the contact form? Public and searchable, but one more place to watch.
3. **Also now, or later:** `SECURITY.md` (with no security link on the New issue page, it is where a vulnerability reporter would look to report privately), `CODE_OF_CONDUCT.md` (Contributor Covenant)?
4. **Who triages, and how often?** Worth stating in `DEVELOPMENT.md` (e.g. weekly, like the contact form).
