# 004 — Video detail page

**Area:** Video page (`/video`), its endpoint and live analysis.
**Status:** done (2026-10-14). Changes planned 2026-10-26: the player grows when played, the channel name as a pill, the score number centred (steps 10–12); the grow animation, the kid ducking and the player's size (steps 13–14). Changes planned 2026-10-28: the title stays left-aligned while the video plays (steps 15–16).

## Goal

Build `/video?id=<youtube-id>`: one video's stimulation score and its 12 measurements, visible without scrolling, plus the video itself on request. The check-a-video form and the rankings rows on the home page already link here. The backend gets `GET /api/videos/{id}`. A video that isn't in the dataset is analyzed on request with the research pipeline while the page shows the progress, then gets the same result view (see **Live analysis**). _(human decision)_

## Decisions

- **Scope.** The page, the endpoint, a shared YouTube player, live analysis of videos not in the dataset _(human decision)_, and the page's states. Not in scope: the cookie banner, and comparison within the video's category _(human decision)_.
- **Query param, not a path** (`/video?id=…`), as 001 says: a static export can't pre-render pages for videos analyzed later. The page reads the ID on the client.
- **Information hierarchy: the most important information shows without scrolling, and the main thing is the scores** _(human decision)_. People arrive with one question: how stimulating is this video? They already know the video (they pasted its link or clicked its title). So, top to bottom:
  1. Which video this is: title, channel, and the video preview beside them.
  2. The answer: the overall score, and the 12 measurements behind it, in one score panel. **The panel fits above the fold on desktop (1280 × 720) up to its bottom padding** (the larger kid costs ~20 px, see below)**; on phones the gauge does**, the measurements follow right below.
  3. The video plays on request: the preview in the header grows into a large player under the title, in a centred column that fits the screen, and closes back into the preview _(human decision, 2026-10-26: playing in the 1/3 preview was too small, and fullscreen was the only bigger choice)_.
