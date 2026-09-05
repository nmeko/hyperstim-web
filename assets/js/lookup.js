/**
 * ---------------------------------------------------------
 * HyperStim lookup.js — index.html logic
 * ---------------------------------------------------------
 */

let activeVideos = SITE_DATA.videos.slice();

// Pagination: renders a bounded batch of cards with a "Show more" button,
// rather than the full result set at once. This used to be mobile-only
// (5 at a time) when the dataset was 189 videos and rendering everything
// on desktop was harmless. At the current dataset size (5000+), rendering
// every card unconditionally on desktop was measured at nearly 2 seconds
// of blocking JS work before the page became interactive -- so desktop
// now paginates too, just with a much larger page size. Resets whenever
// the underlying result set changes (new search/filter).
const MOBILE_PAGE_SIZE = 5;
const DESKTOP_PAGE_SIZE = 30;
const MOBILE_BREAKPOINT = "(max-width: 600px)";
let visibleCount = DESKTOP_PAGE_SIZE;

function isMobileViewport() {
    return typeof window.matchMedia === "function" && window.matchMedia(MOBILE_BREAKPOINT).matches;
}

function currentPageSize() {
    return isMobileViewport() ? MOBILE_PAGE_SIZE : DESKTOP_PAGE_SIZE;
}

/* =========================================================
   Elements
========================================================= */

const grid = document.getElementById("card-grid");
const input = document.getElementById("video-input");
const button = document.getElementById("lookup-button");
const dropZone = document.getElementById("drop-zone");
const dropStatus = document.getElementById("drop-status");
const topicFilter = document.getElementById("topic-filter");
const ageFilter = document.getElementById("age-filter");
const popularityFilter = document.getElementById("popularity-filter");
const sortSelect = document.getElementById("sort-select");
const clearFiltersButton = document.getElementById("clear-filters-button");
const resultCount = document.getElementById("result-count");

const videoContainer = document.getElementById("video-container");
const ratingContainer = document.getElementById("rating-container");
const detailsPanel = document.getElementById("details-panel");

const audienceButtons = document.querySelectorAll("#audience-toggle button");
const audienceNote = document.getElementById("audience-note");

/* =========================================================
   1. Card grid rendering (shared render path for grid + single result)
========================================================= */

// The video closest to the dataset's median composite score, among
// videos that actually have real coverage — a trustworthy starting
// point for someone who doesn't want to browse the whole dataset.
// Computed once; self-adjusting if the dataset changes on a future build.
const REFERENCE_VIDEO = (() => {
    const covered = SITE_DATA.videos.filter(v => v.composite_percentile != null);
    if (!covered.length) return null;
    const sorted = covered.slice().sort((a, b) => a.composite_percentile - b.composite_percentile);
    return sorted[Math.floor(sorted.length / 2)];
})();

function typeBreakdownHTML(video) {
    return allTypeEntries(video).map(entry => {
        const schema = TAXONOMY_SCHEMA[entry.categoryKey].types[entry.typeKey];
        const band = bandFor(entry.percentile);
        const rawBits = Object.entries(entry.features || {})
            .map(([key, f]) => `${key}: ${f.value ?? "n/a"}`)
            .join(" · ");

        return `
            <div class="type-row">
                <div class="rating-badge rating-${band.class}">${formatBand(band, entry.percentile)}</div>
                <h4>${schema.label}</h4>
                <p>${schema.explanation}</p>
                <p class="raw-values">${rawBits}</p>
            </div>
        `;
    }).join("");
}

