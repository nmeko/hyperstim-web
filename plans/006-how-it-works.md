# 006 — How it works

**Area:** How it works page (`/how-it-works`).

## Goal

Build `/how-it-works`, a static page that explains to parents, in plain words, how a video gets its score:

- what we measure;
- which videos we compare against and how they were picked;
- what the 0–100 score means.

It ends with **Common questions**, which replaces the planned `/faq` page. No backend.

Two small changes on the video and channel pages come with it: their measurement popovers link here, and their score popovers use the "production style only" wording.

## Decisions

- **Audience: parents, not researchers.** Plain words and short paragraphs. Technical points are explained through everyday comparisons and diagrams, never formulas. Diagrams carry as much of the page as they can, so it reads more like a picture book than a text page.
- **Copy limits** (plan 004, unchanged): describe what is measured, never effects on children. No claims about attention, development or addiction, and no "good/bad" or "safe/unsafe" wording.
- **"Production style only"** _(human decision)_, worded as a positive statement: "We measure production style only. We don't judge a video's content, educational value, or age appropriateness." This replaces wording like "we're not judging whether a video is good or bad for your child". It's an answer under **Common questions**, not a panel of its own _(human decision)_.
- **No video categories on this page** _(human decision)_. Music, stories, gaming and the other kinds aren't mentioned.
- **Common questions at the bottom of this page; no `/faq` page** _(human decision)_. The footer's "FAQ" link pointed to `/how-it-works#questions`; it was dropped since How it works is in the header (plan 015, 2026-10-26). This overrides `/faq` in plans 001 and 002, and the `/faq` route is not built.
- **One page, one pattern** _(human decision: the first build looked scattered)_. Every section is a section card with an H2, at most a one-sentence lead, and **one diagram** _(human decision)_. Text is kept to what the diagrams can't show _(human decision)_.
- **The page follows one video through a check** _(human decision: option A of the restructuring brainstorm; the sections had no clear order and mixed up the live check and the dataset)_. The live check is the main thread, numbered ①–④ in the section titles. The dataset comes in at step ③, where it matters: it's what a video is compared with. Channel scores are a common question _(human decision)_. This replaces the three-step strip, since the sections are now the steps.
- **Sections**, top to bottom:
  1. **Hero:** the H1 alone at the top left, **level with the home page's H1** _(human decision: there was too much space above it)_, the kid on the right, **its top level with the H1's** _(human decision: there was headroom above it)_, lying on the first card's top edge. **No intro paragraph** _(human decision: it read like a subtitle)_.
  2. **① Paste a link:** a slim card _(human decision: options 1 + 2 of the step 1 mocks; the card looked empty)_: the title and one sentence **at the top left, like the other step titles** _(human decision: it sat mid-height)_, and on the right **the real check field, the same as the home page's, on its butter background and as long as its field there** _(human decision: so people see it's the same thing)_, with the same space above and below it in its box _(human decision, 2026-10-26: without the length hint, the empty error line made the bottom look heavier)_. Stacked below `lg`. **No fork into "already in our dataset" / "not yet", and no pointer to steps ②–④** _(human decision: the cards' top-to-bottom order already tells it)_.
  3. **② We measure 12 things:** no lead _(human decision)_; **one annotated timeline (diagram F) and a compact list of the 12** _(human decision: option a of the brainstormed displays; avoids a wall of text)_. The 5-minute clip is the timeline's time axis, not a diagram of its own _(human decision: one diagram per section)_.
  4. **③ We compare it with our dataset:** the sampling process (diagram E), **no lead** _(human decision)_, **with no captions** _(human decision)_; the scan date sits in the first box. No "Why it matters" _(human decision)_.
  5. **④ You get a score:** one sentence ("more stimulating than 74 of every 100") _(human decision, 2026-11-09: “stimulating”, not “intense” or “calm”)_ and diagram C, a less → more stimulating row of dots **in the score's 5 colors** _(human decision)_. No "lining up" scenario and no "12 → one score" subsection or diagram _(human decision)_.
  6. **Common questions:** an accordion (`id="questions"`) on a mint section panel with plants peeking from its bottom edge. This takes over the look of the mockup's green note _(human decision: instead of a separate "production style" panel)_.

  No closing "Check a video" link _(human decision)_.
- **Sampling is described as an approach, without sampling counts** _(human decision: counts may change, the approach is less likely to)_. The page doesn't say how many videos are drawn per year, how many candidates are drawn, or the size of the channel pool. **The channel criteria are stated** _(human decision)_: at least 10,000 subscribers and more than 100 videos, at our latest scan (August 2026). The page states no video count _(human decision)_. Source: the research repo's contemporary v2 curation (channel discovery, then per channel-year sampling).
- **Fixed facts on the page:**
  - a 5-minute clip starting at 0:30;
  - videos published 2015 onwards;
  - the channel criteria and the scan date (August 2026);
  - the sampling rules, taken from the research curation plan.
- **Measurement copy has a single source.** Names and the one-line descriptions come from `frontend/src/lib/features.ts`. The short timeline labels are added there too, as `label`.
- **Diagrams are drawn in code with UI tokens**: HTML boxes and inline SVG (navy lines, score-scale and pastel fills), with labels as HTML text so they keep their size at every width. They are not hand-drawn art, so they need no art request. Each diagram is `aria-hidden` and sits next to text that says the same thing, so nothing is lost without it.
- **Art:**
  - `kid_wonder` goes in the hero _(human decision)_: the kid lying in front of a laptop, chin on hand, with a question mark ("how does this work?"). It has a transparent background (checked), so it sits on the white page like the home kid. **Hidden below `md`** _(human decision, 2026-10-16)_. **Its head the same size as the home kid's** _(human decision, 2026-10-16: it was 66–95 % of it)_, compared by face width _(human decision, 2026-11-10: sized by eye distance, its head was larger than the home kid's; then fine-tuned by eye against it)_: 244 / 276 / 324 px wide at `md` / `lg` / `xl` (001). Lying on the top edge of the first card; the negative margins scale with it, so elbows and laptop still rest on the border line and its top still lines up with the H1's letters.
  - The `grass_*` / `flower_*` art peeks from the bottom edge of the questions panel on `md`+.
