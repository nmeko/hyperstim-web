/**
 * ---------------------------------------------------------
 * HyperStim compare.js — compare.html logic
 * ---------------------------------------------------------
 */

const selectA = document.getElementById("compare-a");
const selectB = document.getElementById("compare-b");
const presetButton = document.getElementById("compare-preset");
const swapButton = document.getElementById("compare-swap");
const searchA = document.getElementById("compare-a-search");
const searchB = document.getElementById("compare-b-search");

const headline = document.getElementById("compare-headline");
const copyLinkButton = document.getElementById("compare-copy-link");
const similaritiesBox = document.getElementById("compare-similarities");
const videoPair = document.getElementById("compare-video-pair");
const typeGrid = document.getElementById("compare-type-grid");
const comparisonChart = document.getElementById("compare-chart");

const SIMILARITY_THRESHOLD = 8; // percentile points

/* =========================================================
   1. Picker options are no longer all built upfront -- with
   16,000+ videos, that meant creating tens of thousands of DOM
   nodes per select on every page load, which is the real
   source of the slowness. Instead, options are built on demand:
   as the user types (see wirePickerSearch below), or via
   ensureOption() for the few places code sets .value directly
   without the user having typed anything (deep links, the
   preset button, the swap button) -- a native <select>'s value
   silently fails to apply if no matching <option> exists yet.
========================================================= */

function optionLabel(video) {
    // Several videos in the real dataset share an identical title
    // (e.g. multiple "Hickory Dickory Dock" uploads) -- the channel
    // name is what actually tells them apart in the dropdown.
    return `${video.title}: ${video.channel}`;
}

function ensureOption(selectEl, videoId) {
    if (!selectEl || !videoId) return;
    if (selectEl.querySelector(`option[value="${videoId}"]`)) return;
    const video = getVideo(videoId);
    if (!video) return;
    const option = document.createElement("option");
    option.value = video.video_id;
    option.textContent = optionLabel(video);
    selectEl.appendChild(option);
}

function populateSelect(select) {
    // Intentionally a no-op now beyond the placeholder already in the
    // HTML -- kept as a named function since it's called at startup
    // below, in case anything else comes to depend on an init hook here.
}

const SEARCH_RESULT_LIMIT = 50;

/* =========================================================
   1b. Search/paste wiring for each picker: typing filters the
   dropdown's options live; pasting a recognizable YouTube URL
   or video ID jumps straight to that video if it's in the
   dataset. Reuses youtubeId() from shared.js — no duplicated
   parsing logic.
========================================================= */

function wirePickerSearch(inputEl, selectEl, onSelect) {
    if (!inputEl || !selectEl) return;

    inputEl.addEventListener("input", () => {
        const raw = inputEl.value.trim();

        const id = youtubeId(raw);
        if (id) {
            const match = SITE_DATA.videos.find(v => v.video_id === id);
            if (match) {
                ensureOption(selectEl, id);
                selectEl.value = id;
                onSelect();
                return;
            }
        }

        // Rebuild the option list from scratch for this query, rather
        // than hiding/showing a pre-built set of 16,000+ options --
        // capped at SEARCH_RESULT_LIMIT so an overly broad query (a
        // single common letter, say) can't recreate the exact same
        // problem this replaced.
        const placeholder = selectEl.querySelector('option[value=""]');
        selectEl.innerHTML = "";
        if (placeholder) selectEl.appendChild(placeholder);

        const query = raw.toLowerCase();
        if (!query) return;

        const matches = [];
        for (const video of SITE_DATA.videos) {
            if (optionLabel(video).toLowerCase().includes(query)) {
                matches.push(video);
                if (matches.length >= SEARCH_RESULT_LIMIT) break;
            }
        }

        const contemporary = matches.filter(v => !v.is_historical);
        const historical = matches.filter(v => v.is_historical);
        [["Contemporary", contemporary], ["Historical", historical]].forEach(([label, videos]) => {
            if (!videos.length) return;
            const group = document.createElement("optgroup");
            group.label = label;
            videos.forEach(video => {
                const option = document.createElement("option");
                option.value = video.video_id;
                option.textContent = optionLabel(video);
                group.appendChild(option);
            });
            selectEl.appendChild(group);
        });
    });
}

