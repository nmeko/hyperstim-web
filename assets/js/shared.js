/**
 * ---------------------------------------------------------
 * HyperStim shared.js
 * ---------------------------------------------------------
 * Cross-page constants and utilities. Loaded on every page,
 * after data.js and before the page-specific script.
 * ---------------------------------------------------------
 */

/* =========================================================
   1. Taxonomy schema — the single source of truth for labels,
   plain-language explanations, and which raw feature(s) back
   each pattern type. Mirrors scripts/build_dataset.py — if you
   change a key here, update the Python script too.
========================================================= */

const TAXONOMY_SCHEMA = {
    pacing_intensification: {
        label: "Pacing Intensification",
        short: "Pacing",
        intro: "How fast the video moves visually — frequent cuts, shifting colors, and constant motion keep the visual system continually re-triggered.",
        types: {
            rapid_cutting: {
                label: "Rapid Cutting",
                explanation: "How often the shot changes. Frequent cuts keep pulling attention back to a new image before a child has finished processing the last one.",
                features: ["cuts_per_min", "mean_shot_dur_s"]
            },
            scene_discontinuity: {
                label: "Scene Discontinuity",
                explanation: "How visually different one shot is from the next at each cut. Big jumps make it harder for a young viewer to track what just happened.",
                features: ["inter_cut_ssim_mean"]
            },
            chromatic_instability: {
                label: "Chromatic Instability",
                explanation: "How much the color palette shifts from frame to frame. Constantly shifting colors keep the visual system in flux with no stable point to rest on.",
                features: ["mean_hist_diff"]
            },
            visual_intensity: {
                label: "Visual Intensity",
                explanation: "Overall color saturation and vividness. Highly saturated, colorful footage is more visually arousing than muted footage.",
                features: ["mean_saturation", "mean_colorfulness"]
            },
            continuous_visual_motion: {
                label: "Continuous Visual Motion",
                explanation: "How much of the video has visible motion, and how rarely it holds still. Constant motion leaves little visual downtime.",
                features: ["motion_mean", "motion_rest_frac"]
            }
        }
    },

    recovery_denial: {
        label: "Recovery Denial",
        short: "Recovery",
        intro: "How often the video lets a viewer's arousal come back down — through quiet moments, steadier volume, and a break from constant intensity.",
        types: {
            sustained_audio_intensity: {
                label: "Sustained Audio Intensity",
                explanation: "Average loudness across the whole video. Sustained loud audio keeps arousal elevated, with fewer quiet moments to reset.",
                features: ["mean_rms_db"]
            },
            loudness_oscillation: {
                label: "Loudness Oscillation",
                explanation: "How often volume jumps sharply. Frequent, sharp jumps repeatedly re-trigger a startle-like attention response.",
                features: ["loudness_oscillation_score", "loudness_jumps_per_min"]
            },
            silence_elimination: {
                label: "Silence Elimination",
                explanation: "What share of the video is near-total silence. Little or no silence removes the natural pauses a young viewer needs to disengage and reset.",
                features: ["silence_frac"]
            }
        }
    },

    reward_patterning: {
        label: "Reward Patterning",
        short: "Reward",
        intro: "How often the video sets up a small payoff — a musical release or a surprise reveal — training an expectation of constant reward.",
        types: {
            musical_build_resolve: {
                label: "Musical Build-Resolve",
                explanation: "How often music builds tension and then releases it. Frequent build-and-release cycles condition an expectation of constant payoff.",
                features: ["build_resolve_per_min"]
            },
            surprise_reveals: {
                label: "Surprise Reveals",
                explanation: "How often a cut lines up with a sudden sound burst. Frequent surprise pairings train a strong expectation of being startled or rewarded.",
                features: ["reveal_coincidence_rate"]
            }
        }
    }
};

