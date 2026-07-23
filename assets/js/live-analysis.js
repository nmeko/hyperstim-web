/**
 * ---------------------------------------------------------
 * live-analysis.js — on-demand analysis of a YouTube video
 * that isn't in the dataset yet.
 *
 * Hooks into the existing "not found" search flow: when a
 * pasted URL doesn't match anything in SITE_DATA, this offers
 * a live-analysis option instead of a dead end.
 *
 * Reuses the site's existing shared rendering functions
 * (compositeBadgeHTML, categoryScoreLineHTML) since the API's
 * result shape is deliberately identical to a normal dataset
 * video's { composite_percentile, taxonomy } shape. Results
 * are always shown in a clearly separate, labeled panel --
 * this is intentional: a live result is NOT part of the
 * permanent dataset (see the ephemeral-by-design note in
 * live_analysis_api.py), and the UI should never blur that
 * line for the person looking at it.
 * ---------------------------------------------------------
 */

// CONFIGURE THIS: the public URL where live_analysis_api.py is
// actually running on your VM. Using a placeholder here on purpose --
// this must be filled in with your real address before this does
// anything, and works safely as a no-op (button never appears) if left
// unconfigured on a fresh checkout.
const LIVE_ANALYSIS_API_BASE = "https://YOUR-VM-ADDRESS-HERE:8420";

const POLL_INTERVAL_MS = 2500;
const MAX_POLL_ATTEMPTS = 40; // ~100s ceiling before giving up client-side

function looksLikeUnconfigured() {
    return LIVE_ANALYSIS_API_BASE.includes("YOUR-VM-ADDRESS-HERE");
}

function liveAnalysisPromptHTML(query) {
    return `
        <div class="live-analysis-prompt">
            <p>This video isn't in the dataset yet.</p>
            <button type="button" id="live-analysis-start" class="secondary">
                Analyze it live
            </button>
            <p class="disclaimer">
                Live analysis compares this video against the existing dataset,
                but is not added to it. Processing usually takes 15-60 seconds.
            </p>
        </div>
    `;
}

function liveAnalysisProgressHTML(statusLabel) {
    return `
        <div class="live-analysis-progress" aria-live="polite">
            ${mascotSVG(56)}
            <p>${statusLabel}</p>
        </div>
    `;
}

function liveAnalysisErrorHTML(message) {
    return `
        <div class="live-analysis-error" role="alert">
            <p><strong>Couldn't complete live analysis.</strong></p>
            <p>${message}</p>
        </div>
    `;
}

const STATUS_LABELS = {
    queued: "Queued...",
    downloading: "Downloading a clip of the video...",
    analyzing: "Measuring pacing, audio intensity, and reward patterning...",
};

function liveAnalysisResultHTML(result) {
    const categoryLines = Object.keys(TAXONOMY_SCHEMA)
        .map(key => categoryScoreLineHTML(result, key))
        .join("");

    return `
        <div class="live-analysis-result">
            <div class="live-analysis-badge">Live Analysis — not part of the permanent dataset</div>
            <h3>${result.title || result.video_id}</h3>
            ${result.channel ? `<p class="video-channel">${result.channel}</p>` : ""}
            ${compositeBadgeHTML(result)}
            <ul class="score-list">${categoryLines}</ul>
            <p class="disclaimer">
                Compared against the current dataset. Scores may shift as the
                dataset grows.
            </p>
        </div>
    `;
}

async function pollJob(jobId, container) {
    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));

        let response;
        try {
            response = await fetch(`${LIVE_ANALYSIS_API_BASE}/api/analyze/${jobId}`);
        } catch (networkErr) {
            container.innerHTML = liveAnalysisErrorHTML(
                "Lost connection to the analysis server. Please try again."
            );
            return;
        }

        if (!response.ok) {
            container.innerHTML = liveAnalysisErrorHTML(
                "The analysis server returned an unexpected error."
            );
            return;
        }

        const data = await response.json();

        if (data.status === "done") {
            container.innerHTML = liveAnalysisResultHTML(data.result);
            return;
        }
        if (data.status === "error") {
            container.innerHTML = liveAnalysisErrorHTML(data.error || "Analysis failed.");
            return;
        }

        container.innerHTML = liveAnalysisProgressHTML(
            STATUS_LABELS[data.status] || "Working..."
        );
    }

    container.innerHTML = liveAnalysisErrorHTML(
        "This is taking longer than expected. The video may be unusually long, " +
        "or the analysis server may be busy. Please try again in a moment."
    );
}

async function startLiveAnalysis(url, container) {
    container.innerHTML = liveAnalysisProgressHTML("Starting...");

    let response;
    try {
        response = await fetch(`${LIVE_ANALYSIS_API_BASE}/api/analyze`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url }),
        });
    } catch (networkErr) {
        container.innerHTML = liveAnalysisErrorHTML(
            "Couldn't reach the analysis server. It may be offline."
        );
        return;
    }

    if (!response.ok) {
        let detail = "Please check the link and try again.";
        try {
            const errBody = await response.json();
            if (errBody.detail) detail = errBody.detail;
        } catch (parseErr) { /* use default message */ }
        container.innerHTML = liveAnalysisErrorHTML(detail);
        return;
    }

    const { job_id } = await response.json();
    pollJob(job_id, container);
}

// Hook: called from runLookup() when findVideo() finds nothing AND the
// query looks like a real YouTube URL/ID. Safe no-op if the API base
// is still the placeholder (nothing configured yet on a fresh checkout).
function offerLiveAnalysis(query, container) {
    if (looksLikeUnconfigured()) return false;
    const videoId = youtubeId(query);
    if (!videoId) return false;

    container.innerHTML = liveAnalysisPromptHTML(query);
    const startButton = document.getElementById("live-analysis-start");
    if (startButton) {
        startButton.addEventListener("click", () => startLiveAnalysis(query, container));
    }
    return true;
}