/* =========================================================
   2. Comparison logic
========================================================= */

function getVideo(id) {
    return SITE_DATA.videos.find(v => v.video_id === id) || null;
}

function biggestDifference(videoA, videoB) {
    const entriesA = allTypeEntries(videoA);
    const entriesB = allTypeEntries(videoB);

    let biggest = null;

    entriesA.forEach(entryA => {
        const entryB = entriesB.find(e => e.typeKey === entryA.typeKey && e.categoryKey === entryA.categoryKey);
        if (!entryB || entryA.percentile == null || entryB.percentile == null) return;
        const gap = Math.abs(entryA.percentile - entryB.percentile);
        if (!biggest || gap > biggest.gap) {
            biggest = { ...entryA, gap, higherVideo: entryA.percentile >= entryB.percentile ? videoA : videoB, lowerVideo: entryA.percentile >= entryB.percentile ? videoB : videoA };
        }
    });

    return biggest;
}

function similarities(videoA, videoB) {
    const entriesA = allTypeEntries(videoA);
    const entriesB = allTypeEntries(videoB);
    const similar = [];

    entriesA.forEach(entryA => {
        const entryB = entriesB.find(e => e.typeKey === entryA.typeKey && e.categoryKey === entryA.categoryKey);
        if (!entryB || entryA.percentile == null || entryB.percentile == null) return;
        const gap = Math.abs(entryA.percentile - entryB.percentile);
        if (gap <= SIMILARITY_THRESHOLD) {
            similar.push({ ...entryA, gap });
        }
    });

    return similar;
}

// Research-grounded notes for specific pattern types, shown when that
// type happens to be the biggest gap between the two selected videos.
const RESEARCH_NOTES = {
    silence_elimination: "The source research found silence elimination to be one of the most reliable escalation signals across the dataset, more reliable than raw loudness, which is more sensitive to mastering-level differences across eras.",
    rapid_cutting: "The source research found cutting rate has historically changed less than other features, so a large cut-rate gap here is more likely genre-specific than a generational trend."
};

function renderHeadline(videoA, videoB) {
    const diff = biggestDifference(videoA, videoB);
    if (!diff) {
        headline.textContent = "Not enough overlapping data to compare these two videos.";
        return;
    }

    const typeLabel = TAXONOMY_SCHEMA[diff.categoryKey].types[diff.typeKey].label;
    const higherName = diff.higherVideo === videoA ? "Video A" : "Video B";
    const lowerName = diff.higherVideo === videoA ? "Video B" : "Video A";

    let sentence = `The biggest difference is <strong>${typeLabel}</strong>: `
        + `${higherName} (${diff.higherVideo.title}) scores far higher than ${lowerName} (${diff.lowerVideo.title}) `
        + `, a gap of ${Math.round(diff.gap)} percentile points.`;

    const note = RESEARCH_NOTES[diff.typeKey];
    if (note) sentence += ` <span class="era-note">${note}</span>`;

    headline.innerHTML = sentence;
}

function renderSimilarities(videoA, videoB) {
    const sims = similarities(videoA, videoB);
    if (!sims.length) {
        similaritiesBox.hidden = true;
        return;
    }
    similaritiesBox.hidden = false;
    const names = sims.map(s => TAXONOMY_SCHEMA[s.categoryKey].types[s.typeKey].label).join(", ");
    similaritiesBox.innerHTML = `<strong>Where they're similar:</strong> ${names}, within ${SIMILARITY_THRESHOLD} percentile points of each other.`;
}

function videoCellHTML(video, side) {
    return `
        <div class="matrix-video-cell video-${side}">
            ${videoEmbedHTML(video)}
            <h3>${video.title}</h3>
            <p class="video-channel">${video.channel} &middot; ${video.era || ""}</p>
            ${compositeBadgeHTML(video)}
        </div>
    `;
}

