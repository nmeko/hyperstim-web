# 018 — Blog

**Area:** The blog: the Blog tab, the post list (`/blog/`), each post's page (`/blog/<slug>/`), how posts are written (markdown files and the writing guide), and how posts show up in search results and link previews.

## Goal

The team publishes a blog post now and then. Visitors find all posts under a new **Blog** tab, newest first, and read each one on its own page. Each post is one markdown file in the repo, and can have figures, videos, YouTube embeds and references besides text and headings. Every post can be found through search engines on its own.

Layout review: the artifact "Blog page layout" (round 2).

## Decisions

- **Tab order:** Home, Rankings, Compare, How it works, **Blog**, About. The tools come first, Blog sits with the reading pages, and About stays last. On the post pages, Blog is marked as the current tab.
- **Post list (`/blog/`):**
  - H1 "Blog", with no intro line under it _(human decision, 2026-11-09: the sample line didn't work)_.
  - The kid is `kid_notebook` (lying on its tummy, writing in a notebook with a pencil) _(human decision, 2026-11-09: art added by the team)_. It lies at the right on the card's top edge, as on Rankings, hidden below `md`. It appears on this page only, not on posts _(human decision, 2026-11-09)_.
    - Its head is the hero kids' size, compared by head, not by the whole figure _(human decision, 2026-11-09: it was drawn too big)_. The transparent margins are trimmed when it's converted. It's matched to the home kid by face, side by side: `md:w-[12.625rem] lg:w-[14.375rem] xl:w-[17rem]` _(human decision, 2026-11-10: sized by eye distance, its head was larger than the home kid's, whose face is turned)_, with `translate-y-[4%]` so it rests on the line. The heading text keeps clear of it with right padding, and the hero gets a minimum height so the kid stays clear of the header. Add it to `art/used.json` (largest width 272).
  - One section card with every post, newest first. Each post shows its date, its title (`font-hand`, a link that covers the whole row) and its TL;DR.
  - Posts are separated by straight `navy/10` lines _(human decision, 2026-11-09: the lines curved at their ends)_.
  - The TL;DR uses the card's full width _(human decision, 2026-11-09)_.
  - **10 posts per page on every screen**, in numbered pages _(human decision, 2026-11-09: with the TL;DRs, phones scrolled a long way after a few posts; one fixed count, so a page number means the same posts on every device)_.
    - Page 1 is `/blog/`; later pages are `/blog/page/2/` and so on. Each is a static page built at build time, so paging works without JavaScript. There's no `/blog/page/1/`.
    - The page control sits under the list, inside the card, above a `navy/10` line. It's the site's page control (`STYLE.md`, Page control): ‹ Previous, the page numbers and Next › from `sm`, and "‹ Page 1 of 2 ›" on phones. Here its parts are links, not buttons. There's no control when everything fits on one page.
    - Each later page has the H1 "Blog" and the kid, like page 1. Its title is "Blog, page 2 - HyperStim?", with the same description and a canonical URL of its own. All pages are in the sitemap.
    - A new post pushes the oldest post on each page onto the next one. Links to page 2 and beyond don't promise fixed content; the newer / older links on posts are what lead through all posts in order.
- **Post page (`/blog/<slug>/`):**
  - From the top: "← All posts" (text link), the H1 title, the date, then the TL;DR box (`rounded-2xl`, unfilled with a thin `navy/15` line _(human decision, 2026-11-10: in place of the butter fill; chosen from butter, sky and a sunny line)_, a "TL;DR" heading in `font-hand`).
  - The title fills the full width before it wraps, with no balanced line breaks _(human decision, 2026-11-09: the title didn't use the full width)_.
  - Then the body at the page container's full width _(human decision, 2026-11-09: it didn't use the full width)_, followed by References and the newer/older links.
  - No author or reading time _(human decision, 2026-11-09)_.
