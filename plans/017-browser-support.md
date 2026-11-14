# 017 — Browser support

**Area:** Which browsers and versions the site supports, how we check them, and the engine pitfalls our UI must avoid. Fixes on a page are also noted in that page's plan.

## Goal

The site works and looks the same in the Safari people actually run (iOS, iPadOS and macOS) as in Chrome and Firefox. Our checks catch Safari-only bugs before visitors do.

## Why now

On an iPhone, any tap in the homepage rankings card opened the least stimulating video, including taps on the Videos/Channels switch. The switch's yellow pill also sat wrong on three pages. Our E2E tests didn't catch either bug: Playwright's WebKit (27.x) is close to the newest WebKit code, and both bugs are already fixed there. Shipping Safari (18.x) still has them. I reproduced both in WebKit 18.2 (Playwright 1.49.1).

## Decisions

- **Supported:** the last two major versions of Safari (iOS, iPadOS, macOS), Chrome (desktop, Android), Firefox and Edge. Older browsers back to iOS 15.4 still get a working page, because Tailwind 4 adds fallbacks for them; it's tested only in the newest versions. Below 15.4 the page is unstyled (no cascade layers); we accept that.
- **A Safari check that uses shipping Safari's engine** _(human decision, 2026-10-30: a pinned dependency that runs in CI, not a script run by hand)_, on **WebKit 26** (Playwright 1.57.0) _(human decision, 2026-10-30: option b; WebKit 18.2 would also catch the pill, but its Playwright, before 1.55.1, downloads browsers without checking the TLS certificate, GHSA-7mvr-c777-76hp)_. WebKit 26 still has the table-row bug, the one that sent taps to the wrong place; the pill keeps its component test and the `STYLE.md` rule.
  - **Its own package** in `frontend/e2e/safari/` (`package.json`, lock file, `playwright.config.ts`, `safari.spec.ts`): an npm alias in the main `package.json` would take over `npx playwright`, since both packages name their command `playwright`. Its WebKit lives in `~/.cache/ms-playwright-safari` (`PLAYWRIGHT_BROWSERS_PATH` in its scripts), so the two Playwright versions don't clean up each other's browsers in the shared cache. Its install script leaves out the system libraries; CI and `./dev.sh --install-tools` add `--with-deps`, so a developer's install doesn't run `apt` unasked.
  - **CI runs the E2E job on `ubuntu-24.04`**, not `ubuntu-latest` _(human decision, 2026-11-10: ubuntu-latest moved to Ubuntu 26.04, where Playwright 1.57.0 has no WebKit and the install failed)_. Move it to a newer runner only together with a Playwright for the Safari check that supports it.
  - **Same servers as the main suite:** both configs start them from `e2e/servers.ts`; the main config ignores `e2e/safari/`. The spec fetches its test videos with plain `fetch`, as the main suite's helpers take the other Playwright's types.
  - **Checks**, at 1280 × 800 (`safari-desktop`) and 360 × 740 (`safari-phone`):
    - **Every tap reaches the control under it:** on the home, rankings (videos and channels), compare (videos and channels), video, channel, How it works, About and Privacy pages, the middle of every visible button, link and field (of each line, for a link that wraps) hits that control, each scrolled to the middle of the screen. Left out: the over-years charts' thumbnails, which overlap on purpose, and the contents of a closed `<details>`.
    - **Compare info popups** open within 24 px of their button.
    - With the row fixes undone, the check fails as visitors saw it: every control on the home rankings card is covered by the least stimulating video's link, and the compare popups open away from their buttons.
  - **Moving the pin up:** when a new Safari ships, to a Playwright whose WebKit matches a Safari still in wide use.
- **Playwright's Linux WebKit is not Safari.** It shares the layout engine, not the iOS shell (keyboard, toolbars, video playback). A new page or a major UI change also gets a manual check on a real iPhone before handoff. This goes next to the manual screen reader pass in CLAUDE.md.
- **Engine rules, in `STYLE.md`** (new section **Browser pitfalls**):
  1. A table row (`tr`, `thead`, `tbody`) is never the anchor for something placed on top of it. Safari ignores `position: relative` on table parts (WebKit bug 240961), so the overlay attaches to the next positioned ancestor instead. Anchor to a cell (`td`/`th`) or to an element outside the table.
  2. Content inside a `<button>` doesn't rely on stretching to the button's height; Safari 18 doesn't stretch it. Give it its own height (`min-h-9` in a `min-h-11 p-1` button) or center it.
- **Linked rows** (`LinkedRow`; `STYLE.md`, Tables): the name's link covers its own cell (`relative` on the `td`, not the `tr`). A click anywhere else in the row opens the same page through an `onClick` on the row _(human decision, 2026-10-30: keeps today's whole-row target)_. It ignores clicks on the row's links and buttons, clicks after selecting text, and modifier keys. Keyboard and screen reader users still reach the page through the link, as now. Middle-click and Cmd-click work on the name only.
- **Fixes 7–12 belong here too** _(human decision, 2026-10-30)_, though they aren't Safari-only. Each is noted in its page's plan.
- **Autoplay on iPhone:** accepted _(human decision, 2026-10-30)_. iOS often blocks YouTube's autoplay with sound, so a visitor may tap our Play button, then YouTube's.
- **Privacy policy unchanged** _(human decision, 2026-10-30)_. Safari deletes script-written storage after 7 days without a visit, so the consent banner can come back sooner, but "saved for a year" still holds as an upper limit.

## Fixes