- **Look, following the mockup's How it works panel:**
  - numbered step circles, all `sunny` _(human decision)_, here in front of the step sections' H2s;
  - a calm green panel (here, the questions);
  - lots of whitespace.
  - Everything else uses existing `STYLE.md` surfaces (section card, section panel, text link, page container, H1/H2).
- **Only the home page's H1 gets the `.marker` highlight** _(human decision)_. This changes `STYLE.md`'s H1 rule ("key words in `.marker`") for every other page.
- **New styles go into `STYLE.md` in the same change:** the page pattern (including the numbered step H2s), the diagram style (including the timeline and its numbered markers), the measurement list, and the accordion.
- **The header nav is unchanged.** "How it works" is marked as the current page.
- **No mention of the research paper** _(human decision: not public yet)_.
- **Measurement popovers link here** _(human decision)_. On the video and channel pages, each measurement's "(i)" popover ends with a "More about this →" text link to its anchor (`/how-it-works#rapid-cutting`, …). Following it lands with the **"We measure 12 things" title at the top of the screen**, so the visitor sees the section from its start, with the linked measurement highlighted in the list _(human decision, 2026-10-30: it stopped somewhere awkward)_. Also where the item doesn't fit on the screen below the title (a later item on a phone, any item on a phone in landscape): the title stays at the top and the highlighted item is further down _(human decision, 2026-10-30)_. This is the only link in a popover. It's still supplementary (the popover's text stands on its own), so it fits `STYLE.md`'s popover rule. `STYLE.md` gains a line saying a popover may end with one "more" link.
- **Score popovers say "production style only"** _(human decision)_. The score popovers on the video page (plan 004) and the channel page (plan 005) drop "…not whether it is good or bad" (see **Copy**). This overrides those plans' InfoTip copy.

