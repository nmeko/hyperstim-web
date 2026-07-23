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
        intro: "How fast the video moves visually: frequent cuts, shifting colors, and constant motion keep the visual system continually re-triggered.",
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
        intro: "How often the video lets a viewer's arousal come back down, through quiet moments, steadier volume, and a break from constant intensity.",
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
        intro: "How often the video sets up a small payoff, a musical release or a surprise reveal, training an expectation of constant reward.",
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

// A 5-dot scale (Common Sense Media style) as a scannable alternative to
// the raw number — how many of 5 dots are filled scales with percentile.
// aria-hidden because the dots are purely decorative reinforcement; the
// real accessible value is always the text label + number next to it.
function dotScaleHTML(percentile) {
    const band = bandFor(percentile);
    const filled = (percentile === null || percentile === undefined || Number.isNaN(percentile))
        ? 0
        : Math.max(0, Math.min(5, Math.round(percentile / 20)));

    const dots = Array.from({ length: 5 }, (_, i) => {
        const char = i < filled ? "●" : "○";
        const delay = (i * 0.06).toFixed(2);
        return `<span class="dot" style="animation-delay: ${delay}s;">${char}</span>`;
    }).join("");

    return `<span class="dot-scale dot-scale-${band.class}" aria-hidden="true">${dots}</span>`;
}