function cardHTML(video) {
    const topic = deriveTopic(video);
    const isReference = REFERENCE_VIDEO && video.video_id === REFERENCE_VIDEO.video_id;
    const referenceBadge = isReference
        ? `<div class="reference-badge">Reference Point: closest to the dataset average</div>`
        : "";

    const band = bandFor(video.composite_percentile);
    const ageLabel = video.target_age_group === "0-5" ? "Ages 0-5"
        : video.target_age_group === "6-12" ? "Ages 6-12"
        : null;
    const quickLabelHTML = band.class !== "unknown"
        ? `
            <p class="video-quick-label">
                ${ageLabel ? `${ageLabel} &middot; ` : ""}<span class="rating-badge rating-${band.class} rating-badge-small">${band.label}</span>
            </p>
          `
        : "";

    return `
        ${referenceBadge}
        <div class="video-thumb">
            <img src="${youtubeThumbnail(video.video_id)}" alt="${video.title}" loading="lazy">
        </div>
        <h3>${video.title}</h3>
        <p class="video-channel">${video.channel}</p>
        ${quickLabelHTML}
        <p class="video-category">${topic} &middot; ${video.era || ""}</p>
        ${compositeBadgeHTML(video)}
        <ul class="score-list">
            ${categoryScoreLineHTML(video, "pacing_intensification")}
            ${categoryScoreLineHTML(video, "recovery_denial")}
            ${categoryScoreLineHTML(video, "reward_patterning")}
        </ul>
        <div class="card-actions">
            <button class="details-button" type="button" data-video="${video.video_id}">View Full Details</button>
            <a class="secondary compare-link" href="compare.html#a=${video.video_id}">Compare This</a>
        </div>
    `;
}

// Hover-to-preview: after a short pause hovering a card's thumbnail, swap
// the static image for a small muted autoplay preview. Only one preview
// plays at a time (mouseleave tears it down), and this is skipped entirely
// for unavailable videos or when the user prefers reduced motion.
function attachHoverPreview(cardEl, video) {
    if (video.available === false) return;
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const thumb = cardEl.querySelector ? cardEl.querySelector(".video-thumb") : null;
    const img = cardEl.querySelector ? cardEl.querySelector(".video-thumb img") : null;
    if (!thumb || !img) return;

    let hoverTimer = null;
    let previewFrame = null;

    cardEl.addEventListener("mouseenter", () => {
        hoverTimer = setTimeout(() => {
            if (previewFrame) return;
            previewFrame = document.createElement("iframe");
            previewFrame.src = `https://www.youtube.com/embed/${video.video_id}?autoplay=1&mute=1&controls=0&modestbranding=1&playsinline=1`;
            previewFrame.className = "card-hover-preview";
            previewFrame.tabIndex = -1;
            previewFrame.setAttribute("aria-hidden", "true");
            previewFrame.setAttribute("allow", "autoplay");
            thumb.appendChild(previewFrame);
            img.style.visibility = "hidden";
        }, 500);
    });

    cardEl.addEventListener("mouseleave", () => {
        clearTimeout(hoverTimer);
        if (previewFrame) {
            previewFrame.remove();
            previewFrame = null;
            img.style.visibility = "";
        }
    });
}

function renderCards(videos) {
    if (!grid) return;

    grid.innerHTML = "";

    if (!videos.length) {
        grid.innerHTML = `
            <article class="video-card">
                <h3>No results found</h3>
                <p>Try a different search term, or clear the topic filter.</p>
            </article>
        `;
    } else {
        const pageSize = currentPageSize();
        const visibleVideos = videos.slice(0, visibleCount);

        visibleVideos.forEach(video => {
            const card = document.createElement("article");
            card.className = "video-card";
            card.dataset.video = video.video_id;
            card.innerHTML = cardHTML(video);
            grid.appendChild(card);
            attachHoverPreview(card, video);
        });

        if (videos.length > visibleVideos.length) {
            const remaining = videos.length - visibleVideos.length;
            const showMoreButton = document.createElement("button");
            showMoreButton.type = "button";
            showMoreButton.className = "secondary show-more-button";
            showMoreButton.textContent = `Show ${Math.min(pageSize, remaining)} more (${remaining} left)`;
            showMoreButton.addEventListener("click", () => {
                visibleCount += currentPageSize();
                renderCards(videos);
            });
            grid.appendChild(showMoreButton);
        }
    }

    if (resultCount) {
        resultCount.textContent = `${videos.length} video${videos.length === 1 ? "" : ""}${videos.length === 1 ? "" : "s"} shown`;
    }
}

/* =========================================================
   2. Filtering + sorting
========================================================= */

