# 014 — Usage insights

**Area:** What the site counts about how it's used (nothing about who uses it), and where those numbers are kept for the team.
**Branch:** based on `013-growing-dataset` _(human decision, 2026-10-26)_: the counting hooks sit in the API code that plan 013 changes (its dataset store), so 013 merges first.

## Goal

Let the team see _(human decision, 2026-10-26)_:

1. **What people look at** among the videos and channels we have.
2. **What parents look for that we don't have:** videos checked live, channels looked up, searches that found nothing. A guide for what to expand next (plan 013) and what to improve.
3. **How the dataset grows** (plan 013): videos and channels over time, the collector's health.

No dashboard _(human decision, 2026-10-26)_: the numbers are kept on the server, and the team asks Claude (in a session on the server) to read them and present what they show.

## Decisions (proposed)

### What is counted

Daily totals, counted by our server **as part of what it already does for each visitor: nothing new is added to the API and the frontend doesn't change** _(human decision, 2026-10-26: no need to expose an API; the logs just need to hold the information)_. Nothing about who: no IP address, no cookie, nothing stored on the visitor's device, no visitor ID. So it needs no consent banner (unlike Google Analytics, which stays as it is, for visitors who accept it).

| What visitors do | What the log keeps per day |
|---|---|
| Open a video's page (or put it on one side of a compare) | the video's ID, whether it's in the dataset, how many times |
| Open a channel's page | the channel's ID, how many times |
| Ask for a live check of a video | the video's ID; whether it's new, already checked for someone else, or in the dataset; how many times. Its channel and results are in the live check's own file (`ANALYSIS_DIR/<id>.json`), joined when reading. |
| Paste a channel link (compare, rankings search) | the channel's ID, whether it's in the dataset, how many times |
| Search by name (rankings, compare) | the search text, videos or channels, whether anything was found, how many times |

- **Only finished searches count.** The search boxes search 300 ms after typing pauses, so the requests include half-typed words ("pe", "pep", "peppa"). The server keeps each IP address's last search in memory for 10 s; a new search that extends it (or a deletion back from it) replaces it, and only the last one of such a chain is counted, once nothing follows for 10 s. The IP is held in memory for those seconds only, never written, like the live check's per-IP limit. Only the first page of a search counts (paging and sorting the same results don't). Text is trimmed, lower-cased, spaces collapsed, at most 80 characters.
- **Rough numbers, not exact:** scripts and crawlers can inflate them.
- **Stored as a log on the server, not in git** _(human decision, 2026-10-26)_: one TSV file a day in the instance's `data/usage/` (`<date>.tsv`: kind, key, extra, count), plain text that Claude or anyone can read with standard tools. The API adds up counts in memory and rewrites today's file once a minute (write, then rename), so requests never wait on the disk (a crash loses at most a minute).
- **Kept for good** _(human decision, 2026-10-26)_: counts by video or channel ID and search texts.

### Privacy policy (plan 009)

- **One general paragraph** _(human decision, 2026-10-26: say that we collect interactions to improve the site, not what exactly we look at)_, in **When you browse the site**, in place of the paragraph on our request logs _(human decision, 2026-10-26: not that explicit on what we log; no retention period, a detail visitors don't need)_: "Our server keeps technical logs to keep the site running and safe, and counts how the site is used to improve it. Neither is used to identify you."
- Plan 009's table gets the detailed row (what's counted, kept for good, nothing about who). "Last updated" changes. Both land in the same change as the counting, as `CLAUDE.md` requires.

### Getting insights from the numbers

- **Where they are** (all on the server, none in git):

  | Question | Source |
  |---|---|
  | What people look at, check, look up, search for | `data/usage/<date>.tsv` (above) |
  | Which videos checked live, with their channel and results | `ANALYSIS_DIR/<id>.json` (exists, plan 004) |
  | How the dataset grows, the collector's health (pace, blocks, quota, CPU, disk) | `collector.db` and `hyperstim-collector status` (plan 013) |
  | What's in the dataset | the API's data, `backend/data/` |

- **The team can read them:** `setup.sh` gives the release group read access to `data/usage/`, `collector.db` and `ANALYSIS_DIR` (the service still owns them; nobody else can write). So a teammate, or Claude in their session, reads them directly.
- **A short guide in `backend/README.md`** ("Usage numbers"): what each file holds, its columns, and example questions ("most checked videos we don't have, by channel, last 30 days", "searches that found nothing", "growth per week", "share of the 100 busiest channels"), so a Claude session knows where to look without being told.
- It's for the team only: none of it is served by the API or committed.

## Steps

1. Review this plan.
2. **Counting:** the in-memory counter and the daily files, added where the backend already handles these requests; the search chains. Tests (counts, prefix chains, paging not counted, no IP in any file).
3. **Privacy policy:** the sentence, plan 009's table row, "Last updated".
4. **Server:** read access for the release group (`setup.sh`, plan 010), built with plan 013's deployment (decision 11).
5. **Docs:** `backend/README.md` ("Usage numbers" guide).

## Open questions

None.
