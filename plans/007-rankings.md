# 007 — Rankings page

**Area:** Rankings page (`/rankings`) and the ranking endpoints.

## Goal

Build `/rankings`: every video or channel in the dataset, ranked by the overall stimulation score or by any one of the 12 measurements. Users can switch between videos and channels, search by name, filter by category, and page through the results. Each row shows the overall score and the 12 measurements as colour-coded numbers. The home card's "See full rankings →" already links here. The backend's `GET /api/videos` and `GET /api/channels` gain sorting by measurement, a category filter, search, and paging.

## Decisions

- **Scope.** The page, the extended list endpoints, and the page's states. Not in scope: comparing, rows for live-analyzed videos (these never join the dataset, plan 004), and downloads or exports.
- **Videos or channels**, switched with the segmented control (as on the home card). Videos are the default. Switching keeps the search, category, and ranking criterion, and goes back to page 1.
- **Columns:** rank, name, Overall, then the 12 measurements in the research taxonomy's three groups (the order of the measurement table, plan 004). Video rows: title, with the channel (linked) on a second line. Channel rows: name, with "{N} videos" on a second line. A row links to its video or channel page.
- **Ranking criterion:** Overall by default. Clicking a column header (Overall or any measurement) ranks by that column, keeping the current order _(human decision: switching columns used to jump back to most stimulating first)_. Clicking the selected header again flips the order. One criterion at a time.
- **Order button** _(human decision: an order switch on wide screens too, on the category row; quiet, so it doesn't race the view control for attention)_: a text button with a ⇅ icon that shows the current order ("Most stimulating first" / "Least stimulating first") _(human decision, 2026-11-09: “stimulating”, not “intense” or “calm”)_ and flips it on click. No border or fill (`STYLE.md`, Order button). From `lg` at the right end of the category row; below `lg` next to the "Rank by" select (under it below `sm`) _(human decision: the same button on narrow screens, in place of a segmented control)_.
- **Ranks:**
  - A rank is the position, most stimulating first, by the selected criterion among the rows in the selected category. **Search does not change ranks**: it only hides rows, so a search result still shows a video's real place.
  - When the order is flipped to least stimulating first, the list is reversed and the ranks count back from that end: −1 is the least stimulating, then −2, −3, as on the home card (screen readers: “1st least stimulating”) _(human decision: not the huge numbers)_. The API returns them as 1, 2, 3 in that order; the page adds the minus sign.
  - Rows with no value for the criterion ("No cuts", "No sound", "Not measured", see plan 004) get no rank ("–"). They come last in both orders.
  - A count of 0 is a value (0, plan 004) _(human decision, 2026-10-16)_, so those rows are ranked, at the least stimulating end. **Equal values share a rank** (the first one's: 1, 2, 2, 4), so the thousands of videos tied at 0 don't get arbitrary ranks; least stimulating first, they are all −1 _(human decision, 2026-10-16)_.
  - Ties are listed by ID, so the order is stable (same rule as plan 002). With Overall, all categories, most stimulating first, the top 3 match the home card.
- **Colour-coded numbers** (**new**, the *score cell*). Each score is a navy bold number on a rounded tile. The tile's background is the score scale colour the score meter uses for that score (`filledSegments`: `sky-blue`, `leaf`, `scale-low`, `scale-mid`, `scale-high`) at 50 %. At 50 %, navy text has a contrast of at least 6.3 : 1 on every colour (checked). Full-strength colours fail on `leaf` and `scale-high`. The number carries the value, so colour is never the only cue. Empty values show a muted "–" on no tile, with the reason for screen readers.
- **Search:** one search input at the top of the card. It matches any part of the name, ignoring case, accents and repeated spaces _(2026-10-27: pages show a title's double spaces as one, so a copied title didn't match)_. For videos it searches the title and the channel name (typing a channel's name lists its videos). For channels it searches the name. Results update as the user types (300 ms debounce) and the list goes back to page 1. 1–100 characters; the field is trimmed. The field itself takes up to 500, so long links fit.
- **Links in the search, as in the compare picker** _(human decision, 2026-10-17)_. The same input rules as plan 008, read by the same helper (`readSearchInput`):
  - **Videos:** a YouTube video link or ID shows that video's row, with its real rank. The URL keeps the ID (`q=<videoId>`), so the link can be shared. Not in the rankings: “This video isn’t in our dataset. [Check it →]” (its video page runs the live check; checked videos never join the rankings, plan 004). With a category picked, it's the usual no-match message, since the category may hide it.
  - **Channels:** a channel link shows that channel's row (`q=<channelId>`). A `/channel/UC…` link needs no lookup. A handle, `/c/` or `/user/` link is looked up with `GET /api/channel-lookup` (plan 008); because that may ask YouTube and counts toward the per-IP limit, it runs when the link is pasted or on Enter, not while typing. Not in the dataset: “{Name} isn’t in our dataset yet.” These two come from a channel-ID lookup (no YouTube request) when a `UC…` search finds nothing with all categories, so they also show from a shared link. Every channel in the dataset is ranked, whatever its number of videos _(human decision, 2026-10-28: the minimum kept small channels from being judged on a few videos; the collector now keeps adding videos to them, plan 013)_. The lookup's other messages are as in plan 008.
  - **Wrong kind of link:** a channel link with Videos selected: “That’s a channel link. Switch to Channels to find a channel.” A video link with Channels selected: “That’s a video link. To find a channel, paste a channel’s link or type its name.” Anything else that looks like a link: “That doesn’t look like a YouTube link or video ID.” These take the table's place in the message box, with "Clear search", which also empties the field.
  - The table filters as you type, so there is no suggestion list here.
- **Category filter:** "All" (the default), then the dataset's categories (Music, Narrative, Play & activity, Educational, Gaming), as chips. The five are fixed in the frontend (`lib/categories.ts`, keys `music`, `narrative`, `play`, `educational`, `gaming`, also used in the URL and the API), like the 12 measurements, so the chips show without waiting for the backend (`STYLE.md`; a select below `sm`). Only one can be picked, as with the measurement picker (plan 005). A channel is listed under a category if at least one of its videos is in it. Its scores stay whole-channel scores, the same numbers as on its channel page; the filter only picks which channels are listed _(human decision)_.
- **Search filters** _(human decision, 2026-10-26, from plan 013's "new this week" link)_: the search box takes `key:value` filters next to the search words, as GitHub's search does. Only the keys below are filters; any other `word:` is searched as text, since titles often have colons ("Peppa Pig: Muddy Puddles"). Recognised filters are highlighted in the box, so it's clear they're filters _(human decision, 2026-10-26)_ (`STYLE.md`, Search filters); invalid ones aren't.
  - **`category:<key>`**, keys as in `lib/categories.ts` (`music`, `narrative`, `play`, `educational`, `gaming`). The token and the category chips (the select below `sm`) are one control: picking a chip changes the token's value where it is, or adds one after the other filters _(human decision, 2026-10-26: putting it first, before a filter already there, was unexpected)_, typing the token picks the chip, deleting it picks All. One category at a time; a second `category:` replaces the first.
  - **`added:<date>`**: dates only, `YYYY-MM-DD`, in the visitor's time zone. `added:2026-10-20` (that day), `added:>2026-10-20` (after it), also `>=`, `<`, `<=`. Videos: the time a video joined the dataset (the reference set counts as added on its date, 2026-09-01). Channels: the time the channel's first video joined, i.e. channels new to the dataset.
  - **A bad filter** shows a hint in the message box instead of the table, as the link messages do: "“added:yesterday” isn’t a date filter. Use a date like added:2026-10-20, or added:>2026-10-20 for after it." / "“category:dance” isn’t a category. Categories: music, narrative, play, educational, gaming." Several `added:` filters narrow each other.
  - **"Clear search"** empties the whole box, filters included, as the box holds them.
  - **Nothing in a date window:** "No videos added on October 20."
  - **Rules at hand:** an info button (`InfoTip`) right after the search box (copy below).
  - **Results line** says the filters in words: "Showing 1–25 of 98 music videos added after October 19 matching “peppa”".
  - **URL:** the box's text is the state: `/rankings?q=category:music+added:>2026-10-19`. The old `category=` parameter still works and becomes the token, so shared links keep working.
  - **Ranks** stay the ranks within the category, as with search (filters only hide rows).
  - **API, additive:** `addedFrom` (inclusive) / `addedBefore` (exclusive), UTC instants, on `GET /api/videos` and `GET /api/channels`; the frontend turns the dates into instants in the visitor's time zone, sends the category as `category` and the search words alone as `q`. So the usage log (plan 014) keeps the search words only, not the filters.
  - The parser is `lib/search-filters.ts`.
- **Channels listed:** the ones with ≥ 5 scored videos (512), as on the home card, so the two agree _(human decision)_.
- **Paging on the server:** 25 rows per page, fetched with `offset` + `limit`, so a page never loads the whole dataset. A numbered page control sits under the table (**new**, see **Design**). Changing the page moves focus to the results line above the table and scrolls it into view (instantly with reduced motion), so keyboard users start at the new rows.
- **State in the URL:** `/rankings?view=channels&sort=cuts_per_min&order=asc&category=music&q=…&page=2`, with defaults left out. Links can be shared and Back works. Typing in search replaces the history entry; every other change adds one. Invalid values fall back to their defaults. The home card's link carries its current view (`/rankings?view=channels`).
- **While loading:** skeleton rows on first load. On later changes the current rows stay, dimmed (`opacity-60`, `aria-busy`), until the new page arrives, so the table doesn't jump. A response to an older request is ignored, so a slow, outdated response never replaces a newer one (`useApi` gains a `stale` flag).
- **Phones and tablets (below `lg`): cards instead of the table.** The table needs about 900 px (14 columns), so the full table starts at `lg` (overrides 001's `md`). Each card shows rank, name, second line, the Overall tile, and the tile of the selected measurement when one is selected. All 12 are on the row's own page _(human decision)_. Table and cards are both rendered and CSS breakpoints show one (likewise chips or select, and the "Rank by" row), so the first paint already fits the screen _(human decision: no flash of the phone controls on load)_. Since there are no headers to click, a "Rank by" select (Overall + the 12 in `<optgroup>`s, as the measurement picker's phone select) and the order button take their place.
- **The kid: `kid_blocks_2`, a pose from the team** _(human decision, 2026-10-16: the kneeling `kid_blocks` was too large at the shared head size)_: lying on the tummy, stacking colourful blocks. Flipped horizontally, so the kid faces the page rather than out of it _(human decision: flip if it looks better)_. At the H1 row's right, body and blocks resting on the card's top edge. **Its head the same size as the home kid's** _(human decision, 2026-10-16)_, compared by face width _(human decision, 2026-11-10: sized by eye distance, its head was larger than the home kid's; then fine-tuned by eye against it)_: 216 / 248 / 288 px wide at `md` / `lg` / `xl` (001). It's placed `absolute` at the hero's bottom right, as on the compare page, so where it's taller than the text it rises above it instead of pushing the H1 down; the text keeps clear of it with right padding (kid width + its margin). Transparent background, so no blend mode. Decorative, hidden below `md`.
- **Reuse:** page container, section card, message box, text input, segmented control, chips, select, outlined button, text link (`STYLE.md`); `FEATURE_INFO`, `FEATURE_GROUPS`, `featureDisplay` (`lib/features.ts`); `filledSegments` (`ScoreMeter`); `MeasurementPicker` (moved to `components/`, gains a `label`); `channelHref`/`videoHref`. With a second use each, the segmented control, chip and select become shared components (`SegmentedControl`, `Chip`, `Select`), used by the home card and the measurement picker too. The segmented control's pill fills its option with the same 4 px gap to the border on every side, so its curve follows the border's, here and on the home card _(human decision: the pill's and the border's radii didn't match)_. New: `ScoreCell`, `Pagination`, `RankingsPage`.
- **New styles go into `STYLE.md` in the same change:** the score cell, the rankings table (grouped, rotated sortable headers), the rankings card (phones), and the page control.

## Design

### Layout

DOM order: H1 + intro → rankings card (search + view switch, category chips, results line, table/cards, page control) → footer.

| Width | Layout |
|---|---|
| `lg`+ | H1 and intro on the top left. Section card: search input (left, `max-w-md`) and the Videos/Channels control (right) on one row; category chips under them; results line; the table; the page control centred under it. The kid on the card's top edge at the right. |
| `md`–`lg` | Same card. Below the chips: a "Rank by" select and the order button on one row. Cards instead of the table. |
| `sm`–`md` | The view control, then the search full width under it _(human decision: view control first on narrow screens)_; chips; "Rank by" and order on one row. Cards. No kid. |
| < `sm` | As above, with a category select instead of chips, side by side with "Rank by" (two columns), so the results start higher _(human decision)_; the order button under them. Page control reduced to ‹ · Page 3 of 655 · ›. |

**Table header** (`lg`+): two header rows. Row 1 has the group names centred over their columns _(human decision)_ (`colspan` 6 / 4 / 2, `text-xs` semibold, with a `navy/15` line under each group). Row 2 has the column names: "#", "Video", then "Overall" and the 12 measurement names, set vertically (reading bottom to top) so 48 px columns can hold them. Each name is a sort button (44 px target) with a ▼/▲ on the selected column and a faint ▼ under every other one, so all columns read as clickable _(human decision)_. The selected header has the sunny pill. The `th` carries `aria-sort`. A thin `navy/10` gap separates Overall from the 12. **The column names stick** _(human decision, 2026-10-30: on a long table, people lose track of which column is which)_: row 2 stays at the top of the screen while the rows scroll under it (`sticky top-0`, white, above the rows' links); row 1, the group names, scrolls away _(human decision: column names only, not both rows)_. Its line looks the same stuck as at the top of the table: no shadow _(human decision: no glow under the line)_. As the table collapses its borders, the line is drawn as an inset shadow on the cells, so it moves with them. When Tab moves up the rows, the browser scrolls the focused link into view but doesn't know about the stuck names, so the links in the table get a top scroll margin the height of the names (`scroll-mt-*`) and are never hidden under them (WCAG 2.4.11). Below `lg` nothing changes: the cards name their scores.

**Desktop (1280 px)**

```
┌────────────────────────────────────────────────────────────────────────────────────────────┐
│ HyperStim?                                      Home  Rankings  Compare  How it works  About │
├────────────────────────────────────────────────────────────────────────────────────────────┤
│  Stimulation rankings                                                                      │
│  16,375 videos and 512 channels, ranked by how stimulating they are.                      │
│                                                                           {kid with lens}  │
│  ╭─ rankings card ──────────────────────────────────────────────────────────────────────╮  │
│  │  ( 🔍 Search videos or channels…           )                 ( Videos | Channels )   │  │
│  │  Category  (All) (Music) (Narrative) (Play & activity) (Educational) (Gaming)  ⇅ Most…│  │
│  │                                                                                      │  │
│  │  Showing 1–25 of 16,375 videos                                                       │  │
│  │                                    Pacing intensification  Sustained sensory  Reward │  │
│  │                              ┌───┐  ───────────────────── ────────────────  ────── │  │
│  │                              │ O │   R   S   P   L   M   L   V   V   A   S   A   S │  │
│  │  #  Video                    │ v │   a   c   a   u   o   o   i   i   u   i   u   u │  │
│  │                              │ ▼ │   ⋮   ⋮   ⋮   ⋮   ⋮   ⋮   ⋮   ⋮   ⋮   ⋮   ⋮   ⋮ │  │
│  │ ─────────────────────────────└───┘───────────────────────────────────────────────── │  │
│  │  1  Super Fast Toy Party     [99]  [96][88][91][97][84][90] [72][65][93][88] [94][97]│  │
│  │     Wheelie Friends TV                                                               │  │
│  │  2  Color Blast Song Mix     [99]  [94][90][95][71][88][93] [80][77][90][91] [85] – │  │
│  │     Rainbow Hop                                                                      │  │
│  │  …                                                                                   │  │
│  │                                                                                      │  │
│  │                 ‹ Previous   1  2  [3]  4  5  …  655   Next ›                        │  │
│  ╰──────────────────────────────────────────────────────────────────────────────────────╯  │
└────────────────────────────────────────────────────────────────────────────────────────────┘
  [nn] = score cell (number on a 50 % score-colour tile); – = no value
```

**Phone (360 px)**

```
┌──────────────────────────────┐
│ HyperStim?               ☰   │
├──────────────────────────────┤
│ Stimulation rankings         │
│ 16,375 videos and 512        │
│ channels, ranked by …        │
│ ╭─ card ───────────────────╮ │
│ │ ( Videos | Channels )    │ │
│ │ ( 🔍 Search videos…     )│ │
│ │ Category     Rank by     │ │
│ │ [ All     ▾] [ Rapid c ▾]│ │
│ │ ⇅ Most stimulating first │ │
│ │                          │ │
│ │ 1–25 of 16,375 videos    │ │
│ │ ──────────────────────── │ │
│ │ 1  Super Fast Toy Party  │ │
│ │    Wheelie Friends TV    │ │
│ │    Overall [99]          │ │
│ │    Rapid cutting [96]    │ │
│ │ ──────────────────────── │ │
│ │ 2  Color Blast Song Mix  │ │
│ │    …                     │ │
│ │                          │ │
│ │  ‹   Page 1 of 655   ›   │ │
│ ╰──────────────────────────╯ │
└──────────────────────────────┘
```

### States

- Loading (first): skeleton rows/cards, `aria-busy`, sr-only "Loading rankings…".
- Loading (later): current rows dimmed, `aria-busy`; the results line updates when the new page arrives.
- No match (search or filter): message box "No {videos} match “{q}”." (with a category: "No {music} {videos} match …") and a "Clear search" outlined button.
- A link in the search: looking a channel up (sr-only "Looking up this channel…", rows dimmed); the link messages (see **Decisions**, Links in the search) in the message box, each with "Clear search".
- Page past the end (from an old link): goes to the last page.
- Error: message box "We couldn’t load the rankings." + "Try again", as on the other pages.

### Copy

| Where | Text |
|---|---|
| `<title>` | Stimulation rankings - HyperStim? |
| Meta description | Which kids’ videos and channels are the most stimulating, or overstimulating? Every one in our dataset, ranked by overall score or any of 12 measurements. _(human decision, 2026-10-29; plan 011, Page descriptions)_ |
| H1 | Stimulation rankings |
| Intro | Videos and channels in our dataset, ranked by how stimulating they are. _(human decision, 2026-11-09: “stimulating”, not “intense” or “calm”)_ Then, on its own line _(human decision)_: [What the measurements mean →](/how-it-works) (no counts: the results line has them, and needs no extra request; no sentence on the 5-video minimum _(human decision)_) |
| Search label (sr-only) / placeholder | Search videos / Title, channel, or video link… · Search channels / Channel name or link… (short enough for 320 px) |
| Link messages | This video isn’t in our dataset. Check it → · {Name} isn’t in our dataset yet. · That’s a channel link. Switch to Channels to find a channel. · That’s a video link. To find a channel, paste a channel’s link or type its name. · That doesn’t look like a YouTube link or video ID. · the lookup's errors as in plan 008 |
| View control `aria-label` | Show ranking of · Videos · Channels |
| Category label | Category · All · Music · Narrative · Play & activity · Educational · Gaming |
| Rank by (below `lg`) | Rank by · Overall · {12 names} |
| Order button | ⇅ Most stimulating first / ⇅ Least stimulating first (`aria-label` “Order: …”) _(human decision, 2026-11-09: “stimulating”, not “intense” or “calm”)_ |
| Results line (`aria-live="polite"`) | Showing {26}–{50} of {5,699} {music} videos (the criterion is left out: the selected header shows it _(human decision)_); channels: “… of {544} channels …”, with a category “… of {120} channels with {music} videos …”, every channel, so the count matches the home page's _(human decision, 2026-10-28, plan 013: no 5-video minimum)_; with search: “… matching “{q}” …”; a link (its ID): “… for this link”; one row: “1 video” / “1 channel” |
| Search info (`InfoTip`) | Search by title or channel, or paste a YouTube link. Filters: **category:music** (music, narrative, play, educational, gaming) · **added:2026-10-20** added that day · **added:>2026-10-20** added after it (also <, >=, <=) |
| Table caption (sr-only) | {Videos}, ranked by {Overall}, {most stimulating first} |
| Sort button | the column's name; the header's `aria-sort` tells the current order |
| Rank “–” (sr-only) | Not ranked |
| Rank “−{12}” (sr-only), least stimulating first | {12th} least stimulating |
| Empty cell (sr-only) | No cuts / No sound / Not measured |
| Page control (`nav` “Pages”) | ‹ Previous · Next › (`aria-label` “Previous page” / “Next page”) · page buttons (`aria-label` “Page {3}”), current `aria-current="page"` · phones: Page {3} of {655} |
| No match | No {videos} match “{q}”. · Clear search |
| Error | We couldn’t load the rankings. · Try again |

## API contract (frontend `api.ts` ↔ backend)

```
GET /api/videos?sort=score|<feature key>&order=desc|asc&category=<key>&q=<text>&offset=0&limit=25
  → { items: [{ id, title, channelId, channel, category,               // category: key, e.g. "play"
                rank: number | null,                 // by `sort` within `category`, 1 = first in `order`; null = no value
                score: number,                       // 0–100, 1 decimal
                features: [{ key, value, percentile }] }],   // the 12, as in GET /api/videos/{id}
      total: number }                                // rows matching category + q

GET /api/channels?sort=…&order=…&category=…&q=…&offset=0&limit=25
  → { items: [{ id, name, videoCount, rank, score, features }], total }
```

- `q` that is exactly a row's ID (an 11-character video ID, or a `UC…` channel ID) also matches that row (links in the search, 2026-10-17).
- `sort` defaults to `score` and `order` to `desc`. `category` is a key from `lib/categories.ts` (`play` = the dataset's “play & activity”); empty = all; an unknown key → 422. `q` 1–100 characters. `offset` ≥ 0, `limit` 1–100 (default 20). Anything else → 422.
- **Breaking change:** `sort=score_desc|score_asc` becomes `sort=score&order=desc|asc`. The home card is updated in the same change.
- 25 rows × 12 features ≈ 10 KB per page.

## Backend

- `Video` gains `category` (the API key: the dataset's “play & activity” is `play`; an unknown category stops the load); `Channel` gains `categories` (the set of its videos' categories).
- A count of 0 on a per-minute feature ranks as percentile 0, as the API sends it (plan 004, `dataset.py`) _(human decision, 2026-10-16)_. The six keys match the frontend's `perMin`/`cutsPerMin` units, and a test checks this.
- At startup (and at each dataset reload, plan 013), for each of the 13 criteria (score + 12), the videos and the channels are pre-sorted once: most stimulating first, ties by ID, no-value rows last. One helper (`ranking.py`) serves both videos and channels. A feature ranks by its percentile (for a channel, the mean percentile shown in its tile).
- **Requests cost the same however large the dataset grows** _(human decision, 2026-10-27: the home page's numbers waited on requests that built a row for each of the 16k videos to return 3, and the dataset keeps growing)_:
  - **The default view is ready-made:** with the load, each criterion's order is also kept for the unfiltered view (every video now, no category, no search, no `asOf`), with its values. A request for it (the home card, the rankings page as it opens) just slices, read backwards for `asc`, and builds only the rows it returns; each row's rank is a binary search on the values (equal values share the first one's rank, in either order).
  - **The pill's count is looked up, not scanned:** an `addedFrom`/`addedBefore` filter on that view counts its rows from a list of the videos' add times sorted with the load (binary search), and finds its page by walking the ready-made order until it has enough rows.
  - **Other requests** (category, search, `asOf`) still filter every row, but keep the shared rows rather than building one per row, and rank only the page they return the same way.
  - Answers are unchanged (same items, ranks, totals); the existing tests stay as they are, plus tests that the ready-made path and the filtering path agree for every criterion, both orders, with ties and no-value rows.
- Search: compare `casefold()` + accents removed (NFKD, combining marks dropped) + runs of whitespace as one space, precomputed per row. A `q` equal to a row's ID (case kept) also matches it.
- Tests (synthetic fixture): each criterion's order and tie-break; equal values share a rank, also in `asc`; `asc` is the reverse; no-value rows last and unranked in both orders; category filter for videos, and channels with ≥ 1 video in the category; search ignores case, accents and repeated spaces, keeps ranks, and matches a video's channel name; `offset`/`limit`/`total`; `minVideos`; bad params → 422.

## Steps

Order: the frontend first (steps 2–5, on mock data) and a review of it; then the backend (step 1) and the review against it _(human decision)_.

1. **Backend.** Dataset fields, pre-sorted orders, the extended endpoints, the category keys, tests. Update `backend/README.md` if it lists the endpoints.
2. **API client + mocks.** New params and types; the home card moves to `sort`/`order`; mocks with made-up names: enough rows for many pages, all categories, counts of 0 and missing values, accented names.
3. **Shared pieces.** `ScoreCell`; `Pagination` (page window helper tested: 1 … 4 5 [6] 7 8 … 655); the URL state helper (parse with fallbacks, serialize without defaults; tested); `STYLE.md` entries; `kid_blocks_2` in `used.json`.
4. **Page.** `/rankings` (`useSearchParams` inside `Suspense`, as on `/channel`) with the table, cards, controls, and all states; the home card's link carries the view.
5. **Tests.** Header click sorts and the second click flips (`aria-sort`); rank by select + order button below `lg`; view switch keeps search/category/criterion and resets the page; search debounce, page reset, and the replace-vs-push history rule; category chips/select; paging moves focus to the results line; stale responses ignored; cell colours follow `filledSegments`; empty cells read their reason; each state renders.
6. **Review.** Screenshots at 360 and 1280 px (plus 320, 768, 1024, 1920, keyboard-only) next to the home card, compared with `STYLE.md`; run against the real backend (search speed, last page). Stop for review.
7. **Links in the search** (2026-10-17, with plan 008 step 6).
   - Backend: `q` matches an exact ID; tests (video ID, channel ID, keeps the rank, respects the category).
   - Frontend: `SearchBox` reads the input with `readSearchInput`; a link goes to the URL as its ID; a handle link is looked up on paste or Enter; the link messages; the new placeholders. Mocks and tests (each link kind and message, the lookup only on paste or Enter).
   - Screenshots at 360 and 1280 px against the real backend. Stop for review.
8. **Speed** (2026-10-27, with plan 013's garbage collection change): the ready-made default view, the add-time count, and the leaner filtering path (Backend). Tests as there. Measure before and after: the home page's six requests alone and together, and a rankings search. Stop for review.
9. **Sticky column names** (2026-10-30). The header's column-name row sticks (see Table header). `STYLE.md` (Rankings table). Tests: E2E at 1280 × 800 that, after scrolling to the last row, the column names are still in view and a sort button still works; Shift+Tab up the rows leaves each focused link below the names; the axe and keyboard checks pass. Screenshots at 1280 px at the top and part-way down, and at 360 px (unchanged). Stop for review.
10. **Safari fixes** (2026-10-30, plan 017). In Safari, every table row opened the last row on the page, as Safari ignores `relative` on a table row. The name's link now covers its cell, and a click elsewhere in the row opens it (`LinkedRow`). The search has no built-in clear button, which narrowed the text and put the filter marks out of line. `STYLE.md` (Tables, Search filters, Browser pitfalls); tests.

## Review decisions

- Layout sketch (`lg`+): the results line no longer names the criterion (see Copy, Results line).
- Layout sketch (`lg`+): the category row ends with the order button, right-aligned (see Decisions, Order button).
- Layout sketch (phone): the view control moved above the search (see Layout, `sm`–`md`).
- Layout sketch (phone): the category and "Rank by" selects side by side (see Layout, < `sm`).
- Layout sketches (2026-11-09): the intro and order button read “stimulating” (see Copy).
- Layout sketch (phone): the order button replaces the segmented order control that was planned under “Rank by” (see Decisions, Order button).

## Open questions

None.