function populateTopicFilter() {
    if (!topicFilter) return;
    const counts = {};
    SITE_DATA.videos.forEach(v => {
        const topic = deriveTopic(v);
        counts[topic] = (counts[topic] || 0) + 1;
    });
    Object.keys(counts).sort().forEach(topic => {
        const option = document.createElement("option");
        option.value = topic;
        option.textContent = `${topic} (${counts[topic].toLocaleString()})`;
        topicFilter.appendChild(option);
    });
}

// Popularity tiers are a small, known set of raw values from the pipeline
// (e.g. "tier1_10M+") -- map them to something readable rather than
// showing the raw underscore-separated string.
const POPULARITY_LABELS = {
    tier1_10m: "Tier 1 (10M+ subscribers)",
    tier2_1m: "Tier 2 (1M-10M subscribers)",
    tier3_100k: "Tier 3 (100K-1M subscribers)",
    tier4_10k: "Tier 4 (10K-100K subscribers)",
};

function prettifyFilterLabel(raw, knownLabels) {
    const normalize = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    const key = normalize(raw);
    for (const [k, label] of Object.entries(knownLabels || {})) {
        if (key.startsWith(normalize(k))) return label;
    }
    return raw.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function populateAgeFilter() {
    if (!ageFilter) return;
    const counts = {};
    SITE_DATA.videos.forEach(v => {
        if (!v.target_age_group) return;
        counts[v.target_age_group] = (counts[v.target_age_group] || 0) + 1;
    });
    Object.keys(counts).sort().forEach(value => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = `Ages ${value} (${counts[value].toLocaleString()})`;
        ageFilter.appendChild(option);
    });
}

function populatePopularityFilter() {
    if (!popularityFilter) return;
    const counts = {};
    SITE_DATA.videos.forEach(v => {
        if (!v.popularity_tier) return;
        counts[v.popularity_tier] = (counts[v.popularity_tier] || 0) + 1;
    });
    Object.keys(counts).sort().forEach(value => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = `${prettifyFilterLabel(value, POPULARITY_LABELS)} (${counts[value].toLocaleString()})`;
        popularityFilter.appendChild(option);
    });
}

// Search-suggestion datalist, populated from real video titles and channel
// names so the search box behaves like a real app's search rather than a
// guess-and-check text field with no feedback until you hit Enter.
function populateVideoSuggestions() {
    const datalist = document.getElementById("video-suggestions");
    if (!datalist) return;

    // Native browser <datalist> autocomplete can get sluggish with many
    // thousands of options. Cap the total and prioritize: fully-scored
    // video titles first (the most useful/complete results to search
    // for), then unique channel names, up to the cap.
    const SUGGESTION_CAP = 1000;
    const titles = new Set();
    const channels = new Set();

    SITE_DATA.videos.forEach(video => {
        if (video.title && video.composite_percentile !== null) titles.add(video.title);
        if (video.channel) channels.add(video.channel);
    });

    const combined = [...titles, ...channels].slice(0, SUGGESTION_CAP);
    combined.forEach(entry => {
        const option = document.createElement("option");
        option.value = entry;
        datalist.appendChild(option);
    });
}

