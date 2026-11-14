# Writing a blog post

How to write, preview and publish a post on the site's blog ([plan 018](../../../plans/018-blog.md)). This guide stays in the repo; it is not a post and never appears on the site.

The example post, [`src/lib/blog/fixtures/2026-11-09-every-element.md`](../../src/lib/blog/fixtures/2026-11-09-every-element.md), uses every element below. It is also the blog's test post, so everything it shows is known to work. Copy from it.

## Files

- **The post:** one markdown file, `frontend/content/blog/<date>-<slug>.md`, starting with the post's `date` so the folder lists posts in order: `2026-11-09-why-cuts-are-not-everything.md`. The slug, the rest of the name, becomes the post's URL, `/blog/why-cuts-are-not-everything/`. Use lowercase words joined by hyphens. If the publishing day changes, rename the file along with `date`.
- **Its media** (images, videos, posters): `frontend/public/blog-media/<slug>/`, a folder named after the slug (no date). In the post, refer to them by file name only.

## Front matter

Every post starts with this block:

```markdown
---
title: Why scene cuts are only part of the story
date: 2026-11-09
tldr: Fast editing is the measure most people think of, but a video can feel intense with few cuts. This post shows three videos where cuts alone would get it wrong.
description: Why scene cuts alone don't tell you how stimulating a kids' video is, with three examples.
---
```

| Field | | |
|---|---|---|
| `title` | required | The post's heading, and its name in search results ("<title> - HyperStim?"). |
| `date` | required | `YYYY-MM-DD`. Posts are listed newest first. |
| `tldr` | required | Two or three sentences in the TL;DR box at the top, and under the title in the list. `**bold**` and `*italic*` work here; put the text in quotes if it starts with `*` or holds a `:` followed by a space. |
| `description` | optional | What search results and link previews show. Without it they show the TL;DR. **At most 155 characters**: if the TL;DR is longer, add a description (a test checks this). |

There is no author, reading time or draft field. A post that isn't ready stays on its branch (see **Publishing**).

## Text

Write in American English (color, center, gray), in short paragraphs. Standard markdown works: `**bold**`, `*italic*`, lists, `> quotes`, links and tables.

- **Headings:** `##` for sections and `###` inside them. The title is the page's only top heading, so `#` isn't allowed.
- **Links to the site's own pages** start with `/`: `[the rankings](/rankings/)`. Links to other sites open in a new tab.
- **Tables:** a header row, then `|---|---|`. Wide tables scroll sideways on phones.

## Figures

```markdown
::figure[The caption, shown under the image.]{src="cuts-chart.webp" alt="What the image shows, for someone who can't see it."}
```

- `alt` is required: describe what the image shows. The caption can add what it means.
- Figures are numbered for you ("Figure 1.", "Figure 2."). Write only the caption's text.

## Videos

Our own recording, played from the site:

```markdown
::video[The caption.]{src="compare-page.mp4" poster="compare-page.webp"}
```

A YouTube video, embedded:

```markdown
::youtube[The caption, also the video's name for screen readers.]{id="dQw4w9WgXcQ"}
```

- The `id` is the 11 characters after `watch?v=` in the video's link.
- Nothing loads from YouTube until the reader presses Play.
- Add the video's ID to `backend/data/blog-videos.txt`, so its thumbnail shows (the API serves thumbnails only for videos it knows; a test reminds you). Videos in a comparison below are added for you.
- Videos and YouTube embeds share one count ("Video 1.", "Video 2."), apart from figures.

### Comparing two videos

A clip comparison plays two YouTube videos side by side, with a tab per stretch (a verse, say). As a video plays, a chart under it fills in: a tick for each cut to a new shot, or a line for how much the picture moves. One video plays at a time.

```markdown
::::clips[The caption.]{a=enq9Ge90o1w b=jyaUWUFH3BA}
::cuts[Scene changes]{a=0:14.5-0:30.5 b=0:03-0:21.6}
::motion[Motion]{a=0:36-0:51.5 b=0:21.6-0:39.6}
::::
```

- `a` and `b` are the two videos' IDs. Each tab is `::cuts` or `::motion`, with its label and the stretch of each video as `minutes:seconds-minutes:seconds` (tenths allowed).
- One tab is fine; with two or more, readers switch between them.
- The numbers come from `public/blog-media/<slug>/clips.json`. Make it (and remake it after changing a block) with:

  ```sh
  cd backend
  uv run python scripts/clip_data.py <slug>
  ```

  It downloads only the stretches, to a temporary folder it deletes, and measures them as the dataset does. The build fails while a block and `clips.json` don't match. It also lists both videos in `backend/data/blog-videos.txt`, for their thumbnails.
