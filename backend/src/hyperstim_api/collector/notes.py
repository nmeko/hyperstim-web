"""The changelog's notes (plan 013, decision 10): one short line for each change to what the
collector picks or in what order, or to how the changelog counts, shown on the day it went live.

A change to the collector's rules or order adds a line here in the same commit, without a date:
the collector dates it the first day it runs with it. Keep each under ~70 characters.
"""

# (note, day): the day only for the notes from before the collector dated them itself.
NOTES: tuple[tuple[str, str | None], ...] = (
    ("Collecting starts: 150 videos a day, lowest r first", "2026-10-26"),
    ("Each channel gets 5 videos first; failed downloads retried", "2026-10-29"),
    ("Fewest-video channels first; channels with under 10% kids' videos left out", "2026-10-29"),
    ("Channels with 1–4 videos by score first; at most 3 new channels a day", "2026-10-29"),
    ("Counts end at 23:59:59 UTC; ch_ready, ch_out recounted from backups", None),
    ("Thinnest channels first; under 5 eligible a year left out; 3 new a day", None),
    ("A third of downloads for new channels to catch up; at most 3 new a day", None),
    ("New channels join by subscribers, most first; their counts read weekly", None),
    ("Pace lowered from 150 to 120 videos a day after three blocks", None),
)