function applyFiltersAndSort() {
    const query = (input.value || "").trim().toLowerCase();
    const topic = topicFilter ? topicFilter.value : "";
    const age = ageFilter ? ageFilter.value : "";
    const popularity = popularityFilter ? popularityFilter.value : "";
    const sortMode = sortSelect ? sortSelect.value : "intense-first";

    let videos = SITE_DATA.videos.filter(video => {
        const matchesQuery =
            !query ||
            video.title.toLowerCase().includes(query) ||
            video.channel.toLowerCase().includes(query) ||
            deriveTopic(video).toLowerCase().includes(query);
        const matchesTopic = !topic || deriveTopic(video) === topic;
        const matchesAge = !age || video.target_age_group === age;
        const matchesPopularity = !popularity || video.popularity_tier === popularity;
        return matchesQuery && matchesTopic && matchesAge && matchesPopularity;
    });

    videos = videos.slice().sort((a, b) => {
        if (sortMode === "alphabetical") return a.title.localeCompare(b.title);

        const pa = a.composite_percentile;
        const pb = b.composite_percentile;
        const aUnscored = pa === null || pa === undefined;
        const bUnscored = pb === null || pb === undefined;

        // Unscored videos have no real position in either ranking --
        // treating a missing score as 0 (the old behavior) silently made
        // every unrated video look like "the calmest," which is actively
        // misleading, not just a missing-data quirk. Always push them to
        // the bottom, regardless of which sort direction is active.
        if (aUnscored && bUnscored) return 0;
        if (aUnscored) return 1;
        if (bUnscored) return -1;

        return sortMode === "calm-first" ? pa - pb : pb - pa;
    });

    if (clearFiltersButton) {
        const anyFilterActive = Boolean(query || topic || age || popularity);
        clearFiltersButton.hidden = !anyFilterActive;
    }

    activeVideos = videos;
    visibleCount = currentPageSize();
    renderCards(videos);
}

/* =========================================================
   3. Single-video lookup result (search / paste / drop)
========================================================= */

function findVideo(rawInput) {
    const id = youtubeId(rawInput);
    if (id) {
        const byId = SITE_DATA.videos.find(v => v.video_id === id);
        if (byId) return byId;
    }
    const query = (rawInput || "").trim().toLowerCase();
    if (!query) return null;
    return SITE_DATA.videos.find(v =>
        v.title.toLowerCase().includes(query) || v.channel.toLowerCase().includes(query)
    ) || null;
}

function renderVideoPanel(video, notFoundQuery, query) {
    if (!video) {
        if (notFoundQuery) {
            videoContainer.innerHTML = "";
            const offered = offerLiveAnalysis(query, videoContainer);
            if (!offered) {
                videoContainer.innerHTML = `<div class="panel-placeholder">${mascotSVG(56)}<p>This video isn't in the current dataset.</p></div>`;
            }
        } else {
            videoContainer.innerHTML = `<div class="panel-placeholder">Search above, or choose "View Full Details" on a video below.</div>`;
        }
        ratingContainer.innerHTML = notFoundQuery
            ? `
                <div class="not-found">
                    <h3>This video hasn't been measured by this dataset yet</h3>
                    <p>Only videos the research pipeline has already processed have a permanent
                    dataset score. A live, one-time analysis has started automatically above,
                    using the same measurement pipeline as the research dataset.</p>
                </div>
              `
            : "";
        return;
    }

    renderFoundVideoDisplay(video);
}

// Populates the video embed and the 3-category rating summary beneath
// it -- shared by normal dataset videos AND completed live-analysis
// results, so both render identically rather than live analysis having
// its own separate, different-looking layout.
function renderFoundVideoDisplay(video) {
    videoContainer.innerHTML = videoEmbedHTML(video);

    ratingContainer.innerHTML = `
        ${video.live_analysis ? `<div class="live-analysis-badge">Live Analysis — not part of the permanent dataset</div>` : ""}
        <h3>${video.title}</h3>
        <p class="video-channel">${video.channel} &middot; ${video.era || ""}</p>
        ${scoreMeterHTML(video)}
        <button type="button" class="secondary copy-link-button" data-video-id="${video.video_id}">Copy Link to This Result</button>
    `;
}

