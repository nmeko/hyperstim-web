## Related issue

<!-- Every PR closes or refers to an issue. Discuss bigger changes in the issue first. -->
Closes #

## Type of change

- [ ] Bug fix (something didn't work as intended)
- [ ] New feature (something new visitors can see or use)
- [ ] Improvement to an existing feature
- [ ] Breaking change (a link stops working, or scores change meaning)
- [ ] Docs, tests or refactoring only (no visible change)

## Problem

<!-- What was wrong or missing, and who it affects. -->

## Solution

<!-- What you changed and why this way. Alternatives you tried, and how they did. -->

## Visitor-facing changes

<!-- Anything visitors will notice; write "None" if nothing. -->
- **Interface:** <!-- e.g. new category list, new filter on the rankings page -->
- **Claims and text:** <!-- e.g. changed numbers, explanations, methodology wording -->

## Screenshots

<!-- UI changes only: before and after, at phone (360 px), tablet (768 px) and desktop (1280 px). -->

## Checklist

- [ ] Tests added or updated; a bug fix includes a test that fails without it
- [ ] Lint, type check, tests (unit, component, end-to-end) and build pass
- [ ] Test coverage of the changed lines (`npm run test:coverage`, `uv run pytest --cov`): frontend __%, backend __%
- [ ] UI changes checked at the three sizes above, with the keyboard, and in the Safari check
- [ ] Docs updated (READMEs, `.env.example`) if setup, commands or settings changed
- [ ] The privacy policy (`/privacy`) is still true
- [ ] Nothing secret or server-specific in the diff (keys, tokens, hostnames, server paths, unreleased research data)
- [ ] Every commit message follows "Commit messages" in `DEVELOPMENT.md` (PRs are merged with "Rebase and merge", so each commit lands as written)