## Design

### Diagrams

**F. We measure 12 things** (step ②): a made-up 5-minute clip on one time axis, with a **Visual** and an **Audio** track _(human decision: not "picture" and "sound")_. Numbered markers (navy circles) run left to right: the visual events ①–⑤ above the visual track, then the visual levels ⑥ colorfulness and ⑦ brightness as icons right of it; the audio events ⑧–⑩ and ⑫ (a quiet stretch) below the audio track, and ⑪ average loudness as a dashed line across it, its marker at the line's end. **Every measurement is in the drawing, 9–12 included** _(human decision: instead of separate dials)_. **Few, quiet colors** _(human decision: it had too many, out of place on the site)_: `sky` shots, a `sky-blue/40` shot after the cut at ②, `butter` shots once the colors swap out at ③, a white shot behind the `sunny` flash, a `navy/10` quiet stretch. The axis under it reads "0:30 — 5 minutes, the same for every video — 5:30".

```
             ①        ②               ③     ④          ⑤                        ⑥     ⑦
  Visual   ▕shot▕shot▕ shot ▕ shot ▕ shot ▕ ✦ ▕shot▕ ⇉⇉ ▕ shot ▕                🎨    ◐
  Audio    ∿∿∿∿╱╱╱╱╱╲∿∿∿∿∿∿▲∿∿∿∿∿∿▲∿∿∿∿∿∿∿∿∿∿∿∿▁▁∿∿∿  - - - average - - -   ⑪
               ⑧          ⑨      ⑩            ⑫
           0:30 ─────── 5 minutes, the same for every video ─────── 5:30
```

From `lg`, the short label sits next to each marker as well. Below `lg`, only the markers show, and the list carries the words.

**Measurement list** under F _(human decision: no taller than the diagram)_: the 12 in marker order, each item = marker, name (with its anchor) and **the existing one-line description under it, at most two lines, not hidden in an info button** _(human decision)_. Four columns from `xl`, three from `lg`, two from `sm`, one below. A "More about this" link highlights its item and, on desktop, lands with the timeline in view.

**E. Our dataset** (step ③): four steps left to right from `lg`, top to bottom below. **Its steps have no numbers**, only arrows, so they don't clash with the page's ①–④.

```
  Find channels           Line up every upload         Pick a few at random,          Our dataset
                             by year                       every year
  🔍 kids’ channels   →    2015 ▯▯                  →    2015 ▯▯              →      the same share
  on YouTube               2016 ▯▯▯▯                     2016 ▣▯▣▯                   from every year
  ✓ 10K+ subscribers       2017 ▯▯▯▯▯▯                   2017 ▯▣▯▯▣▯                  of every channel
  ✓ 100+ videos            …                             …
                           2026 ▯▯▯▯▯▯▯▯▯▯▯              2026 ▯▣▯▯▯▣▯▯▯▯▯
                                                         each pick must be:
                                                         ✓ made for kids  ✓ not a Short
                                                         ✓ 2–60 minutes   ✓ still online
```

In the second box, one channel's uploads are small rectangles stacked by year, uneven: few early, many recent. In the third, the picked ones are filled navy. One pick per row is crossed out (failed a check) and the next one is picked instead; the checks are a ✓ list in its box (read out by screen readers, like the first box's).

**C. Where it sits** (step ④): one row of ~40 small dots sorted from less to more stimulating, standing for all the videos in our dataset, in the score's 5 colors. Dots left of "your video" are filled, and the ones right of it are rings. Below `md` there are ~19 dots.

