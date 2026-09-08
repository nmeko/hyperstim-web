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
const resultsSection = document.getElementById("compare-results");
const copyLinkButton = document.getElementById("compare-copy-link");
const similaritiesBox = document.getElementById("compare-similarities");
const videoPair = document.getElementById("compare-video-pair");
const typeGrid = document.getElementById("compare-type-grid");

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

const INITIAL_SUGGESTION_COUNT = 20;

function populateSelect(select) {
    if (!select || typeof SITE_DATA === "undefined" || !SITE_DATA.videos.length) return;

    // An empty dropdown looks broken even though it's working as
    // designed (real options build once you type -- see
    // wirePickerSearch below, which is what actually keeps this from
    // recreating the tens-of-thousands-of-options performance problem
    // this replaced). A small, fixed starter list makes it obvious
    // right away that picking a video here does something, without
    // bringing back that cost: built once here rather than on every
    // keystroke, capped at a small fixed count regardless of dataset size.
    const scored = SITE_DATA.videos.filter(v => v.composite_percentile !== null && !v.is_historical);
    const sample = scored.slice(0, INITIAL_SUGGESTION_COUNT);
    if (!sample.length) return;

    const group = document.createElement("optgroup");
    group.label = "Suggestions";
    sample.forEach(video => {
        const option = document.createElement("option");
        option.value = video.video_id;
        option.textContent = optionLabel(video);
        group.appendChild(option);
    });
    select.appendChild(group);
}

const SEARCH_FIRST_BATCH_SIZE = 25;

/* =========================================================
   1b. Search/paste wiring for each picker: typing filters the
   dropdown's options live; pasting a recognizable YouTube URL
   or video ID jumps straight to that video if it's in the
   dataset. Reuses youtubeId() from shared.js — no duplicated
   parsing logic.
========================================================= */

function buildOptionsForMatches(selectEl, matches) {
    const contemporary = matches.filter(v => !v.is_historical);
    const historical = matches.filter(v => v.is_historical);
    [["Contemporary", contemporary], ["Historical", historical]].forEach(([label, videos]) => {
        if (!videos.length) return;
        let group = Array.from(selectEl.children).find(c => c.tagName === "OPTGROUP" && c.label === label);
        if (!group) {
            group = document.createElement("optgroup");
            group.label = label;
            selectEl.appendChild(group);
        }
        videos.forEach(video => {
            const option = document.createElement("option");
            option.value = video.video_id;
            option.textContent = optionLabel(video);
            group.appendChild(option);
        });
    });
}

