---
title: An example post with every element
date: 2026-11-09
tldr: This post shows **each thing** a blog post can hold, so you can copy what you need. It is the writing guide's example and the blog's test post, and it never appears on the live site.
description: An example post that shows headings, figures, videos, YouTube embeds, a clip comparison, references, lists, quotes and a table.
---

A post starts with its text straight away: the title, date and TL;DR above come from the front matter. Write in short paragraphs, in American English, and link to the site's own pages where they explain more, like [how we measure a video](/how-it-works/) or the [rankings](/rankings/). Links to other sites, like the [Next.js docs](https://nextjs.org/docs), open in a new tab.

## Headings

Use two levels: `##` for sections and `###` inside them. The post's title is its only top heading.

### A smaller heading

Text can be **bold** or *italic*, and a citation goes right after the words it supports.[^measures] The same source can be cited again later.

## Figures

A figure is an image from the team, with alt text that says what it shows and a caption under it. Figures are numbered for you.

::figure[The kid holding a coral card and a blue card, as on the Compare page.]{src="kid-with-cards.webp" alt="A drawing of a child sitting cross-legged, holding up a coral card in one hand and a blue card in the other."}

## Videos

A video is a recording the team made, with a poster image that shows before it plays. Videos are numbered apart from figures.

::video[A short animation of the kid waving.]{src="kid-waving.mp4" poster="kid-waving-poster.webp"}

A YouTube video is embedded instead of copied. Nothing loads from YouTube until the reader presses Play, and it counts as a video too.[^youtube]

::youtube[A kids' video from our dataset.]{id="--87Tdi3b-I"}

A clip comparison plays two YouTube videos of the same song side by side, one tab per stretch, and draws what we measure as each video plays. Its numbers come from `clips.json`, which a script measures (see the writing guide).

::::clips[Two videos of the same nursery rhyme.]{a=enq9Ge90o1w b=jyaUWUFH3BA}
::cuts[Scene changes]{a=0:14.5-0:30.5 b=0:03-0:21.6}
::motion[Motion]{a=0:36-0:51.5 b=0:21.6-0:39.6}
::::

## Lists, quotes and tables

- A list item
- Another one, with a [link](/compare/)

1. A numbered step
2. The next step

> A quote stands apart from the text around it.

| Measurement | What it counts |
|---|---|
| Rapid cutting | Cuts per minute |
| Loudness jumps | Sudden rises in sound |

That's everything. Cite once more to show a source used twice.[^measures]

[^measures]: HyperStim? (2026). [How it works: what we measure](/how-it-works/).
[^youtube]: HyperStim? (2026). [Privacy policy](/privacy/): what YouTube receives when you play a video.