```
  less stimulating ●●●●●●●●●●●●●●●●●●●●●●●●●●●●●◆○○○○○○○○○○ more stimulating
                                    ▲ your video
        ← 74 of every 100 videos are less stimulating →
```

### Layout

| Width | Layout |
|---|---|
| `lg`+ | Hero: H1 (left) · kid (right) lying on the first card. Steps ①–④ are white section cards, one diagram each. Questions: mint section panel, accordion `max-w-3xl` inside. |
| `md`–`lg` | As above. E becomes a 2 × 2 grid. |
| < `md` | Single column: H1 → cards, no kid _(human decision, 2026-10-16)_. E stacked. C uses ~19 dots. |

**Desktop (1280 px)**

```
┌────────────────────────────────────────────────────────────────────────────────────────────┐
│ HyperStim?                                      Home  Rankings  Compare  How it works  About │
├────────────────────────────────────────────────────────────────────────────────────────────┤
│  How it ~works~                                                {kid with laptop, ?}        │
│  ╭─ (1) Paste a link ───────────────────────────────────────────────_kid lies here_──╮    │
│  │  one sentence                         ┌─ butter ───────────────────────────────┐   │    │
│  │                                       │ YouTube link or video ID               │   │    │
│  │                                       │ [https://www.youtube… ] (Check video →)│   │    │
│  │                                       └────────────────────────────────────────┘   │    │
│  ╰────────────────────────────────────────────────────────────────────────────────────╯    │
│  ╭─ (2) We measure 12 things ─────────────────────────────────────────────────────────╮    │
│  │  [F: Visual / Audio timeline, ①–⑫, time axis 0:30 — 5 minutes — 5:30]             │    │
│  │  ① Rapid cutting       ② Scene …       ③ Palette …       ④ Luminance …             │    │
│  │    how often the …       how different …  how often …       how often …            │    │
│  │  ⑤ … ⑫                                                                             │    │
│  ╰────────────────────────────────────────────────────────────────────────────────────╯    │
│  ╭─ (3) We compare it with our dataset ───────────────────────────────────────────────╮    │
│  │  [E: find channels → uploads by year → pick a few each year → dataset]             │    │
│  ╰────────────────────────────────────────────────────────────────────────────────────╯    │
│  ╭─ (4) You get a score ──────────────────────────────────────────────────────────────╮    │
│  │  one sentence                                                                      │    │
│  │  [C: dots in the 5 score colors, "your video"]                                     │    │
│  ╰────────────────────────────────────────────────────────────────────────────────────╯    │
│  ╭─ Common questions (mint panel) ────────────────────────────────────────────────────╮    │
│  │        ▸ What does a high score mean?                                              │    │
│  │        ▸ …                                                                         │    │
│  ╰─🌿────────────────────────────────────────────────────────────────────────────🌼──╯    │
├────────────────────────────────────────────────────────────────────────────────────────────┤
```

**Phone (360 px)**

```
┌──────────────────────────────┐
│ How it works                 │
│ ╭─ (1) Paste a link ───────╮ │
│ │ sentence, check field    │ │
│ ╰──────────────────────────╯ │
│ ╭─ (2) We measure 12 … ────╮ │
│ │ [F, markers only]        │ │
│ │ ① Rapid cutting          │ │
│ │   How often the picture… │ │
│ ╰──────────────────────────╯ │
│ ╭─ (3) We compare it … ────╮ │
│ │ [E, stacked]             │ │
│ ╰──────────────────────────╯ │
│ ╭─ (4) You get a score ────╮ │
│ │ sentence, [C, 19 dots]   │ │
│ ╰──────────────────────────╯ │
│ ╭─ Common questions ───────╮ │
│ │ ▸ …                      │ │
│ ╰──────────────────────────╯ │
└──────────────────────────────┘
```

### Elements