function renderVideoPair(videoA, videoB) {
    videoPair.innerHTML = `
        <div class="matrix-row matrix-header">
            <div class="matrix-label">Video Preview</div>
            <div>${videoCellHTML(videoA, "a")}</div>
            <div>${videoCellHTML(videoB, "b")}</div>
        </div>
    `;
}

function basicInfoRow(label, valueA, valueB) {
    return `
        <div class="matrix-row">
            <div class="matrix-label">${label}</div>
            <div class="matrix-cell">${valueA}</div>
            <div class="matrix-cell">${valueB}</div>
        </div>
    `;
}

function typeRow(catKey, typeKey, type, videoA, videoB) {
    const a = videoA.taxonomy[catKey]?.types[typeKey];
    const b = videoB.taxonomy[catKey]?.types[typeKey];
    const gap = (a?.percentile != null && b?.percentile != null) ? Math.abs(a.percentile - b.percentile) : null;
    const highlight = gap !== null && gap > SIMILARITY_THRESHOLD;
    const cellClass = `matrix-cell${highlight ? " diff-highlight" : ""}`;

    return `
        <div class="matrix-row">
            <div class="matrix-label">
                <span>${type.label}</span>
                <p class="matrix-label-note">${type.explanation}</p>
            </div>
            <div class="${cellClass}">${meterRow("Video A", a?.percentile, "a")}</div>
            <div class="${cellClass}">${meterRow("Video B", b?.percentile, "b")}</div>
        </div>
    `;
}

function meterRow(label, value, side) {
    const pct = value == null ? 0 : Math.round(value);
    return `
        <div class="compare-meter-row">
            <span class="compare-meter-label">${label}</span>
            <div class="compare-meter-track">
                <div class="compare-meter-fill ${side}" style="width:${pct}%;"></div>
            </div>
            <span class="compare-meter-value">${value == null ? "n/a" : pct}</span>
        </div>
    `;
}

function renderTypeGrid(videoA, videoB) {
    const rows = [];

    rows.push(`
        <div class="matrix-group-row">
            <div>Basic Information</div><div></div><div></div>
        </div>
    `);
    rows.push(basicInfoRow("Channel", videoA.channel, videoB.channel));
    rows.push(basicInfoRow("Era", videoA.era || "—", videoB.era || "—"));
    rows.push(basicInfoRow("Overall Score", compositeBadgeHTML(videoA), compositeBadgeHTML(videoB)));

    Object.entries(TAXONOMY_SCHEMA).forEach(([catKey, cat]) => {
        rows.push(`
            <div class="matrix-group-row">
                <div>${cat.label}</div><div></div><div></div>
            </div>
        `);
        Object.entries(cat.types).forEach(([typeKey, type]) => {
            rows.push(typeRow(catKey, typeKey, type, videoA, videoB));
        });
    });

    typeGrid.innerHTML = rows.join("");
}

/* =========================================================
   2b. Comparison bar chart — a compact, all-in-one-glance
   summary of both videos across all 10 pattern types. Reuses
   meterRow() (the same bar component already used per-row in
   the matrix above), so it's visually consistent and doesn't
   need a separate accessible-alternative table — the bars are
   real text-containing DOM elements, not an image needing a
   workaround for screen readers.
========================================================= */

function renderComparisonChart(videoA, videoB) {
    if (!comparisonChart) return;

    const entriesA = allTypeEntries(videoA);
    const entriesB = allTypeEntries(videoB);
    const pairs = entriesA.map((entryA, i) => ({ a: entryA, b: entriesB[i] }));

    const coveredA = pairs.filter(p => p.a.percentile != null).length;
    const coveredB = pairs.filter(p => p.b.percentile != null).length;

    if (coveredA < 3 || coveredB < 3) {
        comparisonChart.innerHTML = `<p class="panel-placeholder">Not enough measured data on one or both videos yet for a chart. See the table above for what is measured.</p>`;
        return;
    }

    const rows = pairs.map(p => {
        const schema = TAXONOMY_SCHEMA[p.a.categoryKey].types[p.a.typeKey];
        return `
            <div class="chart-bar-group">
                <div class="chart-bar-label">${schema.label}</div>
                ${meterRow("Video A", p.a.percentile, "a")}
                ${meterRow("Video B", p.b.percentile, "b")}
            </div>
        `;
    }).join("");

    comparisonChart.innerHTML = `
        <div class="bar-chart">${rows}</div>
        <p class="era-note">
            Each pair of bars shows both videos' percentile score on that metric. The longer the bar,
            the more intense that video scored relative to the rest of the dataset.
        </p>
    `;
}