- **Video header: title (smaller, at most 2 lines, longer titles end in “…”) and channel on the left 2/3; the video preview (16:9) on the right 1/3, at every width** _(human decision)_; while the video plays, the player moves under them at the full content width (see **The video**) _(human decision, 2026-10-26)_. No category, published date or length _(human decision)_. No "Watch on YouTube" link _(human decision: the embedded player already links to YouTube)_. A "Compare with another video →" link opens `/compare` with this video as A _(human decision, 2026-10-16, plan 008)_.
- **Channel names are links, on the home page and on this page** _(human decision; overrides plan 002's "Channels … Not linked for now")_, for the channel details page to come. The link is `/channel?id={channelId}` (a query param like `/video`, since that page will be a static export too), keyed by the channel ID because names aren't unique; so `/api/videos` items gain `channelId` and `/api/channels` items gain `id`. Home page: in the Videos view the channel name under each title links to the channel (the rest of the row still opens the video); in the Channels view the whole row links to the channel. Until the channel page exists, these links lead to the site's 404 page. On this page, a video checked live whose channel isn't in the dataset shows the channel name without a link _(human decision: there is no channel page to link to)_; the API says so with `channelInDataset`.
- **Score**, as on the home page: the 0–100 percentile. Shown on a **gauge with an animation** _(human decision)_ (see Design). No sentence under it _(human decision)_; the score's info popover says it is a position in our dataset, not a grade. No rank number (#412 of 16,375): the page is about this one video, and a rank reads like a leaderboard.
- **Measurements = the 12 features, in the research taxonomy's three groups**, as a compact table to the right of the gauge _(human decision)_: name + info "i", percentile number, small meter. What each one measures, and this video's raw value where it has a readable unit, are in the info popover, not visible in the row _(human decision)_. No group subtotals: a group score would be a new summary with no research behind it.
  - Groups: **Pacing intensification** (types 1.1–1.6), **Sustained sensory intensity** (2.1–2.4), **Reward patterning** (3.1–3.2). In two columns: Pacing intensification in one; Sustained sensory intensity above Reward patterning in the other _(human decision)_.
  - Measurement names are the research taxonomy's type names (see **Copy**), in sentence case _(human decision)_.
  - Meters keep 5 cells and the score scale colours _(human decision)_.
  - **A count of 0 shows as 0, with its meter like any other value** _(human decision, 2026-10-16: a real count of 0 is a number, not a missing value, so no "None detected" label)_. The API sends it as percentile 0, not its pool percentile: many videos have no flashes, build-ups or surprise sounds, and with ties at 0 a zero would show as a middling percentile (e.g. 60). Applies to the per-minute features (1.1, 1.3, 1.4, 1.6, 3.1, 3.2). Display only: the score keeps the pool percentiles (`scoring.py`).
  - **No value:** "No cuts" for 1.2 when a video has no cuts (nothing to compare). **Silent clips** (the 7 videos without sound, two titled "No Sound"): the pipeline leaves 1.6 and 2.3 blank, since silence has no loudness and jumps are measured against it; the API sends 1.6 as a count of 0 (no sound, no jumps), and 2.3 shows "No sound" _(human decision, 2026-10-16)_. "Not measured" for any other missing value. No meter for these.
  - Raw values (in the popover) only for features with a plain unit (per minute, share of time). Saturation, brightness, loudness (LUFS) and scene dissimilarity have none: their units mean nothing to parents.
- **Copy limits** (from the research team's guidance): describe what is measured, not effects on children. No claims about addiction, attention, or development; no "good/bad" or "safe/unsafe" wording.
- **No clip-coverage note** ("We measured up to 5 minutes…") **and no cookie note** under the video ("Plays from YouTube, which may set cookies.") _(human decision)_.
- **The video: the preview in the header; a click turns it into a large player under the title, and the shrink button closes it back into the preview** _(human decision, 2026-10-26: was the player in the same spot, too small to watch)_. No player below the score panel _(human decision)_. The preview is a 16:9 box showing the video's YouTube thumbnail with a centred "▶ Play video" button. Clicking swaps in the `youtube-nocookie.com` player and starts it, under the title and channel line; the score panel moves down while it plays, nothing above the player moves. **Size:** the player is centred under the title and its width follows the screen's height, so it never runs to the bottom of the screen and the top of the score panel shows under it; never wider than the content (as wide as the score panel on a tall screen, e.g. 1920 × 1080; about 800 px on 1280 × 800, about 740 px on 1366 × 768), and full width on tablets and phones _(human decision, 2026-10-26: at the full content width the video looked too large on desktop, running to the bottom of the screen; chosen over a fixed 896 px column)_. The title and channel line stay left-aligned where they were and may run the full content width, over the preview's spot; the × is at the channel line's right end _(human decision, 2026-10-28: in the centred column the title jumped right on short, wide screens; chosen over a left-aligned player)_. **Motion:** the thumbnail grows from the preview's spot into the player's (0.45 s), while the score panel slides down; the shrink button plays it backwards, the video shrinking back into the preview's spot while the panel slides up _(human decision, 2026-10-26: the layout jumped at once, so it was hard to follow what happened; chosen over a space opening downward, which didn't show that the preview became the player)_. The thumbnail stays over the player until YouTube's player has loaded, then fades into it, so there's no black box _(human decision, 2026-10-26)_. No motion with `prefers-reduced-motion`. A shrink button (two arrows pointing inward, "Shrink video") closes it _(human decision, 2026-10-28: the channel page's video panel icon; there × closes the whole panel, so × would mean two things)_: the player is removed (so playback stops) and the preview is back in its 1/3 spot with its thumbnail and play button, as before the click _(human decision, 2026-10-26)_. Same at every width. Compared in a review page of five options (today, grow when played, always full width, an overlay, half width); the overlay hid the scores while watching, and an always-full-width video pushed the score off the first screen. The click is the consent 001 asks for, so this works before the cookie banner exists. The thumbnail comes from our backend, which fetches it from YouTube, so YouTube doesn't see the visitor _(human decision, 2026-10-16, plan 009: was loaded from YouTube's image server)_; it loads with the page, since it's at the top. If it can't load, the preview is a plain tile with the Play button (plan 009, Thumbnails) _(human decision, 2026-11-02)_; if YouTube has no thumbnail for it, a footnote says the video may have been removed or made private (under the preview, on phones under the title block) _(human decision, 2026-11-02)_. `YouTubePlayer` component, reused by `/compare`. There it also reports when it starts playing and can be paused, through the embed's message API (`enablejsapi=1`, no script from YouTube), so only one video plays at a time; this page doesn't use that _(human decision, 2026-10-16, plan 008)_. People who prefer YouTube itself use the player's own YouTube link.
- **Score meter becomes a shared component** (`ScoreMeter`), used by the rankings card and the measurement rows (compact size).
- **New styles go into `STYLE.md` in the same change:** `ScoreGauge`, the measurement table, the video preview (Data display / Controls), `ScoreMeter` as the meter's owner, and (live analysis) the progress bar and the step list.
- **Fonts stay as in `STYLE.md`:** the video title, group headings and score number use the handwritten font; only the title's size is reduced _(human decision)_.
- **The kid is the site's recurring character** and appears on every page (a rule in `STYLE.md`) _(human decision)_, from `md` up: below `md` it's hidden on every page (001) _(human decision, 2026-10-16)_. On this page:
  - `kid_3` (peeking over an edge with both hands on it, looking down to the right, smiling; transparent PNG), one image for every video _(human decision)_. A smile/surprised switch (`kidMood`, smile when no measurement is above 90) stays in the code, unused, for when a surprised version of this pose exists.
  - On the score panel's top edge, looking at the measurements _(human decision)_: hands on the border line (the art's table edge, 92.1 % down the image), looking right (no flip). Head about 75 % of the home page kid, keeping close to the fold _(human decision: should look similarly large as the home page's)_: `w-44` at `md`, `w-52` from `lg`; above the right part of the gauge column from `lg`, at the panel's left below that. Hidden below `md` _(human decision, 2026-10-16)_; the head size stays its own, not matched to the hero kids (001). The space above the panel makes room for it from `md` (`md:mt-20 lg:mt-16 xl:mt-10`); below `md` the panel has the page's usual gap under the header. While the video plays, the kid ducks behind the panel's top edge (slides down, cut off at the border line, 0.45 s, with the player's grow), and the panel moves up to the usual gap (`mt-6`) under the player; on × the kid pops back up _(human decision, 2026-10-26: the kid sat between the video and the scores and pushed the scores down; chosen over hiding it at once)_. With reduced motion it is hidden and shown without sliding. Decorative (`alt=""`, `aria-hidden`): the text already says how stimulating the video is.
  - Not shown while loading. While a video is analyzed live, and when that fails: `kid_2` (peeking over a table with a teddy bear).
  - The kid images are RGB with a near-white background (250–255, not transparent), so they sit on white only, never on a pastel panel. On the panel edge the kid uses `mix-blend-multiply`, so the border line shows through the background. A transparent version from the team would be cleaner.
- **No plants on the score panel** _(human decision: the page left too little breathing space)_.
- **The header and content stay in the same place on every page** _(human decision)_. The content width is the same everywhere; what moved was its position: with classic scrollbars (Windows, most Linux, macOS with a mouse), a page that scrolls loses 15 px to the scrollbar, so its centred content sat 7.5 px further left than on a page that doesn't scroll. Fix: `scrollbar-gutter: stable` on `html` (site-wide, `globals.css`). Side effect: on a page that doesn't scroll, the footer's sky background stops 15 px short of the window's right edge.

## Design

### Layout

DOM order at every width: header (metadata, then preview) → score panel (gauge, then measurements) → (footer).

| Width | Layout |
|---|---|
| `lg`+ (≥1024) | Header: title, channel (2/3, top-aligned) · preview (1/3); while playing, title, channel and the player under them in a centred column that fits the screen's height _(human decision, 2026-10-26)_. Kid on the panel's top edge above the gauge column. Score panel: gauge column (13rem with `gap-x-8` below `xl`, 17rem with `gap-x-12` from `xl`; the gauge fills it, vertically centred) · measurements in two columns: Pacing intensification on the left; Sustained sensory intensity above Reward patterning on the right. No dividers _(human decision)_. |
| `md` (768–1023) | Header as above; kid on the panel's top edge at its left. Score panel: gauge (~192 px) centred; the two measurement columns below. |
| < `md` (320–767) | Header as above (the preview's play button shows its icon only); no kid _(human decision, 2026-10-16)_. Score panel: gauge, then the three groups in one column. |

The title is top-aligned so the kid has room under it; the gauge column is 13rem below `xl` so measurement names don't wrap at 1024 px.

Sketches _(human decision)_: not to scale (names shortened only in the phone sketch); made-up title and channel; `▮▮▮▯▯` = compact meter, `(i)` = info button. The live analysis sketch is under **Live analysis → Design**.

**Desktop (1280 px; the score panel is above the fold up to its bottom padding)**

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ HyperStim?                                         Home  Rankings  Compare  How it works  About    │
├────────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                    │
│  Tiny Trucks Race to the Rainbow Bridge!                         ┌───────────────────────────────┐ │
│  ( Wheelie Friends TV )                                          │ [thumbnail] ( ▶ Play video )  │ │
│                                                                  └───────────────────────────────┘ │
│                     {kid →}                                                                        │
│  ╭─ score panel (white card) ──────────────────────────────────────────────────────────────────╮   │
│  │                          Pacing intensification              Sustained sensory intensity    │   │
│  │                                                                                             │   │
│  │    ,-'''''''-.          Rapid cutting (i)        93 ▮▮▮▮▮   Visual intensity (i)    81 ▮▮▮▮▮│   │
│  │  ,'         `.          Scene discontinuity (i)  71 ▮▮▮▮▯   Visual brightness (i)   45 ▮▮▮▯▯│   │
│  │ /      \       \        Palette instability (i)  88 ▮▮▮▮▮   Audio intensity (i)     66 ▮▮▮▮▯│   │
│  │ less     ●     more     Luminance flash (i)      64 ▮▮▮▮▯   Silence elimination (i) 30 ▮▮▯▯▯│   │
│  │     87 / 100 (i)         Motion density (i)       58 ▮▮▮▯▯                                  │   │
│  │                          Loudness jumps (i)       40 ▮▮▯▯▯   Reward patterning              │   │
│  │                                                              Audio build-resolve (i)  0 ▮▯▯▯▯│   │
│  │                                                              Surprise reveals (i)     0 ▮▯▯▯▯│   │
│  ╰─────────────────────────────────────────────────────────────────────────────────────────────╯   │
│                                                                                                    │
├────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ © 2026 HyperStim?                                                    Privacy policy  About us  FAQ │
└────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

After "Play video": the player grows out of the preview into a centred spot under the title, sized to fit the screen's height (on a tall screen as wide as the content, as sketched); the title stays left-aligned at the full width _(human decision, 2026-10-28)_; the kid ducks behind the panel; the shrink button shrinks it back into the preview _(human decision, 2026-10-26; the shrink icon 2026-10-28)_.

```
│  Tiny Trucks Race to the Rainbow Bridge!                                                           │
│  ( Wheelie Friends TV )  Compare with another video →                                        (⤡)   │
│  ┌──────────────────────────────────────────────────────────────────────────────────────────────┐  │
│  │                                                                                              │  │
│  │                              YouTube player (16:9, centred column)                           │  │
│  │                                                                                              │  │
│  └──────────────────────────────────────────────────────────────────────────────────────────────┘  │
│                     {kid →}                                                                        │
│  ╭─ score panel (white card) ─ …                                                                   │
```

**Phone (360 × 640; the gauge is above the fold)**

```
┌──────────────────────────────┐
│ HyperStim?           ☰ Menu  │
├──────────────────────────────┤
│ Tiny Trucks Race   ┌───────┐ │
│ to the Rainbow B…  │  (▶)  │ │
│ (Wheelie Friends…) └───────┘ │
│ ╭─ score panel ────────────╮ │
│ │    ,-'''''''-.           │ │
│ │  ,'    \      `.         │ │
│ │ less    ●     more       │ │
│ │       87 / 100 (i)       │ │
│ │ ──────────────────────── │ │  ← fold
│ │ Pacing intensification   │ │
│ │ Rapid cutting (i) 93 ▮▮▮▮│ │
│ │ Scene discont… (i)71 ▮▮▮▯│ │
│ │ …  (12 rows, 3 groups)   │ │
│ ╰──────────────────────────╯ │
└──────────────────────────────┘
```

### Elements, top to bottom

All surfaces and controls are from `STYLE.md`; new ones are marked **new**.

1. **Video header** (no card): a `grid-cols-[2fr_1fr]` grid, items top-aligned: the text on the left, the video preview (`YouTubePlayer`) on the right. H1 = the video title (`font-hand`, `text-[1.375rem] sm:text-2xl lg:text-[1.75rem]`, no marker, clamped to 2 lines with the full title in the DOM). Under it: channel name as a pale blue pill, the growth pill's look (`rounded-full bg-sky px-3 py-0.5 text-sm font-bold text-navy`, `hover:bg-mint`), a link to the channel page (`/channel?id={channelId}`) _(human decision, 2026-10-26: bold navy was too heavy next to the title and the Compare link; grey alone didn't look clickable, and an underline beside the Compare link's looked too heavy)_. Its 44 px target is the link (`inline-flex min-h-11 items-center`, `sm:-my-2.5` like the Compare link), with the pill inside it. When `channelInDataset` is false: the name as plain text (`text-sm text-ink`, no pill), since a pill reads as something to tap _(human decision, 2026-10-26)_. On the channel's line, after it: "Compare with another video →" (text link, `text-sm`), to `/compare?a={id}`; on its own line below `sm`. It sits on that line so it stays clear of the kid peeking over the panel _(human decision, 2026-10-16, plan 008)_.
2. **Score panel** (section card, white).
   - Panel padding `py-6`; no vertical divider, a gap instead (`gap-x-8` at `lg`, `gap-x-12` from `xl`); a `navy/10` line between gauge and measurements only when stacked.
   - **Gauge column** (**new**: `ScoreGauge`). No visible "Stimulation score" title _(human decision)_: an sr-only H2 "Stimulation score" names the panel; the score `InfoTip` sits after the number, outside its centring: "87 / 100" is centred under the dial and the info button hangs to its right (`absolute left-full`), so a score of 100 doesn't wrap onto a second line in the 192 px column _(human decision, 2026-10-26: "100 / 100" wrapped below `lg`; chosen over no-wrap, a larger dial and a smaller number)_. Same on the channel page, which shares the gauge (plan 005). A half-circle dial (inline SVG, ~192 px wide below `lg`, the full column from `lg`; about 80 % of its first size, to leave more gap between the columns _(human decision)_) split into five bands in the score scale colours (`sky-blue` → `leaf` → `scale-low` → `scale-mid` → `scale-high`, 20 points each), "less stimulating" and "more stimulating" labels, each on two lines ("less" / "stimulating"), centred under its end of the dial (small, ink) _(human decision, 2026-11-09: “stimulating”, not “intense” or “calm”; two lines centred under the ends, since on one line they wrapped or ran into each other below `xl`)_, and a navy needle with a round hub. Under the dial: the score as a large navy `font-hand` number with "/ 100" small after it.
   - **Animation:** on first render the needle sweeps from 0 to the score (~1 s, ease-out) while the number counts up with it. With `prefers-reduced-motion`, both show the final value at once. The SVG is `aria-hidden`; the counting number is `aria-hidden` too, with the final score in sr-only text, so screen readers read one value.
   - **Measurements** (**new**: measurement table). Each group: H3 (`font-hand text-lg text-navy`), then one row per feature, `min-h-11`, lines `navy/10`. Row: name (semibold navy) + `InfoTip`; percentile (bold navy, `tabular-nums`, right-aligned fixed-width column); `ScoreMeter` compact (5 segments, ~4.5 rem wide). A count of 0 is a "0" with its meter _(human decision, 2026-10-16)_. "No cuts" / "No sound" / "Not measured" in muted text in place of number + meter. sr-only text on the number: "Higher than {93}% of videos in our dataset". The popover: the description, then this video's value where there is one.
3. **Video preview** (**new**: `YouTubePlayer`), in the header. A 16:9 `rounded-2xl` box, overflow hidden, as wide as its column. Before the click: the thumbnail as `<img alt="">`, a light navy scrim, centred primary button with a play icon; the "Play video" label shows from a 20rem-wide box, a round icon-only button below that. After: the iframe (`title` = video title, `allow="autoplay; encrypted-media; picture-in-picture; fullscreen"`) in a 16:9 `rounded-2xl` box under the title and channel line (`mt-4`), in the centred column (see **The video**: size), focus moved to it once it has grown _(human decision, 2026-10-26)_. The shrink button (`size-11 rounded-full hover:bg-sky`, a navy `size-5` icon of two arrows pointing inward, `aria-label` "Shrink video") _(human decision, 2026-10-28: was the compare slot's ×)_ sits at the right end of the channel line, above the player, so it covers none of YouTube's own controls; on a short, wide screen the player is narrower than the content, so the button is right of its corner _(human decision, 2026-10-28)_. Closing removes the iframe, shows the preview again in its 1/3 spot and moves focus to its play button. While the player is open, the kid has ducked, so the score panel sits at the usual gap (`mt-6`) _(human decision, 2026-10-26)_. On this page the header owns the playing state and passes it to `YouTubePlayer`; the compare page keeps playing in place, and the channel page's video panel owns it too, to grow it the same way (plan 005, 2026-10-28).
4. **States**
   - Loading: skeletons for the thumbnail, the title and the score panel (dial outline, 12 grey rows), `aria-busy`, sr-only loading text. The preview is a grey 16:9 box.
   - No `id` or not a valid ID: message box with the text and a "Check another video" link to `/`.
   - Not in the dataset (404): the page starts a live analysis and shows its progress, then the result (see **Live analysis**) _(human decision)_.
   - Error (network/5xx): message box + "Try again" (outlined button), as on the home page.

### Copy

`{…}` = filled in at runtime. Arrows are decorative (`aria-hidden`). Typographic apostrophes.

**Page metadata**

| Where | Text |
|---|---|
| `<title>` (static, before load) | Video details - HyperStim? |
| `<title>` (after load, set on the client) | {video title} - HyperStim? |
| Meta description | How stimulating is this video? Its score and what we measured. |

**Score panel: gauge**

| Where | Text |
|---|---|
| H2 (sr-only) | Stimulation score |
| Dial end labels | less stimulating · more stimulating (two lines each) _(human decision, 2026-11-09: “stimulating”, not “intense” or “calm”)_ |
| Number | {87} / 100 (sr-only: "Stimulation score {87} out of 100") |
| InfoTip | Score 0–100: where this video’s production sits among the videos in our dataset, not whether it is good or bad. |

**Score panel: measurements**

| Group (H3) |
|---|
| Pacing intensification |
| Sustained sensory intensity |
| Reward patterning |

Descriptions as below _(human decision: they look good)_.

| # | Name | Popover: description | Popover: this video |
|---|---|---|---|
| 1.1 | Rapid cutting | How often the picture switches to a new shot. | {22.6} cuts per minute |
| 1.2 | Scene discontinuity | How different each new shot looks from the one before. | — |
| 1.3 | Palette instability | How often the colors on screen are replaced. | {21.0} per minute |
| 1.4 | Luminance flash | How often the picture suddenly gets brighter. | {1.6} per minute |
| 1.5 | Motion density | How much of the time things on screen move fast. | {21}% of the time |
| 1.6 | Loudness jumps | How often the sound jumps well above its usual level. | {0.3} per minute |
| 2.1 | Visual intensity | How saturated the colors are. | — |
| 2.2 | Visual brightness | How bright the picture is. | — |
| 2.3 | Audio intensity | How loud the sound is overall. | — |
| 2.4 | Silence elimination | How much of the time sound is playing. | Sound {77}% of the time |
| 3.1 | Audio build-resolve | Sound that rises steadily, then drops back. | {0.2} per minute |
| 3.2 | Surprise reveals | Loud sounds that land right on a cut. | {0.2} per minute |

Per-minute values: 1 decimal; shares: whole percent. Info button sr label: "About {name}".

| Where | Text |
|---|---|
| Percentile (sr-only) | Higher than {93}% of videos in our dataset |
| Zero events | 0, with its meter _(human decision, 2026-10-16)_ |
| 1.2 missing | No cuts |
| 2.3 missing (no sound) | No sound _(human decision, 2026-10-16)_ |
| Other missing | Not measured |

**Video**

| Where | Text |
|---|---|
| Button | Play video (sr-only: "Play video: {video title}") |
| iframe `title` | {video title} |

**States**

| Where | Text |
|---|---|
| Loading (sr-only) | Loading video… |
| Invalid / missing ID | That doesn’t look like a YouTube video ID. |
| Not in dataset | See **Live analysis → Copy** |
| Error | We couldn’t load this video. |
| Error button | Try again |

## API contract (frontend `api.ts` ↔ backend)

```
GET /api/videos/{id}
  → {
      id: string, title: string, channelId: string, channel: string,
      score: number,             // 0–100, 1 decimal
      channelInDataset: boolean, // false for a live video from a channel not in the dataset (no link)
      features: [{ key: string, value: number | null, percentile: number | null }]  // the 12, in taxonomy order
    }
  404 → { detail: "Video not found" }
  422 → id not 11 characters of [A-Za-z0-9_-]

GET /api/videos     items gain channelId: string   (channel links, human decision)
GET /api/channels   items gain id: string          (the channel ID; channel links, human decision)
```

`GET /api/videos/{id}` also answers for videos analyzed live (same shape); `/api/meta`, `/api/videos` and `/api/channels` never include them. Live analysis endpoints: see **Live analysis → API**.

`percentile` is the feature's percentile in the dataset (same formula as the score, 1 decimal), `null` when `value` is; a per-minute count of 0 is `0`, and a clip without sound (2.3 `null`) has 1.6 as `value: 0, percentile: 0` _(human decision, 2026-10-16)_. These rules live in the backend (`dataset.py`), so every page and the channel averages and rankings follow them; the frontend only shows "No cuts" / "No sound" / "Not measured" for `null`. Feature names and descriptions are frontend copy keyed by `key`. No category, publication date or length: the page doesn't show them.

## Backend

- `Video` keeps the 12 values and their percentiles (computed at startup from the pools `scoring.py` already builds). A dict by ID for lookup.
- `GET /api/videos/{id}` as above; ID pattern checked by FastAPI (`Path(pattern=…)`).
- CORS allows GET and POST (POST for live analysis).
- Tests (synthetic fixture): found video has all fields and 12 features in order; missing value → `null` value and percentile; unknown ID → 404; malformed ID → 422; feature percentiles match `scoring.percentile_rank`.

## Live analysis

_(human decision: “Check a video” should actually work, by running the download and analysis scripts.)_ Overrides 001's `POST /api/analyze` + `GET /api/analyze/{job_id}` (jobs are keyed by video ID instead) and 001's default proposal that analysis results join the dataset.

### Decisions

- **Starts on its own.** When `GET /api/videos/{id}` says 404, the page starts the analysis (no extra click): the person already asked for this video in the check-a-video form. Starting is idempotent per video ID: a second visitor, a reload, or coming back later to the same link joins the running analysis or gets the stored result. So the link can be closed and reopened.
- **The research pipeline, unchanged.** The backend runs the two scripts in `backend/pipeline/` as subprocesses, exactly as the README's usage shows (one-row manifest, `--workers 1`, no download delays, `derive` with its default thresholds), so live features are measured like the dataset's. Steps for one video:
  1. **Look up**. First YouTube's "made for kids" flag (`status.madeForKids`, YouTube Data API `videos.list`, 1 quota unit, ~0.1 s; yt-dlp doesn't expose it): refuse a video without it, like the dataset's sampling did _(human decision: same filter as the dataset)_. The key is `YOUTUBE_API_KEY`; unset, the check is off and the API logs a warning at startup (local development). Then yt-dlp (metadata only, no download): title, channel, channel ID, duration, live status. Refuse live streams / upcoming premieres and videos shorter than 90 s (the clip starts at 0:30; the old live API used the same minimum). No maximum, and Shorts are not refused, unlike the dataset's 120–3600 s sampling _(human decision: 90 s and up is fine)_.
  2. **Download** the clip (`58_download_clips_v2.py`): 5 minutes from 0:30, 360p. Only that section is fetched (yt-dlp `--download-sections`), so the time doesn't grow with the video's length: ~14 s for videos from 2 minutes to 3 hours (timed 2026-10-14).
  3. **Measure** (`04_extract_features_v2.py extract`, then `derive`): the 12 features. Limited to 4 of the server's cores _(human decision: more cores barely help; timed 2026-10-14 per video: 1 core 32 s, 2 28 s, 4 26 s, 8 26 s, since the motion pass is single-threaded and only ffmpeg's decoding uses more)_.
  4. **Score** against the dataset (below), store, delete the clip and the cache.
- **Never part of the dataset** _(human decision)_. A live video is scored against the dataset's pools (each feature's percentile in the dataset, its composite's percentile among the dataset's composites), the same way `scoring.py` already describes. The pools, the dataset's scores, the rankings and the video count never change. If a video later joins the dataset, its dataset row wins.
- **Stored as plain files, one JSON file per video** (`ANALYSIS_DIR/<video_id>.json`) _(human decision: no SQLite, plain file reads and writes are enough for this lightweight task)_: status, stage times, title, channel, channel ID, the 12 raw features, error, timestamps. Written to a temporary file and renamed into place, so a reader never sees a half-written file. Writes go through one lock (the request that queues a video writes its first state; the analysis thread the rest). Raw values only; percentiles are computed on each read, so they follow the dataset if it is re-imported. No visitor data (no IP, no cookie) is stored.
- **Kept until removed by hand** (delete the file) _(human decision)_; the privacy policy says requested video IDs are stored.
- **One analysis at a time,** in a background thread of the API process; the others wait in a first-in, first-out queue. Queue full (10 waiting) → 503 _(human decision)_. The API must run as a single process (no `--workers`) for this; the README says so.
- **Limits: per IP, plus a site-wide daily cap** _(human decision, 2026-10-17, plan 010: many IPs together could use up the YouTube API quota)_. Site-wide: at most `ANALYSIS_LIMIT_PER_DAY` new analyses (prod 1,000 _(human decision, 2026-10-17: too strict)_) in 24 hours from all visitors together; over it, the same `503 Busy` as a full queue. It's counted from the stored analyses' request times (no IPs), so a restart doesn't reset it. Per IP: 20 new analyses per IP address per hour _(human decision, 2026-10-17: too strict)_; was the old API's 5). The compare page's channel lookups that have to ask YouTube count toward the same limit _(human decision, 2026-10-16)_ (plan 008). No cookies: they wouldn't stop abuse (cleared at will, blocked across sites). The counts live in memory only, for at most an hour, never stored; the privacy policy says so. Requests for a stored or running video don't count. Behind the reverse proxy, uvicorn runs with `--proxy-headers` so the limit sees the visitor's IP (README). Set by `ANALYSIS_LIMIT_PER_IP` (new analyses per hour; `0` = off). Off for local development (`dev.sh`, `.env.example`) _(human decision: so it doesn't interfere with debugging)_.
- **Timeouts:** look-up 1 min, download 15 min (the script tries three YouTube clients, 5 min each), measure 10 min. A timeout fails the analysis.
- **Restart:** at startup the backend reads the folder; analyses that were waiting or running when the API stopped start again from the beginning. The queue itself lives in memory.
- **Failed analyses** stay stored with their reason, so the page can explain; requesting the video again retries it (counts toward the limit).
- **Progress the person can trust** _(human decision: show the status and/or a progress bar so people know what to expect)_. The scripts don't report progress inside one video, and they must stay unchanged, so:
  - The page shows **the steps** (look up, download, measure), with the current one marked; while waiting, the number of videos ahead.
  - A **progress bar** with the time left, estimated from typical step durations: timed on our server and kept as constants (`TYPICAL_S`: look-up 6 s, download 15 s, measure 25 s; a 30-minute video took 4 + 13 + 23 s end to end); each analysis logs its step times for re-timing. Within a step the bar moves with elapsed time but stops at 90 % of the step until the step is really done, and the page shows at most 99 % before the result, so it never claims to be finished early. No "taking longer than usual" note _(human decision: it competed with the time left for space)_.
  - No text on how long it usually takes _(human decision: the bar and the time left give enough information)_.
- **When done,** the page fetches `GET /api/videos/{id}` and shows the normal result view; the gauge animation then plays as the reveal. Nothing on the result says it was a live analysis _(human decision)_.

### API

```
POST /api/analyses/{id}     start (or join) the analysis of a video
  → 202 Analysis   (200 if it is already done or running)
  404 → never; a video in the dataset → 200 { status: "done" }
  422 → malformed ID (same pattern as /api/videos/{id})
  429 → { detail: "Too many requests" }      (ANALYSIS_LIMIT_PER_IP new analyses per IP per hour)
  503 → { detail: "Busy" }                    (queue full)

GET /api/analyses/{id}      poll (the page polls every 2 s)
  → 200 Analysis
  404 → never requested

Analysis = {
  status: "queued" | "lookup" | "download" | "measure" | "done" | "failed",
  queuePosition: number | null,  // videos ahead, while queued
  progress: number,              // 0–1, the estimate above
  remainingS: number | null,     // estimated seconds left; null when queued or done
  error: "unavailable" | "not_for_kids" | "too_short" | "live" | "failed" | null
}
```

`unavailable`: the look-up or download failed (private, removed, age- or region-restricted, or YouTube refused). `not_for_kids`: YouTube doesn't mark it as made for kids. `failed`: measuring failed or timed out, or the Data API couldn't be reached.

### Backend

- `analysis.py`: the queue, worker thread, the JSON file store, the pipeline runs (subprocess, temp folder per video under `ANALYSIS_DIR`, always deleted), and the progress estimate. `scoring.py` gains nothing new: `feature_percentiles` and `percentile_rank` against the existing pools; `Dataset` keeps its sorted composite pool for this.
- New env vars (`.env.example`, README, `dev.sh`): `ANALYSIS_DIR` (the result files + temporary clips; outside the repo or git-ignored), `YTDLP_COOKIES` (optional path to a cookies file for yt-dlp, as the research download uses; never committed), `ANALYSIS_LIMIT_PER_IP` (optional; default 5 when unset, so a server that forgets it is still limited; `0` in `.env.example` and `dev.sh`), `YOUTUBE_API_KEY` (for the made-for-kids check; a secret, never committed; set on the server).
- Tests with the pipeline replaced by a fake runner (no network, no ffmpeg): start → queued → stages → done; idempotent start; queue position; queue full → 503; limit → 429 (stored videos don't count; `0` = off); dataset video → done; too short / live / unavailable / not for kids / failed mapping; restart resumes; the temp folder is deleted after success and failure; a live result through `GET /api/videos/{id}` has percentiles against the dataset pools, and `/api/meta`, rankings and the dataset videos' scores are unchanged. Plus one real end-to-end run by hand during review (not in CI).

### Design

The look of the old "We haven’t checked this video yet" state, now saying the analysis is running _(human decision)_: `kid_2` (decorative, ~280 px wide, hidden below `md` _(human decision, 2026-10-16)_) on the white page just above a message box (sky), centred, `max-w-2xl`. Inside, top to bottom: H1, the steps, the progress bar with the time left. No video title _(human decision: it popped in after the look-up)_; the result page shows it. A compact form, for a compare slot, shows the same steps and bar in a small sky box without the kid and the H1; its failures leave out the check-another links (the slot's × empties it) _(human decision, 2026-10-16, plan 008)_. **New in `STYLE.md`:** the progress bar and the step list (Data display).

```
                  {kid_2 peeking}
╭─ message box (sky) ──────────────────────────────╮
│            Checking this video…                  │
│                                                  │
│      ✓ Looking up the video                      │
│      ● Downloading a 5-minute clip               │
│      ○ Measuring                                 │
│        [██████████░░░░░░░░░░░░░░░░░░░░]          │
│                About 1 min left                  │
╰──────────────────────────────────────────────────╯
```

- Steps: a list; done ✓ (leaf), current ● (navy, bold), next ○ (muted). Icons `aria-hidden`; sr-only "done" / "current" on each.
- Progress bar: `role="progressbar"`, `aria-valuenow` in %, `aria-label` "Analysis progress"; navy fill on a pale navy track (navy at 12 %) _(human decision: the white track hardly showed on the sky box)_, rounded-full, ~12 px high, width animates (none with `prefers-reduced-motion`). The time left sits centred under the bar at every width, so the bar keeps its full width and stays centred _(human decision: beside it, the text shortened the bar and pushed it off-centre)_.
- Screen readers: a polite live region (outside the states, so it stays on the page) announces only step changes and the outcome (done, a failure, a refusal), not every bar tick.
- Queued: the steps all ○, above them "{2} videos ahead of yours."; the bar stays at 0.
- Failed: the same box with the reason, "Check another video →" and "Watch on YouTube ↗"; for `failed` also "Try again" (outlined button).
- Busy (503) / limit (429): the box with the message and "Try again" / "Check another video →". Nothing is stored for a refused request; the page doesn't retry on its own _(human decision)_.
- Lost connection while polling: keep polling quietly; after ~30 s of failures, the error message box with "Try again".

### Copy

| Where | Text |
|---|---|
| H1 | Checking this video… |
| Queued | {2} videos ahead of yours. (1: “1 video ahead of yours.”) |
| Step 1 | Looking up the video |
| Step 2 | Downloading a 5-minute clip |
| Step 3 | Measuring |
| Time left | About {1} min left · Less than a minute left |
| `unavailable` | We couldn’t get this video from YouTube. It may be private, removed, or restricted. |
| `not_for_kids` | YouTube doesn’t list this video as made for kids, so we can’t check it. _(human decision)_ |
| `too_short` | This video is too short to measure: we need at least 90 seconds. |
| `live` | We can’t measure live streams or premieres that haven’t aired yet. |
| `failed` | Something went wrong while measuring this video. |
| 503 | We’re checking a lot of videos right now. Please try again in a few minutes. |
| 429 | You’ve checked several new videos in the last hour. Please try again later. |
| Failed-state links | Check another video → · Watch on YouTube ↗ |
| Live region | Downloading a 5-minute clip · Measuring · Done |

### Mocks

Mock mode gets a mock analysis: an unknown ID runs through the steps in ~12 s, then shows a mock result; `mockVidFail`, `mockNotKids`, `mockVidShrt`, `mockVidLive` and `mockVidErrr` fail as `unavailable`, `not_for_kids`, `too_short`, `live` and `failed`, `mockVidWait` sits in the queue for a few seconds, `mockVidBusy` gets 503 and `mockVid0429` gets 429.

## Steps

1. **Backend.** Endpoint, dataset fields, tests.
2. **API client + mocks.** `getVideo(id)` in `api.ts` (404 surfaces as `ApiError` with status 404); mock details for the mock videos, with one zero-event, one missing-value case, and one mock ID that returns 404.
3. **Shared pieces.** Extract `ScoreMeter` from `RankingsCard` (no visual change) with a compact size; `ScoreGauge`; `YouTubePlayer`; `STYLE.md` entries; add `kid_2` and `kid_3` to `used.json`; the mood rule (`kidMood(features)`) as a small tested function.
4. **Page.** `/video` with all states; `useSearchParams` inside a `Suspense` boundary (needed for static export).
5. **Tests.** Value formatting (per minute, percent), zero-count/missing rules, kid mood rule, gauge needle angle for 0/50/100 and reduced motion, the preview swaps to the iframe on click (and loads nothing from YouTube before), each state renders, title set after load.
6. **Review.** Screenshots at 360 and 1280 px (plus 320, 768, 1920 and keyboard-only check) compared with `STYLE.md`; check the score panel is above the fold at 1280 × 720 and the gauge at 360 × 640; run against the real backend. Stop for review.
7. **Live analysis, backend.** `analysis.py`, endpoints, env vars, tests; time a few real runs on our server to set the typical step durations. README, `.env.example`, `dev.sh`.
8. **Live analysis, frontend.** `startAnalysis(id)` / `getAnalysis(id)` in `api.ts` and mocks; the progress view in `VideoPage` (404 → start → poll → result); `STYLE.md` entries; tests (each step and failure renders, polling stops on done/failed, the bar never reaches 100 % before done, reduced motion, live region text).
9. **Review.** Screenshots of each state at 360 and 1280 px; one real video end to end against the real backend; a second tab joining the same analysis. Stop for review.
10. **Player grows when played, channel pill** (2026-10-26). `YouTubePlayer` takes the playing state from its parent on this page; the header's two layouts; the × button and focus moves; the channel pill; `STYLE.md` (Video header, Video preview); tests (play moves the player under the title, × removes the iframe and brings back the thumbnail with focus on the play button, the channel link renders as a pill, a channel not in the dataset as plain text). No privacy policy change: the same player, loaded only after the click.
11. **Score number** (2026-10-26). The info button outside the number's centring in `ScoreGauge`; `STYLE.md` (Score gauge); a test that the button follows the number.
12. **Review.** Screenshots at 360, 768 and 1280 px, before play and while playing, with scores of 100 and two digits, also on the channel page; keyboard-only play and close. Stop for review.
13. **Grow, kid, size** (2026-10-26). The grow animation (a copy of the thumbnail flying between the two boxes while the real ones are hidden, the score panel sliding with it, none with reduced motion); `YouTubePlayer` keeps the thumbnail over the player until it has loaded; the kid ducking; the centred column; `STYLE.md` (Video header, Video preview, Score panel); tests (focus after grow and shrink, thumbnail cover goes on load, kid ducked while playing).
14. **Review.** Recordings at 360, 768 and 1280 px, screenshots at 1280 × 800, 1366 × 768 and 1920 × 1080 while playing; reduced motion; keyboard-only. Stop for review.
15. **Title stays left while playing** (2026-10-28). The header keeps the full content width while playing: title and channel line left-aligned, the shrink button (replacing ×) at the line's right end, the player centred under them at the screen-fitting width; the grow and the score panel's slide unchanged; `STYLE.md` (Video header); tests (while playing the title's left edge stays where it was, the player is centred, "Shrink video" closes it).
16. **Review.** Recordings at 360, 768 and 1280 px, screenshots at 1280 × 800 and 1920 × 1080 while playing. Stop for review.
17. **Safari and phone fixes** (2026-10-30, plan 017). The player plays inline on iPhone (`playsinline=1`). `PLAYER_WIDTH` uses `svh`, so a playing video doesn't resize as the mobile toolbar hides. The score's info popover draws over the measurement rows below `lg` (`z-10` on its wrapper), and every info popover shifts to stay 16 px inside the screen (it stuck out at 320 px). `STYLE.md` (Video header, Score gauge, Popover); tests.

## Review decisions

Human decisions applied to the sketches, which can't carry an inline mark:

1. **Desktop and phone sketches:** the preview at the top right, the kid on the score panel's top edge, no plants, no video card below the panel (see **Decisions**: video header, the video, the kid, no plants).
2. **"Not checked yet" sketch removed;** the live analysis sketch replaces it (see **Live analysis**).
3. **Live analysis sketch:** no "This usually takes about 2 minutes. You can leave and come back to this link later." under the bar (see **Live analysis → Decisions**: progress).
4. **Live analysis sketch:** no video title under the heading; the time left under the bar, both centred (see **Live analysis → Design**).
5. **Desktop sketch** (2026-10-16): Audio build-resolve and Surprise reveals show "0" with its meter instead of "None detected" (see **Decisions**: a count of 0).
6. **Phone sketch** (2026-10-16): no kid above the score panel (see **Decisions**: the kid).
7. **Desktop sketch** (2026-10-26): the channel name in a pill, and a sketch of the playing state, the player under the title with × at the right (see **Decisions**: the video; **Elements**: video header, video preview).

8. **Desktop sketch** (2026-10-28): the playing state's × is the shrink icon (⤡) (see **Elements**: video preview).
9. **Desktop and phone sketches** (2026-11-09): the dial's end labels read “less” / “more” (short for “less stimulating” / “more stimulating”, on two lines on the page) instead of “calm” / “intense” (see **Elements**: gauge column; **Copy**: dial end labels).

## Open questions

None.