- **Check field** (shared): the home page's form (label, input, "Check video →", hint, error) moves into `CheckVideoForm`, used by the home card and step ①. Same validation, errors and navigation to the video page. A link pasted before the page's script ran is kept (2026-11-11, plan 012: it stayed in the field, but Check said to paste one first).
- **Step headings** (**new**): steps ①–④ are section cards whose H2 starts with a `sunny` number circle (`size-9`, `font-hand`, `aria-hidden`), with sr-only "Step 1: " in the H2 text. The questions panel has a plain H2.
- **Timeline and measurement list** (**new**): diagram F and the list under it (see **Diagrams**). Each measurement has an anchor (`#rapid-cutting`, …), so other pages can link to it; where it lands is under **Decisions** (Measurement popovers link here). The marker number appears in both the diagram and the list, `aria-hidden` in the list (screen readers get the list alone).
- **Accordion** (**new**): native `<details>`/`<summary>`, so there's no JavaScript.
  - Each item is a `summary` row (`min-h-11`, semibold navy, with a chevron that rotates when open) followed by body text. Row lines are `navy/10` on the mint panel.
  - All items start closed.
  - `/how-it-works#questions` scrolls to the panel's H2.
- **Headings:** H1 "How it works", with no `.marker` highlight _(human decision)_. Each section has a visible H2. The steps inside diagram E use H3s.

### Copy

Final text for every string on the page goes in a table here, as in plans 002/004. The drafts below are for review.

**Page**