// This is the exact content that previously lived inside the "View Full
// Details" popup modal — reused as-is, just rendered into the permanent
// right-hand panel instead of a modal-panel overlay.
function renderDetailsPanel(video) {
    if (!video) {
        detailsPanel.innerHTML = `<div class="panel-placeholder">${mascotSVG(72)}<p>Select a lookup result to view its detailed information.</p></div>`;
        return;
    }

    const similar = findSimilarVideo(video);
    const similarHTML = similar
        ? `
            <div class="similar-suggestion">
                <p>See how this compares to a similar video:</p>
                <a class="secondary" href="compare.html#a=${video.video_id}&b=${similar.video_id}">
                    Compare with "${similar.title}" (${similar.era || "Contemporary"})
                </a>
            </div>
          `
        : "";

    const band = bandFor(video.composite_percentile);
    const calmerAlt = band.class === "extreme" ? findCalmerAlternative(video) : null;
    const calmerAltHTML = calmerAlt
        ? `
            <div class="calmer-alternative-suggestion">
                <p><strong>Looking for something calmer?</strong> This video scores high on production intensity. Here's a similar video with meaningfully less:</p>
                <a class="secondary" href="index.html#v=${calmerAlt.video_id}">
                    View "${calmerAlt.title}"
                </a>
                <a class="secondary" href="compare.html#a=${video.video_id}&b=${calmerAlt.video_id}">
                    Compare the two directly
                </a>
            </div>
          `
        : "";

    detailsPanel.innerHTML = `
        <h4 id="sensory-details" class="sensory-details-heading sensory-details-heading-first">Sensory Details</h4>
        <div class="category-matrix">
            ${categoryMatrixHTML(video)}
        </div>
        ${calmerAltHTML}
        ${similarHTML}
    `;
}

// Unified update path: used by search/paste lookup, drag-and-drop, the
// "View Full Details" button on a card, and hash-based deep links. Updates
// the video panel and the details panel together, per the split-screen spec.
function showDetails(video, notFoundQuery, query) {
    renderVideoPanel(video, notFoundQuery, query);
    renderDetailsPanel(video);

    if (video) {
        location.hash = `v=${video.video_id}`;
        scrollResultsIntoView();
    } else {
        if (history.replaceState) {
            history.replaceState(null, "", location.pathname + location.search);
        }
        // Not found (including the live-analysis case) still needs the
        // same auto-scroll: without it, someone searching a video that
        // isn't in the dataset has no reason to notice that a "starting
        // live analysis..." message appeared below the fold, and might
        // assume their search just didn't do anything.
        if (notFoundQuery) scrollResultsIntoView();
    }
}

// Scrolls the results area into view after a selection, so a person
// doesn't have to notice on their own that something appeared below
// the fold. Instant (not smooth) for anyone with reduced-motion set.
function scrollResultsIntoView() {
    const workspace = document.getElementById("workspace");
    if (!workspace) return;
    const prefersReducedMotion = typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    workspace.scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth", block: "start" });
}

function runLookup() {
    const query = input.value;
    const video = findVideo(query);
    showDetails(video, !video && query.trim().length > 0, query);

    // The search box doubles as a live filter for the card grid below
    // (see the "input" listener near the bottom of this file). Left
    // as-is after a successful lookup, a pasted URL or raw video ID
    // would keep filtering that grid too -- and since no title or
    // channel literally contains a URL/ID string, the grid would be
    // stuck showing zero results with no obvious reason why. Clearing
    // the box once the lookup succeeds lets the grid revert to
    // showing everything, matching what the person actually did (find
    // one specific video), not what the leftover text looks like.
    if (video) {
        input.value = "";
        applyFiltersAndSort();
    }
}

/* =========================================================
   4. Drag-and-drop: YouTube link text, or a local file (filename match)
========================================================= */

function fuzzyMatchFilename(filename) {
    const tokens = filename
        .toLowerCase()
        .replace(/\.[a-z0-9]+$/, "")
        .split(/[^a-z0-9]+/)
        .filter(t => t.length > 2);

    if (!tokens.length) return null;

    let best = null;
    let bestScore = 0;

    SITE_DATA.videos.forEach(video => {
        const haystack = `${video.title} ${video.channel}`.toLowerCase();
        const score = tokens.filter(t => haystack.includes(t)).length;
        if (score > bestScore) {
            bestScore = score;
            best = video;
        }
    });

    return bestScore > 0 ? best : null;
}

