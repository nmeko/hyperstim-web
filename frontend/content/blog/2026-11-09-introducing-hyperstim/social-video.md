# Social video: Introducing HyperStim?

The verses the post's social video plays (plan 018, Social video). Not a post: the blog reads only
the markdown files at the top of `content/blog/`. After changing a verse, measure it again with
`uv run python scripts/social_video_data.py ../frontend/content/blog/2026-11-09-introducing-hyperstim`
in `backend/`, then render the film (`npm run social-video` in `frontend/`, see the writing guide).

- Scene changes: the first verse, "Five little ducks went swimming one day…" to "…only four little
  ducks came back". A's ends just before its next shot's cut, so that cut isn't counted.
- Motion: the second verse, "Four little ducks went swimming one day…" to "…only three little ducks
  came back".

::::clips[Social video]{a=enq9Ge90o1w b=HOWt5un1-Ts}
::cuts[Scene changes]{a=0:15.3-0:30.2 b=0:14.4-0:30.6}
::motion[Motion]{a=0:37.4-0:52.1 b=0:39.6-0:55.2}
::::
