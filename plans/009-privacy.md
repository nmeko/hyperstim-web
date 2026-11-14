# 009 — Privacy policy

**Area:** Privacy policy page (`/privacy`), cookie consent, and (later) analytics.

## Goal

Build `/privacy`: a short policy, in plain words, that says exactly what the site does with visitor data today. Then add Google Analytics behind an opt-in banner, and update the policy with it.

## What the site does (checked in the code; GA rows once built)

| Where | What it sees or stores | Kept |
|---|---|---|
| GitHub Pages (hosts the pages) | IP address, browser, pages requested, in GitHub's own logs | GitHub's policy |
| Fonts | Self-hosted at build (`next/font`), so no request goes to Google Fonts | – |
| Our server (API) | Reverse proxy access and error logs: IP, time, URL requested, browser. The API itself logs no IPs (uvicorn's access log off in the app, see **Logs**) | 14 days |
| Live check, rate limit | IP address, in memory only, to allow 20 new checks per hour (plan 004) | ≤ 1 hour, never written to disk |
| Live check, results | Video ID, public video details, results. Nothing about who asked | Until removed by hand (plan 004) |
| Usage counts (plan 014) | Daily totals of what visitors do: videos and channels viewed, live checks, channel lookups (by ID), search texts (once a visitor stops typing for 10 s) and whether they found anything. No IP, cookie or visitor ID; each IP's last search is held in memory for 10 s only, never written. Said in the policy as one general sentence _(human decision, 2026-10-26)_ | Kept for good; the IP ≤ 10 s, in memory |
| Live check, the clip | Downloaded to our server for analysis | Deleted when the analysis finishes |
| YouTube thumbnails | Fetched by our server and cached there (see **Thumbnails**), so YouTube never sees the visitor. Public images only, nothing about visitors | 30 days on the server; the visitor's browser keeps each for a day |
| YouTube player | Loads only after "Play video" is clicked. Privacy-enhanced mode (`youtube-nocookie.com`). Once playing, YouTube may set cookies and local storage | Google's policy |
| Google Analytics | Only after Accept: IP, browser, device, pages viewed, referrer, sent to Google | 2 months in GA; cookies 2 years |
| Cookies, local storage | `_ga` cookies only after Accept; the consent choice in `localStorage` (never sent anywhere) | Cookies 2 years; choice 12 months |
| Contact form (Google Form, linked) | What the visitor writes: reply email, request, optional IP/time | Deleted once the request is handled |

## Decisions

- **Plain words, short sections, for parents.** No technical details such as "our server": the policy says "we" _(human decision, 2026-10-17)_. The same tone as How it works. No legal boilerplate beyond what the law requires.
- **Facts only, and kept true.** Each statement matches the table above. A change to any of these behaviours updates the policy in the same change (a rule added to 001).
- **"Last updated" date** at the top of the page.
- **Sections:**
  No "In short" summary box _(human decision, 2026-10-16)_.
  No "Who we are" section _(human decision, 2026-10-16)_: the policy names no team, and the contact link is in **Your choices**.
  1. **When you browse the site**: GitHub Pages logs, our own logs (full IP addresses _(human decision)_, kept 14 days), and why: to run the site and keep it safe from abuse. Said in general, together with the usage counts (plan 014), without listing what a log holds: "Our server keeps technical logs to keep the site running and safe, and counts how the site is used to improve it. Neither is used to identify you." _(human decision, 2026-10-26: not that explicit on what we log; no retention period, a detail visitors don't need)_. With analytics, also Google Analytics, only if the visitor accepts (see **Google Analytics → Policy changes**) _(human decision, 2026-10-17: no separate Analytics section)_.
  2. **When you check a video**: what is saved: "We save the results, with the video's ID, title and channel, so they're ready for the next person who checks the same video. They aren't linked to you." _(human decision, 2026-10-17: the earlier wording read awkwardly)_; the clip deleted after analysis; YouTube may set cookies when a video is played (link to Google's privacy policy). Not stated: the channel look-up and the in-memory rate-limit count _(human decision, 2026-10-17: details visitors don't need)_.
  3. ~~**YouTube**~~: no YouTube section; its one point (YouTube may set cookies when a video plays) is in **When you check a video** _(human decision, 2026-10-17: thumbnails and privacy-enhanced mode were details visitors don't need)_.
  4. **Cookies**: rewritten for analytics, see **Google Analytics → Policy changes**. YouTube's cookies are in **When you check a video**, not repeated here.
  5. ~~**Children**~~: no Children section _(human decision, 2026-10-17: one sentence alone as a section looked awkward; dropping "knowingly" from its second sentence would have made it untrue)_.
  6. **Your choices**: "To ask what we hold about you, or to have it deleted, please fill out the contact us form." _(human decision, 2026-10-16)_. No reply time and no hint about IP address and time (the form's IP and time fields cover it) _(human decision, 2026-10-16)_. Nothing on the form being run by Google, what we do with messages, or complaining to a data protection authority _(human decision, 2026-10-16)_.
  No "Changes to this policy" section; the "Last updated" date at the top stays _(human decision, 2026-10-16)_.
- **One policy for every visitor, with no jurisdiction named** _(human decision: visitors are mainly in the US, but anyone can visit)_. The text names no law and has no region-specific parts. Its content still meets the strictest common rules (EU/UK GDPR; in the US, California's CalOPPA and COPPA), which costs only a few plain sentences since we collect almost nothing:
  - what is collected, why, how long, who else sees it, the contact, a dated last update (all);
  - why we keep logs, said in plain words (security) (GDPR). GDPR also expects who runs the site, a reply time for requests and the right to complain to a data protection authority; left out _(human decision, 2026-10-16)_;
  - how Do Not Track is handled (CalOPPA, which applies once we collect emails through the contact form);
  - the children section (COPPA). The site is for parents, but its topic and picture-book style may make it look aimed at children. Today that's fine: IPs used only for security and rate limiting need no parental consent. With analytics too: the site is for parents, not aimed at children, so COPPA needs no parental consent for GA _(human decision, 2026-10-17)_. The Children section was later dropped (see **Sections**); COPPA needs no notice from a site not aimed at children.
  - Not legal advice: if the team belongs to an institution, its privacy office should read the final text.
- **Logs** (checked on the server; details stay off the repo). The policy promises 14 days, so every log with visitor IPs must keep to that:
  - Reverse proxy access/error logs: already rotated daily and deleted after 14 days. No change.
  - This repo's backend: uvicorn's access log is turned off in the app itself, not by a `--no-access-log` flag on the server _(human decision, 2026-10-17: off by default)_; also off locally. The reverse proxy already logs each request, so it would only add a second copy, kept as long as the server keeps the service's output. The app's own log lines contain no IPs (checked). Tested; documented in `backend/README.md`.
  - The old site's live-analysis API is out of scope: this site runs on this repo's backend only _(human decision)_.
- **Thumbnails through our backend** _(human decision: no third party sees the visitor before they press play; also one fewer outside dependency)_. Changes plans 004 and 005, which loaded thumbnails from YouTube's image server.
  - `GET /api/thumbnails/{video_id}?size=hq|mq`: the backend fetches each image from YouTube once and caches it on disk (`THUMBNAIL_DIR`, one file per video and size) for 30 days, then fetches it again _(human decision, 2026-10-17, plan 010: bounds what our server asks YouTube for, now that nginx has no rate limit)_; a thumbnail YouTube doesn't have is remembered for a day; if YouTube is unreachable, an older cached copy is served. No prefetching: an image is fetched the first time someone needs it _(human decision, 2026-10-17)_. The policy needs no change: it doesn't state how long the server keeps thumbnails, and they hold no visitor data _(human decision, 2026-10-17)_. The response has a 1-day cache header so the visitor's browser reuses it. The request to YouTube comes from our server, with no visitor data.
  - Only for videos the site knows (in the dataset, with a stored analysis, or embedded in a blog post, plan 018); anything else is 404 without asking YouTube, so the endpoint can't be used to fetch arbitrary images. _(human decision, 2026-11-10: blog videos added, so a post's thumbnails show like a dataset video's, analyzed or not)_ Unknown sizes: 422 (FastAPI's validation error).
  - If YouTube has no thumbnail: 404; YouTube unreachable: 502.
  - **When YouTube can't be reached, the server waits before asking again** _(human decision, 2026-11-02: each request waited up to 10 s and asked YouTube again, so an outage slowed every page and kept the server calling YouTube)_: with no cached copy, it remembers that for 10 minutes (an `.unreachable` file next to the image, like the `.missing` one) and answers 502 at once in that time, with `Cache-Control: no-store` so the browser asks again on the next page load. A cached copy is still served as before.
  - **A thumbnail that can't load shows a placeholder** _(human decision, 2026-11-02: a failed image showed the browser's broken-image icon, e.g. on channels whose videos YouTube took down; chosen from plain tile, picture icon and title letter in a review page)_: a 404, a 502 or a network error all look the same. The image's own box stays (`bg-navy/10`, its size and corners), and a picture icon (a rounded frame with a sun and a hill, `text-navy/30`, about a third of the box's height) sits in its middle. In a video preview (`YouTubePlayer`) the tile has no icon, since the Play button already sits in its middle; the button still plays the video. No text in the tile and no tooltip _(human decision, 2026-11-02: text inside the thumbnail's box was rejected)_; the image stays decorative (empty `alt`, the icon `aria-hidden`). What it means goes outside it (next point). One shared `Thumbnail` component draws the image or the placeholder for every user: `TimeChart`, `VideoStrip`, `CompareChart`, the compare `Picker`, `YouTubePlayer` (preview and cover), and the copy that flies in `grow`. It catches a load error with `onError`, and on mount also checks an image that had already failed (`complete` with no `naturalWidth`). No retry. A thumbnail that later works shows on the next page load. Its style goes into `STYLE.md` (Thumbnail placeholder). The policy needs no change: nothing new is stored or sent.
  - **A video whose thumbnail YouTube says is gone gets a line about the video** _(human decision, 2026-11-02: about the video's status, not the thumbnail, and outside the tile)_: "This video may have been removed or made private on YouTube." _(human decision, 2026-11-02: chosen from three wordings in a review page)_.
    - **Where** _(human decision, 2026-11-02)_: a footnote under the large previews (`mt-2 text-sm text-ink/80`): the video page (on phones under the title block, full width, as the preview there is too narrow), the compare slots, the channel page's video panel. And a last line in the chart popovers, `TimeChart` and `CompareChart` (`mt-2 text-ink/80`), so phones, where the channel chart has no thumbnails, get it too. Not on strip cards, hanging thumbnails or picker options: their title is right there, and many missing cards would repeat the line.
    - **Only on a 404** _(human decision, 2026-11-02)_: the browser can't tell why an image failed, so after an error `Thumbnail` asks our server for the same URL once and reads the status. A popover for a video whose thumbnail the page hasn't tried yet asks the same way. One small shared store (`lib/thumbnails.ts`) asks each video at most once per page load. A 502 or a network error shows the tile only, with no line, so a YouTube outage never labels every video as removed.
    - The footnote is plain text, so screen readers read it; the chart popovers stay `aria-hidden` as before. The policy needs no change: the extra request goes to our server, like the image.
  - **A thumbnail YouTube says is gone tells the collector** (plan 013, decision 5) _(human decision, 2026-11-02)_.
  - Frontend: `thumbnailUrl` moves from `lib/youtube.ts` to `lib/api.ts` (the one place that talks to the backend) and points to the endpoint (through `NEXT_PUBLIC_API_BASE`); every user (`YouTubePlayer`, `TimeChart`, `VideoStrip`) is unchanged otherwise.
  - Speed: one fewer outside host for the browser to connect to, but each image now goes through our one server (the fetch from YouTube takes about 40–90 ms), so first loads, especially far from the server, are a bit slower. The browser cache covers repeat views.
  - Tests: dataset/live/unknown ID, bad sizes and IDs, fetched once then served from the cache (also after a restart), fetched again after 30 days, a missing thumbnail → 404 and remembered for a day, YouTube down → 502 or the stale copy, no half-written files.
- **Contact form** _(human decision: a Google Form)_: https://forms.gle/oLbWLgE8sT6zHhLR9, title "HyperStim? Support", a general contact form that also takes privacy requests _(human decision)_. Linked from the policy as "contact us" _(human decision)_ and from the About page (plan 015) _(human decision, 2026-10-26)_, no footer link _(human decision)_; not embedded (no form code on our pages); no Google sign-in; responses go to a team account checked at least weekly; each response deleted once handled. Fields:

  | Field | Type, required | Description shown in the form |
  |---|---|---|
  | (Form description) | – | "Questions, feedback, or requests about your data on the HyperStim? website. Please don't include anything sensitive. We reply within 30 days and delete your message once it's handled." |
  | Email address | Short answer, email validation, required | "So we can reply. We use it only for this request." |
  | What would you like to do? | Multiple choice, required: "Ask what data you hold about me" · "Delete my data" · "Ask a question about privacy" · "Report a problem" · "Give feedback" · "Other" | – |
  | Details | Paragraph, required | "Tell us what your message is about." |
  | IP address | Short answer, optional | "Only for requests about our server logs, which we can find only by IP address and time. We keep logs for 14 days." |
  | Date and time of your visit | Short answer, optional | "Roughly, with your time zone, e.g. 16 Oct 2026, 3 pm EST." |

  Form settings: "Collect email addresses" off (the field above does it without a Google account), "Limit to 1 response" off (needs sign-in), no file upload (needs sign-in).
- **No cookie banner until analytics** _(human decision: only if the rules require it only with analytics; checked, they do)_. This changes 001.
  - EU/UK rules (ePrivacy) require consent before a site stores or reads anything on the visitor's device, unless it is strictly needed for what the visitor asked for. We store nothing (no cookies, no `localStorage`), so there is nothing to ask about. US law has no cookie-consent requirement.
  - The YouTube player loads only after "Play video" is clicked (plan 004), so YouTube's cookies follow the visitor's own request (the usual "click to load" approach). The policy explains this in **YouTube** and **Cookies**.
  - With analytics, the banner and the footer's "Cookie settings" link become required (below).
- **The kid: `kid_quiet`** _(human decision)_: sitting cross-legged, finger on lips, winking ("we keep quiet about you"). Transparent background. Sits on the policy card's top edge at the hero's right, at the hero kids' head size, compared by face width with the home kid (`w-52 lg:w-58 xl:w-68`, `STYLE.md`) _(human decision, 2026-11-10: at 85 % of its earlier size it looked too small)_. Added to `frontend/art/used.json`.
- **Page layout** (`STYLE.md`, Privacy page): the H1 and "Last updated", with the kid on the card's top edge; then **one section card holding all sections**, divided by lines (one card per section looked heavy for a text page). The text uses the card's full width _(human decision, 2026-10-16: `max-w-prose` left a third of the card empty)_. Anchors on each H2 (`#cookies`, `#youtube`, …), so other pages can link to a section. External links (GitHub, Google, the contact form) open in a new tab.
- **Links in:** footer "Privacy policy" (exists) and the FAQ answer "Do you keep anything about me?" (exists, plan 006).
- **No backend.** Static page.

## Google Analytics

Google Analytics 4 (GA) counts visits and pages, behind an opt-in banner _(human decision, 2026-10-17: GA preferred over a cookieless tool)_. It changes the policy: the site now sets cookies and sends data to Google, but only after the visitor accepts.

**Not aimed at children** _(human decision, 2026-10-17: the site is for parents, so COPPA's parental consent doesn't apply)_.

### Consent

- **Nothing from Google loads before Accept.** Consent Mode "basic": no `gtag.js`, no pings, no cookies until the visitor accepts. (Not "advanced", which sends cookieless pings before consent.)
- **Banner** on the first visit, the same for every visitor _(human decision, 2026-10-17: the first draft's question as heading didn't look professional)_: "**Cookies on HyperStim?** We'd like to use analytics cookies from Google Analytics to understand how people use the site and improve it. We set them only if you accept." Then **Accept** and **Reject** as two equal primary buttons (short labels _(human decision)_), centred, with no link _(human decision, 2026-10-17)_.
  - Not modal: the site works while it's open. A card at the bottom right, aligned with the page container's right edge _(human decision, 2026-10-17: the lower-left corner looked unnatural; centred tried, then bottom right preferred)_; gone once the visitor chooses.
  - Comes first in the page's reading order (before the skip link), labelled as a region ("Cookie choice"), so keyboard and screen-reader users meet it first. No focus stealing.
  - Rendered only in the browser (after reading the saved choice), so the static HTML has none and visitors who chose don't see it flash.
- **The choice** is kept in `localStorage` (`hyperstim-consent`: accepted or rejected, and the date). Asked again after 12 months. If `localStorage` is blocked, the choice holds for the current page view only and the banner returns next time.
- **Privacy signals:** Global Privacy Control or Do Not Track turned on counts as Reject: no banner, no GA _(human decision, 2026-10-17: Do Not Track too, not only GPC)_.
- **Changing the choice:** a "Cookie settings" button in the footer (next to Privacy policy) reopens the banner, showing the current choice. The policy's **Your choices** has a "cookie settings" text link that does the same. Withdrawing (Reject after Accept) deletes the `_ga` cookies and reloads the page, so GA is gone at once. The button is hidden when the signals above are on; then the banner isn't needed, and the policy explains why.

### Code

- The GA ID from `NEXT_PUBLIC_GA_ID` (an Actions variable in `deploy.yml`, like the other two; `.env.example`, `frontend/README.md`, `deploy/README.md`). Unset (local dev, CI, forks): no banner, no footer button, no GA code.
- One small consent module (`lib/consent.ts`): reads and saves the choice, checks the privacy signals, and on Accept adds `gtag.js` once with `allow_google_signals: false`, `allow_ad_personalization_signals: false`, and ad storage denied. Cookies keep GA's default of 2 years _(human decision, 2026-10-17)_. Hand-written, no new dependency (`@next/third-parties` isn't needed for one script).
- Page views: GA's enhanced measurement counts Next.js page changes from the browser history; no per-page code. Pages already have their own titles.
- Components: `ConsentBanner` (in the layout) and the footer's "Cookie settings" button.
- YouTube stays click-to-load and is independent of this choice (pressing "Play video" is the visitor's own request, plan 004).
- Tests: no script before a choice, after Reject, with GPC or DNT, or with no ID; Accept adds the script once; withdrawing deletes the cookies; the choice expires after 12 months; blocked `localStorage`; the banner's labels and equal buttons; the footer button only with an ID.

### Style

New surface in `STYLE.md`, **Consent banner**: the popover look, at the bottom right, `max-w-lg` so the text sits on two full lines _(human decision, 2026-10-17)_; heading, body, then the two primary buttons, centred (classes in `STYLE.md`). No kid (it would crowd small screens). Screenshots at 360 and 1280 px, with the footer and the home hero behind it.

### Policy changes (in the same change)

- **When you browse the site** gains a paragraph on analytics, after the server logs; no separate Analytics section _(human decision, 2026-10-17)_: only if you accept, we use Google Analytics to count visits and see which pages are used. Google receives your IP address, browser and device, the pages you view and how you got here, and stores them for 2 months. Google works for us as a service provider and may process the data in the US. We don't use it for ads and don't share it with Google for other purposes. How to change the choice is said once, in **Your choices**, not repeated here _(human decision, 2026-10-17: duplicated)_. Link to Google's privacy policy. The sentence on fonts and pictures coming with the site is dropped _(human decision, 2026-10-17)_.
- **Cookies** (rewritten): we set cookies only if you accept analytics; what they are for (Google Analytics tells visits apart) and how long they are kept (2 years, or until the choice changes). No cookie names _(human decision, 2026-10-17: not friendly for a general audience; purpose and duration are what the rules ask for)_. Your choice itself is saved in your browser (not a cookie) for a year so we don't ask again; it is never sent anywhere. The privacy signals (below). YouTube may set cookies after you press play.
- **Privacy signals** (in **Cookies**, replaces the Do Not Track sentence): "If your browser sends Global Privacy Control or Do Not Track, we treat it as a no to Google Analytics and don't ask." _(replaces the earlier human decision "We don't track you, so Do Not Track signals change nothing", which GA makes untrue)_
- **Your choices**: adds "You can change your mind about cookies at any time in cookie settings.", where "cookie settings" is a text link (a button styled as one) that reopens the banner; left out when there is no choice to make (no GA ID, or a privacy signal on) _(human decision, 2026-10-17: a text link here, not the earlier outlined button)_. No hint on finding a visitor's GA data (such as their `_ga` cookie value): too technical for most visitors, and GA data ends after 2 months anyway _(human decision, 2026-10-17: keep it simple)_.
- "Last updated" date; the table at the top of this plan gains the GA and consent rows; the contact form's "no Google code on our pages" becomes "no form code on our pages".
- FAQ "Do you keep anything about me?" (plan 006) adds: "If you allow it, Google Analytics counts your visit."
- 001: the banner and footer link now exist; "no analytics or cookies from us" becomes "analytics only after consent".

### GA settings (done by the team in GA's admin, not in code)

1. Create a GA4 property and a web stream for the site's address; send the measurement ID (`G-…`). It's public (it appears in the page), but it goes in the Actions variable, not the code.
2. Data retention: 2 months. Google Signals off. Granular location and device data collection off. Ads personalisation off. All data-sharing settings off.
3. Accept the Data Processing Terms (Admin → Account settings), which makes Google a processor.
4. Enhanced measurement on, with "Page changes based on browser history events".
5. Set the Actions variable `NEXT_PUBLIC_GA_ID`, then release (plan 010).

## Steps

1. ~~Answer the open questions.~~ The copy is reviewed on the built page _(human decision: no separate copy review in the plan)_; the text lives in `PrivacyPage.tsx`.
2. ~~Build `/privacy`~~ (page, sections, anchors, kid); tests: headings and anchors in order, the contact link, the stated retention times (logs, the rate-limit count).
3. ~~Backend: the thumbnail endpoint~~ (`thumbnails.py`, README); the README's **Privacy** section (access log off, 14-day proxy logs).
4. ~~Update 001~~ (privacy page, no banner until analytics, the policy-stays-true rule, the thumbnail endpoint), 004 and 005 (thumbnails from our backend).
5. ~~Lint, type check, tests, build; screenshots at 360, 768, 1280, 1920 px.~~
6. ~~Google Analytics:~~ `lib/consent.ts`, `ConsentBanner`, the footer's "Cookie settings", `NEXT_PUBLIC_GA_ID` (deploy workflow, `.env.example`, READMEs); tests.
7. ~~Policy~~ (Analytics, Cookies, privacy signals, Your choices, date), FAQ answer (006), 001, `STYLE.md` (Consent banner).
8. ~~Lint, type check, tests, build; screenshots at 360 and 1280 px; check in the browser's network tab that nothing goes to Google before Accept, after Reject, or with GPC on.~~
9. The team: GA settings (above) and the Actions variable; then release when asked.
10. **Missing thumbnails** (2026-11-02, Thumbnails): _built 2026-11-02._ the 10-minute wait after YouTube can't be reached (`thumbnails.py`; tests: answered 502 at once in those 10 minutes without asking YouTube, asked again after them, a cached copy still served, `no-store` on the 502); the `Thumbnail` component with the placeholder, used by all six users above; `STYLE.md` (Thumbnail placeholder, and the entries that mention the thumbnail's grey box). Tests: component (the placeholder after an error event and for an image that failed before mount, no icon in a preview with the Play button still there, axe); E2E with one video's thumbnail answered 404 (channel page from `sm` and the phone strip, video page, compare picker: placeholder shown, no broken image, the rest unchanged); the Safari check. Screenshots at 360 and 1280 px (with the real Nomad Kids TV videos YouTube no longer has). Plans 004, 005, 008, 010. Stop for review.
11. **A line about the video** (2026-11-02, Thumbnails): _built 2026-11-02._ the shared store and the status check; the footnote under previews (`YouTubePlayer` users: video page, compare slots, channel panel) and the popover line (`TimeChart`, `CompareChart`); `STYLE.md` (Thumbnail placeholder, Over-years chart, Two-channel chart); a backend test that the 404 and 502 carry the CORS header, so the page can read them. Tests: unit (the store asks once per video; 404 → gone, 502 and network errors → not), component (footnote and popover line for a 404, neither for a 502, axe); E2E with one thumbnail answered 404 and one 502 (video page at phone and desktop, channel panel and popover, compare slot); the Safari check. Screenshots at 360 and 1280 px. Plans 004, 005, 008. Stop for review.

## Open questions

None.