| Where | Text |
|---|---|
| `<title>` | How it works - HyperStim? |
| Meta description | How HyperStim? measures how stimulating kids’ videos are: 12 measurements of scene changes, colors, and sounds, combined into one score. _(human decision, 2026-10-29; plan 011, Page descriptions)_ |
| H1 | How it works (no `.marker` highlight; only the home page's H1 has one) _(human decision)_ |

**① Paste a link**

| Where | Text |
|---|---|
| H2 | ① Paste a link |
| Lead | Paste any YouTube video made for kids. |
| Check field | As on the home page (plan 002): “YouTube link or video ID”, “Check video →” and its two errors; no length hint _(human decision, 2026-10-26: its 15-minute limit had nothing behind it; a check takes about the same time for any length, since only a 5-minute clip is measured)_. |

**② We measure 12 things**

| Where | Text |
|---|---|
| H2 | ② We measure 12 things |
| Time axis | 0:30 · 5 minutes, the same for every video (“5 minutes” below `sm`) · 5:30 |

Timeline labels (new `label` in `features.ts`), next to the markers from `lg`:

| # | Measurement | Label |
|---|---|---|
| 1 | Rapid cutting | each cut, counted |
| 2 | Scene discontinuity | how different the next shot looks |
| 3 | Palette instability | the colors swap out |
| 4 | Luminance flash | a sudden brightening |
| 5 | Motion density | fast movement on screen |
| 6 | Visual intensity | vivid colors |
| 7 | Visual brightness | brightness |
| 8 | Audio build-resolve | sound builds up, then drops back |
| 9 | Loudness jumps | a sudden loud moment |
| 10 | Surprise reveals | a loud jump right on a cut |
| 11 | Audio intensity | average loudness |
| 12 | Silence elimination | a quiet stretch |

The list shows the existing one-line descriptions (plan 004).

**③ We compare it with our dataset**

| Where | Text |
|---|---|
| H2 | ③ We compare it with our dataset |
| Box 1 | **Find channels.** Box: ✓ 10K+ subscribers ✓ 100+ videos, then “(at our latest scan, August 2026)” _(human decision)_. |
| Box 2 | **Line up every upload by year.** |
| Box 3 | **Pick a few at random, every year.** Box: ✓ made for kids ✓ not a Short ✓ 2–60 minutes ✓ still online. |
| Box 4 | **Our dataset.** |

**④ You get a score**

| Where | Text |
|---|---|
| H2 | ④ You get a score |
| Lead | A score of 74 means a video is more stimulating than 74 of every 100 videos we compare with. _(human decision: short, no scenario, no count)_ _(human decision, 2026-11-09: “stimulating”, not “intense” or “calm”)_ |

**Common questions** (H2 "Common questions", `id="questions"`)

| Question | Answer |
|---|---|
| What does a high score mean? _(human decision)_ | A high score means a video is more stimulating than most videos we compare with. We measure production style only. We don’t judge a video’s content, educational value, or age appropriateness. |
| This video looks really stimulating. Why is its score low? _(human decision, 2026-11-09: “stimulating”, not “intense” or “calm”)_ | We measure 5 minutes, starting 30 seconds in, not the whole video. If its busiest parts come later, the score won’t see them. And the score compares with other kids’ videos, many of which are stimulating too, so a video can feel busy and still sit in the middle. _(human decision)_ |
| What do “No cuts” and “No sound” mean? | Scene discontinuity measures how different each new shot looks from the one before. If a video stays on one shot for the whole 5 minutes we measure, there’s nothing to compare, so we show “No cuts” instead of a score. Likewise, a video without sound has no loudness to measure, so Audio intensity shows “No sound”. _(human decision, 2026-10-16: replaces “What does ‘None detected’ mean?”, since a count of 0 now shows as 0)_ |
| How is a channel’s score worked out? _(human decision: a question, not a section)_ | It’s the average of its videos’ scores in our dataset. _(human decision: no mention of rankings)_ |
| How do you choose the channels and videos? _(plan 013, 2026-10-25)_ | We look for kids’ channels on YouTube that have at least 10,000 subscribers and more than 100 videos, leaving out channels YouTube makes automatically (e.g., “Topic” channels). From each channel, we randomly pick about the same number of videos from every year since 2015. Every video we pick must be made for kids, 2 to 60 minutes long, not a Short, and still online. We keep adding new channels and videos. _(human decision, 2026-11-02: plan 013's channel-first rule, worded for a general audience; it said every video has the same chance)_ |
| Can I check a video that isn’t on YouTube? _(human decision, 2026-10-16: placed with the privacy question, both about checking a video)_ | Not yet. For now, we can only check YouTube videos. _(human decision, 2026-10-16: short, no reason given)_ |
| Do you keep anything about me? | When you check a video that isn’t in our dataset, we save its results, so anyone who checks it later gets them right away. Nothing about who checked it is saved. Our server keeps short-lived logs to prevent abuse. See our [privacy policy](/privacy). _(human decision: open with what is saved and why)_ |

"Who decides the scores?", "Who made HyperStim?" and "Why only 5 minutes of the video?" are dropped, with no reason for the 5 minutes given elsewhere _(human decision)_.

**Video and channel pages** (overrides plans 004/005)

| Where | Text |
|---|---|
| Measurement popover, last line | More about this → (to `/how-it-works#{slug}`; sr-only “More about {name}”) |
| Video page score InfoTip | Score 0–100: where this video’s production sits among the videos in our dataset. We measure production style only. |
| Channel page score InfoTip | Score 0–100: the average of this channel’s video scores. Each shows where a video’s production sits among the videos in our dataset. We measure production style only. |

## Steps

1. **Copy source.** Add `label` to the 12 entries in `features.ts`.
2. **Pieces.**
   - Step headings, the shared check field, diagrams C, E and F (inline SVG; the dot count in C changes with width; F shows labels from `lg`), the measurement list, and the accordion.
   - `STYLE.md` entries for the new styles.
   - `kid_wonder` added to `used.json`.
3. **Page.** `/how-it-works` with metadata.
4. **Footer.** "FAQ" goes to `/how-it-works#questions`.
5. **Video and channel pages.** "More about this →" in the measurement popovers (from the shared `Measurements`, slug from `features.ts`). The new score InfoTip copy. The `STYLE.md` popover line.
6. **Tests.**
   - Every measurement in `features.ts` renders in the list with its anchor, marker number and description, and its label in F.
   - The headings form an outline, steps ①–④ in order; the H1 has no marker.
   - Every accordion item opens.
   - Step ①'s check field opens the video page, like the home page's.
   - The footer FAQ link points to the anchor.
   - Each measurement popover links to its anchor on this page, and every slug exists there.
   - The score popovers show the new wording.
7. **Review.**
   - Screenshots at 360 and 1280 px, plus 320, 768 and 1920 px, compared with `STYLE.md` and the mockup's How it works panel. The changed popovers too, on the video and channel pages.
   - Keyboard-only pass through the accordion.
   - Anchors land below the header.
   - Stop for review.
8. **Where a measurement link lands** (2026-10-30, plans 017 and this one). Measured in Chromium, WebKit 18.2 and Firefox at 320 × 568 to 1920 × 1080: all three land within a few pixels of each other, so it's not a browser bug. The landing spot was a fixed distance above the item (`scroll-mt-[32rem]`), so where the title ended up depended on the item's place in the list and on the screen. On desktop the title was 67 px down for the first item, but scrolled past for a later one. On phones it was about 200 px down, with the item often below the screen. Plan 017's first fix (`min(32rem,40svh)`) put the title above the screen almost everywhere, so this step replaces it.
   - **How** (`LandAtTitle`): each item's `scroll-margin-top` is set in the browser to its distance below the title plus 16 px, so every way of reaching the anchor lands with the title 16 px from the top: the link from another page, a shared link, a reload, Back. It's measured again when the page's size changes (`ResizeObserver`: a new width, fonts loading) and right before each landing. On first load the browser scrolls to the anchor before the page's script runs, so the script scrolls there once more. It also lands again when only the address's `#` part changes (`hashchange`, `popstate`).
   - **Kept in place while the page settles:** after landing, a later change of the page's size (late layout, a resize) puts the item back at its place, until the visitor scrolls, taps or types. Safari doesn't keep the scroll position when content above changes; without this the title ended up 6–134 px off in WebKit's phone tests.
   - **Highlight after a link inside the site** (found while testing, also on the live site): `:target` only follows real page loads, and the "More about this" link changes the address without one, so the item wasn't highlighted. `LandAtTitle` marks it (`data-linked`, `data-linked:bg-butter`) as well.
   - **Without JavaScript:** `scroll-mt-4`, so the item lands at the top of the screen, in view.
   - **Tests:** E2E in all four projects, from a video page's popover and opened directly (first and last measurement), at 1280 × 800, 360 × 740, 375 × 548 and 740 × 340: the title is 16 px from the top (±3, WebKit rounds on phones) and the item is highlighted. Component: the margins follow the distance to the title; the first load and a `#` change land and mark the item; a size change lands again until the visitor scrolls.
   - **Checked** in Chromium, WebKit 18.2 and Firefox at 10 sizes from 320 × 568 to 1920 × 1080, by link and opened directly: the title lands 13–19 px from the top in all 90 cases.
   - **Docs:** `STYLE.md` (Measurement list); plan 017's fix 8 row.

## Review decisions

- Step ①'s look was chosen from a mock review page (an artifact, not in the repo) showing five options; the user picked a mix of 1 (real field) and 2 (slim card), with the field on the right. The sketches below **Layout** show it.
- The ASCII sketches of the desktop and phone layouts below **Layout** are redrawn for the page that follows one video: steps ①–④ as section titles, one diagram per card, descriptions under the list's names, no closing link (see **Sections**).
- The ASCII sketch of diagram E drops its step numbers (see **Diagrams**, E).
- The phone sketch below **Layout** has no kid under the H1 (2026-10-16; see **Decisions**, Art).
- Diagram C's sketch reads “less stimulating” / “more stimulating” and “74 of every 100 videos are less stimulating” (2026-11-09; see **Diagrams**, C).

## Open questions

None.