Each fix comes with a test that fails without it: a component test with Testing Library, plus a Safari-check assertion where jsdom can't see it.

**Safari bugs** (confirmed in WebKit 18.2 or read from the code):

| # | Where (plan) | Bug | Fix |
| --- | --- | --- | --- |
| 1 | Home rankings card, `RankingsCard.tsx:257` (002) | Every row's link covers the whole card, so any tap opens the last row (−1). | Linked rows, above. |
| 2 | Rankings table, `RankingsPage.tsx:816` (007) | Every row opens the last row on the page. Affects iPad and desktop Safari, where the table is shown. | Linked rows, above. |
| 3 | Compare table, `Comparison.tsx:148` (008) | Measurement info popups open about a screen away from their button, sometimes above the top of the page on iPhone. | `relative` on the `th scope="row"`, not the `tr`. |
| 4 | Segmented control, `SegmentedControl.tsx:33` (STYLE.md; home, rankings and compare pages) | The pill is 20 px tall instead of 36 and sticks to the top. | `min-h-9` on the pill. |
| 5 | `YouTubePlayer.tsx:102` (004) | On iPhone, videos open fullscreen, which breaks the player-growing animation and the side-by-side compare view. | Add `playsinline=1` to the embed URL. |
| 6 | Rankings search, `RankingsPage.tsx:564` (007) | Safari and Chrome put a clear "×" inside `type="search"`, which narrows the text by about 17 px, so with long text the filter highlights end up 15–17 px out of line with their words (confirmed in both engines). | Hide `::-webkit-search-cancel-button` (`display: none`; `appearance: none` still leaves its space). |

**Other platform and screen-size bugs found in the same audit:**

| # | Where (plan) | Bug | Fix |
| --- | --- | --- | --- |
| 7 | `video/ScoreGauge.tsx:79` (004) | Below `lg`, the score's info popup draws under the measurement rows: a transform on its wrapper keeps the `z-10` from working (confirmed by the E2E test). | Lift the `z-10` to the wrapper. |
| 8 | `how-it-works/WhatWeMeasure.tsx:271` (006) | `scroll-mt-[32rem]` at every size, so on short screens (iPhone SE, phones in landscape) "More about this →" lands with the item off-screen. | Replaced by plan 006 step 8 _(human decision, 2026-10-30: land with the section's title at the top)_: the first fix here (`min(32rem,40svh)`) put the title above the screen. |
| 9 | `compare/CompareChart.tsx:118` (008) | On touch screens, a dot's popup only hides when a mouse leaves the dot, so a scroll that starts on a dot leaves it stuck. | Replaced by plan 008 step 8 _(human decision, 2026-10-30: a finger can't be held on a dot)_: a tap opens the video under the chart; only a mouse gets the popover. |
| 10 | `video/parts.tsx:14`, `app/layout.tsx:31` (004, 001) | `dvh` follows the mobile toolbar, so a playing video changes width by about 100 px while scrolling (tablets in landscape). | `svh`. |
| 11 | `ScoreGauge` + `InfoTip.tsx:88` (004) | At 320 px the score's info popup sticks out about 8 px past the left edge. | Every `InfoTip` shifts sideways to stay 16 px inside the screen. |
| 12 | `compare/Picker.tsx:319` (008) | With the iOS keyboard up, the lower suggestions sit under the keyboard and the list doesn't scroll the page. | Replaced by plan 008 step 8 _(human decision, 2026-10-30: `40svh` left the list under the keyboard)_: the list fits the visual viewport. |

## Steps

1. ~~The Safari check's package in `frontend/e2e/safari/`, its WebKit in `./dev.sh --install-tools` and CI (plans 010, 012), the shared `e2e/servers.ts`; `frontend/README.md`, `DEVELOPMENT.md`, CLAUDE.md (Tests).~~
2. ~~The Safari-check specs; checked that they fail with the row fixes undone.~~
3. ~~Fixes 1–6, then 7–12, each with its test. Note each in its page's plan (dated) and the rules and the linked-row change in `STYLE.md`.~~ Tests:
   - **Component:** `LinkedRow`; the rows' links anchor to their cell, not the row (home card, rankings page); the compare popovers anchor to their `th`; the pill's own height; `InfoTip`'s sideways shift; `playsinline`; a chart dot's popover goes for any pointer; `svh`.
   - **E2E, in all four projects:** a click on a row's cell opens it; the search highlights stay in line; the score's popover is on top and on screen at 320 px; a measurement anchor lands in view at 375 × 548 and 740 × 340. Each failed without its fix.
4. ~~CLAUDE.md: the manual real-iPhone check before handoff, next to the screen reader pass.~~
5. Lint, type check, unit, component and E2E tests, build ~~(done, without the Safari check)~~. ~~Checked in WebKit 18.2, WebKit 26.0 and Chromium (mock data, 360 and 1280 px): the switch takes taps, pills are 36 px, rows open their own page, compare popovers open 2 px from their button.~~ A real-iPhone check of the home, rankings, compare and video pages.
6. Commits on `017-browser-support`, e.g.:
   - `fix: Open the tapped row, not the last one, in Safari's ranking tables (plans 002, 007, 017)`
   - `fix: Fill the switch's pill to its full height in Safari (plan 017)`
   - `fix: Open compare info popups next to their button in Safari (plans 008, 017)`
   - `fix: Play videos inline on iPhone (plans 004, 017)`
   - `test: Check that every tap reaches its control in the newest Safari's engine (plans 012, 017)`

## Open questions

None.