const FEATURE_INDEX = (() => {
    const index = {};
    Object.entries(TAXONOMY_SCHEMA).forEach(([catKey, cat]) => {
        Object.entries(cat.types).forEach(([typeKey, type]) => {
            type.features.forEach(featureKey => {
                index[featureKey] = { categoryKey: catKey, typeKey };
            });
        });
    });
    return index;
})();

/* =========================================================
   2. Rating bands — plain-language first, number second.
========================================================= */

function bandFor(percentile) {
    if (percentile === null || percentile === undefined || Number.isNaN(percentile)) {
        return { label: "Not enough data", class: "unknown", icon: "○" };
    }
    if (percentile < 40) return { label: "Good", class: "good", icon: "●" };
    if (percentile < 70) return { label: "Moderate", class: "moderate", icon: "▲" };
    return { label: "Extremely High", class: "extreme", icon: "■" };
}

function formatBand(band, percentile) {
    const icon = `<span class="band-icon" aria-hidden="true">${band.icon}</span>`;
    if (percentile === null || percentile === undefined || Number.isNaN(percentile)) {
        return `${icon}${band.label}`;
    }
    return `${icon}${band.label} (${Math.round(percentile)}/100)`;
}

/* =========================================================
   2b. Info-icon tooltip — a small "?" that explains a score
   on hover or keyboard focus. Accessible: the explanation is
   real DOM text (not a title attribute, which is unreliable
   for touch/keyboard), and the icon itself is a focusable,
   labeled element.
========================================================= */

function infoIconHTML(explanationText, ariaLabel = "What does this score mean?") {
    return `
        <span class="info-icon" tabindex="0" role="button" aria-label="${ariaLabel}">
            <span aria-hidden="true">?</span>
            <span class="info-tooltip" role="tooltip">${explanationText}</span>
        </span>
    `;
}

const COMPOSITE_SCORE_EXPLANATION =
    "The overall score is the average of the Pacing, Recovery, and Reward category scores, " +
    "ranked relative to every other video in this dataset — not an absolute or medical scale.";

// The composite/overall score badge, with its explanation tooltip built in.
// Used everywhere a video's top-level score badge appears, so the
// explanation and markup stay consistent instead of being copy-pasted.
function compositeBadgeHTML(video) {
    const band = bandFor(video.composite_percentile);
    return `
        <div class="rating-badge rating-${band.class}">
            ${formatBand(band, video.composite_percentile)}
            ${infoIconHTML(COMPOSITE_SCORE_EXPLANATION, "What does the overall score mean?")}
        </div>
    `;
}

// A single "Category: Band (score)" line with an info icon explaining
// that category, for compact contexts like the card grid's score list.
function categoryScoreLineHTML(video, categoryKey) {
    const pct = categoryPercentile(video, categoryKey);
    const band = bandFor(pct);
    const schema = TAXONOMY_SCHEMA[categoryKey];
    return `<li>${schema.short}: ${formatBand(band, pct)} ${infoIconHTML(schema.intro, `What does ${schema.label} mean?`)}</li>`;
}

/* =========================================================
   3. YouTube helpers
========================================================= */

