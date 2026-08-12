/**
 * ---------------------------------------------------------
 * live-analysis.js — on-demand analysis of a YouTube video
 * that isn't in the dataset yet.
 *
 * Hooks into the existing "not found" search flow: when a
 * pasted URL doesn't match anything in SITE_DATA, this
 * automatically starts a live analysis rather than requiring
 * a second, separate click -- the search itself was already
 * an explicit action, so no further confirmation is needed
 * for a valid YouTube URL specifically (plain text searches
 * that don't parse as a URL never reach this at all).
 *
 * Completed results render through the exact same functions
 * a normal dataset video uses (renderFoundVideoDisplay,
 * renderDetailsPanel in lookup.js) rather than a separate,
 * differently-shaped card -- the API's result shape is
 * deliberately identical to a dataset video's
 * { composite_percentile, taxonomy } shape specifically so
 * this reuse works cleanly. A "Live Analysis" badge is still
 * inserted so it's never confused for a permanent dataset
 * entry -- see the ephemeral-by-design note in
 * live_analysis_api.py.
 * ---------------------------------------------------------
 */

const LIVE_ANALYSIS_API_BASE = "https://hyperstimulation.cis240515.projects.jetstream-cloud.org";

const POLL_INTERVAL_MS = 2500;
const MAX_POLL_ATTEMPTS = 40; // ~100s ceiling before giving up client-side

function looksLikeUnconfigured() {
    return LIVE_ANALYSIS_API_BASE.includes("YOUR-VM-ADDRESS-HERE");
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
    queued: "This video isn't in the dataset yet. Starting a live analysis...",
    downloading: "Downloading a clip of the video...",
    analyzing: "Measuring pacing, audio intensity, and reward patterning...",
};

// Renders a completed live-analysis result using the exact same layout
// dataset videos use: video embed + 3-category summary on the left
// (renderFoundVideoDisplay, from lookup.js), full score meter and
// category matrix on the right (renderDetailsPanel, from lookup.js).
// Both functions read video.live_analysis themselves to show the
// "not part of the permanent dataset" badge, so nothing extra is
// needed here beyond calling them.
function renderLiveAnalysisResult(result) {
    renderFoundVideoDisplay(result);
    renderDetailsPanel(result);
}

async function pollJob(jobId, progressContainer) {
    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));

        let response;
        try {
            response = await fetch(`${LIVE_ANALYSIS_API_BASE}/api/analyze/${jobId}`);
        } catch (networkErr) {
            progressContainer.innerHTML = liveAnalysisErrorHTML(
                "Lost connection to the analysis server. Please try again."
            );
            return;
        }

        if (!response.ok) {
            progressContainer.innerHTML = liveAnalysisErrorHTML(
                "The analysis server returned an unexpected error."
            );
            return;
        }

        const data = await response.json();

        if (data.status === "done") {
            renderLiveAnalysisResult(data.result);
            return;
        }
        if (data.status === "error") {
            progressContainer.innerHTML = liveAnalysisErrorHTML(data.error || "Analysis failed.");
            return;
        }

        progressContainer.innerHTML = liveAnalysisProgressHTML(
            STATUS_LABELS[data.status] || "Working..."
        );
    }

    progressContainer.innerHTML = liveAnalysisErrorHTML(
        "This is taking longer than expected. The video may be unusually long, " +
        "or the analysis server may be busy. Please try again in a moment."
    );
}

async function startLiveAnalysis(url, progressContainer) {
    progressContainer.innerHTML = liveAnalysisProgressHTML(STATUS_LABELS.queued);

    let response;
    try {
        response = await fetch(`${LIVE_ANALYSIS_API_BASE}/api/analyze`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url }),
        });
    } catch (networkErr) {
        progressContainer.innerHTML = liveAnalysisErrorHTML(
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
        progressContainer.innerHTML = liveAnalysisErrorHTML(detail);
        return;
    }

    const { job_id } = await response.json();
    pollJob(job_id, progressContainer);
}

// Hook: called from renderVideoPanel() in lookup.js when findVideo()
// finds nothing AND the query looks like a real YouTube URL/ID.
// Automatically starts analysis -- no separate button/click required,
// since reaching this point already required an explicit search
// action. Safe no-op if the API base is still the placeholder
// (nothing configured yet on a fresh checkout).
function offerLiveAnalysis(query, container) {
    if (looksLikeUnconfigured()) return false;
    const videoId = youtubeId(query);
    if (!videoId) return false;

    startLiveAnalysis(query, container);
    return true;
}
