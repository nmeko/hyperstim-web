# 008 — Compare page

**Area:** Compare page (`/compare`). The "Compare with…" links on the video and channel pages are recorded in plans 004 and 005.

**Status:** built, in review (2026-10-16). Change planned (2026-11-11): neutral A/B badges (no side colours). Change planned (2026-10-17): channel links only in the channel field, found channels offered by name, thumbnails in the video suggestions, and clearer field text (step 6).

## Goal

Build `/compare`: two videos, or two channels, side by side, showing **where they differ**. It shows no verdict and takes no votes. The page answers one question: "How different is the production of these two?" Everything else stays on the detail pages, which the compare page links to. The page itself needs no backend changes; channel links (proposed) add one lookup endpoint.

## Decisions

- **Scope.** The page, its picker, and the "Compare with…" links. Not in scope: comparing a video with a channel _(human decision)_, more than two items, comparing from the rankings rows, and any vote or "guess which" game _(human decision)_.
- **No voting, no stored input.** Nothing the visitor does on this page is sent anywhere except the reads below. So we need no database, can't get too few votes to mean anything, and can't have the results skewed on purpose _(human decision)_.
- **Videos or channels**, switched with the segmented control, as on the rankings page. Videos are the default. Switching clears both slots, since IDs don't carry over.
- **Two slots, A and B, told apart by their letter, not by colour** _(human decision, 2026-11-11: the coral/blue coding is dropped)_. Each slot, headline and table column carries an "A" or "B" badge: a white circle with a solid navy ring (the letter's own colour) and the bold navy letter, as the blog's clip comparison marks its videos (plan 018) _(human decision, 2026-11-11)_; at the top of a slot as large as the × beside it _(human decision)_.
- **"vs." between the two slots** _(human decision)_, in grey body text like the intro _(human decision)_, also while picking: centred between the two items once both are in, level with the fields while picking, and between the stacked pickers on phones.
- **The picker: one field per empty slot** that takes both kinds of input, so visitors never need to know what's in our dataset:
  - **Typing a name** lists matches from the dataset as they type (300 ms debounce). The list shows about 6 at a time and **scrolls** _(human decision, 2026-10-16)_; more load as it nears the end (20 per request, `offset` paging), so typing stays fast however many match. Arrow keys move through what's loaded and load more at the end. For videos it shows the thumbnail (`mq`, 64 × 36 px, 48 × 27 px with a 2-line title below `sm`, lazy-loaded, from our backend as everywhere, plan 009) in front of the title and channel _(human decision, 2026-10-17)_, or the placeholder if it can't load (plan 009, Thumbnails) _(human decision, 2026-11-02)_ (a picked video's slot and the chart popover add the line about the video, plan 009); the "Use this video" option has none. For channels, the name and "{N} videos". No scores in the list _(human decision)_. It's an ARIA combobox with a listbox: arrow keys, Enter, Escape. No library.
  - **Pasting a YouTube link or ID** (videos only) offers that video as the first option, "Use this video". If the video is in the dataset or was checked before, it loads straight away. Otherwise the live check starts in that slot (see **Live check in a slot**).
  - **No match:** "No videos in our dataset match “{q}”. Paste a YouTube link to check any video." For channels: "No channels in our dataset match “{q}”."
  - **The field says which links it takes** _(human decision, 2026-10-17: "YouTube link" didn't say whether a video or a channel link)_: a video link in the video field, a channel link in the channel field (see **Copy**).
  - **A channel link in video mode:** "That’s a channel link. Switch to Channels to compare channels." In channel mode, channel links are looked up (see **Channel links**).
  - **The other slot's item is left out** of the suggestions; pasting its link says “That video is already in the other slot.” A URL with the same ID twice keeps only A.
  - **Search fails:** “We couldn’t search right now. Please try again in a moment.”
- **Channel links in the channel picker** _(human decision, 2026-10-16)_. The channel field also takes channel links:
  - **Channel links:** `youtube.com/channel/UC…`, `youtube.com/@handle`, and the older `/c/…` and `/user/…` forms.
  - **No video links** _(human decision, 2026-10-17: pasting a video and getting its channel's comparison is confusing)_. A video link says: “That’s a video link. To compare channels, paste a channel’s link or type its name.” No option is offered. A bare 11-character text stays a name search here, since channel names can look like IDs. A link that is neither: “That doesn’t look like a YouTube channel link.”
  - **The channel is looked up first, and offered by its name** _(human decision, 2026-10-17: "Use this channel's link" didn't say which channel)_. A pasted link is looked up at once; a typed one when Enter is pressed (until then the list says “Press Enter to look up this channel.”), since a handle lookup may ask YouTube and counts toward the per-IP limit. While it runs: “Looking up this channel…” under the field (usually under a second, a few seconds when YouTube has to be asked).
  - **In our dataset:** the channel is offered as the one option, as a search result looks: its name and "{N} videos". Picking it fills the slot.
  - **Not in our dataset:** the field stays, with the message “{Channel name} isn’t in our dataset yet. Checking a whole channel is coming soon. For now, pick a channel from our dataset.” The name is shown when the lookup found it; otherwise it says “This channel”.
  - **Can't be found** (removed, private, not a channel): “We couldn’t find a YouTube channel for that link.”
- **Searching channels** lists every channel that has a channel page (`minVideos=1`), as the rankings now do too _(2026-10-28, plan 013)_, because a parent may look for a small channel. Its score still averages fewer videos, as on its own page.
- **Where people usually start: from a detail page.** The video page gets a "Compare with another video →" text link and the channel page a "Compare with another channel →" link. Each opens `/compare` with A filled, so only B is left to pick. On the video page the link shares the channel name's line (its own line on phones), which keeps it clear of the kid peeking over the score panel. On the channel page it follows "View on YouTube ↗".
- **A filled slot** shows a compact header:
  - Video: its preview (`YouTubePlayer`), the title (3 lines at most) as a link to the video's page, and the channel.
  - Channel: the name as a link to the channel's page, and its meta line as on the channel page ("{29} videos in our dataset · 2018–2026"). No separate "details →" links _(human decision)_.
  - Each has its badge at the top left and a **× button at the top right** ("Remove video A") that empties the slot, with focus in its field _(human decision)_. No "Change" button. When both slots are filled, the headers sit side by side at every width, so the two stay in view together. Empty slots (pickers) are stacked below `md`.
- **One sound at a time.** Both previews can be played, but when one starts, the other pauses. This uses the YouTube embed's message API (`enablejsapi=1`): the player reports its state, and the page sends `pauseVideo` to the other one. No script is loaded from YouTube. `YouTubePlayer` gains an optional `onPlay` callback and a `pause()` handle. The video and channel pages don't use them.
- **What a comparison shows,** in this order, once both slots are filled:
  1. **Summary:** one sentence.
     - Videos: “[B] is more stimulating overall: 41 vs 82.” A's score always comes first, like the table's columns _(human decision)_. Within 5 points _(human decision)_: “[A] and [B] are about as stimulating as each other: 52 vs 49.” _(human decision, 2026-11-09: “stimulating”, not “intense” or “calm”)_
     - Channels: “[B]’s videos are more stimulating on average: …”
     - [A]/[B] are the badges, followed by the name in sr-only text. No good/bad wording (plan 006).
  2. **The biggest differences, in words** _(human decision)_ (instead of a long list of bars, _human decision: too long to read_): under the summary, at most **two** lines, for the measurements whose values differ most, and only by **20 points or more**. Each says what the higher side does more, in plain words, with the two values: “[A] cuts to a new shot more often: 99 vs 0.” Values are always the 0–100 values the table shows _(human decision)_: mixing units and 0–100 values was hard to read. **A's value always comes first** (“[B] is louder: 21 vs 77”), not the higher one _(human decision)_: swapping the order made the numbers hard to read. With no difference of 20+: “Their 12 measurements are all within 20 points of each other.”
     - A count of 0 is a 0 like any other value (plan 004) _(human decision, 2026-10-16)_: “99 vs 0” is a big difference. A side without a value ("No cuts", "No sound", "Not measured") has no difference to compare.
  3. **Every measurement in a table** _(human decision)_: Overall, then the 12 in their three groups (group names as small row headers), one column per side headed by its badge. **From `lg`, two columns** _(human decision)_, like the video page: Overall and Pacing intensification on the left, the other two groups on the right; stacked below `lg`. **The headline measurements' rows are highlighted** (butter background) _(human decision)_, so it's clear where to look. Each value is a score cell, as in the rankings. A side without a value shows its reason ("No cuts", "No sound", "Not measured") in muted text, as on the video page, with no note explaining it _(human decision)_. The info button next to each name explains it and gives both raw values where there is a unit (“A: 30.3 cuts per minute”). No “Biggest differences first” note _(human decision)_.
  4. **Channels only — Over the years:** both channels on **one chart**: dots and a trend line per channel, with the measurement picker (Overall + the 12) above it, as on the channel page. This is the one thing two channel pages can't show: how the two changed over time, and how widely each channel's videos spread. Hovering a dot shows the same popover as on the channel page. There are no hanging thumbnails, video panel or strip; a dot links to its video's page. Below `sm` the chart stays (it scales). The sr-only table holds both channels' values.
- **Chart colours: both channels in navy** _(human decision, 2026-11-11: no side colours, as for the badges)_: white dots with a navy outline and navy trend lines. A's trend line is solid and B's dashed, and A's videos are circles and B's squares, so the shapes tell the two apart. The `side-a`/`side-b` tokens and their strong shades are removed.
- **Live check in a slot.** `LiveAnalysis` gains a compact form: the step list and progress bar inside the slot, without the kid. A failure shows its message in the slot; × empties it. The other slot stays usable meanwhile. The comparison appears once both are scored.
- **State in the URL:** `/compare?a={id}&b={id}`, with channels as `/compare?view=channels&a=…&b=…`. Defaults are left out. Filling or changing a slot adds a history entry, so links can be shared and Back works. An invalid or unknown ID shows a message in that slot ("We couldn’t find this video."); × empties it. A video ID not in the dataset still starts the live check, as on the video page.
- **The kid: `kid_compare`** _(human decision)_: sitting cross-legged, a coral card in one hand and a blue card in the other, looking between them. The art stays as is now that the sides have no colours _(human decision, 2026-11-11)_. It sits on the card's top edge at the right of the H1 row, hidden below `md`, **as large as the home page's kid** (same head size by face width: 232 / 264 / 312 px wide at `md` / `lg` / `xl`, see 001) _(human decision, 2026-11-10: sized by eye distance, its head was larger than the home kid's; then fine-tuned by eye against it)_. The right padding that keeps the text clear grows with it at `md`. It's taller than the H1 and intro, so it rises above them rather than pushing the H1 down; the H1 stays level with the other pages'. The Videos/Channels control sits under the intro, so the kid has the row's right end (as on the rankings page).
- **Reuse:** page container, section card, message box, search input, segmented control, chips/select (via `MeasurementPicker`), outlined button, text link, `InfoTip` (`STYLE.md`); `parseVideoInput`, `featureDisplay`, `formatValue`, `FEATURE_INFO`; `getVideo`, `getChannel`, `getVideos`/`getChannels` with `q`; `LiveAnalysis`; the channel chart's scales, year axis and trend helpers (`chart.ts`).
  - New: `ComparePage`, `Picker` (combobox), `Slot`, `Comparison` (summary, headlines, table), `CompareChart`.
  - `TimeChart` keeps its look. Its scales and axis move into shared pieces (`timeScale` in `chart.ts`, `ChartGrid`/`TimeAxis` in `ChartAxes.tsx`), and `CompareChart` is a second, smaller chart on them (two series, no thumbnails), since the channel page's thumbnail and panel logic doesn't fit two channels.
  - The measurement info popover (`FeatureTip`) moves out of the measurement table, for the compare table too.
- **New styles go into `STYLE.md` in the same change:** the A/B badge, the compare slot, the combobox listbox, the comparison (headlines and table), and the two-series chart.

## Design

### Layout

DOM order: H1 + intro → view control → slot A → “vs.” → slot B → summary → headlines → table → (channels) over the years → footer.

| Width | Layout |
|---|---|
| `lg`+ | H1, intro and the Videos/Channels control under it, top left; the kid on the card's top edge at the right. One section card holds the two slots in two equal columns with “vs.” between them. Under them, in the same card, the summary and headlines, then the two tables side by side (`max-w-5xl`, centred). Channels: an "Over the years" section card below. |
| `md`–`lg` | Same, with narrower columns. |
| < `md` | Empty slots (pickers) stacked, with “vs.” between them. Filled slots side by side in two narrow columns with a narrow “vs.”: badge and ×, preview, title (3 lines). The summary, headlines and table run full width; long measurement names wrap. |

**Desktop (1280 px), two videos**

```
┌────────────────────────────────────────────────────────────────────────────────────────────┐
│ HyperStim?                                      Home  Rankings  Compare  How it works  About │
├────────────────────────────────────────────────────────────────────────────────────────────┤
│  Compare                                                                                   │
│  Put two videos side by side and see where their production differs.     {kid, two cards} │
│  ( Videos | Channels )                                                    {sits on edge}  │
│  ╭─ card ──────────────────────────────────────────────────────────────────────────────╮  │
│  │  (A)                            ×           (B)                            ×         │  │
│  │  ┌───────────────────────────────┐          ┌───────────────────────────────┐        │  │
│  │  │ ▶ preview                     │   vs.    │ ▶ preview                     │        │  │
│  │  └───────────────────────────────┘          └───────────────────────────────┘        │  │
│  │  Super Fast Toy Party (link)                Quiet Garden Walk (link)                 │  │
│  │  Wheelie Friends TV                         Little Leaf                              │  │
│  │ ──────────────────────────────────────────────────────────────────────────────────── │  │
│  │            (A) is more stimulating overall: 82 vs 41.                               │  │
│  │            (A) cuts to a new shot more often: 88 vs 35.                              │  │
│  │            (A) has more sudden loud moments: 80 vs 0.                                │  │
│  │                                                                                      │  │
│  │                         (A)   (B)                              (A)   (B)             │  │
│  │  Overall               [82]  [41]       Sustained sensory intensity                  │  │
│  │  Pacing intensification                 Visual intensity (i)  [40]  [3]              │  │
│  │ ░Rapid cutting (i)     [88]  [35]░      …                                            │  │
│  │  Scene discontinuity   [60]  No cuts    Reward patterning                            │  │
│  │  …                                      …                                            │  │
│  │  (░ = highlighted headline row)                                                      │  │
│  ╰──────────────────────────────────────────────────────────────────────────────────────╯  │
└────────────────────────────────────────────────────────────────────────────────────────────┘
```

**Desktop, picking B** (A filled from the video page's link)

```
│  │  (A) Super Fast Toy Party …               (B)                                       │  │
│  │  [preview, title, channel]                Video or channel name, or a YouTube link  │  │
│  │                                           ( 🔍 bluey                             )  │  │
│  │                                           ┌───────────────────────────────────────┐ │  │
│  │                                     vs.   │ Bluey Dance Mode                      │ │  │
│  │                                           │ Ludo Studio                           │ │  │
│  │                                           └───────────────────────────────────────┘ │  │
│  │                                           Search our dataset, or paste a link to     │  │
│  │                                           check any video.                           │  │
```

**Phone (360 px), two videos**

```
┌──────────────────────────────┐
│ HyperStim?               ☰   │
├──────────────────────────────┤
│ Compare                      │
│ Put two videos side by side… │
│ ( Videos | Channels )        │
│ ╭─ card ───────────────────╮ │
│ │ (A)      ×   (B)      ×  │ │
│ │ [preview] vs. [preview]  │ │
│ │ Super Fast   Quiet       │ │
│ │ Toy Party    Garden Walk │ │
│ │ ──────────────────────── │ │
│ │ (A) is more stimulating  │ │
│ │ overall: 82 vs 41.       │ │
│ │ (A) cuts to a new shot   │ │
│ │ more often: 88 vs 35.    │ │
│ │              (A)   (B)   │ │
│ │ Overall      [82]  [41]  │ │
│ │ Rapid        [88]  [35]  │ │
│ │ cutting (i)              │ │
│ │ …                        │ │
│ ╰──────────────────────────╯ │
└──────────────────────────────┘
```

**Channels:** the same card, with channel headers. Below it is a second section card, "Over the years": the measurement picker, then one chart with A's dots and solid line and B's dots and dashed line, and a small legend: (A) {name} ── (B) {name} - - .

### States

- **Nothing picked:** two empty pickers, and under the card a muted line: “Not sure where to start? [Browse the rankings →](/rankings)”.
- **One picked:** that slot's header and the other slot's picker. No summary yet.
- **Loading a slot:** a skeleton header in that slot (`aria-busy`).
- **Live check in a slot:** the compact step list + bar. Screen readers hear step changes, as on the video page.
- **Slot error** (unknown ID, failed check, network): a message in the slot with "Try again" (network only); × empties the slot.
- **Search loading:** the list keeps its last results, dimmed. Older responses are ignored, as in rankings.

### Copy

| Where | Text |
|---|---|
| `<title>` | Compare - HyperStim? · once both are loaded: {A} vs {B} - HyperStim? |
| Meta description | Is one kids’ video or channel more overstimulating than another? Put two side by side and see how their scene changes, colors, and sounds differ. _(human decision, 2026-10-29; plan 011, Page descriptions)_ |
| H1 | Compare |
| Intro | Videos: Put two videos side by side and see where their production differs. · Channels: Put two channels side by side and see where their production differs. |
| View control `aria-label` | Compare · Videos · Channels |
| Slot heading (sr-only H2) | Video A / Video B · Channel A / Channel B |
| Picker label | Videos: Video name or video link · Channels: Channel name or channel link |
| Picker placeholder | Title, channel, or video link… · Channel name or link… |
| Picker hint | Videos: Search our dataset, or paste a YouTube video link to check any video. · Channels: Search our dataset, or paste a YouTube channel link. |
| Link option | Use this video: {ID} · Channels: {Channel name} / {N} videos |
| Typed channel link (in the list) | Press Enter to look up this channel. |
| Channel lookup (under the field) | Looking up this channel… · {Name} isn’t in our dataset yet. Checking a whole channel is coming soon. For now, pick a channel from our dataset. · We couldn’t find a YouTube channel for that link. · You’ve looked up or checked several new videos and channels in the last hour. Please try again later, or pick a channel from our dataset. · We couldn’t look up that link. Please try again in a moment. · That channel is already in the other slot. |
| Loading more (in the list) | Loading more… |
| No match | No videos in our dataset match “{q}”. Paste a YouTube video link to check any video. · No channels in our dataset match “{q}”. You can also paste a channel’s link. |
| Channel link in video mode | That’s a channel link. Switch to Channels to compare channels. |
| Video link in channel mode | That’s a video link. To compare channels, paste a channel’s link or type its name. |
| Invalid link | That doesn’t look like a YouTube link or video ID. (as the check field) · Channels: That doesn’t look like a YouTube channel link. |
| Suggestions count (sr-only, live) | {20} suggestions(, more as you scroll) |
| Slot button | × (`aria-label` “Remove video A”) |
| Between the slots (`aria-hidden`) | vs. |
| Already picked | That video is already in the other slot. |
| Search error | We couldn’t search right now. Please try again in a moment. |
| Slot errors | We couldn’t find this video. · We couldn’t find this channel. · We couldn’t load this video. Try again |
| Summary, videos | [A] is more stimulating overall: {82} vs {41}. ([B] …: {A’s} vs {B’s}.) · [A] and [B] are about as stimulating as each other: {52} vs {49}. _(human decision, 2026-11-09: “stimulating”, not “intense” or “calm”)_ |
| Summary, channels | [A]’s videos are more stimulating on average: {82} vs {41}. · [A] and [B]’s videos are about as stimulating as each other: {52} vs {49}. _(human decision, 2026-11-09: “stimulating”, not “intense” or “calm”)_ |
| Headline | [A] cuts to a new shot more often: {99} vs {0}. (channels: [A]’s videos cut …) · none: Their 12 measurements are all within 20 points of each other. |
| Table caption (sr-only) | Every measurement: {A} (A) and {B} (B), 0–100 |
| Info popover extra | A: {30.3 cuts per minute} · B: {0 cuts per minute} |
| Channels section H2 | Over the years |
| Chart legend | (A) {name} · (B) {name} |
| Nothing picked | Not sure where to start? Browse the rankings → |
| Video page link | Compare with another video → |
| Channel page link | Compare with another channel → |

## API contract

No changes. The page uses:

```
GET /api/videos?q=<text>&sort=score&order=desc&offset=<n>&limit=20                picker suggestions (videos)
GET /api/channels?q=<text>&sort=score&order=desc&minVideos=1&offset=<n>&limit=20   picker suggestions (channels)
GET /api/videos/{id}       a filled video slot (dataset or live-checked)
POST/GET /api/analyses/{id} live check in a slot
GET /api/channels/{id}     a filled channel slot (includes its videos for the chart)
```

Channel links _(human decision, 2026-10-16)_:

```
GET /api/channel-lookup?url=<YouTube channel link>
  → 200 { channelId, name: string | null, inDataset: boolean,
          videoCount: number }   // its videos in the dataset, 0 if not in it (the option's "{N} videos"; plan 007's 5-video rule)
  → 404  no channel found for the link (removed, private, unknown handle)
  → 422  not a YouTube channel link (video links included, human decision, 2026-10-17)
  → 429  too many lookups from this IP address
```

- Fast path, no YouTube request: a `/channel/UC…` link (`inDataset` from the dataset; `name` from the dataset, else null).
- Otherwise the backend asks YouTube through yt-dlp, as the live check's look-up step does (a handle, `/c/` or `/user/`). Results are cached in memory for a day. **A lookup that asks YouTube counts toward the live check's per-IP limit** (`ANALYSIS_LIMIT_PER_IP`, plan 004), sharing its count _(human decision, 2026-10-16)_; fast paths don't count. Over the limit: 429, and the field says “You’ve looked up or checked several new videos and channels in the last hour. Please try again later, or pick a channel from our dataset.”

Suggestions come in score order, not by closeness of match. The list is short and ranked by Overall, as on the rankings page.

## Steps

The frontend is built against mock data, then reviewed. There is no backend step.

1. **Shared pieces.**
   - `YouTubePlayer`: `onPlay` and `pause()` via the embed's message API.
   - `LiveAnalysis`: compact form.
   - Chart helpers needed by both charts move into `chart.ts`.
   - `STYLE.md` entries.
2. **Picker.** `ComparePicker`: debounced search, link/ID detection, the combobox keyboard pattern, leaving out the other slot's item, the no-match and wrong-kind messages.
3. **Page.**
   - `/compare` (`useSearchParams` inside `Suspense`) with the URL state helper (parse with fallbacks, serialize without defaults; tested).
   - Slots, summary, headlines, table, `CompareChart`, all states.
   - The "Compare with…" links on the video and channel pages.
4. **Tests.**
   - URL state and history.
   - View switch clears the slots.
   - Picker: debounce, keyboard, link option, live check start, other item excluded.
   - Summary wording, including the 5-point "about as stimulating" rule.
   - Headlines: at most two, 20+ points, the higher side, 0–100 values; their rows highlighted.
   - Only one player plays (message API mocked).
   - Chart: two series, sr-only table.
   - Every state renders.
5. **Review.**
   - Screenshots at 360 and 1280 px, plus 320, 768 and 1920 px, next to the video and channel pages, compared with `STYLE.md`.
   - Keyboard-only pass through the picker.
   - Two real previews: playing one pauses the other.
   - A run against the real backend, including a live check in slot B.
   - Stop for review.
6. **Channel links only** (2026-10-17).
   - Backend: `parse_link` takes channel links only; a video link → 422. The video fast path goes (`_known_video`, the lookup's use of the analyzer). Tests and `backend/README.md` updated.
   - Picker: a video link or ID in channel mode shows the video-link message and offers no option; the new label, placeholder and hint. Mock and tests updated.
   - Picker: a channel link is looked up on paste or Enter and offered by its name and video count (tests: paste looks up, typing doesn't, Enter does; the option fills the slot).
   - Picker: thumbnails in the video suggestions. `STYLE.md`'s compare picker entry gains the thumbnail (`w-16 aspect-video rounded object-cover`, `bg-navy/10` while loading or missing, `aria-hidden`/empty `alt`, `gap-3` to the text). Screenshot at 320 px too, where titles get the least room.
   - The link helpers move into `lib/youtube.ts` as one `readSearchInput` (a name, a video ID, a channel ID, a channel page link, or a link we can't use), shared with the rankings search (plan 007). The lookup's messages move to `lib/lookup-text.ts`, shared too.
   - Backend: the lookup returns `videoCount`.
   - Screenshots of both fields at 360 and 1280 px. Stop for review.
7. **Safari and touch fixes** (2026-10-30, plan 017). The compare table's info popovers opened about a screen away from their button in Safari: the `th`, not the row, is `relative` now. A chart dot's popover goes when a finger leaves it too, so a scroll that starts on a dot leaves none behind. The picker's list is at most `40svh` tall, so the iPhone keyboard doesn't hide its lower options. `STYLE.md` (Compare table, Two-channel chart, Compare picker); tests.
8. **Over the years: thumbnails, taps, and the suggestion list above the keyboard** (2026-10-30). Prototyped in a scratch copy and reviewed with screenshots, then built.
   - **Thumbnails under the chart** _(human decision, 2026-10-30: as on the channel page)_: from `sm`, each video's thumbnail hangs from its date under the axis, as on the channel page (same size, fanned stacks, the hovered or opened one standing out). A's thumbnails in the first group and B's in the second _(human decision, 2026-10-30)_, each led by its A/B badge in the y labels' gutter. The thumbnails start right of that gutter. The lines from the dates are in each side's strong shade at 35 %, the opened one solid, so B's lines can be told apart where they pass behind A's group. Thumbnails are buttons, so keyboards reach every video.
   - **Mouse vs touch** _(human decision, 2026-10-30: holding a finger on a dot isn't practical and hides the text)_: only a mouse gets the hover popover. A tap or a click on a dot or thumbnail opens the video below the chart, out from under the finger, and marks its dot, which stays marked:
     - from `sm` (desktops, iPads): in the channel page's video panel (`VideoPanel`, with the side's badge and channel name above the title), with the preview to play it. Also for a mouse click, which until now opened the video's page _(human decision, 2026-10-30)_;
     - on phones: a small card right under the chart (`PickedVideo`: badge and channel, title linking to the video's page, date, value, ×), scrolled into view only if it's below the screen _(human decision, 2026-10-30: rather than the channel page's popover and strip of cards)_.
     - Another tap replaces it; × closes it.
     - **Hold to spread** _(human decision, 2026-10-30: option f of the demos on the review page)_, on touch screens at every width: a finger held still on the chart for 330 ms (moving less than 8 px) takes over from page scrolling. The dots within 46 px of the finger spread apart (a fisheye: distance × 3.6 / (2.6 × distance / 46 + 1)) and grow up to 1.9×. Every other dot and both trend lines fade to 30 %. The dot nearest the finger (within 16 px, after spreading) is the one that will open: it grows 2 px more, gets the guide line, and the white popover shows it, always above it so the finger doesn't cover it. Sliding updates all of this; lifting opens that video as a tap does (nothing when no dot is near). A finger that moves before 330 ms scrolls the page as usual, and a quick tap stays a tap. No hint text _(human decision, 2026-10-30: ask before adding any)_.
     - This replaces plan 017's fix 9, which closed the popover as the finger left the dot.
   - **Suggestion list above the keyboard** _(human decision, 2026-10-30: the first fix didn't help)_: replaces plan 017's `40svh` cap. While the list is open it's as tall as the space between it and the bottom of the visible screen allows (the browser's visual viewport, which shrinks for the on-screen keyboard), less 20 px, at most `21rem` and at least two options. If there's room for fewer than three options as it opens (the field low on the screen), or the field is out of view, the page first scrolls the field to 16 px below the top of what's visible, once, so the field stays in view with the list under it _(human decision, 2026-10-30)_.
   - **Tests:** component tests for the thumbnail groups, for mouse vs touch, for the panel and the card, and for the list's height and the field's move with a smaller visual viewport. E2E: a tap on a dot on a phone shows the card and no popover, and the URL stays; a thumbnail opened by keyboard on desktop shows the panel; on phones, with the visual viewport shrunk by a 291 px keyboard, the list ends above it and the field stays in view. Still to do: a check on a real iPhone, since only a real keyboard shrinks the visual viewport.
   - **Docs:** `STYLE.md` (Two-channel chart, Compare picker, Video panel's label); plan 017's rows 9 and 12.

## Review decisions

- Desktop sketch: the Videos/Channels control moved under the intro, and the kid sits on the card's top edge at the right (see **Decisions**, the kid).
- Desktop, picking and phone sketches: × at each slot's top right, “vs.” between the slots, linked titles, no scores in the suggestions, and the headlines and table in place of the bars (see **Decisions**: "vs.", the picker, a filled slot, what a comparison shows).
- Desktop and phone sketches (2026-11-09): the summary reads “more stimulating” (see **Copy**).
- Desktop and phone sketches: headlines in 0–100 values, the table in two columns from `lg`, the headline rows highlighted (see **Decisions**, what a comparison shows).

## Open questions

None.