function youtubeId(raw) {
    if (!raw) return null;
    const input = raw.trim();

    const patterns = [
        /(?:youtube\.com\/watch\?[^#]*\bv=)([A-Za-z0-9_-]{11})/,
        /youtu\.be\/([A-Za-z0-9_-]{11})/,
        /youtube\.com\/shorts\/([A-Za-z0-9_-]{11})/,
        /youtube\.com\/embed\/([A-Za-z0-9_-]{11})/
    ];

    for (const pattern of patterns) {
        const match = input.match(pattern);
        if (match) return match[1];
    }

    if (/^[A-Za-z0-9_-]{11}$/.test(input)) return input;

    return null;
}

function youtubeThumbnail(videoId) {
    return `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
}

// Single source of truth for embedding a video anywhere on the site.
// If build_dataset.py's --availability-report found this video removed/
// private/region-locked, show a graceful placeholder instead of a
// broken iframe. `video.available` is only present after that step has
// been run at least once; videos never checked are treated as available.
const UNAVAILABLE_REASON_MESSAGES = {
    private: "This video was made private by its uploader after it was scored.",
    removed: "This video was removed from YouTube after it was scored.",
};

function videoEmbedHTML(video) {
    if (video.available === false) {
        const reasonText = UNAVAILABLE_REASON_MESSAGES[video.unavailable_reason]
            || "This video was scored before it became unavailable on YouTube (removed, made private, or region-locked).";
        return `
            <div class="video-unavailable">
                <img src="${youtubeThumbnail(video.video_id)}" alt="" loading="lazy">
                <p><strong>Original video no longer publicly available</strong></p>
                <p>${reasonText} The measurements below are still real — they just can't be replayed here.</p>
                <button
                    type="button"
                    class="retry-video-button secondary"
                    data-video-id="${video.video_id}"
                    data-title="${video.title}">
                    Try Again
                </button>
            </div>
        `;
    }

    return `
        <iframe
            src="https://www.youtube.com/embed/${video.video_id}"
            title="Preview: ${video.title}"
            loading="lazy"
            allowfullscreen>
        </iframe>
    `;
}

/* =========================================================
   4. Content topic keyword matching (browse filter, independent
   of the taxonomy scores).
========================================================= */

const TOPIC_KEYWORDS = {
    "Gameplay": ["gameplay", "let's play", "lets play", "minecraft", "roblox", "fortnite", "gaming"],
    "Educational": ["learn", "abc", "counting", "numbers", "phonics", "school", "education", "science"],
    "Music & Songs": ["song", "sing", "music", "rhyme", "lullaby", "nursery"],
    "Storytelling": ["story", "storytime", "tale", "fairy tale", "bedtime"],
    "Toys & Play": ["toy", "unboxing", "playset", "surprise egg", "blind bag"]
};

function deriveTopic(video) {
    if (video.content_topic) return video.content_topic;
    const haystack = `${video.title} ${video.channel}`.toLowerCase();
    for (const [topic, keywords] of Object.entries(TOPIC_KEYWORDS)) {
        if (keywords.some(kw => haystack.includes(kw))) return topic;
    }
    return "Other";
}

/* =========================================================
   5. Composite / category / type percentile helpers. These
   read the nested taxonomy structure produced by
   scripts/build_dataset.py (see data.js for the shape).
========================================================= */

function categoryPercentile(video, categoryKey) {
    const category = video.taxonomy && video.taxonomy[categoryKey];
    if (!category) return null;
    const values = Object.values(category.types)
        .map(t => t.percentile)
        .filter(p => typeof p === "number");
    if (!values.length) return null;
    return values.reduce((a, b) => a + b, 0) / values.length;
}

function allTypeEntries(video) {
    const entries = [];
    Object.entries(video.taxonomy || {}).forEach(([catKey, cat]) => {
        Object.entries(cat.types).forEach(([typeKey, type]) => {
            entries.push({ categoryKey: catKey, typeKey, ...type });
        });
    });
    return entries;
}

// How many of the 10 pattern types have a real (non-null) percentile for
// this video, out of 10. Used anywhere we want to prefer well-covered
// videos over ones the pipeline hasn't fully processed yet — this number
// rises on its own as coverage improves, so callers never need updating.
function typeCoverageCount(video) {
    return allTypeEntries(video).filter(e => e.percentile != null).length;
}

/* =========================================================
   6. Accessibility bar controller — shared across every page.
   Expects: #text-smaller, #text-reset, #text-larger, #contrast-toggle
========================================================= */

function initAccessibilityBar() {
    const html = document.documentElement;
    const STEP = 2;
    const MIN = 14;
    const MAX = 26;
    const DEFAULT = 16;

    let currentFontSize = DEFAULT;

    const smaller = document.getElementById("text-smaller");
    const reset = document.getElementById("text-reset");
    const larger = document.getElementById("text-larger");
    const contrast = document.getElementById("contrast-toggle");

    function applyFontSize() {
        html.style.fontSize = `${currentFontSize}px`;
        // Font-size changes the sticky header's actual rendered height
        // (toolbar buttons and nav text both scale) — remeasure so
        // anything offset below it (like a sticky panel) stays correct.
        requestAnimationFrame(updateStickyHeaderOffset);
    }

    if (larger) {
        larger.addEventListener("click", () => {
            currentFontSize = Math.min(MAX, currentFontSize + STEP);
            applyFontSize();
        });
    }

    if (smaller) {
        smaller.addEventListener("click", () => {
            currentFontSize = Math.max(MIN, currentFontSize - STEP);
            applyFontSize();
        });
    }

    if (reset) {
        reset.addEventListener("click", () => {
            currentFontSize = DEFAULT;
            applyFontSize();
        });
    }

    if (contrast) {
        contrast.addEventListener("click", () => {
            const isHigh = html.dataset.contrast === "high";
            html.dataset.contrast = isHigh ? "" : "high";
            contrast.setAttribute("aria-pressed", String(!isHigh));
        });
        contrast.setAttribute("aria-pressed", "false");
    }
}

// Measures the actual rendered height of the sticky header (accessibility
// toolbar + nav together) and exposes it as --sticky-header-height, so any
// element that needs to sit just below the sticky header (without being
// covered by it) can use that instead of a hardcoded guess that breaks the
// moment font size, window width, or the header's contents change.
function updateStickyHeaderOffset() {
    const header = document.getElementById("site-header");
    if (!header) return;
    document.documentElement.style.setProperty("--sticky-header-height", `${header.offsetHeight}px`);
}

/* =========================================================
   11. First-visit onboarding walkthrough
========================================================= */

const ONBOARDING_KEY = "hyperstim_onboarding_dismissed";

function initOnboarding() {
    let alreadySeen = false;
    try {
        alreadySeen = !!localStorage.getItem(ONBOARDING_KEY);
    } catch (e) {
        // localStorage can throw in some privacy modes — just skip onboarding
        // rather than breaking the page.
        return;
    }
    if (alreadySeen) return;

    const overlay = document.createElement("div");
    overlay.className = "onboarding-overlay";
    overlay.innerHTML = `
        <div class="onboarding-panel" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
            <h2 id="onboarding-title">Welcome to the HyperStim Video Audit</h2>
            <p>This site measures production-intensity patterns in children's videos across three categories:</p>
            <ul class="onboarding-categories">
                <li><strong>Pacing Intensification</strong> — how fast the video moves visually.</li>
                <li><strong>Recovery Denial</strong> — how rarely it lets a viewer calm back down.</li>
                <li><strong>Reward Patterning</strong> — how often it sets up a small payoff.</li>
            </ul>
            <p>Every score is a band, shown with both a color and a shape (so it still reads without color):</p>
            <ul class="band-key">
                <li><span class="rating-badge rating-good"><span class="band-icon" aria-hidden="true">●</span>Good</span></li>
                <li><span class="rating-badge rating-moderate"><span class="band-icon" aria-hidden="true">▲</span>Moderate</span></li>
                <li><span class="rating-badge rating-extreme"><span class="band-icon" aria-hidden="true">■</span>Extremely High</span></li>
            </ul>
            <p class="disclaimer">Scores are relative to this dataset, not an absolute or medical scale.</p>
            <button type="button" id="onboarding-dismiss">Got it, let's go</button>
        </div>
    `;
    document.body.appendChild(overlay);

    const dismissButton = overlay.querySelector ? overlay.querySelector("#onboarding-dismiss") : null;
    const releaseFocusTrap = trapFocus(overlay);
    if (dismissButton) dismissButton.focus();

    function dismiss() {
        try { localStorage.setItem(ONBOARDING_KEY, "1"); } catch (e) { /* ignore */ }
        releaseFocusTrap();
        overlay.remove();
    }

    if (dismissButton) dismissButton.addEventListener("click", dismiss);
    overlay.addEventListener("click", e => { if (e.target === overlay) dismiss(); });
    document.addEventListener("keydown", function escHandler(e) {
        if (e.key === "Escape" && document.body.contains(overlay)) {
            dismiss();
            document.removeEventListener("keydown", escHandler);
        }
    });
}

/* =========================================================
   12. Video-unavailable "Try again" retry handler — delegated
   once on document so it works on every page without each
   page needing its own listener.
========================================================= */

function initVideoRetryHandlers() {
    document.addEventListener("click", e => {
        const button = e.target.closest ? e.target.closest(".retry-video-button") : null;
        if (!button) return;
        const container = button.closest(".video-unavailable");
        if (!container) return;
        const videoId = button.dataset.videoId;
        const title = button.dataset.title || "";
        container.outerHTML = `
            <iframe
                src="https://www.youtube.com/embed/${videoId}"
                title="Preview: ${title}"
                loading="lazy"
                allowfullscreen>
            </iframe>
        `;
    });
}

/* =========================================================
   13. Find a related video — same topic, preferring a
   different era (surfaces generational comparisons), for the
   "compare with a similar video" suggestion on the Lookup page.
========================================================= */

function findSimilarVideo(video) {
    const topic = deriveTopic(video);
    const sameTopic = SITE_DATA.videos.filter(v => v.video_id !== video.video_id && deriveTopic(v) === topic);
    if (!sameTopic.length) return null;

    const differentEra = sameTopic.filter(v => v.era !== video.era);
    const pool = differentEra.length ? differentEra : sameTopic;
    return pool[Math.floor(Math.random() * pool.length)];
}

/* =========================================================
   10. Back-to-top button — injected once, shown after the
   user has scrolled past roughly one screen's worth of content.
========================================================= */

function initBackToTop() {
    const button = document.createElement("button");
    button.id = "back-to-top";
    button.type = "button";
    button.setAttribute("aria-label", "Back to top");
    button.hidden = true;
    button.innerHTML = "&uarr; Top";
    document.body.appendChild(button);

    button.addEventListener("click", () => {
        window.scrollTo({ top: 0, behavior: "smooth" });
    });

    window.addEventListener("scroll", () => {
        button.hidden = window.scrollY < 500;
    });
}

/* =========================================================
   7. Scroll-reveal helper — SAFE BY DEFAULT. Elements are
   visible with no JS at all. Only once this script confirms
   it's running do we arm the animation, right before observing.
========================================================= */

function initScrollReveal(selector = "[data-reveal]") {
    if (!("IntersectionObserver" in window)) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const elements = document.querySelectorAll(selector);
    if (!elements.length) return;

    const observer = new IntersectionObserver(entries => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add("revealed");
                observer.unobserve(entry.target);
            }
        });
    }, { threshold: 0.15 });

    elements.forEach(el => {
        el.classList.add("reveal-armed");
        observer.observe(el);
    });
}

/* =========================================================
   8. Focus trap helper for modals.
========================================================= */

function trapFocus(container) {
    const focusableSelector =
        'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

    function handleKeydown(e) {
        if (e.key !== "Tab") return;

        const focusable = Array.from(container.querySelectorAll(focusableSelector))
            .filter(el => el.offsetParent !== null);

        if (!focusable.length) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
        }
    }

    container.addEventListener("keydown", handleKeydown);
    return () => container.removeEventListener("keydown", handleKeydown);
}

/* =========================================================
   9. Init accessibility bar + reveal helper on every page.
========================================================= */

document.addEventListener("DOMContentLoaded", () => {
    initAccessibilityBar();
    initScrollReveal();
    updateStickyHeaderOffset();
    initBackToTop();
    initOnboarding();
    initVideoRetryHandlers();
});

window.addEventListener("resize", () => {
    updateStickyHeaderOffset();
});
