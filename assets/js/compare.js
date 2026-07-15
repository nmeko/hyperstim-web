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
   1. Populate pickers, grouped by era via <optgroup>
========================================================= */

function populateSelect(select) {
    if (!select) return;
    const byEra = {};
    SITE_DATA.videos.forEach(video => {
        const era = video.era || "Contemporary";
        byEra[era] = byEra[era] || [];
        byEra[era].push(video);
    });

    Object.entries(byEra).forEach(([era, videos]) => {
        const group = document.createElement("optgroup");
        group.label = era;
        videos.forEach(video => {
            const option = document.createElement("option");
            option.value = video.video_id;
            // Several videos in the real dataset share an identical title
            // (e.g. multiple "Hickory Dickory Dock" uploads) — the channel
            // name is what actually tells them apart in the dropdown.
            option.textContent = `${video.title} — ${video.channel}`;
            group.appendChild(option);
        });
        select.appendChild(group);
    });
}

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
                selectEl.value = id;
                onSelect();
                return;
            }
        }

        const query = raw.toLowerCase();
        const options = selectEl.querySelectorAll ? selectEl.querySelectorAll("option") : [];
        options.forEach(opt => {
            if (!opt.value) { opt.hidden = false; return; } // keep the placeholder visible
            opt.hidden = query.length > 0 && !opt.textContent.toLowerCase().includes(query);
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
    silence_elimination: "The source research found silence elimination to be one of the most reliable escalation signals across the dataset — more reliable than raw loudness, which is more sensitive to mastering-level differences across eras.",
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
        + `— a gap of ${Math.round(diff.gap)} percentile points.`;

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
    similaritiesBox.innerHTML = `<strong>Where they're similar:</strong> ${names} — within ${SIMILARITY_THRESHOLD} percentile points of each other.`;
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
        comparisonChart.innerHTML = `<p class="panel-placeholder">Not enough measured data on one or both videos yet for a chart — see the table above for what is measured.</p>`;
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
            Each pair of bars shows both videos' percentile score on that metric — the longer the bar,
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
    if (matchA) selectA.value = matchA[1];
    if (matchB) selectB.value = matchB[1];
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
    const covered = videos.filter(v => typeCoverageCount(v) > 0);
    const pool = covered.length ? covered : videos;
    return pickRandom(pool);
}

function computePreset() {
    // "Contemporary" is the fixed fallback era_for() assigns to any video
    // historical-manifest.tsv doesn't cover; every other era string is
    // whatever historical-manifest.tsv actually labels it (e.g. a specific
    // decade), so we don't hardcode a particular historical label here.
    const historical = SITE_DATA.videos.filter(v => v.era && v.era !== "Contemporary");
    const contemporary = SITE_DATA.videos.filter(v => !v.era || v.era === "Contemporary");

    if (!historical.length || !contemporary.length) return null;

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
