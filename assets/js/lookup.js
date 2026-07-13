/**
 * ---------------------------------------------------------
 * HyperStim lookup.js — index.html logic
 * ---------------------------------------------------------
 */

let activeVideos = SITE_DATA.videos.slice();

/* =========================================================
   Elements
========================================================= */

const grid = document.getElementById("card-grid");
const input = document.getElementById("video-input");
const button = document.getElementById("lookup-button");
const dropZone = document.getElementById("drop-zone");
const dropStatus = document.getElementById("drop-status");
const topicFilter = document.getElementById("topic-filter");
const sortSelect = document.getElementById("sort-select");
const resultCount = document.getElementById("result-count");

const videoContainer = document.getElementById("video-container");
const ratingContainer = document.getElementById("rating-container");
const detailsPanel = document.getElementById("details-panel");

const audienceButtons = document.querySelectorAll("#audience-toggle button");
const audienceNote = document.getElementById("audience-note");

/* =========================================================
   1. Card grid rendering (shared render path for grid + single result)
========================================================= */

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
    const band = bandFor(video.composite_percentile);
    const topic = deriveTopic(video);

    return `
        <img src="${youtubeThumbnail(video.video_id)}" alt="${video.title}" loading="lazy">
        <h3>${video.title}</h3>
        <p class="video-channel">${video.channel}</p>
        <p class="video-category">${topic} &middot; ${video.era || ""}</p>
        <div class="rating-badge rating-${band.class}">${formatBand(band, video.composite_percentile)}</div>
        <ul class="score-list">
            <li>Pacing: ${formatBand(bandFor(categoryPercentile(video, "pacing_intensification")), categoryPercentile(video, "pacing_intensification"))}</li>
            <li>Recovery: ${formatBand(bandFor(categoryPercentile(video, "recovery_denial")), categoryPercentile(video, "recovery_denial"))}</li>
            <li>Reward: ${formatBand(bandFor(categoryPercentile(video, "reward_patterning")), categoryPercentile(video, "reward_patterning"))}</li>
        </ul>
        <button class="details-button" type="button" data-video="${video.video_id}">View Full Details</button>
    `;
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
        videos.forEach(video => {
            const card = document.createElement("article");
            card.className = "video-card";
            card.innerHTML = cardHTML(video);
            grid.appendChild(card);
        });
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
    const topics = Array.from(new Set(SITE_DATA.videos.map(deriveTopic))).sort();
    topics.forEach(topic => {
        const option = document.createElement("option");
        option.value = topic;
        option.textContent = topic;
        topicFilter.appendChild(option);
    });
}

function applyFiltersAndSort() {
    const query = (input.value || "").trim().toLowerCase();
    const topic = topicFilter ? topicFilter.value : "";
    const sortMode = sortSelect ? sortSelect.value : "intense-first";

    let videos = SITE_DATA.videos.filter(video => {
        const matchesQuery =
            !query ||
            video.title.toLowerCase().includes(query) ||
            video.channel.toLowerCase().includes(query) ||
            deriveTopic(video).toLowerCase().includes(query);
        const matchesTopic = !topic || deriveTopic(video) === topic;
        return matchesQuery && matchesTopic;
    });

    videos = videos.slice().sort((a, b) => {
        if (sortMode === "alphabetical") return a.title.localeCompare(b.title);
        const pa = a.composite_percentile ?? 0;
        const pb = b.composite_percentile ?? 0;
        return sortMode === "calm-first" ? pa - pb : pb - pa;
    });

    activeVideos = videos;
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

function renderVideoPanel(video, notFoundQuery) {
    if (!video) {
        videoContainer.innerHTML = notFoundQuery
            ? ""
            : `<div class="panel-placeholder">Search above, or choose "View Full Details" on a video below.</div>`;
        ratingContainer.innerHTML = notFoundQuery
            ? `
                <div class="not-found">
                    <h3>This video hasn't been measured by this dataset yet</h3>
                    <p>Only videos the research pipeline has already processed can be scored — this tool
                    does not analyze new video content on demand.</p>
                </div>
              `
            : "";
        return;
    }

    videoContainer.innerHTML = `
        <iframe
            src="https://www.youtube.com/embed/${video.video_id}"
            title="Preview: ${video.title}"
            loading="lazy"
            allowfullscreen>
        </iframe>
    `;

    ratingContainer.innerHTML = `
        <div class="type-breakdown">
            ${["pacing_intensification", "recovery_denial", "reward_patterning"].map(catKey => {
                const catBand = bandFor(categoryPercentile(video, catKey));
                return `
                    <div class="type-row">
                        <div class="rating-badge rating-${catBand.class}">${formatBand(catBand, categoryPercentile(video, catKey))}</div>
                        <h4>${TAXONOMY_SCHEMA[catKey].label}</h4>
                        <p>${TAXONOMY_SCHEMA[catKey].intro}</p>
                    </div>
                `;
            }).join("")}
        </div>
    `;
}

// This is the exact content that previously lived inside the "View Full
// Details" popup modal — reused as-is, just rendered into the permanent
// right-hand panel instead of a modal-panel overlay.
function renderDetailsPanel(video) {
    if (!video) {
        detailsPanel.innerHTML = `<div class="panel-placeholder">Select a lookup result to view its detailed information.</div>`;
        return;
    }

    const band = bandFor(video.composite_percentile);

    detailsPanel.innerHTML = `
        <h3>${video.title}</h3>
        <p class="video-channel">${video.channel} &middot; ${video.era || ""}</p>
        <div class="rating-badge rating-${band.class}">${formatBand(band, video.composite_percentile)}</div>
        <div class="type-breakdown">
            ${typeBreakdownHTML(video)}
        </div>
    `;
}

// Unified update path: used by search/paste lookup, drag-and-drop, the
// "View Full Details" button on a card, and hash-based deep links. Updates
// the video panel and the details panel together, per the split-screen spec.
function showDetails(video, notFoundQuery) {
    renderVideoPanel(video, notFoundQuery);
    renderDetailsPanel(video);

    if (video) {
        location.hash = `v=${video.video_id}`;
    } else if (history.replaceState) {
        history.replaceState(null, "", location.pathname + location.search);
    }
}

function runLookup() {
    const query = input.value;
    const video = findVideo(query);
    showDetails(video, !video && query.trim().length > 0);
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
    parent: "As a parent: use the overall band as a quick gut-check, then open a video's full breakdown to see exactly which pattern is driving the score — that's more useful than the single number alone.",
    creator: "As a creator: the type-by-type breakdown shows exactly which production choices (cut rate, silence, reward pacing) are pushing a score up, so you can see the trade-offs of a given edit style.",
    regulator: "As a regulator or researcher: raw feature values and percentiles are shown in small print under every score. This is a pilot sample of a larger research pipeline — see Resources for dataset scope and methodology."
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
if (sortSelect) sortSelect.addEventListener("change", applyFiltersAndSort);

populateTopicFilter();
applyFiltersAndSort();
if (audienceNote) audienceNote.textContent = AUDIENCE_COPY.parent;
openFromHash();
window.addEventListener("hashchange", openFromHash);