// A visual marker showing where a score sits along the 0-100 dataset
// range. Percentile already IS "beats X% of the dataset" — this just
// gives that number a visual position instead of a bare digit.
function distributionMarkerHTML(percentile) {
    if (percentile === null || percentile === undefined || Number.isNaN(percentile)) {
        return `<p class="distribution-caption">Not enough data to place this on the scale yet.</p>`;
    }
    const pct = Math.max(0, Math.min(100, Math.round(percentile)));
    return `
        <div class="distribution-marker">
            <div class="distribution-track">
                <div class="distribution-dot" style="left: ${pct}%;"></div>
            </div>
            <p class="distribution-caption">More intense than ${pct}% of videos in this dataset.</p>
        </div>
    `;
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
    "ranked relative to every other video in this dataset, not an absolute or medical scale.";

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
        ${dotScaleHTML(video.composite_percentile)}
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
                <p>${reasonText} The measurements below are still real. They just can't be replayed here.</p>
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

    const FONT_SIZE_KEY = "hyperstim_font_size";
    const CONTRAST_KEY = "hyperstim_contrast";
    const THEME_KEY = "hyperstim_theme";

    function readSavedFontSize() {
        const saved = parseInt(localStorage.getItem(FONT_SIZE_KEY), 10);
        return (Number.isFinite(saved) && saved >= MIN && saved <= MAX) ? saved : DEFAULT;
    }

    let currentFontSize = readSavedFontSize();

    const smaller = document.getElementById("text-smaller");
    const reset = document.getElementById("text-reset");
    const larger = document.getElementById("text-larger");
    const contrast = document.getElementById("contrast-toggle");
    const theme = document.getElementById("theme-toggle");

    function applyFontSize() {
        html.style.fontSize = `${currentFontSize}px`;
        localStorage.setItem(FONT_SIZE_KEY, String(currentFontSize));
        // Font-size changes the sticky header's actual rendered height
        // (toolbar buttons and nav text both scale) — remeasure so
        // anything offset below it (like a sticky panel) stays correct.
        requestAnimationFrame(updateStickyHeaderOffset);
    }

    // Apply the saved font size immediately on this page too, so a
    // preference set on one page carries over to every other page.
    applyFontSize();

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
        const savedContrast = localStorage.getItem(CONTRAST_KEY) === "high";
        html.dataset.contrast = savedContrast ? "high" : "";
        contrast.setAttribute("aria-pressed", String(savedContrast));

        contrast.addEventListener("click", () => {
            const isHigh = html.dataset.contrast === "high";
            const next = !isHigh;
            html.dataset.contrast = next ? "high" : "";
            contrast.setAttribute("aria-pressed", String(next));
            localStorage.setItem(CONTRAST_KEY, next ? "high" : "");
        });
    }

    if (theme) {
        // "auto" (the default, and what a never-touched visitor gets) means
        // explicitly follow the OS/browser's own prefers-color-scheme --
        // including whatever time-based auto-switching the OS itself does.
        // "light"/"dark" are explicit choices that override the OS setting
        // and persist across pages and future visits, until changed again.
        const THEME_LABELS = { auto: "Theme: Auto", light: "Theme: Light", dark: "Theme: Dark" };
        const THEME_CYCLE = ["auto", "light", "dark"];

        function applyTheme(value) {
            if (value === "auto") {
                delete html.dataset.theme;
            } else {
                html.dataset.theme = value;
            }
            theme.textContent = THEME_LABELS[value];
            localStorage.setItem(THEME_KEY, value);
        }

        const savedTheme = localStorage.getItem(THEME_KEY);
        applyTheme(THEME_CYCLE.includes(savedTheme) ? savedTheme : "auto");

        theme.addEventListener("click", () => {
            const current = localStorage.getItem(THEME_KEY) || "auto";
            const nextIndex = (THEME_CYCLE.indexOf(current) + 1) % THEME_CYCLE.length;
            applyTheme(THEME_CYCLE[nextIndex]);
        });
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
   10b. Auto-hide header on mobile scroll — the sticky header
   eats a lot of a phone's vertical space. Scrolling down hides
   it (translated off-screen via CSS); scrolling up reveals it
   again. Desktop is unaffected — the header always stays put
   there, matching how it's always worked.
========================================================= */

function initHeaderAutoHide() {
    const header = document.getElementById("site-header");
    if (!header || typeof window.matchMedia !== "function") return;

    const MOBILE_QUERY = "(max-width: 600px)";
    const HIDE_THRESHOLD = 80; // don't hide on tiny, incidental scrolls
    let lastScrollY = window.scrollY || 0;
    let ticking = false;

    function handleScroll() {
        if (!window.matchMedia(MOBILE_QUERY).matches) {
            header.classList.remove("header-hidden");
            lastScrollY = window.scrollY || 0;
            ticking = false;
            return;
        }

        const currentY = window.scrollY || 0;
        const scrollingDown = currentY > lastScrollY;

        if (scrollingDown && currentY > HIDE_THRESHOLD) {
            header.classList.add("header-hidden");
        } else if (!scrollingDown) {
            header.classList.remove("header-hidden");
        }

        lastScrollY = currentY;
        ticking = false;
    }

    window.addEventListener("scroll", () => {
        if (!ticking) {
            requestAnimationFrame(handleScroll);
            ticking = true;
        }
    });
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
            ${mascotSVG(64)}
            <h2 id="onboarding-title">Welcome to the HyperStim Video Audit</h2>
            <p>This site measures production-intensity patterns in children's videos across three categories:</p>
            <ul class="onboarding-categories">
                <li><strong>Pacing Intensification:</strong> how fast the video moves visually.</li>
                <li><strong>Recovery Denial:</strong> how rarely it lets a viewer calm back down.</li>
                <li><strong>Reward Patterning:</strong> how often it sets up a small payoff.</li>
            </ul>
            <p>Every score is a band, shown with both a color and a shape, so it still reads without color:</p>
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
   13b. Site mascot — a calm, original character (not based on
   any existing show/IP) used sparingly: empty states, the
   onboarding walkthrough, and the Resources "about" corner.
   Inline SVG using CSS variables so it adapts to dark mode
   automatically. Purely decorative — always aria-hidden, with
   the caller supplying real accessible text alongside it.
========================================================= */

function mascotSVG(size) {
    const s = size || 96;
    return `
        <svg width="${s}" height="${s}" viewBox="0 0 120 120" aria-hidden="true" focusable="false" class="mascot-bob">
            <ellipse cx="60" cy="58" rx="46" ry="42" fill="var(--surface-alt)" />
            <ellipse cx="60" cy="62" rx="39" ry="35" fill="var(--bg)" />
            <ellipse cx="24" cy="20" rx="10" ry="15" fill="var(--surface-alt)" transform="rotate(-20 24 20)" />
            <ellipse cx="96" cy="20" rx="10" ry="15" fill="var(--surface-alt)" transform="rotate(20 96 20)" />
            <ellipse cx="30" cy="98" rx="16" ry="10" fill="var(--surface-alt)" transform="rotate(15 30 98)" />
            <ellipse cx="90" cy="98" rx="16" ry="10" fill="var(--surface-alt)" transform="rotate(-15 90 98)" />
            <circle cx="44" cy="54" r="5" fill="var(--primary)" />
            <circle cx="76" cy="54" r="5" fill="var(--primary)" />
            <path d="M 46 76 Q 60 84 74 76" fill="none" stroke="var(--accent-b)" stroke-width="3" stroke-linecap="round" />
            <g transform="translate(60,102)">
                <path d="M0 14 C -3 4 -3 -4 0 -12" fill="none" stroke="var(--accent-b)" stroke-width="3" stroke-linecap="round" />
                <path d="M0 -12 C -8 -14 -11 -6 -6 -1 C -2 -6 -1 -9 0 -12 Z" fill="var(--primary)" />
                <path d="M0 -12 C 8 -14 11 -6 6 -1 C 2 -6 1 -9 0 -12 Z" fill="var(--accent-a)" />
            </g>
        </svg>
    `;
}

/* =========================================================
   14. "Currently Comparing" tray — a cross-page queue (backed
   by localStorage) of up to 2 videos to compare. Clicking a
   "Compare This" link (built by cardHTML in lookup.js) adds to
   this queue instead of navigating immediately, via a delegated
   click handler below. The link's href is left intact as a
   no-JS fallback: if JS fails for any reason, it still navigates
   directly to a valid pre-filled Compare page, same as before
   this feature existed.
========================================================= */

const COMPARE_QUEUE_KEY = "hyperstim_compare_queue";

function getCompareQueue() {
    try {
        const raw = localStorage.getItem(COMPARE_QUEUE_KEY);
        const queue = raw ? JSON.parse(raw) : [];
        return Array.isArray(queue) ? queue : [];
    } catch (e) {
        return [];
    }
}

function setCompareQueue(queue) {
    try { localStorage.setItem(COMPARE_QUEUE_KEY, JSON.stringify(queue)); } catch (e) { /* ignore */ }
}

function addToCompareQueue(videoId) {
    let queue = getCompareQueue();
    if (!queue.includes(videoId)) {
        queue = [...queue, videoId].slice(-2); // keep at most the 2 most recently added
        setCompareQueue(queue);
    }
    renderCompareTray();
}

function removeFromCompareQueue(videoId) {
    setCompareQueue(getCompareQueue().filter(id => id !== videoId));
    renderCompareTray();
}

function renderCompareTray() {
    const queue = getCompareQueue();
    let tray = document.getElementById("compare-tray");

    if (!queue.length) {
        if (tray) tray.remove();
        return;
    }

    if (!tray) {
        tray = document.createElement("div");
        tray.id = "compare-tray";
        document.body.appendChild(tray);
    }

    const itemsHTML = queue.map(id => {
        const video = typeof SITE_DATA !== "undefined" ? SITE_DATA.videos.find(v => v.video_id === id) : null;
        const title = video ? video.title : id;
        return `
            <span class="compare-tray-item">
                ${title}
                <button type="button" class="compare-tray-remove" data-video-id="${id}" aria-label="Remove ${title} from comparison">&times;</button>
            </span>
        `;
    }).join("");

    const actionHTML = queue.length === 2
        ? `<a class="secondary" href="compare.html#a=${queue[0]}&b=${queue[1]}">Compare Now</a>`
        : `<span class="compare-tray-hint">Add one more video to compare</span>`;

    tray.innerHTML = `
        <div class="compare-tray-inner">
            <strong>Comparing:</strong>
            ${itemsHTML}
            ${actionHTML}
            <button type="button" id="compare-tray-clear" class="secondary">Clear</button>
        </div>
    `;

    tray.querySelectorAll(".compare-tray-remove").forEach(btn => {
        btn.addEventListener("click", () => removeFromCompareQueue(btn.dataset.videoId));
    });
    const clearButton = document.getElementById("compare-tray-clear");
    if (clearButton) clearButton.addEventListener("click", () => { setCompareQueue([]); renderCompareTray(); });
}

function initCompareTray() {
    renderCompareTray(); // show it immediately if a queue already exists from a previous page

    document.addEventListener("click", e => {
        const link = e.target.closest ? e.target.closest(".compare-link") : null;
        if (!link) return;
        const match = link.getAttribute("href").match(/a=([A-Za-z0-9_-]{11})/);
        if (!match) return; // malformed href — let the default navigation happen as a safe fallback
        e.preventDefault();
        addToCompareQueue(match[1]);
    });
}

/* =========================================================
   15. Copy-link buttons — shares the current page's URL
   (already kept in sync with the current selection via the
   hash-based deep-linking in lookup.js/compare.js). Uses the
   Clipboard API where available, falls back to a prompt() with
   the URL pre-filled so it can still be copied manually.
========================================================= */

function initCopyLinkButtons() {
    document.addEventListener("click", e => {
        const button = e.target.closest ? e.target.closest(".copy-link-button") : null;
        if (!button) return;

        const url = location.href;
        const originalText = button.textContent;

        function showCopiedFeedback() {
            button.textContent = "Link copied!";
            setTimeout(() => { button.textContent = originalText; }, 2000);
        }

        if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(url).then(showCopiedFeedback).catch(() => {
                window.prompt("Copy this link:", url);
            });
        } else {
            window.prompt("Copy this link:", url);
        }
    });
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
    initHeaderAutoHide();
    initBackToTop();
    initOnboarding();
    initVideoRetryHandlers();
    initCompareTray();
    initCopyLinkButtons();

    const aboutMascot = document.getElementById("about-mascot");
    if (aboutMascot) aboutMascot.innerHTML = mascotSVG(72);

    const siteMascot = document.getElementById("site-mascot");
    if (siteMascot) siteMascot.innerHTML = mascotSVG(36);
});

window.addEventListener("resize", () => {
    updateStickyHeaderOffset();
});