- **Elements inside a post:**
  - Headings: `##` and `###` (the H1 is the title).
  - Figures: the image with a caption under it.
  - Videos hosted with the site: a native `<video controls preload="none">` with a poster image and a caption.
  - YouTube embeds: the existing `YouTubePlayer` (nothing loads from YouTube before Play) with a caption.
  - **Clip comparison (`::::clips`)** _(human decision, 2026-11-09)_: two YouTube videos of the same song side by side, with tabs that each play one stretch of both (e.g. a verse), and a chart under them that fills in as the video plays. It lets readers explore what they can see by watching the two videos; the chart is related to the site's measures but is not the same as them _(human decision, 2026-11-09)_. Review: the artifact "Clip Comparison Widget".
    - Markdown, one block per comparison:
      ```
      ::::clips[Caption]{a=<video id> b=<video id>}
      ::cuts[Tab label]{a=0:14.5-0:30.5 b=0:03-0:21.6}
      ::motion[Tab label]{a=0:36-0:51.5 b=0:21.6-0:39.6}
      ::::
      ```
      A block holds one or more tabs, each `cuts` (scene changes) or `motion`; with one, there's no tab switch. It counts as a video in the caption numbering ("Video 1.").
    - **Data:** `uv run python scripts/clip_data.py <slug>` (in `backend/`, like its other scripts) finds the post by its slug, reads its blocks, downloads each stretch to a temporary folder, measures it with the pipeline at the dataset's settings (the cuts behind `cuts_per_min`; the optical flow behind `motion_frac` in 0.2 s steps, leaving out intervals that touch a cut, so a cut's jump doesn't read as motion), writes `public/blog-media/<slug>/clips.json`, and deletes the clips. Only times and numbers are committed, never clips (`CLAUDE.md`). The build fails when a block and `clips.json` don't match (an ID, tab or time changed without re-running the command).
    - **Playing:** the existing `YouTubePlayer` (nothing loads from YouTube before Play), extended with a start and end time and a playback-time report through the embed's message API. One video plays at a time: starting one pauses the other, as on Compare _(human decision, 2026-11-09)_. **Captions off** _(human decision, 2026-11-10)_: when a video starts, the player turns YouTube's captions off through the message API (`unloadModule`), as some videos show them by default; once only, so a viewer can turn them back on with the CC button. **Each tab keeps its state** _(human decision, 2026-11-10)_: every tab has its own pair of players, kept in place (hidden) on the other tabs. Switching tabs pauses the tab left behind; coming back finds its videos and lanes where they were, paused.
    - **The result shows before Play** _(human decision, 2026-11-10: not every reader presses Play)_: until a video plays, its lane shows the whole stretch (all cuts, the whole motion line) and its number. Playing a video starts its lane over, empty, and it fills in as the video plays, with a playhead on the playing lane. Pausing keeps what's drawn; playing on continues it; playing after the end starts over.
    - **No hint or unit note** under the charts _(human decision, 2026-11-10: the line "Play the videos to see how the videos differ." went; the post's text says what to look at)_.
    - **Thumbnails, as for dataset videos** _(human decision, 2026-11-10: "do it as how our video A does")_: every YouTube video a post embeds (`::youtube` and `::::clips`) is listed in `backend/data/blog-videos.txt` (one ID a line, committed), and the backend's thumbnail endpoint serves those too (plan 009, Thumbnails). So a thumbnail shows whether or not the video is in the dataset or was ever analyzed. `clip_data.py` adds a post's clip videos to the list; a backend test fails when a post embeds a video the list lacks, so a `::youtube` embed can't be forgotten. The API change is additive; the list ships with the backend, so a new post's thumbnails show once its release has deployed.
    - **Video titles** above the players link to each video's page on the site (`/video?id=…`) _(human decision, 2026-11-09)_. Under each title, its channel name on a line of its own, in smaller gray text (`text-xs text-ink`) _(human decision, 2026-11-10: not "· channel" after the title)_. `clips.json` holds the channel name as YouTube gives it now.
    - **Top row:** only the tab switch, centered; no line with the stretches' times _(human decision, 2026-11-09)_. Before Play, each video shows its YouTube thumbnail (the video preview's, from our backend).
    - **Same chart height on every tab** _(human decision, 2026-11-09)_, so the page doesn't jump when switching: the cuts chart is as tall as the motion chart, its track in the middle with taller ticks.
    - **Layout:** the block spans the text column's full width, so its edges line up with the paragraphs and the videos are as large as the column allows _(human decision, 2026-11-10: capped at 56rem it sat inset from the text, its videos smaller than they could be)_. From 480 px of block width, the two videos sit side by side with the chart panel under both, one lane per video. Below that, each video's lane sits directly under its video _(human decision, 2026-11-09)_.
    - **The lanes control playback** _(human decision, 2026-11-10)_: clicking or tapping a point on a video's lane pauses the video that was playing, moves the clicked video to exactly that moment of its stretch (no snapping to cuts), and plays it from there; a video not yet started starts there (the click is its Play, so still nothing loads from YouTube before one). Dragging along a lane scrubs: the playhead and the chart follow, and the video plays from where the drag ends. On touch screens a sideways drag scrubs and a vertical one scrolls the page (`touch-action: pan-y`). With a mouse, hovering shows a faint line and the time under the pointer. Each lane is a slider for keyboards and screen readers ("Video A: <title>", its value the seconds played, read as e.g. "12 of 37 seconds, 8 cuts so far"): arrows move 1 s, Page Up/Down 5 s, Home/End to either end, each playing from there. An ad YouTube plays first can delay the jump; the picture updates only when the video plays from the new spot (YouTube has no frame preview).
    - **The time axis ends at the longer of the two stretches** _(human decision, 2026-11-10: rounded up to 5 s, it left part of each lane empty)_, so that video's line reaches the right edge; labels every 5 s (10 s on narrow lanes), the last with the unit.
    - **Each lane:** the video's letter badge (A, B), the timeline, and its number on the right, not above _(human decision, 2026-11-09)_: "N cuts in T s" for cuts, T being the seconds played (whole seconds; the stretch's length at its end) _(human decision, 2026-11-09: "so far" didn't say how far)_, and for motion the average so far with its unit under it, "% of width/s" (percent of the frame's width per second, as on the chart's axis) _(human decision, 2026-11-10: the number needed its unit; chosen over a chart title and an info button)_. The number column is narrow (`4.25rem`, its word line `text-xs`), so the timeline gets most of the width _(human decision, 2026-11-09: the timeline was too short)_. The motion line has no threshold mark _(human decision, 2026-11-09: it's for exploring what's visible, not for restating the measure)_.
    - **Colors:** navy marks on a white panel with a thin `navy/10` border, both videos in navy, letters as white circles with a solid navy ring like the compare page's badges _(human decision, 2026-11-11: the faded `navy/35` ring changed to solid navy, matching the compare page)_, the playhead in `scale-mid` _(human decision, 2026-11-09: the coral/blue letters and the blue panel were too colorful)_. No new tokens.
    - **Testing the embeds:** YouTube refuses some videos in pages whose address is a bare IP (`127.0.0.1`, a server's IP), but plays them under a host name (`localhost`, the live site). Previews are opened at `localhost` (from elsewhere, through an SSH tunnel; no public port). An E2E check loads a page under the live site's origin and confirms each published post's videos reach "playing", so a video whose uploader turns off embedding fails a test; authors run it before publishing (writing guide). **In CI it asks YouTube's oEmbed endpoint instead** and expects 200 (401: embedding off; 404: removed or private) _(human decision, 2026-11-10: YouTube asks GitHub's runners to sign in to prove they aren't bots, so the player check failed every run there)_.
  - References: a citation in the text is raised (superscript) `[1]`, and citations side by side join into one `[2, 3]`, each number its own link _(human decision, 2026-11-09)_; it links to the numbered References list at the post's end, and each reference has a ↩ link back to the text. In the list, the number `[1]` has the same style as the reference text (`ink`, regular weight) _(human decision, 2026-11-09)_.
  - Lists, links, bold, italic, quotes and tables, all standard markdown. Bold is navy; bold italic (`***…***`, used for the site's name) keeps the text's color _(human decision, 2026-11-09)_.
- **Captions:** "Figure N." and "Video N." are numbered automatically, figures and videos counted separately in the order they appear. YouTube embeds count as videos. The author writes only the caption text _(human decision, 2026-11-09)_.
- **References use markdown footnotes** (`[^key]` in the text, `[^key]: …` anywhere in the file), numbered by first use and shown as `[1]`. Authors don't number them by hand, so adding a citation never means renumbering.
- **Newer / older links** at the bottom: "← Newer post" and "Older post →", each with that post's title. A link appears only when that post exists.
  - From `sm`: side by side, newer on the left, older on the right and right-aligned.
  - Below `sm`: stacked, both left-aligned, newer on top, with a straight `navy/10` line between them _(human decision, 2026-11-09: one left- and one right-aligned looked odd on phones)_.
  - No background fill _(human decision, 2026-11-09: drop the blue boxes)_. A thin solid line across the full width above both links (`border-t border-navy/10`, `pt-3`), the same line as above References _(human decision, 2026-11-09)_. Each link: a small "← Newer post" / "Older post →" label (`text-sm font-semibold text-ink`), then the title (`font-hand text-lg` navy, underlined on hover).
- **Files:**
  - One markdown file per post, named `<date>-<slug>.md` (e.g. `frontend/content/blog/2026-11-09-introducing-hyperstim.md`), so the folder lists posts in date order _(human decision, 2026-11-09)_. The date must be the post's `date`. The slug, the rest of the name, becomes the URL (`/blog/introducing-hyperstim/`) and names the media folder.
  - Front matter fields:
    - `title` (required)
    - `date` (required, `YYYY-MM-DD`)
    - `tldr` (required; may hold `**bold**`, `*italic*` and `***both***` in the text's own color, as the first post's does _(human decision, 2026-11-09: not navy)_; descriptions taken from it drop the markers)
    - `description` (optional; see Search and previews)
  - Images, videos and posters go in `frontend/public/blog-media/<slug>/`, and the markdown refers to them by filename only.
- **Markdown rendering** happens at build time into static HTML, with no JavaScript needed to read a post.
  - Libraries: `react-markdown`, `remark-gfm` (footnotes, tables), `remark-directive` (the figure, video and YouTube blocks) and `gray-matter` (front matter). All four are widely used. They render to React, so `YouTubePlayer` and the site's own styles plug in directly.
  - MDX was not chosen: authors would have to write JSX, and its errors are harder to read.
  - Block syntax: `::figure[Caption]{src=… alt=…}`, `::video[Caption]{src=… poster=…}`, `::youtube[Caption]{id=…}`, and the `::::clips` block above. The renderer's checks (media, alt, footnotes, headings `##`/`###` only, no bare `![…](…)` images) run as the page builds.
  - A static export needs at least one page per dynamic route, so before the first post (and while the list fits on one page) a stand-in at `/blog/_/` (and `/blog/page/_/`) renders the not-found page: `noindex`, linked from nowhere, not in the sitemap.
- **Checks that fail the build on a broken post:**
  - A required field is missing or a date is invalid.
  - A file name doesn't start with the post's date.
  - A media file the post refers to is missing.
  - A figure has no `alt`.
  - Two posts have the same slug.
  - A footnote is used but never defined, or defined but never used.
- **Writing guide (`frontend/content/blog/README.md`):** it stays in the repo and is not part of the site; the post loader skips it _(human decision, 2026-11-09)_. It covers:
  - Where files go, the front matter, and every element with a copy-paste example.
  - Rules for media: our own images and recordings only, sizes, formats and alt text.
  - How to preview a post locally (`npm run dev`) and how to publish one (branch, commit type, release).
  - It links to an example post that uses every element. That post doubles as the test fixture (`frontend/src/lib/blog/fixtures/2026-11-09-every-element.md`), so the guide's examples are known to render.
  - The test posts (the example and ten short ones, so two list pages) and their media (made from the team's art) live in `src/lib/blog/fixtures/`. The E2E build reads them instead of `content/blog/` (`BLOG_CONTENT_DIR`, `BLOG_MEDIA_DIR`) and copies their media into `out/`, so nothing of them ships.
- **Media rules:**
  - Videos must be the team's own material: screen recordings, animations, talks. Never clips downloaded from YouTube (`CLAUDE.md`, Public repository); a YouTube video is embedded instead.
  - Videos: MP4 (H.264), at most 10 MB each, with a poster image.
  - Images: WebP or PNG, at most 2× their display width.
  - Images and figures come from the team (`CLAUDE.md`).
- **Search and previews (plan 011):**
  - Every post is its own static page with:
    - title "<post title> - HyperStim?"
    - meta description: the post's `description`, or its TL;DR if none is set; at most 155 characters, checked in `metadata.test.ts`
    - canonical URL
    - Open Graph tags (`og:type` article, published date) with the site's share image
  - `/blog/` and every post go in the sitemap, each post with its date as `lastModified`.
  - Each post also gets `BlogPosting` structured data (JSON-LD: headline, date, description), which lets Google show the date in results.
  - Everything is in the built HTML, so readers that don't run JavaScript get the full post.
  - Every post uses the site's share image; posts don't set their own _(human decision, 2026-11-09)_.
- **Blog page description:** "Research, insights, and real-world examples exploring how kids’ videos use editing, motion, colors, and sound to create different viewing experiences." (150 characters) _(human decision, 2026-11-09)_. Title "Blog - HyperStim?". Added to plan 011's Page descriptions table.
- **Before the first post:** the Blog tab ships, and the list shows a message box (`rounded-2xl bg-sky p-6 text-center`): "No posts yet. Check back soon." _(human decision, 2026-11-09)_.
- **Drafts:** a post in progress lives on an unmerged branch and is previewed locally with `npm run dev`. There is no `draft` field _(human decision, 2026-11-09)_.
- **Privacy policy:** no change expected.
  - The clip comparison plays through `YouTubePlayer` and its thumbnails, as Compare does; the message API loads no script from YouTube.
  - Figures and videos load from our own site.
  - YouTube embeds use `YouTubePlayer`, which the policy already covers ("When you play a video, YouTube may set cookies…").
  - Step 9 re-reads the policy to confirm it doesn't name the pages where videos play.
- **Commit types:**
  - Building the blog is `feat`.
  - Each new post is `fix: Add the blog post "<title>" (plan 018)` _(human decision, 2026-11-10: a post is content on the blog, not a new feature)_: it gets a release note and a patch version. New blog features (like the clip comparison) are `feat`.
- **Style:** `STYLE.md` gets entries for the Blog list page, the post page, the TL;DR box, figures and captions, references and the newer/older links. These reuse the existing surfaces (section card and its line, text link, video preview; butter only for a targeted reference); there are no new tokens.

## Steps

1. Add the dependencies (`react-markdown`, `remark-gfm`, `remark-directive`, `gray-matter`), then update `package-lock.json` and `frontend/README.md`.
2. `src/lib/blog/` loader: read `content/blog/*.md` (skipping `README.md`), check the front matter and media, sort newest first, and give each post its newer/older neighbor.
   - Unit tests cover each failing check, the sort order, the neighbors at both ends, caption numbering and footnote numbering.
3. Renderer (`components/blog/PostBody.tsx`): map markdown and the `figure` / `video` / `youtube` blocks to the site's elements (automatic numbering, captions, `YouTubePlayer`), with footnotes shown as `[1]` and a References section.
   - Component tests use the every-element fixture, including the ↩ links and an axe check.
4. `src/app/blog/page.tsx` (list, page 1), `src/app/blog/page/[page]/page.tsx` (pages 2 and up) and `src/app/blog/[slug]/page.tsx`, all with `generateStaticParams`, with metadata from `pageMetadata` (the article type and date added to the helper) and JSON-LD.
   - Paging: move `Pagination` from `components/rankings/` to `components/` (two uses now) and give it a link mode (`href(page)` in place of `onChange`; disabled steps become `aria-disabled` spans). Rankings keeps the button mode.
   - Component tests check: newest first, the row link, 10 per page, the page control's links and current page, no control with 10 posts or fewer, and that the newer/older links appear only when those posts exist.
5. Header: add Blog before About, and mark it current on `/blog/…`; update the header test. Update plan 001's nav line.
6. Sitemap: add `/blog/`, its later pages and each post. Extend the sitemap and metadata tests to check the posts, the description length and the canonical URL.
7. The writing guide (`content/blog/README.md`) and the every-element fixture.
8. E2E spec (`e2e/blog.spec.ts`):
   - list → post → older → newer → All posts
   - list page 1 → Next → page 2 → Previous, with fixture posts that make 2 pages
   - the YouTube embed loads only after Play
   - a citation jumps to its reference and back
   - axe, the keyboard path, and 320 px reflow on both pages
   - the no-JavaScript check on `/blog/` and on a post
   - Safari check: the post page's video and the newer/older grid.
9. Re-read the privacy policy against step 3 (expect no change). Add the `STYLE.md` entries. Add plan 011's description row and sitemap line.
10. Screenshots at 360 and 1280 px next to the header and footer, compared with `STYLE.md`. Then a manual keyboard and screen reader pass, and a check on a real iPhone.
11. The E2E spec runs against test posts (fixtures), so the post page is covered whatever is published.

12. Clip comparison block (lanes as sliders that seek and play: `YouTubePlayer` gains `playFrom(seconds)` on its handle): `remarkPost` accepts the `clips` block (`lib/blog/clips.ts` holds its types and the lane math) and checks it against `clips.json`; `ClipCompare` component (tabs, two `YouTubePlayer`s, the lanes); `YouTubePlayer` gains `start`, `end` and `onTime`. `STYLE.md` entry for the block. Unit tests for the block checks and the lane drawing (cuts and average motion up to the played time); component tests (tabs, one video at a time, empty before Play, the drawing follows the reported time) with axe; the every-element fixture gets a clips block.
13. `backend/scripts/clip_data.py`: pytest on a short generated clip for both measures; `backend/README.md` documents it.
14. E2E: a fixture post's block loads nothing from YouTube before Play, plays one video at a time, and draws as it plays; every published post's YouTube videos reach "playing" under the live site's origin. Safari check: the block's two layouts. Screenshots of the block at 360 / 768 / 1280 px.

## Posts

One entry per published post, newest first. Adding a post touches only this section (plus the post's own files): its decisions and steps go in its entry, and changes to the blog itself go in the sections above.

Every post's steps: write `content/blog/<slug>.md` and its media; for clip comparisons, run `uv run python scripts/clip_data.py <slug>` in `backend/`; check it with `npm run dev` at `localhost`, at 360 / 768 / 1280 px; commit as `feat: Add the blog post "<title>" (plan 018)`.

### Introducing HyperStim?: A New Way to Explore Children's Videos

- **File:** `content/blog/2026-11-09-introducing-hyperstim.md`, dated the day it's published (rename the file with the date). Text from the team _(human decision, 2026-11-09)_.
- **Clip comparison** (Video 1), caption "*Five Little Ducks* from *Mary's World* vs. *5 Little Ducks* from *KidsTV123*" _(human decision, 2026-11-10: A's channel by its current YouTube name, as the widget shows it; KidsTV123 replaces The Nursery Rhymes' counting video)_. Channel and video names are italic.
  - A: `enq9Ge90o1w`. B: `HOWt5un1-Ts` _(human decision, 2026-11-10)_.
  - "Scene changes": the first two verses, from "Five little ducks…" to "…only three little ducks came back" (A 0:14.5–0:51.8, B 0:14.4–0:55.4). "Motion": the same stretch as "Scene changes" _(human decision, 2026-11-10)_.
- **Numbers in the text** should match what each video's page on the site shows: A 32.4 cuts per minute and fast motion in 42.8 % of the video (dataset); B 4.9 cuts per minute and 0.2 % (the live site's analysis, as B isn't in the dataset), as of 2026-11-10.
- **"This is why we built HyperStim?."** keeps both marks: the question mark is part of the name _(human decision, 2026-11-09)_.
- **References** as footnotes _(human decision, 2026-11-09)_:
  1. Parents (2026): https://www.parents.com/news/some-think-cocomelon-is-too-stimulating-for-their-kids-we-asked-an-expert-to-weigh-insome-think-cocomelon-is-too-stimulating-for-their-kids-we-asked-an-expert-to-weigh-in/
  2. Forbes (2024): https://www.forbes.com/sites/traversmark/2024/05/17/why-kids-shows-like-cocomelon-hamper-critical-brain-development/
  3. The New Yorker (2024): https://www.newyorker.com/magazine/2024/06/17/cocomelon-children-television-youtube-netflix
- **Title:** "Introducing HyperStim?: A New Way to Explore Children's Videos", with the name's question mark _(human decision, 2026-11-09)_.
- ***HyperStim?*** is bold and italic in the TL;DR and the text, in the text's color, not navy _(human decision, 2026-11-09)_; the channel names (*Mary's World*, *KidsTV123*) and video names (*Five Little Ducks*, *5 Little Ducks*) are italic _(human decision, 2026-11-09)_.
- **TL;DR** _(human decision, 2026-11-09)_: "Meet ***HyperStim?***, a platform for exploring stimulation in children's YouTube videos. Compare videos side by side to explore the stimulation levels of videos your children watch, or better understand the production choices behind the videos you create."
- **Description:** the TL;DR is 250 characters, over the 155 limit, so the description is its first sentence: "Meet HyperStim?, a platform for exploring stimulation in children's YouTube videos."
- **Social video** _(human decision, 2026-11-10)_: a short film of the post's clip comparison, posted with the post on X and LinkedIn. Not on the site. Review: the artifact "Five Little Ducks Social Video" (rounds 1–34).
  - **Look:** the post's widget, drawn on a 1920 × 1080 canvas (16:9, as on X) from `STYLE.md`'s Clip comparison, laid out in two columns _(human decision, 2026-11-10: chosen over the widget's stacked lanes, which left the videos small)_: the switch on top, then each video under its head line with its own chart, time labels and number under it. Shapes at 1.6× the widget's CSS pixels, text and letters at 3.2× so they read in a feed _(human decision, 2026-11-10: 2.3× and 2.8× were too small)_. Gaps next to text grow with the text, gaps between shapes stay at 1.6×; the videos are 470 px tall and the charts take the height that's left. No border around the charts _(human decision, 2026-11-10: it was barely visible)_. Head lines: the letter (with the widget's earlier `navy/35` ring, kept as filmed _(human decision, 2026-11-11)_), centered on the title, flush with the video's left edge; the title over the channel _(human decision: the channel names changed with the widget)_. No opening or closing card, no notes on screen, no "Play video" buttons _(human decision, 2026-11-10)_.
  - **Switch:** only the current measure: one yellow chip in its bordered pill (the widget's SegmentedControl, 36 px of its 44 tall, scaled), centered. As the film swipes to Motion, "Scene changes" fades out, the chip takes Motion's width and "Motion" fades in _(human decision, 2026-11-10)_. The label is centered on its capitals in the chip _(human decision, 2026-11-10: it sat 3 px high)_.
  - **Structure:** one video plays at a time, each with its own song. Scene changes: A, then B, each the first verse ("Five little ducks…" to "…only four little ducks came back"). When B's verse ends, both rest for 0.5 s; then the switch moves to Motion while the videos and charts swipe left (0.7 s). Motion: A, then B, each the second verse ("Four little ducks…" to "…only three little ducks came back"). The film ends with the same rest after B's second verse (about 1:06) _(human decision, 2026-11-10)_.
  - **Fading** _(human decision, 2026-11-10)_: the side that isn't playing is faded to 20%: its video, head line (letter, title, channel) and chart. The film opens on both sides unfaded with their whole charts, as a preview of the results _(human decision, 2026-11-10)_; B fades as A starts. Motion opens with both faded, and A comes back over the 0.3 s before its turn. A fades as B starts and comes back over 0.3 s once B's verse ends. After its turn a video rests on its last frame.
  - **Charts:** a faded side shows its whole chart and final number; as its turn comes, that fades out and the chart drawing from 0 fades in _(human decision, 2026-11-10)_. Time labels every 5 s under each chart; both axes end where the longer verse ends _(human decision: the lanes never reached the next 5 s)_. Motion gridlines 0, 15, 30; a value above 30 rises above the top line _(human decision: not capped)_. The number on each chart's right, its unit after the figure and the rest under it, both in gray ("8 cuts / in 15 s", "10.2 % / of width/s"), the block ending at the video's right edge; the charts take the rest of the width _(human decision, 2026-11-10: more room for the timeline)_.
  - **Verses** (the boundaries come from a one-off word-timing run; only the times are kept): A's first verse ends just before its next shot's cut (0:30.2), so that cut isn't counted. Measured with `clip_data.py`'s pipeline settings on exactly these verses, so the numbers differ a little from the post's longer stretches. The committed `social-video.json` is from that measuring run, made before the script existed; YouTube refused the script's own run on 2026-11-10, so run it again once downloads work (it should give the same numbers).
  - **Files**, in a folder named like the post, next to it (the blog reads only the `.md` files at the top of `content/blog/`, so the folder is never a post):
    - `content/blog/<date>-<slug>/social-video.md`: the verses, as a `::::clips` block.
    - `social-video.json`: the videos and the measured verses, from `uv run python scripts/social_video_data.py <folder>` (in `backend/`; reuses `clip_data.py`'s download and measuring). Times and numbers only.
    - `social-video.html`: the film. It plays in a browser for review and exposes a frame-by-frame hook for rendering. Its timeline comes from the verses' lengths.
    - The render: `node scripts/social-video.mjs <folder>` in `frontend/` (no npm script, so `package.json` stays as it is; `--serve` opens the film for review instead) downloads the verses' stretches (720p) to a temporary folder with the backend's `yt-dlp`, draws every frame (30 fps) in Playwright's Chromium, and has `ffmpeg` join the frames and each turn's song into `<date>-<slug>.mp4` in the folder, named like it _(human decision, 2026-11-10)_. The clips are deleted afterwards.
    - **Thumbnail** _(human decision, 2026-11-10)_: the MP4's first frame (it opens on both results), saved by hand with `ffmpeg` as `<date>-<slug>.png` in the folder, for LinkedIn's thumbnail. Every post's social video gets one, and its first frame is designed to work as that thumbnail; the writing guide says so _(human decision, 2026-11-10)_.
    - The clips, the MP4 and the PNG are never committed (`.gitignore`, which ignores the folder's `.mp4` and `.png` files; `CLAUDE.md`, Public repository): the team posts them by hand.
  - **Footage:** the film shows parts of the two channels' videos; whether to post it as is or ask the channels first is the team's call.
  - **Steps:** the data script with pytest on its block parsing and output (measuring is `clip_data.py`'s, already tested); the film page; the render script; `.gitignore`; the writing guide and `backend/README.md` say how to make a post's social video. Check: render, then watch the MP4 against the artifact.

## Review decisions

- 2026-11-09: In the layout mockup, the intro line under "Blog" is gone, the kid is removed from post pages, the dividers between posts are straight, and the list and post use the full width (artifact round 2).
- 2026-11-09: In the layout mockup, `kid_notebook` replaces the stand-in, post titles fill the full width, and reference numbers are gray (artifact round 3).
- 2026-11-09: In the layout mockup, the newer / older links sit under the same thin line as References, with no fill (artifact round 4).
- 2026-11-09: In the layout mockup, the newer / older links stack left-aligned on phones (artifact round 5).
- 2026-11-09: In the layout mockup, the list has 10 posts per page with the page control under it, plus a page 2 view (artifact round 6).

## Open questions

None. The post's text is the team's _(human decision, 2026-11-10: the team rewrites it)_.