/* =========================================================
   2c. Shareable comparison links — the current selection is
   always reflected in the URL hash, so the page can be
   bookmarked or shared and reopen to the same comparison.
========================================================= */

function updateHashFromSelection() {
    const a = selectA.value, b = selectB.value;
    if (!a && !b) return;
    let hash = "";
    if (a) hash += `a=${a}`;
    if (b) hash += (hash ? "&" : "") + `b=${b}`;
    if (history.replaceState) {
        history.replaceState(null, "", `${location.pathname}${location.search}#${hash}`);
    } else {
        location.hash = hash;
    }
}

function applyDeepLinkFromHash() {
    const hash = location.hash.replace(/^#/, "");
    const matchA = hash.match(/a=([A-Za-z0-9_-]{11})/);
    const matchB = hash.match(/b=([A-Za-z0-9_-]{11})/);
    if (!matchA && !matchB) return;
    if (matchA) { ensureOption(selectA, matchA[1]); selectA.value = matchA[1]; }
    if (matchB) { ensureOption(selectB, matchB[1]); selectB.value = matchB[1]; }
    renderComparison();
}

function updateProgress(complete) {
    const step1 = document.getElementById("progress-step-1");
    const step2 = document.getElementById("progress-step-2");
    if (step1 && step2) {
        step1.classList.toggle("active", !complete);
        step1.classList.toggle("done", complete);
        step2.classList.toggle("active", complete);
    }
    if (copyLinkButton) copyLinkButton.hidden = !complete;
}

function renderComparison() {
    const videoA = getVideo(selectA.value);
    const videoB = getVideo(selectB.value);

    if (!videoA || !videoB) {
        headline.textContent = "Select two videos above to compare.";
        similaritiesBox.hidden = true;
        videoPair.innerHTML = "";
        typeGrid.innerHTML = "";
        if (comparisonChart) comparisonChart.innerHTML = "";
        updateProgress(false);
        return;
    }

    renderHeadline(videoA, videoB);
    renderSimilarities(videoA, videoB);
    renderVideoPair(videoA, videoB);
    renderTypeGrid(videoA, videoB);
    renderComparisonChart(videoA, videoB);
    updateHashFromSelection();
    updateProgress(true);
    scrollResultsIntoView();
}

// Scrolls the results area into view after both videos are selected,
// so a person doesn't have to notice on their own that results
// appeared below the fold. Instant (not smooth) for anyone with
// reduced-motion set.
function scrollResultsIntoView() {
    const results = document.getElementById("compare-results");
    if (!results) return;
    const prefersReducedMotion = typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    results.scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth", block: "start" });
}

/* =========================================================
   3. One-click preset: a random historical + random contemporary
   video each click. Within each group, videos with real pipeline
   coverage are picked first; only if a group has NO covered videos
   at all does it fall back to picking among the uncovered ones —
   so the button always works, and automatically starts favoring
   real data the moment the pipeline provides any, with no code
   change needed.
========================================================= */

function pickRandom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

// Random pick from `videos`, preferring ones with any real coverage.
// Falls back to the full group only when none of them have coverage yet.
function pickRandomPreferCovered(videos) {
    // Require FULL coverage (every pattern type scored), not just "at
    // least one type scored" -- a video missing most of its scores
    // isn't a good example for a new user's first look at Compare,
    // especially paired against a fully-scored video on the other side.
    const totalTypes = SITE_DATA.videos.length ? allTypeEntries(SITE_DATA.videos[0]).length : 10;
    const fullyScored = videos.filter(v => typeCoverageCount(v) === totalTypes);
    if (fullyScored.length) return pickRandom(fullyScored);

    // Fallback, only reached if a pool genuinely has zero fully-scored
    // videos (shouldn't happen at this dataset's current ~96% coverage,
    // but stay functional rather than returning nothing if it ever does).
    const partiallyScored = videos.filter(v => typeCoverageCount(v) > 0);
    return pickRandom(partiallyScored.length ? partiallyScored : videos);
}

function computePreset() {
    // "Contemporary" is the fixed fallback era_for() assigns to any video
    // Historical vs. contemporary is determined by the explicit
    // is_historical flag set when the dataset was built, not by
    // inspecting era text -- historical videos each carry their own
    // specific era label (e.g. a production year), so a text-based
    // check would need to enumerate every possible non-"Contemporary"
    // value rather than just checking one clear flag.
    const historical = SITE_DATA.videos.filter(v => v.is_historical);
    const contemporary = SITE_DATA.videos.filter(v => !v.is_historical);

    if (!historical.length || !contemporary.length) return null;

    const totalTypes = SITE_DATA.videos.length ? allTypeEntries(SITE_DATA.videos[0]).length : 10;
    const historicalHasFullyScored = historical.some(v => typeCoverageCount(v) === totalTypes);

    if (!historicalHasFullyScored) {
        // The historical set currently has no fully-scored videos under
        // this schema (a real, separate data gap, not a bug here) --
        // rather than ever pairing a zero-coverage video against a
        // fully-scored one, fall back to two fully-scored contemporary
        // videos so the "never mix full vs. not-yet-computed" guarantee
        // still holds, even though it means giving up the historical
        // framing for this particular preset click.
        const fullyScoredContemporary = contemporary.filter(v => typeCoverageCount(v) === totalTypes);
        const pool = fullyScoredContemporary.length >= 2 ? fullyScoredContemporary : contemporary;
        const first = pickRandom(pool);
        const rest = pool.filter(v => v.video_id !== first.video_id);
        const second = rest.length ? pickRandom(rest) : first;
        return { repHistorical: first, repContemporary: second };
    }

    return {
        repHistorical: pickRandomPreferCovered(historical),
        repContemporary: pickRandomPreferCovered(contemporary),
    };
}

function applyPreset() {
    let result = computePreset();
    if (!result) return;

    // Avoid landing on the exact same pair twice in a row when there's
    // more than one option — a couple of retries is enough to feel random
    // without risking an infinite loop on a tiny dataset.
    let attempts = 0;
    while (
        attempts < 5 &&
        result.repHistorical.video_id === selectA.value &&
        result.repContemporary.video_id === selectB.value
    ) {
        result = computePreset();
        attempts++;
    }

    ensureOption(selectA, result.repHistorical.video_id);
    ensureOption(selectB, result.repContemporary.video_id);
    selectA.value = result.repHistorical.video_id;
    selectB.value = result.repContemporary.video_id;
    renderComparison();
}

/* =========================================================
   4. Wire up
========================================================= */

populateSelect(selectA);
populateSelect(selectB);

selectA.addEventListener("change", renderComparison);
selectB.addEventListener("change", renderComparison);
if (presetButton) presetButton.addEventListener("click", applyPreset);

if (swapButton) {
    swapButton.addEventListener("click", () => {
        const a = selectA.value, b = selectB.value;
        ensureOption(selectA, b);
        ensureOption(selectB, a);
        selectA.value = b;
        selectB.value = a;
        renderComparison();
    });
}

wirePickerSearch(searchA, selectA, renderComparison);
wirePickerSearch(searchB, selectB, renderComparison);

const hadDeepLink = /[ab]=[A-Za-z0-9_-]{11}/.test(location.hash);
if (hadDeepLink) {
    applyDeepLinkFromHash();
} else {
    renderComparison();
}

renderComparison();
