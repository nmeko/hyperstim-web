/**
 * ---------------------------------------------------------
 * HyperStim compare.js — compare.html logic
 * ---------------------------------------------------------
 */

const selectA = document.getElementById("compare-a");
const selectB = document.getElementById("compare-b");
const presetButton = document.getElementById("compare-preset");

const headline = document.getElementById("compare-headline");
const similaritiesBox = document.getElementById("compare-similarities");
const videoPair = document.getElementById("compare-video-pair");
const typeGrid = document.getElementById("compare-type-grid");

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
            option.textContent = video.title;
            group.appendChild(option);
        });
        select.appendChild(group);
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
    const band = bandFor(video.composite_percentile);
    return `
        <div class="matrix-video-cell video-${side}">
            <iframe
                src="https://www.youtube.com/embed/${video.video_id}"
                title="Preview: ${video.title}"
                loading="lazy"
                allowfullscreen>
            </iframe>
            <h3>${video.title}</h3>
            <p class="video-channel">${video.channel} &middot; ${video.era || ""}</p>
            <div class="rating-badge rating-${band.class}">${formatBand(band, video.composite_percentile)}</div>
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
    rows.push(basicInfoRow(
        "Overall Score",
        formatBand(bandFor(videoA.composite_percentile), videoA.composite_percentile),
        formatBand(bandFor(videoB.composite_percentile), videoB.composite_percentile)
    ));

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

function renderComparison() {
    const videoA = getVideo(selectA.value);
    const videoB = getVideo(selectB.value);

    if (!videoA || !videoB) {
        headline.textContent = "Select two videos above to compare.";
        similaritiesBox.hidden = true;
        videoPair.innerHTML = "";
        typeGrid.innerHTML = "";
        return;
    }

    renderHeadline(videoA, videoB);
    renderSimilarities(videoA, videoB);
    renderVideoPair(videoA, videoB);
    renderTypeGrid(videoA, videoB);
}

/* =========================================================
   3. One-click preset: representative historical vs. the
   contemporary video that differs from it the most.
========================================================= */

function applyPreset() {
    // "Contemporary" is the fixed fallback era_for() assigns to any video
    // historical-manifest.tsv doesn't cover; every other era string is
    // whatever historical-manifest.tsv actually labels it (e.g. a specific
    // decade), so we don't hardcode a particular historical label here.
    const historical = SITE_DATA.videos.filter(v => v.era && v.era !== "Contemporary");
    const contemporary = SITE_DATA.videos.filter(v => !v.era || v.era === "Contemporary");

    if (!historical.length || !contemporary.length) return;

    // Pick the historical video closest to the median composite score
    // (a representative example, not a cherry-picked extreme).
    const sortedHist = historical.slice().sort((a, b) => (a.composite_percentile ?? 0) - (b.composite_percentile ?? 0));
    const repHistorical = sortedHist[Math.floor(sortedHist.length / 2)];

    // Pick the contemporary video with the largest composite gap from it.
    let bestContemporary = contemporary[0];
    let bestGap = -1;
    contemporary.forEach(video => {
        const gap = Math.abs((video.composite_percentile ?? 0) - (repHistorical.composite_percentile ?? 0));
        if (gap > bestGap) {
            bestGap = gap;
            bestContemporary = video;
        }
    });

    selectA.value = repHistorical.video_id;
    selectB.value = bestContemporary.video_id;
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

renderComparison();