function wirePickerSearch(inputEl, selectEl, onSelect) {
    if (!inputEl || !selectEl) return;
    let pendingAppend = null;

    inputEl.addEventListener("input", () => {
        const raw = inputEl.value.trim();

        if (pendingAppend) { clearTimeout(pendingAppend); pendingAppend = null; }

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
        // than hiding/showing a pre-built set of 16,000+ options.
        const placeholder = selectEl.querySelector('option[value=""]');
        selectEl.innerHTML = "";
        if (placeholder) selectEl.appendChild(placeholder);

        const query = raw.toLowerCase();
        if (!query) return;

        // Matches against both title AND channel (optionLabel is
        // "title: channel"), confirmed against real queries like
        // "cocomelon" (234 matches, including channel-name-only hits)
        // and "christmas" (437 matches). No cap on how many are found
        // -- a hard cutoff means someone searching a common word never
        // sees videos past whatever number was picked. Instead, the
        // first batch renders immediately so typing stays responsive,
        // and the remaining matches (if any) append moments later,
        // arriving well before anyone finishes reading the first batch
        // and scrolls for more.
        const allMatches = SITE_DATA.videos.filter(v => optionLabel(v).toLowerCase().includes(query));
        const firstBatch = allMatches.slice(0, SEARCH_FIRST_BATCH_SIZE);
        const rest = allMatches.slice(SEARCH_FIRST_BATCH_SIZE);

        buildOptionsForMatches(selectEl, firstBatch);

        if (rest.length) {
            pendingAppend = setTimeout(() => {
                // The query may have changed while this was pending;
                // only append if this input's value still matches.
                if (inputEl.value.trim().toLowerCase() !== query) return;
                buildOptionsForMatches(selectEl, rest);
                pendingAppend = null;
            }, 30);
        }
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

function overallScoreCellHTML(pct, isWinner) {
    if (pct === null || pct === undefined || Number.isNaN(pct)) {
        return `<span class="compare-meter-value">n/a</span>`;
    }
    const rounded = Math.round(pct);
    const crownHTML = isWinner ? `<span class="compare-winner-crown" title="Calmer of the two">&#128081;</span>` : "";
    return `${crownHTML}<span class="compare-meter-value">${rounded}</span>${dotScaleHTML(pct, "large")}`;
}

function overallScoreRowHTML(videoA, videoB) {
    const pctA = videoA.composite_percentile;
    const pctB = videoB.composite_percentile;
    const bothKnown = pctA !== null && pctA !== undefined && pctB !== null && pctB !== undefined;
    // Lower stimulation is the "win" here -- only crown one side when
    // the two scores actually differ, not for an exact tie.
    const aWins = bothKnown && pctA < pctB;
    const bWins = bothKnown && pctB < pctA;

    return basicInfoRow("Overall Score", overallScoreCellHTML(pctA, aWins), overallScoreCellHTML(pctB, bWins));
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

    // Same convention as the Overall Score row: lower is calmer, so
    // lower "wins" -- computed per metric, so one video can win
    // overall while losing on some individual metrics and winning
    // others, rather than one side sweeping everything.
    const bothKnown = a?.percentile != null && b?.percentile != null;
    const aWins = bothKnown && a.percentile < b.percentile;
    const bWins = bothKnown && b.percentile < a.percentile;

    return `
        <div class="matrix-row">
            <div class="matrix-label">
                <span>${type.label}</span>
                <p class="matrix-label-note">${type.explanation}</p>
            </div>
            <div class="${cellClass}">${meterRow(a?.percentile, aWins)}</div>
            <div class="${cellClass}">${meterRow(b?.percentile, bWins)}</div>
        </div>
    `;
}

function meterRow(value, isWinner) {
    const pct = value == null ? null : Math.round(value);
    const crownHTML = isWinner ? `<span class="compare-winner-crown" title="Calmer on this metric">&#128081;</span>` : "";
    return `
        <div class="compare-meter-row">
            ${pct === null
                ? `<span class="compare-meter-value">n/a</span>`
                : `${crownHTML}<span class="compare-meter-value">${pct}</span>${dotScaleHTML(value, "small")}`}
        </div>
    `;
}

function renderTypeGrid(videoA, videoB) {
    const rows = [];

    rows.push(basicInfoRow("Channel", videoA.channel, videoB.channel));
    rows.push(basicInfoRow("Era", videoA.era || "—", videoB.era || "—"));
    rows.push(overallScoreRowHTML(videoA, videoB));

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

function quickPreviewHTML(video) {
    const categoryRows = Object.entries(TAXONOMY_SCHEMA).map(([catKey, cat]) => {
        const pct = categoryPercentile(video, catKey);
        return `
            <li class="category-dots-row">
                <span class="category-dots-label">${cat.short}</span>
                ${dotScaleHTML(pct)}
            </li>
        `;
    }).join("");

    return `
        <p class="compare-quick-preview-title">${video.title}</p>
        <ul class="score-list">${categoryRows}</ul>
    `;
}

function miniCategoryDotsHTML(video) {
    return Object.entries(TAXONOMY_SCHEMA).map(([catKey, cat]) => {
        const pct = categoryPercentile(video, catKey);
        return `
            <li class="category-dots-row">
                <span class="category-dots-label">${cat.short}</span>
                ${dotScaleHTML(pct, "small")}
            </li>
        `;
    }).join("");
}

function exampleCardHTML(referenceVideo, exampleVideo, heading) {
    return `
        <p class="compare-example-heading">${heading}</p>
        <div class="compare-example-pair">
            <div class="compare-example-side">
                <p class="compare-example-title">${referenceVideo.title}</p>
                <ul class="score-list">${miniCategoryDotsHTML(referenceVideo)}</ul>
            </div>
            <div class="compare-example-side">
                <p class="compare-example-title">${exampleVideo.title}</p>
                <ul class="score-list">${miniCategoryDotsHTML(exampleVideo)}</ul>
            </div>
        </div>
        <button type="button" class="secondary compare-example-use" data-video-id="${exampleVideo.video_id}">
            Use this comparison
        </button>
    `;
}

function updateExampleComparisons(videoA) {
    const examplesBox = document.getElementById("compare-examples");
    const sameCard = document.getElementById("compare-example-same");
    const differentCard = document.getElementById("compare-example-different");
    if (!examplesBox || !sameCard || !differentCard) return;

    if (!videoA) {
        examplesBox.hidden = true;
        sameCard.innerHTML = "";
        differentCard.innerHTML = "";
        return;
    }

    const sameExample = findVideoInCategory(videoA, true);
    const differentExample = findVideoInCategory(videoA, false);

    sameCard.innerHTML = sameExample ? exampleCardHTML(videoA, sameExample, "Same-category example") : "";
    differentCard.innerHTML = differentExample ? exampleCardHTML(videoA, differentExample, "Different-category example") : "";
    examplesBox.hidden = !sameExample && !differentExample;
}

function updateQuickPreviews(videoA, videoB) {
    const previewA = document.getElementById("compare-a-preview");
    const previewB = document.getElementById("compare-b-preview");
    const clearA = document.getElementById("compare-a-clear");
    const clearB = document.getElementById("compare-b-clear");

    // Once both videos are chosen, the full results below already
    // show everything these previews would -- keeping them visible
    // too just duplicated the same scores in a second place above the
    // real results.
    const showPreviews = !videoA || !videoB;

    if (previewA) {
        if (videoA && showPreviews) { previewA.innerHTML = quickPreviewHTML(videoA); previewA.hidden = false; }
        else { previewA.innerHTML = ""; previewA.hidden = true; }
    }
    if (previewB) {
        if (videoB && showPreviews) { previewB.innerHTML = quickPreviewHTML(videoB); previewB.hidden = false; }
        else { previewB.innerHTML = ""; previewB.hidden = true; }
    }
    if (clearA) clearA.hidden = !videoA;
    if (clearB) clearB.hidden = !videoB;

    // The example comparisons only make sense once Video A exists to
    // compare against, and only add value while B isn't chosen yet --
    // once both are picked, the full results below already answer
    // "how do these two compare."
    updateExampleComparisons(!videoB ? videoA : null);
}

// Resets one side back to its untouched starting state: no selection,
// no leftover search text, and the initial suggestion list rebuilt
// (search wiring replaces this entirely again as soon as anyone
// types, same as on first page load).
function clearSelection(select, searchInput) {
    select.value = "";
    select.innerHTML = "";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Select a video…";
    select.appendChild(placeholder);
    populateSelect(select);
    if (searchInput) searchInput.value = "";
    renderComparison();
}

// Picks a random video either sharing Video A's content category (a
// same-theme comparison) or deliberately not sharing it (a
// cross-theme comparison), excluding Video A itself.
function findVideoInCategory(referenceVideo, wantSameCategory) {
    const refTopic = deriveTopic(referenceVideo);
    const pool = SITE_DATA.videos.filter(v => {
        if (v.video_id === referenceVideo.video_id) return false;
        if (v.composite_percentile === null || v.composite_percentile === undefined) return false;
        const sameTopic = deriveTopic(v) === refTopic;
        return wantSameCategory ? sameTopic : !sameTopic;
    });
    if (!pool.length) return null;
    return pool[Math.floor(Math.random() * pool.length)];
}

function renderComparison() {
    const videoA = getVideo(selectA.value);
    const videoB = getVideo(selectB.value);

    updateQuickPreviews(videoA, videoB);

    if (!videoA || !videoB) {
        if (resultsSection) resultsSection.hidden = true;
        similaritiesBox.hidden = true;
        videoPair.innerHTML = "";
        typeGrid.innerHTML = "";
        updateProgress(false);
        return;
    }

    if (resultsSection) resultsSection.hidden = false;
    renderHeadline(videoA, videoB);
    renderSimilarities(videoA, videoB);
    renderVideoPair(videoA, videoB);
    renderTypeGrid(videoA, videoB);
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

// Uniform random selection from a fully-scored pool clusters heavily
// around "Moderate" -- confirmed directly against the real dataset,
// 86.8% of all videos land in that one band, since a composite score
// (the average of 12 percentiles) mathematically concentrates toward
// the middle the same way any average of several roughly-independent
// values does. For a feature specifically meant to demonstrate a
// historical-vs-contemporary contrast, that produces a boring
// Moderate-vs-Moderate pairing most of the time (confirmed: ~75% of
// draws, even after biasing toward relative thirds of each pool,
// which still often doesn't cross the actual 40/70 band boundary).
// Drawing directly from the real Good/Extreme band -- confirmed to
// have enough videos to pick from (27 historical Good, 1620
// contemporary Extreme) -- actually solves it, with the relative-third
// approach kept only as a fallback for a pool too thin for real
// variety.
const MIN_BAND_POOL_SIZE = 3;

function pickRandomFromBand(videos, preferLow) {
    const totalTypes = SITE_DATA.videos.length ? allTypeEntries(SITE_DATA.videos[0]).length : 12;
    const fullyScored = videos.filter(v => typeCoverageCount(v) === totalTypes);
    const pool = fullyScored.length ? fullyScored : videos.filter(v => typeCoverageCount(v) > 0);
    if (!pool.length) return pickRandom(videos);

    const realBand = preferLow
        ? pool.filter(v => v.composite_percentile < 40)
        : pool.filter(v => v.composite_percentile >= 70);
    if (realBand.length >= MIN_BAND_POOL_SIZE) return pickRandom(realBand);

    const sorted = [...pool].sort((a, b) => a.composite_percentile - b.composite_percentile);
    const thirdSize = Math.max(1, Math.floor(sorted.length / 3));
    const band = preferLow ? sorted.slice(0, thirdSize) : sorted.slice(-thirdSize);
    return pickRandom(band);
}

function computePreset() {
    // Historical vs. contemporary is determined by the explicit
    // is_historical flag set when the dataset was built, not by
    // inspecting era text -- historical videos each carry their own
    // specific era label (e.g. a production year), so a text-based
    // check would need to enumerate every possible non-"Contemporary"
    // value rather than just checking one clear flag.
    const historical = SITE_DATA.videos.filter(v => v.is_historical);
    const contemporary = SITE_DATA.videos.filter(v => !v.is_historical);

    if (!historical.length || !contemporary.length) return null;

    const totalTypes = SITE_DATA.videos.length ? allTypeEntries(SITE_DATA.videos[0]).length : 12;
    const historicalHasFullyScored = historical.some(v => typeCoverageCount(v) === totalTypes);

    if (!historicalHasFullyScored) {
        // Defensive fallback only: as of the v11 dataset, every
        // historical video is fully scored (confirmed directly), so
        // this branch shouldn't actually trigger. Kept so a future
        // historical-set expansion that briefly lacks full coverage
        // degrades gracefully instead of ever pairing a zero-coverage
        // video against a fully-scored one.
        const fullyScoredContemporary = contemporary.filter(v => typeCoverageCount(v) === totalTypes);
        const pool = fullyScoredContemporary.length >= 2 ? fullyScoredContemporary : contemporary;
        const first = pickRandom(pool);
        const rest = pool.filter(v => v.video_id !== first.video_id);
        const second = rest.length ? pickRandom(rest) : first;
        return { repHistorical: first, repContemporary: second };
    }

    return {
        repHistorical: pickRandomFromBand(historical, true),
        repContemporary: pickRandomFromBand(contemporary, false),
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

document.addEventListener("click", e => {
    const useButton = e.target.closest(".compare-example-use");
    if (!useButton) return;
    const videoId = useButton.dataset.videoId;
    if (!videoId) return;
    ensureOption(selectB, videoId);
    selectB.value = videoId;
    renderComparison();
});

wirePickerSearch(searchA, selectA, renderComparison);
wirePickerSearch(searchB, selectB, renderComparison);

const clearAButton = document.getElementById("compare-a-clear");
const clearBButton = document.getElementById("compare-b-clear");
if (clearAButton) clearAButton.addEventListener("click", () => clearSelection(selectA, searchA));
if (clearBButton) clearBButton.addEventListener("click", () => clearSelection(selectB, searchB));

const hadDeepLink = /[ab]=[A-Za-z0-9_-]{11}/.test(location.hash);
if (hadDeepLink) {
    applyDeepLinkFromHash();
} else {
    renderComparison();
}

renderComparison();