if (dropZone) {
    ["dragenter", "dragover"].forEach(evt =>
        dropZone.addEventListener(evt, e => {
            e.preventDefault();
            dropZone.classList.add("drag-over");
        })
    );

    ["dragleave", "drop"].forEach(evt =>
        dropZone.addEventListener(evt, e => {
            if (evt === "drop") e.preventDefault();
            dropZone.classList.remove("drag-over");
        })
    );

    dropZone.addEventListener("drop", e => {
        const uriList = e.dataTransfer.getData("text/uri-list");
        const plainText = e.dataTransfer.getData("text/plain");
        const droppedText = uriList || plainText;

        if (droppedText) {
            input.value = droppedText;
            runLookup();
            if (dropStatus) dropStatus.textContent = `Looked up dropped link: ${droppedText}`;
            return;
        }

        const files = e.dataTransfer.files;
        if (files && files.length) {
            const match = fuzzyMatchFilename(files[0].name);
            if (dropStatus) {
                dropStatus.textContent = match
                    ? `Matched dropped file "${files[0].name}" to "${match.title}" by filename (not a fresh analysis).`
                    : `No dataset video matched the filename "${files[0].name}".`;
            }
            showDetails(match, !match);
        }
    });
}

/* =========================================================
   5. Selecting a result: search/paste, a card's "View Full
   Details" button, or a deep link (#v=VIDEO_ID) all route
   through the same showDetails() — no popup is ever opened.
========================================================= */

document.addEventListener("click", e => {
    // The "Compare This" link should navigate normally, not also
    // trigger showDetails() on the current page it's about to leave.
    if (e.target.closest(".compare-link")) return;

    const trigger = e.target.closest("[data-video]");
    if (!trigger) return;
    const video = SITE_DATA.videos.find(v => v.video_id === trigger.dataset.video);
    if (video) {
        showDetails(video);
        detailsPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
});

function openFromHash() {
    const match = location.hash.match(/#v=([A-Za-z0-9_-]{11})/);
    if (!match) return;
    const video = SITE_DATA.videos.find(v => v.video_id === match[1]);
    if (video) showDetails(video);
}

/* =========================================================
   6. Audience toggle
========================================================= */

const AUDIENCE_COPY = {
    parent: "As a parent: use the overall band as a quick gut-check, then open a video's full breakdown to see exactly which pattern is driving the score. That's more useful than the single number alone.",
    creator: "As a creator: the type-by-type breakdown shows exactly which production choices (cut rate, silence, reward pacing) are pushing a score up, so you can see the trade-offs of a given edit style.",
    regulator: "As a regulator or researcher: raw feature values and percentiles are shown in small print under every score. This is a pilot sample of a larger research pipeline. See Resources for dataset scope and methodology."
};

audienceButtons.forEach(btn => {
    btn.addEventListener("click", () => {
        audienceButtons.forEach(b => b.setAttribute("aria-pressed", "false"));
        btn.setAttribute("aria-pressed", "true");
        if (audienceNote) audienceNote.textContent = AUDIENCE_COPY[btn.dataset.audience] || "";
    });
});

/* =========================================================
   7. Wire up events + initial render
========================================================= */

if (button) button.addEventListener("click", runLookup);
if (input) {
    input.addEventListener("keydown", e => { if (e.key === "Enter") runLookup(); });
    input.addEventListener("input", applyFiltersAndSort);
}
if (topicFilter) topicFilter.addEventListener("change", applyFiltersAndSort);
if (ageFilter) ageFilter.addEventListener("change", applyFiltersAndSort);
if (popularityFilter) popularityFilter.addEventListener("change", applyFiltersAndSort);
if (sortSelect) sortSelect.addEventListener("change", applyFiltersAndSort);
if (clearFiltersButton) {
    clearFiltersButton.addEventListener("click", () => {
        if (input) input.value = "";
        if (topicFilter) topicFilter.value = "";
        if (ageFilter) ageFilter.value = "";
        if (popularityFilter) popularityFilter.value = "";
        applyFiltersAndSort();
    });
}

populateTopicFilter();
populateAgeFilter();
populatePopularityFilter();
populateVideoSuggestions();
applyFiltersAndSort();
if (audienceNote) audienceNote.textContent = AUDIENCE_COPY.parent;

// Re-render on resize so rotating a phone or resizing a window switches
// correctly between the paginated mobile view and the full desktop grid.
let resizeTimer = null;
window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => renderCards(activeVideos), 200);
});
openFromHash();
window.addEventListener("hashchange", openFromHash);