- Check that both videos play when embedded: preview at `localhost` (not `127.0.0.1` or a server's IP address, where YouTube refuses some videos), and from another computer through an SSH tunnel (`ssh -L 3000:localhost:3000 <server>`).
- It counts as a video ("Video 1.").

## References

Cite with a footnote: `[^key]` right after the words it supports, and the source anywhere in the file (the end is easiest):

```markdown
Studies of children's TV have looked at pacing this way for decades.[^pacing]

[^pacing]: Author, A., & Author, B. (2011). Title of the paper. *Journal Name*, 128(4), 644–649.
```

- Keys are any word you like; readers see numbers, `[1]`, `[2]`, in the order sources are first cited. Adding a citation never means renumbering.
- Each source is listed under **References** at the end, with a ↩ link back to the text.
- Cite the same source again with the same key.

## Media rules

- **Only our own material.** Images and figures come from the team. Videos are our own screen recordings, animations or talks. Never a clip downloaded from YouTube (the repo is public, `AGENTS.md`): embed the YouTube video instead.
- **Images:** WebP or PNG, at most twice as wide as they show (the text column is at most about 1,100 px wide, so at most 2,200 px).
- **Videos:** MP4 (H.264), at most 10 MB each, always with a poster image (WebP or PNG, the video's first frame or a good still).
- **Alt text** on every figure, saying what it shows.

## Checks

The build fails, naming the post's file and the problem, when:

- `title`, `date` or `tldr` is missing, or the date isn't a real `YYYY-MM-DD` date;
- a media file the post refers to isn't in its folder;
- a figure has no `alt`, a video no `poster`, or a YouTube embed no valid `id`;
- a clip comparison lacks a caption, a tab or valid times, or doesn't match its `clips.json`;
- a file name doesn't start with the post's `date`;
- two posts have the same slug (also on different dates);
- a citation `[^key]` has no source, or a source is never cited;
- a heading is `#` or deeper than `###`, or an image is written with `![…](…)` instead of `::figure`.

Before publishing a post with YouTube videos, check that they play when embedded (an uploader can turn embedding off). CI checks only that YouTube still allows embedding them, as YouTube asks its servers to sign in before playing. From `frontend/`, after `npx playwright install chromium` once:

```sh
npx playwright test youtube-embeds
```

## Preview

```sh
cd frontend
npm run dev
```

Open http://localhost:3000/blog/. The page updates as you save. A broken post shows the build's error in the browser.

## Social video

A post can have a short film for X and LinkedIn: its clip comparison played as a 1920 × 1080 video (plan 018, Social video). It isn't shown on the site. Its files live in a folder named like the post, next to it, which the blog never reads as a post: `content/blog/<date>-<slug>/`.

**Design the first frame as the thumbnail.** X and LinkedIn show a video's opening frame before anyone presses play, so make it say what the post is about on its own: the film opens on both videos with their results already showing, not on a blank or half-drawn screen. Check it before rendering: open the film with `--serve` and look at it before it starts.

- `social-video.md`: the verses each video plays, as a `::::clips` block (a `cuts` tab, then a `motion` tab).
- `social-video.json`: the measured verses. After changing a verse, run `uv run python scripts/social_video_data.py ../frontend/content/blog/<date>-<slug>` in `backend/`.
- `social-video.html`: the film, drawn like the post's widget.

Watch it, then render it:

```sh
cd frontend
node scripts/social-video.mjs content/blog/<date>-<slug> --serve   # prints an address to open
node scripts/social-video.mjs content/blog/<date>-<slug>           # writes <date>-<slug>.mp4 there
```

Both download the verses' stretches into a temporary folder first and delete them afterwards (they need the network, `uv` and ffmpeg). Rendering records every frame and takes about six minutes for a one-minute film. `--clips DIR` reuses clips downloaded before (see the script's header). The MP4 holds the channels' footage, so it's never committed (`.gitignore`); post it by hand. Then make the thumbnail: LinkedIn asks for an image when you post a video, so save the MP4's first frame next to it as `<date>-<slug>.png` (also ignored), in the post's folder:

```sh
ffmpeg -i <date>-<slug>.mp4 -frames:v 1 <date>-<slug>.png
```

Post both: the MP4, and on LinkedIn the PNG as its thumbnail.

## Publishing

1. Write the post on the blog's branch, `018-blog`, rebased onto `main` first (`DEVELOPMENT.md`). It stays there, unpublished, until it's merged.
2. Commit the post and its media together, as `feat: Add the blog post "<title>" (plan 018)`. It's new text visitors can read, so it gets a release note.
3. Merge it into `main` as for any change (lint, type check, tests and build pass first).
4. It goes live with the next release (`hyperstim-release`, run by the team).
