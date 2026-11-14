#!/usr/bin/env python3
"""
Stage 4 (v2): Extract features 1.1-2.4, decoding each clip five times.

Scope
-----
This implements **all twelve types** from
plans/plan-2026-08-21-feature-set-v2.md -- 1.1 Rapid Cutting, 1.2 Scene
Discontinuity, 1.3 Palette Instability, 1.4 Luminance Flash, 1.5 Motion
Density, 1.6 Loudness Jumps, 2.1 Visual Intensity, 2.2 Visual Brightness, 2.3
Audio Intensity, 2.4 Silence Elimination, 3.1 Audio Build-Resolve and 3.2
Surprise Reveals -- in twelve reported columns. The v1 extractor
(04_extract_features.py) and its tables stay untouched until this one is
validated (plan §5 step 1).

**Cache version 9, and what moved into it** [2026-08-25]:

  1.1  rewritten. `scdet` the FILTER is gone and its statistic is computed here
       instead, over all three colour channels, at threshold 11 on its own
       0-100 scale. The frame-difference detector that used to be unioned with
       it is DELETED. Both changes are settled on 89 hand labels and both are
       structural, which is what the version bump is for: v8 cached a greyscale
       difference and the two cannot be converted into each other.
  1.2  `inter_cut_ssim_mean` -> **`inter_cut_dssim_mean`**, reported as
       `1 - SSIM` so the whole set points one way. A derive-time subtraction and
       a rename; the cache still holds SSIM as computed.
  2.4  `lufs_gated_frac` -> **`high_lufs_frac`**, which says which side of the
       gate it counts. Same number, and it was already the loud side.
  3.1  NEW column `build_resolve_per_min`, off the momentary series.
  3.2  NEW column `loudness_jump_at_cut_per_min`, an interval join of 1.6's
       jumps against 1.1's cuts.

3.1 and 3.2 cost **no new decode**: 3.1 reads a running median of the momentary
series the audio pass already caches, and 3.2 joins two lists `derive` already
builds. That is how 2.4 arrived too -- wired in after the caches were designed,
at no extract cost. The only reason v9 re-extracts at all is 1.1's three-channel
difference.

**Five types share one audio pass and one reference.** 2.3 is the level inside
BS.1770's gate, 2.4 is how much of the running time is inside it, 1.6 is how far
above it the clip jumps and how often, 3.1 is a shape on the same series, and 3.2
times 1.6's jumps against 1.1's cuts. They cannot disagree about where a clip's
level is, which is the design.

**1.1, 1.2, 1.4 and 1.5 all read a fixed 15 fps grid** [human decisions,
2026-08-23 and 2026-08-24], so Category 1's rate, severity and share features
compare the same 67 ms interval and none of them inherits the source frame rate
(§1 rule 1). **1.3 and the level features 2.1 and 2.2 all read one 1 fps native
decode** [2026-08-26], so the whole set holds two video grids and two frame
sizes and nothing anywhere names a box (§1 rule 3).

The point of the file: **decode once, derive many times.**
-----------------------------------------------------------
Every threshold in the set is either unsettled or worth re-sweeping -- 1.3's
Jaccard cut and presence threshold have to be swept *jointly* on the corpus
(plan §3), and 1.5's 10 %w/s and 1.6's 6 LU came from hand labels rather than
from the corpus, so what they do to the corpus tails is still to be reported.
Decoding plus Farneback is ~60 s/clip and there are ~5,500 clips, so paying it
once per threshold change costs days.

So `extract` writes a per-clip .npz holding the *pre-threshold* intermediates,
and `derive` turns caches into a feature table at whatever thresholds you name.
Re-deriving the whole corpus takes seconds. What each cache makes re-sweepable:

  mafd_native  mean absolute difference between adjacent frames over all three
               colour channels, full rate
                                         -> 1.1's threshold. THE detector; the
                                            score is min(d, |d - prev d|) and is
                                            computed at derive time, so the
                                            threshold stays a re-sweep
  mafd_g*      the same difference on fixed 10/15/30 fps time grids
                                         -> 1.1's grid, which is an open
                                            question §3 1.1 states and which
                                            these keep answerable for a
                                            re-derive rather than a re-decode
  pair_ssim    SSIM across the grid pair bracketing a *superset* of cuts,
               collected for every grid -> 1.2 follows 1.1 for free, and its
                                           grid stays a derive-time choice
  ab_hist      per-second a*b* histogram at 8-unit tiles
                                         -> 1.3's tile width (8/16/32/64 by
                                            aggregation), presence threshold,
                                            AND Jaccard cut
  lstar_mean   per-frame mean CIE L*, full rate
                                         -> 1.4's sampling grid, its threshold,
                                            its rise-vs-swing rule and its
                                            cut-exclusion rule. A frame mean is a
                                            scalar, so caching at the native rate
                                            loses no grid.
  flow_mag     per-interval mean Farneback magnitude in PIXELS, 15 fps, 160 wide
               (height from the source aspect; cached as `flow_h`). Measured on
               PASS 1's retained frames at the `_grid_indices` marks since
               2026-08-26 -- 1.5 no longer owns a decode
                                         -> 1.5's threshold. Cached in pixels and
                                            converted to frame widths per second
                                            at derive time, with the grid and the
                                            width it was measured at.
  lstar_level  per-frame mean CIE L*, 1 fps, native size    -> 2.2 (it is a level;
  sat_level    per-frame mean HSV S, the same frames        -> 2.1  nothing about
                                            either is a threshold, so these two
                                            are cached only so an aggregator
                                            change costs no decode)
  r128_m       K-weighted momentary loudness, 400 ms window at a 100 ms hop
                                         -> 1.6's 6 LU cut and its refractory
                                            gap; 2.3's `lufs`, which is this
                                            series gated; 2.4, which is the
                                            share inside the gate; 3.1's nine
                                            build and resolve tests, on a 0.3 s
                                            running median of it; and 3.2, which
                                            times 1.6's jumps off it. **Five
                                            features, one series, one
                                            reference** -- they cannot disagree
                                            about where a clip's level is, which
                                            is the design.

Only the colour space itself and the sampling grids are baked in. Anything else
is a re-derive.

Usage
-----
  # decode + cache (the long run)
  ./04_extract_features_v2.py extract --manifest M.tsv --cache-dir DIR --workers 8

  # cache -> features TSV (seconds; run as often as you like)
  ./04_extract_features_v2.py derive --manifest M.tsv --cache-dir DIR --out F.tsv

  # what a threshold change would do, without writing a table
  ./04_extract_features_v2.py sweep --cache-dir DIR --param jaccard

  # pilot everything except 1.5 -- Farneback is ~14.9 s/clip of the ~18.5
  ./04_extract_features_v2.py extract --manifest M.tsv --cache-dir DIR \
      --limit 20 --no-flow

  # v11 over a v9 or v10 cache. Only the audio is lifted, so this is barely
  # cheaper than from scratch -- ~18.5 core-seconds either way.
  ./04_extract_features_v2.py extract --manifest M.tsv \
      --cache-dir CACHE/v11 --reuse-from CACHE/v10 --workers 8 \
      --ffmpeg-threads 1
"""

import argparse
import csv
import os
import re
import subprocess
import sys
import time

import numpy as np
import cv2
import yaml

# ============================================================
# Parameters
# ============================================================
# Two kinds live here and they are not the same kind of number.
#
# STRUCTURAL -- baked into the cache. Changing one invalidates every .npz and
# costs a full re-decode.
PASS1_W = 160                  # plan §2 pass A: the small-frame grid, shared by
                               # 1.1, 1.2, 1.4 and 1.5. **Width only.** The
                               # height is `_flow_height(w, h)`, so both axes
                               # take ONE scale factor [human decision,
                               # 2026-08-26, plan §1 rule 3].
                               #
                               # It was `160x90` until then, and a forced box is
                               # wrong for the same reason it was wrong for 1.5:
                               # a source that is not 16:9 has its axes scaled
                               # differently. What that cost, measured over the
                               # 300 historical clips (173 of them not 16:9):
                               # 1.1 is IMMUNE -- a mean absolute difference
                               # divides the pixel count out, 99.88% frame-exact
                               # agreement, 1606 of 1608 detections; 1.4's mean
                               # L* moves -0.126 on a 0-100 scale; but **1.2
                               # moves +0.0162 mean, one-signed** (p5 = +0.0022),
                               # tracking the squash at r = -0.68, because SSIM's
                               # kernel is 11x11 IN PIXELS and spans more source
                               # content down a squashed frame than across it.
                               # 1.2 has no threshold to absorb it and the 16:9
                               # share tracks era (~a third in E0-E3 against 56%
                               # in E4), so the box was adding an era-graded
                               # offset to a reported column.
                               #
                               # Both thresholds fitted at 160x90 were re-scored
                               # against their original labels before this
                               # changed and both HOLD: 1.1's gap runs
                               # 10.435/11.546 forced against 10.475/11.645 free
                               # -- it widens -- 0 errors of 89 either way; 1.4
                               # is 63 of 71 both ways, the same eight items
                               # missed. runs/type11-cut-detection/ and
                               # runs/type14-luma-flash/ hold the labels.
PASS1_H = 90                   # **NOT the pass height any more.** `_pass1` sizes
                               # itself with `_flow_height`. This is kept only so
                               # the one-off scripts in runs/type11-cut-detection/
                               # still reproduce the 160x90 geometry they were
                               # written against. Do not read it as live.
NATIVE_FPS = 1                 # plan §2 pass B: ONE native-resolution decode for
                               # 1.3, 2.1 and 2.2 [human decision, 2026-08-26].
                               # Native size because downscaling averages
                               # neighbouring pixels toward grey, which shrinks
                               # 1.3's occupied tile set and deflates 2.1's
                               # saturation.
                               #
                               # 1.3 was already here; the levels moved down from
                               # 2 fps, which is what let the two native passes
                               # become one. **1.3's frames are bit-identical to
                               # what it read before.** The levels are means over
                               # a clip, so halving the sample count is only a
                               # sampling-noise question: over 300 clips at full
                               # length, `mean_saturation` shifts +0.017 on 0-255
                               # and `mean_lstar` +0.011 on 0-100, Spearman
                               # 0.9999, worst rank move 8 places of 300. The
                               # price is that v1's stored `mean_saturation` no
                               # longer reproduces -- it was the last column that
                               # did (plan §0).
                               #
                               # **Do not implement this by decimating a 2 fps
                               # stream.** That was tried and the premise is
                               # false: ffmpeg's `fps` filter maps each INPUT
                               # frame to an output slot by rounding, so slot 2k
                               # at 2 fps holds the frame nearest t=k within
                               # +-0.25 s while slot k at 1 fps holds one within
                               # +-0.5 s -- different frames near half the marks.
                               # Over 24 historical clips: rho 0.982 but only
                               # 4 of 24 identical, `palette_change_per_min`
                               # +3.4% mean, max move 1.80/min. Decoding at
                               # fps=1 sidesteps it; decimating would not.
AB_SPAN = 128                  # a*b* plane spans -128..+128
CACHE_NB = 32                  # cached at 32x32 (8-unit tiles) so tile WIDTH
                               # stays re-sweepable: 2x2 -> 16 units (chosen),
                               # 4x4 -> 32, 8x8 -> 64.
CAND_CUT_THR = 3.0             # candidate-cut superset for SSIM, on the same
                               # 0-100 scale `derive` fires at 11. Must stay
                               # BELOW any threshold `derive` will ever use, or
                               # 1.2 loses cuts it should have measured. v8
                               # cached pairs for the union of two detectors,
                               # which is far more permissive than this; `derive`
                               # reports the shortfall rather than assuming it is
                               # zero (plan §2.5).
CAND_FD_SIGMA = 0.5            # the retired frame-difference detector's sigma.
                               # Kept only to widen the candidate set, never to
                               # fire a cut: 1.1 deleted that detector on
                               # 2026-08-24 and no column reads it.
SSIM_GRIDS = (15.0,)           # grids 1.2 caches SSIM pairs for. Only the
                               # default: SSIM is the one expensive thing in the
                               # pass (three grids cost 0.67 s/clip against 0.1
                               # for one), and the grid is settled at 15. Adding
                               # a grid here needs a re-extract; `derive` refuses
                               # a grid it has no pairs for rather than silently
                               # reporting 1.2 on a different interval from 1.1.
FD_GRIDS = (10.0, 15.0, 30.0)  # mean-absolute-difference sampling, as fixed TIME grids
                               # in fps [human decision, 2026-08-23: 15 fps, to
                               # align 1.1 with 1.4]. A grid, not a frame stride:
                               # differencing adjacent decoded frames compares
                               # 33 ms on a 30 fps transfer and 42 ms on a 24 fps
                               # one, and frame rate tracks era -- the axis RQ1
                               # tests (§1 rule 1). A grid cannot be recovered
                               # from another, so each is computed while the
                               # frames are in hand.
                               #
                               # v9: these are THREE-CHANNEL, like `mafd_native`,
                               # and are named `mafd_g*` for it. Leaving them
                               # greyscale under a version whose native series is
                               # not would make the open native-vs-grid question
                               # (§3 1.1) a comparison of two different
                               # statistics. They cost three extra frame
                               # differences per grid mark and no extra memory --
                               # one colour frame is held per grid, not a stack.
FLOW_FPS = 15.0                # plan §2 pass 2b: 1.5's grid [human decision,
FLOW_W = PASS1_W               # **1.5 rides pass A, so this cannot differ from
                               # PASS1_W** [2026-08-26]. Kept as its own name
                               # because it is what `_motion_frac` divides by
                               # and what the cache records as `flow_w`.
                               # 2026-08-24; width 320 -> 160 and the height
                               # freed 2026-08-26]. Both structural, neither a
                               # detail: flow magnitude is a displacement per
                               # interval, so the grid IS half the threshold, and
                               # the frame width is the unit the other half is
                               # stated in. A 2 fps grid measured 1.32 %w/s
                               # median against 15 fps's 3.01, because flow over
                               # half a second is NET displacement and the fast
                               # material cancels (plan §3 1.5).
                               #
                               # **Only the WIDTH is fixed.** The height is
                               # `_flow_height`, so the two axes take ONE scale
                               # factor and the grid cancels out of the %w/s
                               # conversion: the number becomes source
                               # displacement over source width, whatever size it
                               # was measured at. A forced box does not do that.
                               # `scale=320:180` and `scale=160:90` both name a
                               # box, so a source that is not 16:9 has its axes
                               # scaled differently and its VERTICAL displacement
                               # comes out wrong by source_aspect / (16/9) --
                               # x0.75 for 4:3, x1.22 for a 2.16:1 letterbox.
                               # 55% of the historical clips were affected, mean
                               # factor 0.873, and it tracks era (0.86 in E0-E3
                               # against 0.91 in E4) because 4:3 sources are
                               # older -- a deflation of early-era motion on
                               # RQ1's own axis (plan §3 1.5).
FLOW_PARAMS = (0.5, 3, 15, 3, 5, 1.2, 0)
                               # pyr_scale, levels, winsize, iterations, poly_n,
                               # poly_sigma, flags -- v1's, unchanged. These are
                               # the estimator the 50 hand labels were fitted
                               # against, so changing one is a decision and not a
                               # tuning knob (a smaller winsize would buy back
                               # most of Farneback's ~54 s/clip and is a pilot
                               # question, plan §3 1.5).
R128_HOP = 0.1                 # plan §2 pass 3: ebur128's momentary report
                               # interval. 400 ms window at a 100 ms hop is a 75%
                               # overlap, which is the block series BS.1770
                               # defines integrated loudness over -- so 2.3 is
                               # this series gated, not a second measurement.
R128_WARMUP = 1.0              # seconds dropped from the head: the 400 ms window
                               # is still filling. The 63 labels behind 1.6 and
                               # the 800-clip record behind 2.3 were both built
                               # on a series trimmed this way
                               # (runs/type16-loudness-jump/scan_corpus.py).
R128_FLOOR = -70.0             # ebur128 reports -inf for digital silence; clamp
                               # to BS.1770's absolute gate so the cache is
                               # finite and the gate is a no-op on it.

# DERIVED -- read at derive time. Changing one costs seconds.
MAFD_SCALE = 100.0 / 256.0     # `scdet` reports on 0-100 and a mean absolute
                               # difference over 8-bit channels is on 0-255, so
                               # every threshold below is stated on scdet's own
                               # scale and the series is converted once, here.
                               # Over three channels the fit against the filter
                               # is slope 0.3906 exactly, intercept 0, R2 1.0000
                               # (runs/type11-cut-detection/equivalence.py).
DEF_CUT_THR = 11.0             # 1.1, and it is the whole detector [settled
                               # 2026-08-24 on 89 hand labels]. Fire where
                               #     min( d , |d - previous d| )
                               # passes 11 on scdet's scale. Both terms have to
                               # be large, so the picture must change a lot AND
                               # that change must be a departure from how much it
                               # was already changing -- which is what separates
                               # a cut from a character whipping across a static
                               # background. Every not-cut in the label set
                               # scores at most 10.44 and every cut at least
                               # 11.55, so 11 is the midpoint of a genuine gap
                               # rather than a fitted edge. ffmpeg's default of
                               # 10 costs one false alarm; the 15 this file used
                               # until 2026-08-24 cost two real cuts.
DEF_CUT_GRID = 0.0             # 1.1's sampling grid, in fps. **0 means native
                               # adjacent frames**, which is what the 89 labels
                               # were scored on and what ships. A grid in
                               # FD_GRIDS reads `mafd_g*` instead, and it is a
                               # derive parameter rather than a re-extract
                               # because those arrays are cached.
                               #
                               # Measured on 2026-08-25 and NOT taken: the 15 fps
                               # grid scores 38 TP / 0 FP / 1 FN on the same
                               # labels and no threshold on it reaches 39/0/0,
                               # because at a 67 ms interval the previous
                               # interval has accumulated within-shot motion that
                               # the |d - d_prev| term subtracts. Cut scores fall
                               # and not-cut scores do not, so the grid costs the
                               # clean separation. Native adjacent differencing
                               # is the one place §1 rule 1 is not obeyed and it
                               # is obeyed in spirit: the score is a contrast
                               # between d and its own previous value rather than
                               # a level. runs/type11-cut-detection/.
DEF_MERGE_S = 0.5              # 1.1 dedupe: one cut per half second
DEF_LUMA_FPS = 15.0            # 1.4 grid, plan §3 1.4. A fixed *time* grid, so a
                               # 24 and a 29.97 fps transfer are compared over the
                               # same 67 ms -- §1 rule 1. 15 rather than 10
                               # because rises last a median 133 ms (p25 83 ms),
                               # and it is the fastest grid no clip must be
                               # upsampled to reach.
DEF_LUMA_THR = 20.0            # 1.4 threshold, a RISE in CIE L* (0-100). From 46
                               # blind hand labels, not a sweep: any cut in
                               # 15.3-21.0 reproduces 44/46 with zero false
                               # alarms. WCAG 2.1's 4.31 was tested and rejected
                               # (24 false alarms of 46) -- it is a
                               # photosensitivity safety floor, a different
                               # construct. runs/type14-luma-flash/.
DEF_TILE_AGG = 2               # 1.3 tile width: 2 -> 16 Lab units (chosen)
DEF_PRESENCE = 0.001           # 1.3 tile occupied at 0.1% of the frame
DEF_JACCARD = 0.45             # 1.3 Jaccard cut.
DEF_MOTION_PCT = 10.0          # 1.5 threshold, in **% of frame width per second**
                               # [human decision, 2026-08-24]. On the 15 fps grid
                               # at 320 px that is 2.13 px per 67 ms interval, or
                               # 32 px/s. Stated in frame widths so it does not
                               # name a resolution; it still names a GRID, since
                               # `motion_frac` correlates only +0.70 between the
                               # 2 and 15 fps grids at 1.25 %w/s and +0.10 at
                               # 0.6. From 50 hand-labelled one-second windows,
                               # 19 motion against 31 not: accuracy has two
                               # disjoint maxima and 10 sits inside the upper one
                               # (8.01, 11.09], so the round number costs
                               # nothing. The boundary is soft -- the overlap
                               # zone spans 1.54 to 18.15 and holds 30 of the 50
                               # -- so the column is sound as a corpus share and
                               # unreliable on any single interval near the line.
DEF_MOTION_MIN_INTERVALS = 30  # below this many non-cut intervals a share is not
                               # a share; the clip reports blank rather than a
                               # number made of a handful of frames.
DEF_EXCESS_LU = 6.0            # 1.6 threshold: how far above the clip's OWN
                               # gated integrated loudness a moment has to sit.
                               # 6 LU is roughly 1.5x as loud as the programme
                               # normally runs. Bracketed by 63 hand labels to
                               # (5.16, 6.00] -- lowest positive exactly 6.00,
                               # highest negative 5.16 -- so 6 is the round
                               # number inside the bracket, not a sweep optimum.
                               # runs/type16-loudness-jump/.
DEF_JUMP_REFRACT_S = 1.0       # 1.6 dedupe: at most one jump per second, taken
                               # greedily in descending excess.

# 3.1 Audio Build-Resolve. Ten tests over one candidate, set by hand labels over
# seven rounds and 172 stimuli (runs/type31-build-resolve/). Rounds 1-4 returned
# ZERO confirmed build-resolves between them and each null removed a hypothesis
# rather than a threshold; the break came when the thresholds moved from absolute
# LU to the clip's own loudness range, and the reason is measurable -- the median
# clip's range is 6.4 LU (p10 3.0), so every absolute cut rounds 1-4 used asked
# for more range than half the corpus contains.
#
# Three of these were chosen by looking at the same 18 clips they are quoted
# against, so that fit is in-sample. Thirteen clips appeared in two rounds and
# three of them moved verdict, which bounds how sharply any of these can be
# quoted. Both limits are in plan §3 3.1 and neither is repairable by tuning.
BR_REACH = 0.15                # STRUCTURAL to the candidate, not a test: a climb
                               # runs from the bottom 15% of the clip's own R128
                               # loudness range to the top 15%.
BR_SMOOTH_S = 0.3              # running median over the momentary series. Kills
                               # a single hit, keeps a 1 s ramp.
BR_LRA_REL_GATE = 20.0         # R128 loudness range gates at -20 LU, not the
                               # -10 LU `I` gates at. Different statistic, and
                               # the standard says so.
BR_PEAK_EXT_S = 4.0            # how far past the top band to walk for the true
                               # local maximum. A candidate used to END at the
                               # first entry into the top band, which is where a
                               # climb becomes VISIBLE, not where it ends; the
                               # human caught it on Porky Pig's Feat (1943) and
                               # The Pink Panther (1964), and fixing it took the
                               # 800-clip corpus from 38 gradual builds to 193.
DEF_BR_R2 = 0.80               # a straight line fits the climb (a step does not)
DEF_BR_MAX_STEP = 0.25         # no single 100 ms rise does more than a quarter
                               # of the climb -- the "not one sudden noise" test.
                               # Moved 0.22 -> 0.25 [human decision, 2026-08-24]:
                               # 0.22 came from a sweep over the same 18 labels
                               # rather than from a principle. Recall 62% -> 88%,
                               # precision 100% -> 78%, and the ERROR TYPE
                               # changes -- the strict rule only ever missed.
DEF_BR_UP_FRAC = 0.55          # most samples rise
DEF_BR_THIRDS = 0.15           # no third of the climb is flat. The real
                               # anti-step and anti-plateau test: a step puts
                               # everything in one third, a plateau empties one.
DEF_BR_DUR_LO = 1.2            # seconds. The one gate still strict, and the
                               # single remaining label miss (Numberjacks, 2023)
                               # is a 1.0 s climb against it.
DEF_BR_DUR_HI = 5.0
DEF_BR_GB1_LO = 0.45           # the resolve is a BAND [round 7: 8/8 and 0/3].
DEF_BR_GB1_HI = 1.30           # It has to come back down, and it has to come
DEF_BR_GB2 = 0.80              # back to roughly where the climb started rather
                               # than crash past it into silence -- a climb that
                               # gives back 174% has STOPPED, not resolved -- and
                               # it has to still be down a second later. A single
                               # floor was round 6's rule and was wrong in both
                               # directions.

# 3.2 Surprise Reveals. 1.6's jump whose SOUND lands within 0.2 s of 1.1's cut.
DEF_REVEAL_WIN_S = 0.2         # symmetric, and that is a human decision AGAINST
                               # the corpus optimum [2026-08-24]. 0.0..+0.2 lifts
                               # 1.90 against this window's 1.42, so symmetry
                               # costs 0.48 of lift; it is taken because the
                               # construct is complete alignment -- the tolerance
                               # exists only because a listener cannot resolve a
                               # tenth of a second -- and because the entire
                               # difference between the two is ONE clip, which
                               # the labeller heard as containing no sudden sound
                               # at all. Fitting the window to it would be
                               # fitting to a case that is neither a clear
                               # positive nor a clear negative.
REVEAL_ONSET_BACK_S = 1.0      # how far back to walk from the peak for the
                               # sound. Shorter searches SATURATE -- 83% of walks
                               # hit the limit at 0.4 s, 24% at 0.6 s, 11% at
                               # 1.0 s -- and a saturated walk-back is
                               # indistinguishable in the output from a real
                               # onset, so this is settled rather than free.
REVEAL_ONSET_DELTA_LU = 1.0    # the floor band the walk-back looks for.
DEF_REVEAL_APPROACH_LU = 0.0   # 0 disables the term, which makes 3.2's jump list
                               # 1.6's shipped jump list exactly. See the note by
                               # `_reveals` -- this is an open human decision and
                               # this default is the one that keeps the two types
                               # from drifting.
#
# On DEF_JACCARD: the fitted optimum on the 31 labelled pairs is 0.449 (29/31).
# 0.45 scores identically and is a rounder number, so it is the default.
# 0.50 was requested as more explainable but scores 27/31 -- it splits a cluster
# of real changes (0.4545, 0.4857, 0.5000) instead of sitting in the gap below
# it (0.4444 not-a-change / 0.4545 change), and it lands exactly ON two observed
# values, so `>` vs `>=` would flip them. Set it here if you want it anyway;
# `derive` is seconds. See runs/type13-colour-change/ and
# human-todo/2026-08-21-hue-threshold-and-smoothing.md.
#
# The corpus-level joint sweep of DEF_JACCARD with DEF_PRESENCE is still open
# (plan §3); `sweep` exists to run it off the caches. So is the report on what
# 1.5's threshold does to both tails -- its risk is one-inflation where 1.4's was
# zero-inflation -- and neither sweep chooses a value, both report one.

# BS.1770-4's two gates. Standard constants, not project choices: they are here
# so 2.3's `lufs` and 1.6's reference are one line of arithmetic between them.
R128_ABS_GATE = -70.0          # absolute, in LUFS
R128_REL_GATE = 10.0           # relative, in LU below the ungated mean

TMP_SUFFIX = ".tmp.npz"        # np.savez appends .npz, so the temp name ends in
                               # it too and must be excluded from any listing.
CACHE_VERSION = 11             # bump when a STRUCTURAL parameter changes.
                               # 7 -> 8: the level pass (2 fps), the flow pass
                               # and the audio pass are new arrays. NOTHING that
                               # v7 already held changed.
                               # 8 -> 9: pass 1 is rewritten for the 1.1 settled
                               # on 2026-08-24. `scd_score` and the greyscale
                               # `fd_diff_*` series are GONE, replaced by
                               # three-channel `mafd_native` and `mafd_g*`. The
                               # settled detector needs a three-channel
                               # difference and neither of the v8 arrays can be
                               # converted into one -- the ratio between them
                               # wanders 0.391-0.450 with how colourful the clip
                               # is (plan §3 1.1) -- so pass 1 re-runs. Every
                               # other pass is lifted out of v8 unchanged, which
                               # is the reuse direction of v8 inverted.
                               # 9 -> 10: pass 2b moves from a forced 320x180 box
                               # to 160 wide with the source aspect kept, so
                               # `flow_mag` is measured on a different grid and
                               # `flow_h` joins `flow_w` beside it. v9's flow
                               # CANNOT be converted: the cache holds
                               # mean sqrt(u^2+v^2) and the aspect correction
                               # needs mean sqrt(u^2+(v/0.75)^2), which the mean
                               # has already collapsed. Nothing else changed.
                               # 10 -> 11: the standardisation [human decision,
                               # 2026-08-26]. Pass 1 stops forcing a 160x90 box,
                               # which re-measures `mafd_native`, `mafd_g*`,
                               # `pair_ssim` and `lstar_mean`; the level grid
                               # drops from 2 fps to 1, which re-measures
                               # `sat_level` and `lstar_level`; and `flow_mag`
                               # moves onto pass 1's frames at the
                               # `_grid_indices` marks. `ab_hist` keeps its
                               # DEFINITION (1 fps native) but its pass merged
                               # into the level pass, so it is recomputed rather
                               # than lifted -- the decode has to run for the
                               # levels regardless, so lifting it would save the
                               # histogram and nothing else.
                               #
                               # **Only the audio survives**, and it survives
                               # from v9 as readily as from v10, which is why
                               # both are reusable below.

# ------------------------------------------------------------------
# Reuse: v11 RECOMPUTES both video passes and lifts only the audio
# ------------------------------------------------------------------
# v9 recomputed pass 1 alone; v10 recomputed passes 1 and 2b. **v11 recomputes
# every video pass there is**, because the standardisation moved a size, a grid
# and a frame selection at once: pass A's geometry (PASS1_W), pass B's rate
# (NATIVE_FPS) and where `flow_mag` comes from. Nothing measured on the picture
# survives it.
#
# **The audio does.** Nothing in this revision touches R128_HOP, R128_WARMUP,
# R128_FLOOR or `_pass3_momentary`, so `r128_m` carries forward -- and it carries
# forward from v9 exactly as well as from v10, since v10 did not touch it either.
# Both versions are therefore reusable, which matters in practice: it means a v11
# run does not have to wait for an in-flight v10 to finish before it can lift the
# audio it needs.
#
# What that leaves is ~0.2 s/clip of the ~18.5 core-seconds a from-scratch clip
# costs. The reuse path is kept anyway because pass C is the one pass whose input
# (the soundtrack) no future picture-side decision can invalidate.
#
# `duration_s`, `fps`, `src_fps` and `n_frames` are NOT reused: pass 1 recomputes
# them from the decode it is doing anyway, and carrying a frame count that
# disagreed with the arrays beside it is the one way this could go quietly wrong.
REUSABLE_VERSIONS = frozenset({9, 10})
REUSE_KEYS = (
    "r128_m", "r128_t0", "r128_hop",                # pass C: 1.6, 2.3, 2.4, 3.1
)


# ============================================================
# Pass A -- every frame at 160 wide; 1.1, 1.2, 1.4 and 1.5 all read it
# ============================================================

def _pass1(clip_path, src_fps, w, h, ffmpeg_threads=0):
    """Full-rate decode at 160 px wide, height from the source.

    Returns (grey_frames, mafd_by_grid, lstar_mean). `grey_frames` is the full
    greyscale stack, kept so 1.2 can take SSIM at the true frame either side of a
    cut with no seeking -- v1 seeked per cut and CAP_PROP_POS_FRAMES does not land
    on B-frames where it is asked (plan §2).

    **`scdet` is gone and its score is computed here instead** [settled
    2026-08-24]. The filter returns its scores in a text file numbered by
    ffmpeg's FILTER-GRAPH frame counter while this loop numbers frames by what
    arrives on stdout, and the two diverge wherever ffmpeg drops a frame between
    the stages. On the clip that exposed it the filter saw 9,090 frames and 9,002
    reached us, so every score was filed against a picture three seconds away --
    real cuts read ~0 and static frames ~20. Measured over 120 clips the
    divergence is **0 of 60 historical against 10 of 60 contemporary**, which
    makes it a bias on RQ1's own axis rather than noise. Re-indexing the file by
    `pts_time` was tried and left a systematic -2 frame offset. Computing the
    difference in-process removes the second counter and the whole failure class,
    and `min(d, |d - prev d|)` over the frames we already have is cut-for-cut
    identical to the filter on every clean clip tested
    (runs/type11-cut-detection/equivalence.py).

    `d` is over **all three colour channels**, which is the reason v9 exists. The
    greyscale approximation v7 and v8 cached tracks the real statistic at a ratio
    that wanders 0.391-0.450 with how colourful the clip is, so a threshold set
    on one does not transfer to the other. Over three channels the fit is slope
    100/256 exactly, intercept 0, R2 = 1.0000.

    Memory: the colour frames are NOT retained. One previous colour frame is held
    for the native series and one per grid, so the grids cost three extra frame
    differences per mark and no extra footprint -- a 300 s clip's colour stack
    would be 389 MB, and at 12 workers that is memory the box does not have.

    The GREYSCALE stack IS retained, and since 2026-08-26 it has two consumers
    rather than one: 1.2 takes SSIM at a cut without seeking, and **1.5 takes
    Farneback at the 15 fps marks without a decode of its own**
    (`_flow_from_frames`). 129 MB per 300 s clip at 160x90, 173 MB at 160x120.
    """
    # ONE scale factor, not a box (plan §1 rule 3). `_flow_height` is exactly what
    # `scale=160:-2` computes, and it is shared with 1.5 -- which now reads these
    # very frames -- so the two geometries cannot drift apart even by accident.
    ph = _flow_height(w, h)
    if not ph:
        return [], {}, np.asarray([], np.float32)
    vf = f"scale={PASS1_W}:{ph}"
    cmd = ["ffmpeg", "-v", "error", "-nostdin"]
    if ffmpeg_threads:
        cmd += ["-threads", str(ffmpeg_threads)]
    cmd += ["-i", clip_path, "-vf", vf, "-pix_fmt", "bgr24",
            "-f", "rawvideo", "-"]

    nbytes = PASS1_W * ph * 3
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE,
                            stderr=subprocess.DEVNULL)

    frames = []                                 # greyscale, for 1.2
    luma = []                                   # 1.4
    native = []                                 # 1.1, three channels
    fps = float(src_fps) if src_fps else 0.0
    grids = {g: {"k": 0, "next": 0, "prev": None, "out": []} for g in FD_GRIDS}
    prev_bgr = None
    i = 0
    while True:
        buf = proc.stdout.read(nbytes)
        if len(buf) < nbytes:
            break
        bgr = np.frombuffer(buf, np.uint8).reshape(ph, PASS1_W, 3)
        cur = bgr.astype(np.int16)
        frames.append(cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY))
        # 1.4's per-frame mean CIE L*. A second conversion, not the greyscale
        # one: L* is the axis a fixed perceptual threshold means something on,
        # and it partitions CIELAB with 1.3's a*b* plane. Note this is the
        # lightness of area-averaged pixels, NOT the mean of per-pixel
        # lightness -- L* is non-linear, so the two differ. That is what the
        # 46 labelled pairs were built from (runs/type14-luma-flash/).
        lab = cv2.cvtColor(bgr, cv2.COLOR_BGR2Lab)
        luma.append(lab[:, :, 0].mean() * 100.0 / 255.0)

        if prev_bgr is not None:
            native.append(float(np.abs(cur - prev_bgr).mean()))

        # Grid marks are a function of k, fps and the grid only -- not of the
        # frame count -- so they can be generated while streaming, and the frames
        # at them can be differenced without retaining a stack.
        #
        # The arithmetic has to be `k * (1/g) * fps` and NOT the algebraically
        # equal `k * fps / g`, because `_grid_indices` builds its marks off
        # `np.arange(0, n/fps, 1/g)`, whose k-th element is exactly `k * (1/g)`
        # in floating point. The two forms differ in the last bit, and `np.rint`
        # rounds halves to even, so at a mark landing on an exact .5 they choose
        # DIFFERENT frames -- 25 fps on a 10 fps grid is one such case. Matching
        # the expression is what keeps this bit-identical to the mapping 1.4 and
        # the candidate set use.
        #
        # `while` rather than `if` because a grid above the source rate repeats
        # an index, and the repeat differences a frame against itself for
        # exactly 0.0, which is what `_grid_indices` produces for the same case.
        if fps > 0:
            for g, st in grids.items():
                while st["next"] == i:
                    if st["prev"] is not None:
                        st["out"].append(float(np.abs(cur - st["prev"]).mean()))
                    st["prev"] = cur
                    st["k"] += 1
                    st["next"] = int(np.rint(st["k"] * (1.0 / g) * fps))
        prev_bgr = cur
        i += 1

    proc.stdout.close()
    proc.wait()

    n = len(frames)
    out = {"native": np.asarray(native, np.float32)}
    for g, st in grids.items():
        # `_grid_indices` CLIPS every mark past the end onto the last frame, so
        # its series runs one pair longer than the marks that actually landed on
        # a frame: the first over-run pair differences the last mark against the
        # final frame, and any after it difference the final frame against
        # itself. Streaming cannot see those while it is reading, so they are
        # replayed here rather than left off -- otherwise `mafd_g*` would be
        # short against `fd_diff_g*` and against everything that indexes into it.
        want = max(0, _grid_indices(n, fps, g).size - 1) if n and fps > 0 else 0
        extra = want - len(st["out"])
        if extra > 0 and st["prev"] is not None and prev_bgr is not None:
            st["out"].append(float(np.abs(prev_bgr - st["prev"]).mean()))
            st["out"].extend([0.0] * (extra - 1))
        out[g] = np.asarray(st["out"][:want], np.float32)
    return frames, out, np.asarray(luma, np.float32)


def _grid_indices(n, fps, grid_fps):
    """Native frame index nearest each 1/grid_fps mark. The same mapping 1.4 uses."""
    t = np.arange(0.0, n / fps, 1.0 / grid_fps)
    return np.clip(np.rint(t * fps).astype(int), 0, n - 1)


def _cut_score(mafd):
    """`scdet`'s statistic, on scdet's own 0-100 scale.

        score[i] = min( d[i-1] , |d[i-1] - d[i-2]| )

    where `d[j]` is the mean absolute difference between frames j and j+1, so
    `score[i]` describes the boundary between frames i-1 and i -- the indexing
    every other cut consumer in this file assumes.

    **Why the minimum.** Taking the smaller of two quantities requires both to be
    large: the change must be big AND a sudden departure from how much the
    picture was already changing. A character whipping across the screen makes
    `d` big, but `d` was already big the frame before, so the second term is small
    and the minimum suppresses it. A cut jumps out of a quiet baseline and both
    terms survive. That single property is why the frame-difference detector this
    replaces could not be rescued by retuning: it asked only the first question,
    and scored 43% precision over the 89 labels with 49 false alarms against 37
    real cuts, every one of them within-shot motion.
    """
    d = np.asarray(mafd, np.float64)
    n = d.size + 1
    s = np.zeros(n, np.float64)
    if n > 2:
        i = np.arange(2, n)
        s[i] = np.minimum(d[i - 1], np.abs(d[i - 1] - d[i - 2]))
    return s * MAFD_SCALE


def _ssim(img1, img2, k1=0.01, k2=0.03, L=255):
    """SSIM, 11x11 Gaussian sigma 1.5 -- the v1 kernel, unchanged (plan §3 1.2)."""
    img1 = img1.astype(np.float64)
    img2 = img2.astype(np.float64)
    c1, c2 = (k1 * L) ** 2, (k2 * L) ** 2
    mu1 = cv2.GaussianBlur(img1, (11, 11), 1.5)
    mu2 = cv2.GaussianBlur(img2, (11, 11), 1.5)
    mu1_sq, mu2_sq, mu1_mu2 = mu1 ** 2, mu2 ** 2, mu1 * mu2
    s1 = cv2.GaussianBlur(img1 ** 2, (11, 11), 1.5) - mu1_sq
    s2 = cv2.GaussianBlur(img2 ** 2, (11, 11), 1.5) - mu2_sq
    s12 = cv2.GaussianBlur(img1 * img2, (11, 11), 1.5) - mu1_mu2
    num = (2 * mu1_mu2 + c1) * (2 * s12 + c2)
    den = (mu1_sq + mu2_sq + c1) * (s1 + s2 + c2)
    return float(np.mean(num / den))


def _fd_cut_frames(fd, sigma, idx, fd_native):
    """Native frame indices where an adaptive `mean + sigma*sd` bar is passed.

    **This is the retired detector and it does not fire a cut any more.** It is
    kept for one job: widening the candidate set so 1.2 has an SSIM pair for
    anything `derive` might ever pick, including under a threshold nobody has
    chosen yet. It was deleted as a detector on 2026-08-24 because it cannot tell
    a new shot from continuous motion -- a cartoon character crossing a static
    background repaints as much of the frame as a cut does, and an adaptive bar
    does not rescue it, since in one labelled window the smallest difference at a
    called cut was 10.97 while unclaimed peaks reached 12.80. It also fired on a
    near-constant share of intervals in every era, which flattened `cuts_per_min`
    across E0-E4 on RQ1's own axis.

    Localisation is pushed back onto a native frame: within the grid window that
    fired, the cut is the frame whose own adjacent difference is largest.
    """
    if fd.size == 0:
        return []
    thr = fd.mean() + sigma * fd.std()
    hits = np.nonzero(fd > thr)[0]
    cuts = []
    for k in hits:
        lo, hi = int(idx[k]), int(idx[k + 1])
        if hi <= lo:
            continue
        # fd_native[j-1] is the difference between frames j-1 and j.
        window = fd_native[lo:hi]
        cuts.append(lo + 1 + int(np.argmax(window)) if window.size else hi)
    return cuts


def _candidates(mafd_by_grid, n_frames, fps):
    """Frame indices of every *plausible* cut, generous on purpose.

    A cut at index i sits between frame i-1 and i. `derive` picks its real cuts
    out of this set, so the set has to be a superset of anything it will pick --
    which means the settled score at a threshold far below 11, on the native
    series and on every grid, plus the retired detector's adaptive bar at a sigma
    below any that will be derived.

    v8 built this from the union of two detectors, which is more permissive
    still, so its cached pairs probably already cover every cut the settled rule
    finds. Probably is not a basis, which is why `derive` counts the shortfall
    (plan §2.5).
    """
    idx = set()
    native = mafd_by_grid["native"]
    idx.update(np.nonzero(_cut_score(native) > CAND_CUT_THR)[0].tolist())
    for g in FD_GRIDS:
        gi = _grid_indices(n_frames, fps, g)
        grid = mafd_by_grid[g]
        idx.update(_fd_cut_frames(grid, CAND_FD_SIGMA, gi, native))
        # A grid detection localises onto the native frame carrying the largest
        # adjacent difference inside its window, the same step _fd_cut_frames
        # takes, so a grid-scored cut cannot fall outside the set above by more
        # than that window.
        for k in np.nonzero(_cut_score(grid) > CAND_CUT_THR)[0].tolist():
            k = min(max(int(k) - 1, 0), gi.size - 2)
            lo, hi = int(gi[k]), int(gi[k + 1])
            win = native[lo:hi]
            idx.add(lo + 1 + int(np.argmax(win)) if win.size else hi)
    idx.discard(0)
    return np.array(sorted(i for i in idx if 0 < i < n_frames), np.int32)


# ============================================================
# Pass B -- ONE native-size decode at 1 fps, for 1.3, 2.1 and 2.2
# ============================================================
# There were two native decodes here until 2026-08-26, because 1.3 was on a 1 fps
# grid and the levels were on 2 fps. Dropping the levels to 1 fps (NATIVE_FPS)
# makes them one, and 1.3's frames do not change at all.
#
# The `-filter_complex "[0:v]split=2[a][b];[a]fps=1[p];[b]fps=2[l]"` graph the
# plan used to propose is NOT what this is. That existed to give the two features
# different rates off one decode while protecting v1's `mean_saturation` values,
# and that protection was given up deliberately (plan §3 2.1). A single fps=1
# decode is simpler and has no frame-selection subtlety to reason about.

def _frames_native(clip_path, grid_fps, w, h, ffmpeg_threads=0):
    """Yield native-resolution BGR frames on a fixed `grid_fps` time grid.

    Native size is not an optimisation detail (plan §2): downscaling averages
    neighbouring pixels toward grey, which moves 1.3's mass to the origin tile
    and shrinks the occupied set, and shrinks 2.1's per-pixel `(max-min)` so
    `mean_saturation` reads low. v1 computed colour on full frames.
    """
    cmd = ["ffmpeg", "-v", "error", "-nostdin"]
    if ffmpeg_threads:
        cmd += ["-threads", str(ffmpeg_threads)]
    cmd += ["-i", clip_path, "-vf", f"fps={grid_fps:g}", "-pix_fmt", "bgr24",
            "-f", "rawvideo", "-"]

    nbytes = w * h * 3
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE,
                            stderr=subprocess.DEVNULL)
    try:
        while True:
            buf = proc.stdout.read(nbytes)
            if len(buf) < nbytes:
                break
            yield np.frombuffer(buf, np.uint8).reshape(h, w, 3)
    finally:
        proc.stdout.close()
        proc.wait()


def _pass2_native(clip_path, ffmpeg_threads=0, w=0, h=0):
    """1.3, 2.1 and 2.2 from one native decode on the 1 fps grid.

      1.3 `ab_hist`      per-frame a*b* histogram, cached at 32x32 (8-unit tiles)
                         rather than the chosen 16x16 so the tile width stays a
                         derive-time choice (2x2 -> 16 units, 4x4 -> 32, 8x8 -> 64)
      2.2 `lstar_level`  mean CIE L* per frame, from the SAME cvtColor 1.3 needs
      2.1 `sat_level`    mean HSV S per frame -- a **second** cvtColor on those
                         frames, because 2.1 left CIELAB on 2026-08-24 and reads
                         HSV. ~0.12 s/clip at 1 fps against ~0.9 s of decode.

    The two level series are cached per frame although neither has a threshold,
    so that a change of aggregator -- the question `runs/type21-chroma/` asked and
    answered for both -- stays a re-derive rather than a re-decode.

    **`runs/type21-chroma/`'s 5,506-clip probe read a 2 fps grid**, so these two
    columns no longer reproduce the run of record the 2.1 and 2.2 decisions were
    taken against. They were re-measured before the grid moved: over 300 clips at
    full length, `mean_saturation` shifts +0.017 on 0-255 and `mean_lstar` +0.011
    on 0-100, Spearman 0.9999 for both, worst rank move 8 places of 300. No
    decision in either type turns on a difference that size.
    """
    if not w or not h:
        return None, 0, None, None

    edges = [-AB_SPAN, AB_SPAN]
    hists, lstar, sat = [], [], []
    for bgr in _frames_native(clip_path, NATIVE_FPS, w, h, ffmpeg_threads):
        lab = cv2.cvtColor(bgr, cv2.COLOR_BGR2Lab)      # 8-bit Lab: a*,b* +128

        # 1.3
        a = lab[:, :, 1].astype(np.int16) - 128
        b = lab[:, :, 2].astype(np.int16) - 128
        hh, _, _ = np.histogram2d(a.ravel(), b.ravel(), CACHE_NB, [edges, edges])
        hists.append(hh.astype(np.uint32))

        # 2.2 -- the per-pixel mean, on native frames. Unlike 1.4's, this one is
        # NOT the lightness of area-averaged pixels, and the plan says so.
        lstar.append(lab[:, :, 0].mean() * 100.0 / 255.0)

        # 2.1 -- v1's definition unchanged: S = (max-min)/max per pixel on the
        # 8-bit BGR triple, 0..255, mean over pixels. Only the grid moved.
        sat.append(cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)[:, :, 1].mean())

    if not hists:
        return None, 0, None, None
    return (np.stack(hists), w * h,
            np.asarray(lstar, np.float32), np.asarray(sat, np.float32))


# ============================================================
# 1.5 -- Farneback over pass A's frames. No decode of its own.
# ============================================================

def _flow_height(w, h):
    """Pass A's height for a source w x h: 160 wide, aspect kept, EVEN.

    This is what `scale=160:-2` computes, but computed here rather than left to
    ffmpeg: rawvideo carries no header, so the reader has to know the height
    before the first byte arrives. Deriving it in one place means the buffer size
    and the filter string cannot disagree.

    **It sizes pass A as a whole since 2026-08-26**, not just 1.5 -- which is the
    point, because 1.5 reads pass A's frames now. The name is kept because
    `flow_h` in the cache is what `_motion_frac` reads back.
    """
    if w <= 0 or h <= 0:
        return 0
    return max(2, int(round(FLOW_W * h / w / 2.0)) * 2)


def _flow_from_frames(frames, src_fps):
    """Mean Farneback magnitude per 15 fps interval, in pixels, over pass A.

    **1.5 stopped owning a decode on 2026-08-26** (plan §2.3, merge 1). It became
    possible when pass 1 stopped forcing a 160x90 box: 1.5 had moved to 160 wide
    two days earlier, so the two passes were decoding the same picture at the same
    size and one of them was redundant. The frames are already in memory for 1.2,
    so this costs no decode, no seek and no extra footprint -- only the Farneback
    it always cost (~14.9 s/clip at 160x90, ~19.7 s at 160x120).

    **The frame selection is not the same as the old pass's, and that was measured
    before the merge was taken.** ffmpeg's `fps=15` and `_grid_indices` are two
    different rounding rules onto the same marks, and they agree on 100% of frames
    only when the source rate is an integer multiple of 15: **50.2% at 29.97 fps**,
    66.7% at 25, 70.1% at 23.976, 100% at 30. So the set was already running two
    different 15 fps grids whose disagreement tracks source frame rate -- and
    therefore era, which is RQ1's axis. 1.1, 1.2 and 1.4 were on `_grid_indices`
    and only 1.5 was not. This does not introduce that inconsistency, it removes it.

    What it does to the number, over 20 clips spanning every source rate in the
    corpus: mean |delta| **0.0015** on `motion_frac`, max 0.0046, median
    per-interval magnitude +0.7%, **Spearman exactly 1.00000** -- not one clip
    reorders. The 30 fps clips, where the two rules pick identical frames, come out
    identical to four decimals, which is the control. For scale, moving 1.5 from
    320 to 160 wide on 2026-08-24 shifted `motion_frac` by +0.027 mean, six times
    this, and was accepted on its own evidence. **1.5's 50 window labels are not in
    the repository (plan §1 rule 3) and could not have arbitrated a difference this
    small in any case**: their overlap zone spans a factor of twelve in flow
    magnitude.

    Decoded to greyscale by `cvtColor` on `bgr24` upstream, NOT by ffmpeg's `gray`
    output -- ffmpeg's carries the source's own range flag, and Farneback's
    polynomial expansion is not invariant to a contrast rescale, so the cheaper
    path would be a quietly different estimator from the one the labels fitted.
    Pass A already does it that way, which is one more reason the merge is safe.

    Magnitudes are returned in **pixels**, pre-threshold. `_motion_frac` converts
    to frame widths per second, which is the unit the threshold is stated in and
    the only one that does not name a resolution -- but it still names the grid, so
    `flow_fps`, `flow_w` and `flow_h` are cached beside it.
    """
    n = len(frames)
    if n < 2 or not src_fps:
        return np.asarray([], np.float32)

    gi = _grid_indices(n, src_fps, FLOW_FPS)
    mags = []
    for k in range(1, gi.size):
        a, b = int(gi[k - 1]), int(gi[k])
        # A grid above the source rate repeats an index. Differencing a frame
        # against itself is exactly 0.0, which is what the `mafd_g*` path in
        # `_pass1` produces for the same case -- matched here so the two series
        # mean the same thing at the same marks.
        if a == b:
            mags.append(0.0)
            continue
        flow = cv2.calcOpticalFlowFarneback(frames[a], frames[b], None,
                                            *FLOW_PARAMS)
        mags.append(float(np.hypot(flow[:, :, 0], flow[:, :, 1]).mean()))
    return np.asarray(mags, np.float32)


# ============================================================
# Pass 3 -- the whole waveform, for 1.6 and 2.3
# ============================================================

_R128_FRAME_RE = re.compile(r"^frame:\d+\s+pts:\S+\s+pts_time:([\d.]+)")
_R128_M_RE = re.compile(r"^lavfi\.r128\.M=(-?[\d.]+|-inf)")


def _pass3_momentary(clip_path, timeout=300):
    """K-weighted momentary loudness: a 400 ms window reported every 100 ms.

    ITU-R BS.1770 / EBU R128 through ffmpeg's `ebur128`, which is the
    standard-compliant implementation. Types 1.6 and 2.3 both read this one
    series and share one reference (plan §3 1.6): 2.3's `lufs` is this series
    gated, and 1.6 counts how far above that the clip goes and how often. 2.4 and
    3.1 will read it too.

    `-vn` is not optional and is worth 40x: without it ffmpeg decodes the whole
    video track in order to discard it, which took a corpus-wide momentary pass
    from 3 minutes to ~2 hours over 800 clips.

    Returns (t0, M). The first R128_WARMUP seconds are dropped, because the
    400 ms window is still filling; M is rounded to 0.1 LU, which is the
    resolution ebur128 reports and what the cached series behind both validated
    records holds (runs/type16-loudness-jump/scan_corpus.py).
    """
    cmd = ["ffmpeg", "-v", "error", "-nostats", "-nostdin", "-i", clip_path,
           "-vn", "-af",
           "ebur128=metadata=1,ametadata=mode=print:key=lavfi.r128.M:file=-",
           "-f", "null", "-"]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except (subprocess.TimeoutExpired, OSError):
        return 0.0, np.array([], np.float32)

    ts, ms = [], []
    t = None
    for line in r.stdout.splitlines():
        m = _R128_FRAME_RE.match(line)
        if m:
            t = float(m.group(1))
            continue
        m = _R128_M_RE.match(line)
        if m and t is not None:
            v = m.group(1)
            ms.append(R128_FLOOR if v == "-inf" else max(float(v), R128_FLOOR))
            ts.append(t)
            t = None
    if not ms:
        return 0.0, np.array([], np.float32)

    t_arr = np.asarray(ts)
    keep = t_arr >= R128_WARMUP
    if keep.sum() < 2:
        keep = np.ones(t_arr.size, bool)
    return (float(t_arr[keep][0]),
            np.round(np.asarray(ms)[keep], 1).astype(np.float32))


def _probe_size(clip_path):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=width,height", "-of", "csv=p=0", clip_path],
        capture_output=True, text=True).stdout.strip()
    try:
        parts = out.split(",")
        return int(parts[0]), int(parts[1])
    except (ValueError, IndexError):
        return 0, 0


def _probe(clip_path):
    """Width, height, declared fps and duration in ONE ffprobe call.

    Three separate spawns cost ~0.1 s per clip, which is 9 minutes over the
    corpus for information one process already has.
    """
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
         "stream=width,height,avg_frame_rate", "-show_entries",
         "format=duration", "-of", "default=nw=1:nk=1", clip_path],
        capture_output=True, text=True).stdout.split()
    try:
        w, h, rate, dur = int(out[0]), int(out[1]), out[2], float(out[3])
        num, _, den = rate.partition("/")
        fps = float(num) / float(den or 1)
    except (ValueError, IndexError, ZeroDivisionError):
        return 0, 0, 0.0, 0.0
    return w, h, fps, dur


def _probe_src_fps(clip_path):
    """Declared average frame rate, as a Fraction string like 30000/1001.

    1.4's grid maps time to frame index, and it must use the rate the *source*
    declares, not n_frames/duration: the two differ in the fourth decimal and
    that is enough to move which frame a 67 ms mark lands on, which changes the
    count. The 46-pair ground truth was built against the declared rate.
    """
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
         "stream=avg_frame_rate", "-of", "csv=p=0", clip_path],
        capture_output=True, text=True).stdout.strip()
    try:
        num, _, den = out.partition("/")
        return float(num) / float(den or 1)
    except (ValueError, ZeroDivisionError):
        return 0.0


def _probe_duration(clip_path):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "csv=p=0", clip_path], capture_output=True, text=True).stdout
    try:
        return float(out.strip())
    except ValueError:
        return 0.0


# ============================================================
# extract -- decode once, write the cache
# ============================================================

def _reuse_arrays(path):
    """Passes 2, 2p, 2b and 3 from a compatible older cache, or None.

    None means "compute them" -- a missing file, an unreadable one, a version
    this build has not certified, or one short of an array. Reuse never guesses:
    the fallback is the full pass, which is slower and always correct.
    """
    if not path or not os.path.exists(path):
        return None
    try:
        with np.load(path) as z:
            v = int(z["version"]) if "version" in z.files else 0
            if v not in REUSABLE_VERSIONS:
                return None
            if any(k not in z.files for k in REUSE_KEYS):
                return None
            return {k: z[k] for k in REUSE_KEYS}
    except Exception:                           # noqa: BLE001 -- treat as absent
        return None


def _init_worker():
    """One OpenCV thread per worker.

    OpenCV defaults to one thread per core INSIDE each process, so a 12-worker
    pool on 8 cores asks for 96 threads and they spend their time contending
    rather than working. Farneback barely parallelises internally in any case --
    measured at 533 intervals/s with the default against 565 with one thread, so
    the fix is worth ~6% of the flow pass and costs nothing. The pool is where
    the parallelism belongs.
    """
    cv2.setNumThreads(1)


def extract_one(job):
    video_id, clip_path, cache_dir, ffmpeg_threads, want_flow, reuse_dir = job
    out_path = os.path.join(cache_dir, f"{video_id}.npz")
    try:
        t0 = time.time()
        w, h, src_fps, duration_s = _probe(clip_path)
        if duration_s < 10:
            return video_id, "too short", 0.0

        # Pass A. Everything on the picture side comes out of this one decode
        # in v11 -- 1.1's difference series, 1.4's L* series, 1.2's SSIM pairs
        # and 1.5's flow. Only the audio is ever lifted from an older cache.
        frames, mafd_by_grid, luma_mean = _pass1(
            clip_path, src_fps, w, h, ffmpeg_threads)
        n_frames = len(frames)
        if n_frames < 2:
            return video_id, "no frames", 0.0
        fps = n_frames / duration_s if duration_s else 0.0

        cand_cuts = _candidates(mafd_by_grid, n_frames, src_fps)

        # 1.2 takes SSIM across the GRID pair bracketing a cut, not the native
        # frames either side [human decision, 2026-08-23: 15 fps default].
        # Native-adjacent SSIM measured 33 ms on a 30 fps transfer and 42 ms on a
        # 24 fps one -- the same frame-rate dependence §1 rule 1 forbids in 1.1.
        # Pairs are cached for SSIM_GRIDS only -- SSIM is the one expensive step
        # in the pass, so the settled 15 fps grid is cached and `derive` refuses
        # any other rather than reporting 1.2 over a different interval to 1.1.
        pairs = set()
        for g in SSIM_GRIDS:
            gi = _grid_indices(n_frames, src_fps, g)
            for c in cand_cuts:
                k = min(max(int(np.searchsorted(gi, c)) - 1, 0), gi.size - 2)
                pairs.add((int(gi[k]), int(gi[k + 1])))
        pairs = sorted(pairs)
        pair_i = np.array([a for a, _ in pairs], np.int32)
        pair_j = np.array([b for _, b in pairs], np.int32)
        pair_ssim = np.array(
            [_ssim(frames[a], frames[b]) for a, b in pairs], np.float32)

        # 1.5, off the same stack, before it is dropped. Farneback is ~14.9 s at
        # 160x90 and ~19.7 s at 160x120 -- still ~70% of a clip's serial work and
        # the whole of 1.5's cost -- so it can be skipped for a pilot of the other
        # features. A cache written that way carries `flow_mag` of length zero and
        # `derive` reports 1.5 blank rather than a share of nothing.
        flow_h = _flow_height(w, h)
        if want_flow:
            flow_mag = _flow_from_frames(frames, src_fps)
        else:
            flow_mag = np.asarray([], np.float32)

        del frames                    # 129-173 MB/clip, drop it as soon as both
                                      # 1.2 and 1.5 have finished with it

        computed = {
            "duration_s": np.float32(duration_s),
            "fps": np.float32(fps),
            "src_fps": np.float64(src_fps or fps),
            "n_frames": np.int32(n_frames),
            "cand_cuts": cand_cuts,
            "pair_i": pair_i,
            "pair_j": pair_j,
            "pair_ssim": pair_ssim,
            "ssim_grids": np.asarray(SSIM_GRIDS, np.float64),
            "lstar_mean": luma_mean,
            "mafd_native": mafd_by_grid["native"],
            **{f"mafd_g{g:g}": mafd_by_grid[g] for g in FD_GRIDS},
            "pass1_w": np.int32(PASS1_W),
            "pass1_h": np.int32(flow_h),
            "flow_mag": flow_mag,
            "flow_fps": np.float64(FLOW_FPS),
            "flow_w": np.int32(FLOW_W),
            "flow_h": np.int32(flow_h),
        }

        old = _reuse_arrays(
            os.path.join(reuse_dir, f"{video_id}.npz") if reuse_dir else "")

        # Pass B ALWAYS runs in v11: its rate changed, so nothing older holds it.
        ab_hist, n_pixels, lstar_level, sat_level = _pass2_native(
            clip_path, ffmpeg_threads, w, h)
        if ab_hist is None or lstar_level is None:
            return video_id, "no native frames", 0.0

        carried = {
            "ab_hist": ab_hist,
            "n_pixels": np.int64(n_pixels),
            "lstar_level": lstar_level,
            "sat_level": sat_level,
            "level_fps": np.float64(NATIVE_FPS),
        }

        # Pass C is the only pass v11 lifts, and it lifts equally well from v9 or
        # v10 because neither touched the audio. A clip with no audio track is not
        # a failure: it caches an empty series and derives 1.6, 2.3, 2.4, 3.1 and
        # 3.2 blank.
        if old is not None:
            carried.update(old)
        else:
            r128_t0, r128_m = _pass3_momentary(clip_path)
            carried.update({
                "r128_m": r128_m,
                "r128_t0": np.float64(r128_t0),
                "r128_hop": np.float64(R128_HOP),
            })

        # Written to a temp file and moved into place. If a long run is killed
        # mid-write, a truncated .npz would look cached to the resume check and
        # then fail at derive time.
        tmp_path = out_path + TMP_SUFFIX
        np.savez_compressed(
            tmp_path,
            version=np.int32(CACHE_VERSION),
            **computed,
            **carried,
        )
        os.replace(tmp_path, out_path)
        return video_id, None, time.time() - t0
    except Exception as exc:                    # noqa: BLE001 -- one bad clip
        for stray in (out_path + TMP_SUFFIX,):
            if os.path.exists(stray):
                os.unlink(stray)
        return video_id, f"{type(exc).__name__}: {exc}", 0.0


# ============================================================
# derive -- cache -> features, at any thresholds
# ============================================================

def _cuts_from_cache(c, cut_thr, merge_s, cut_grid=0.0):
    """1.1, and it is one detector at one threshold [settled 2026-08-24].

    `min(d, |d - prev d|)` past `cut_thr` on scdet's 0-100 scale, deduped within
    `merge_s`. v1 merged two detectors CONDITIONALLY (`if len(cuts_ffmpeg) < 3:
    use fd only`), so part of the corpus was measured by one estimator and the
    rest by two; v2 always merged; the settled rule has nothing to merge.

    `cut_grid` of 0 differences native adjacent frames, which is what ships and
    what the 89 labels were scored on. A grid in FD_GRIDS reads `mafd_g*`
    instead and localises each detection onto the native frame carrying the
    largest adjacent difference inside its window, so 1.2 still takes SSIM at a
    real boundary. See DEF_CUT_GRID for what that costs.
    """
    fps = float(c["fps"])
    src_fps = float(c["src_fps"]) if "src_fps" in c else fps
    n_frames = int(c["n_frames"])
    native = c["mafd_native"]

    if not cut_grid:
        idx = set(np.nonzero(_cut_score(native) > cut_thr)[0].tolist())
    else:
        key = f"mafd_g{cut_grid:g}"
        if key not in c:
            raise SystemExit(
                f"1.1 has no cached mean-absolute-difference series for a "
                f"{cut_grid:g} fps grid. Re-extract with that grid in FD_GRIDS.")
        gi = _grid_indices(n_frames, src_fps, cut_grid)
        idx = set()
        for k in np.nonzero(_cut_score(c[key]) > cut_thr)[0].tolist():
            k = min(max(int(k) - 1, 0), gi.size - 2)
            lo, hi = int(gi[k]), int(gi[k + 1])
            win = native[lo:hi]
            idx.add(lo + 1 + int(np.argmax(win)) if win.size else hi)
    idx.discard(0)

    merge_frames = max(1, int(round(merge_s * fps)))
    kept = []
    for i in sorted(idx):
        if not kept or i - kept[-1] > merge_frames:
            kept.append(i)
    return np.array(kept, np.int32), fps


def _palette_rate(c, tile_agg, presence, jaccard_thr):
    """1.3: how often the set of occupied a*b* tiles is replaced.

    Every one-second pair counts, including pairs straddling a cut
    [human decision, 2026-08-21] -- a cut introducing a new palette is still a
    colour change the child sees.
    """
    hist = c["ab_hist"]
    n_pixels = int(c["n_pixels"])
    if hist.shape[0] < 2 or n_pixels == 0:
        return float("nan"), 0

    if tile_agg > 1:                            # 32x32 -> coarser tiles
        n = hist.shape[1] // tile_agg
        hist = hist[:, :n * tile_agg, :n * tile_agg].reshape(
            hist.shape[0], n, tile_agg, n, tile_agg).sum(axis=(2, 4))

    occ = hist >= presence * n_pixels           # occupied tile set per second
    a, b = occ[:-1], occ[1:]
    inter = np.count_nonzero(a & b, axis=(1, 2))
    union = np.count_nonzero(a | b, axis=(1, 2))
    with np.errstate(invalid="ignore", divide="ignore"):
        dist = np.where(union == 0, 0.0, 1.0 - inter / np.maximum(union, 1))

    hits = int(np.count_nonzero(dist > jaccard_thr))
    minutes = len(occ) / 60.0                   # the 1 fps grid IS the clock
    return (hits / minutes if minutes else float("nan")), len(dist)


def _lstar_flash(c, cuts, grid_fps, thr):
    """1.4: how often mean-frame lightness *rises* past a threshold, on a fixed grid.

    A rate and only a rate [human decision, 2026-08-21, reaffirmed 2026-08-23]:
    the size of each rise is an intermediate and is not reported.

    Three rules, each with its own evidence in runs/type14-luma-flash/:
      - the grid is picked by TIME, not frame stride, or the comparison interval
        becomes a property of the source (re-encoding 30 -> 15 fps moved the
        count by a median 1.61x);
      - a RISE, not a swing -- none of the six labelled darkenings was called a
        flash, and abs() would roughly double the corpus number;
      - pairs straddling a cut are dropped, which removes 64% of qualifying rises
        corpus-wide, so 1.1's threshold matters more here than 1.4's own.
    """
    L = c["lstar_mean"]
    # The DECLARED rate, not n_frames/duration -- see _probe_src_fps.
    fps = float(c["src_fps"]) if "src_fps" in c else float(c["fps"])
    n = L.size
    if n < 2 or fps <= 0 or grid_fps <= 0:
        return float("nan"), 0

    dur = n / fps
    t = np.arange(0.0, dur, 1.0 / grid_fps)
    idx = np.clip(np.rint(t * fps).astype(int), 0, n - 1)
    if idx.size < 2:
        return float("nan"), 0

    d = L[idx[1:]] - L[idx[:-1]]
    hit = d >= thr                              # a rise, not abs()

    t0 = np.arange(d.size) / grid_fps
    t1 = t0 + 1.0 / grid_fps
    if len(cuts):
        ct = np.asarray(cuts, float) / fps      # cut frame indices -> seconds
        spans_cut = np.searchsorted(ct, t0) != np.searchsorted(ct, t1)
        hit &= ~spans_cut
        eligible = int(np.count_nonzero(~spans_cut))
    else:
        eligible = int(d.size)

    minutes = dur / 60.0                        # clip minutes, per plan §3 1.4
    return (int(hit.sum()) / minutes if minutes else float("nan")), eligible


def _cut_seconds(c, cuts):
    """Cut frame indices as seconds. The DECLARED rate, as everywhere else."""
    fps = float(c["src_fps"]) if "src_fps" in c else float(c["fps"])
    if fps <= 0 or not len(cuts):
        return np.array([], float)
    return np.asarray(cuts, float) / fps


def _motion_frac(c, cuts, pct_w_per_s, min_intervals=DEF_MOTION_MIN_INTERVALS):
    """1.5: share of 15 fps intervals in which the picture is being displaced fast.

    A share, not a rate, and not a magnitude [human decision, 2026-08-24]: fast
    motion *persists* where a cut or an L* rise does not, so counting qualifying
    intervals per minute would report a duration in the units of a rate. The type
    names how much of the running time is in fast motion, not how fast it is.

    The threshold arrives as a percentage of frame width per second and is
    converted here, using the grid and the width the cache was measured at:

        px per interval = pct/100 * flow_w / flow_fps

    which at 10 %w/s, 160 px and 15 fps is 1.07 px, or 16 px/s. **Only the width
    appears**, and that is exact rather than a convention: pass 2b scales both
    axes by one factor (see `_flow_height`), so dividing by the width undoes it
    for vertical displacement as well as horizontal, and the grid cancels. The
    unit is resolution-free but **not** grid-free in practice -- the same clips
    rank at only +0.70 between the 2 and 15 fps grids, and moving the width 320
    -> 160 shifts `motion_frac` +0.027 on average -- so a cache measured on
    another grid would need its own threshold, which is why the grid is cached
    beside the magnitudes rather than assumed.

    Intervals straddling a cut are dropped (§1 rule 2). A cut displaces every
    pixel at once, so Farneback reports a large flow for any interval containing
    one and it would clear the threshold whatever the content was doing; left in,
    `motion_frac` would carry an additive term proportional to the cut rate, on
    RQ1's own axis. The rule costs about 2% of intervals at 15 fps, against about
    14% on the 2 fps grid 1.5 came from -- which is one of the reasons the grid
    moved.
    """
    mag = c["flow_mag"] if "flow_mag" in c else np.array([])
    if mag.size == 0:
        return float("nan"), 0
    grid = float(c["flow_fps"]) if "flow_fps" in c else FLOW_FPS
    width = float(c["flow_w"]) if "flow_w" in c else FLOW_W
    if grid <= 0 or width <= 0:
        return float("nan"), 0

    thr_px = (pct_w_per_s / 100.0) * width / grid

    t0 = np.arange(mag.size) / grid
    t1 = t0 + 1.0 / grid
    ct = _cut_seconds(c, cuts)
    if ct.size:
        keep = np.searchsorted(ct, t0) == np.searchsorted(ct, t1)
    else:
        keep = np.ones(mag.size, bool)

    n_keep = int(np.count_nonzero(keep))
    if n_keep < min_intervals:
        return float("nan"), n_keep
    return float(np.count_nonzero((mag >= thr_px) & keep) / n_keep), n_keep


def _integrated_lufs(M):
    """2.3: BS.1770 gated integrated loudness, in LUFS.

    Computed from the momentary blocks rather than parsed out of ffmpeg's summary
    line, for three reasons. The series *is* what the standard integrates -- a
    400 ms window at a 100 ms hop is the 75%-overlapping block series -- so this
    is the standard's own arithmetic and not an approximation of it. It
    guarantees 1.6 and 2.3 share one reference exactly, which is the whole design
    of 1.6 (plan §3 1.6). And it is the estimator both records were measured
    with: the 63 labels behind 1.6's 6 LU cut
    (`runs/type16-loudness-jump/excess.py`) and the 800-clip distribution behind
    2.3 (`runs/type23-loudness-scale/`, median -16.2 LUFS) both gate this cache.
    It differs from ffmpeg's own summary only by the R128_WARMUP trim and the
    0.1 LU rounding, both of which the labelled sets also carry.

    The gates are BS.1770-4's: absolute at -70 LUFS, then relative at 10 LU below
    the ungated mean of what survives. Gating is what makes `I` the level of the
    programme *while it plays*, which is what lets 1.6 read speech as excess 0
    and only a shout as a jump -- and, separately, what keeps 2.3 from restating
    2.4 (the lift correlates with the silence share at r = +0.79).
    """
    M = np.asarray(M, np.float64)
    if M.size < 3:
        return float("nan")
    z = 10.0 ** (M / 10.0)
    keep = M > R128_ABS_GATE
    if int(keep.sum()) < 3:
        return float("nan")
    ungated = 10.0 * np.log10(z[keep].mean())
    keep2 = keep & (M > ungated - R128_REL_GATE)
    if int(keep2.sum()) < 3:
        return float(ungated)
    return float(10.0 * np.log10(z[keep2].mean()))


def _high_lufs_frac(c):
    """2.4: share of momentary blocks that are programme rather than silence.

    **The relative gate is applied first and the absolute gate second** [human
    decision, 2026-09-01]. Both gates still apply and the mask is the same
    intersection either way; what the ordering fixes is the DOMAIN the relative
    gate's reference is computed over. Here it is the energy mean of EVERY block,
    floored ones included:

        gate = 10*log10(mean(10**(M/10)))  -  10 LU        # over all blocks
        keep = (M > -70)  AND  (M > gate)

    BS.1770-4 as written computes that reference over the blocks that already
    cleared the absolute gate, which makes the absolute gate a restriction on the
    reference rather than a filter. Under this ordering the two roles swap: the
    reference has no floor, and the absolute gate is what excludes silence.

    **Both orderings are well posed and were measured against each other over all
    16,675 clips** (runs/type24-sound-frac/, four arms off one cached series).
    Against BS.1770's ordering this one is identical to four decimals on 88.2% of
    clips, Pearson 0.99978, Spearman 0.99997, with every era, upload-year and
    popularity-tier figure reproducing to the third decimal. The seven fully
    silent clips read 0.000 under both.

    **What this ordering costs, stated rather than left to be found.** Adding
    zero-energy blocks to the mean can only lower it, by exactly
    `10*log10(1 - floored share)` -- 3.01 dB for a clip that is half silence -- so
    the gate is never higher than BS.1770's and the column is never lower. The
    inflation is graded by the quantity being measured: mean +0.0040 in the bottom
    sixth of the column against +0.0000 in the top, correlating with a clip's
    silence share at r = +0.35, maximum +0.098 on one clip. The more silence a
    clip holds, the more lenient its own gate becomes, and that lands on the lower
    tail where §3 2.4 says the column's information is. Measured: the bottom
    decile's p10-p90 spread moves 0.2631 -> 0.2613.

    **And 2.3 does not follow it here.** `lufs` stays BS.1770 as written, because
    that is what LUFS names and because it is 1.6's comparison level -- moving it
    would move `loudness_jumps_per_min` with it. So 2.3 and 2.4 no longer share
    one reference, and the plan's claim that 1.6, 2.3 and 2.4 read one series and
    one reference now holds for the series and not for the reference. They differ
    only on clips carrying floored blocks: 1,498 of 16,675 by more than 0.001.

    The two ablations that do NOT work are kept in the plan rather than here.
    Absolute gate alone: median 1.000, IQR 0.003, 56.2% of clips exactly 1.000,
    Spearman 0.13 against this column. Relative gate alone, with no absolute test
    at any stage: indistinguishable across the corpus and 0.000 -> 1.000 on the
    seven silent clips, which puts a clip with no audio at the top of a scale
    where higher means more stimulating.

    **There is still no threshold to choose**, which was the point of taking the
    gates from the standard and survives the reordering: -70 LUFS and 10 LU are
    both BS.1770-4's numbers. The column takes no parameter and `sweep` has
    nothing to sweep for it.

    **The ungated mean is an energy mean, not a mean of dB values**: the second is
    a geometric mean of intensity, which is the error that removed `mean_rms_db`
    (plan §3 2.3).

    **There is no minimum-duration rule, and that is a choice rather than an
    omission.** A share weights every qualifying block the same, so the column
    counts a 7.8 s stretch where the programme stops and a 200 ms gap between
    words identically -- the inspection bench in runs/type24-sound-frac/ shows a
    p0 clip with 20 marks of median 7.8 s and a p50 clip with 85 of median 0.2 s.
    A duration rule would separate them, it is a second threshold, and it needs
    the labelling round 1.4 and 1.5 both got. Adding it silently would repeat the
    mistake this type has already made once.

    Higher is more stimulating as of 2026-08-24: the column counts the blocks
    *above* the gate, where v1's `silence_frac` counted the ones below.
    """
    M = c["r128_m"] if "r128_m" in c else np.array([])
    if M.size == 0:
        return float("nan")
    M = np.asarray(M, np.float64)
    # The reference is over EVERY block, so a clip whose blocks all sit on the
    # -70 floor gets a gate of -80 and the relative test alone would keep all of
    # them. The absolute test is what stops that, and it runs on the mask.
    gate = 10.0 * np.log10(np.mean(10.0 ** (M / 10.0))) - R128_REL_GATE
    return float(((M > R128_ABS_GATE) & (M > gate)).mean())


def _approach_curve(M, hop, back_lo=0.2, back_hi=0.6):
    """How far the level climbed to reach here, measured just before here.

    Compared against a median of the recent past rather than the immediately
    preceding sample, so the statistic asks "did it come up fast" without being
    thrown by one dip in the run-up. Verbatim from
    runs/type16-loudness-jump/excess.py, where 3.2's published numbers came from.

    **1.6 does not use this.** The `approach >= 3 LU` term was specified, tested
    and dropped on 2026-08-24 [human decision]: p = 0.226 at n = 9, it buys one
    clip of accuracy on 63 labels, and omitting it moves the corpus distribution
    by less than its own uncertainty. It survives here only so 3.2 can be
    re-derived on the rule its record was built with.
    """
    M = np.asarray(M, np.float64)
    lo, hi = int(round(back_lo / hop)), int(round(back_hi / hop))
    n = M.size
    out = np.full(n, np.nan)
    for i in range(hi, n):
        out[i] = M[i] - np.median(M[i - hi:i - lo])
    return out


def _loudness_jumps(c, thr_lu, refract_s, approach_lu=0.0):
    """1.6: how often the clip goes above its OWN overall level, per minute.

    Two numbers, one subtraction, one threshold:

        excess(t) = M(t) - I

    `M(t)` is momentary loudness, how loud the clip is at this instant; `I` is
    its gated integrated loudness, how loud the programme runs overall -- 2.3's
    column, not a second measurement. So the question is never "is this loud", it
    is **"is this louder than this show usually is"**, and 6 LU is about 1.5x as
    loud as the programme.

    A jump is a local maximum of excess at or above the threshold, taken greedily
    in descending excess and discarding any within `refract_s` of one already
    taken. The greedy descent is what makes the kept offsets local maxima: a
    plateau above the cut contributes its own peak and nothing else, because
    every neighbour inside the refractory gap is discarded after it.

    One-sided by construction. An excess statistic counts rises only, so a drop
    into silence is not a jump -- and the 19 drops among the round-1 labels were
    all rejected by the human.

    Returns (rate per minute, I, peak indices). `I` is returned rather than
    recomputed so 2.3 and 1.6 cannot drift, and the indices rather than a count
    so 3.2 joins against THIS list rather than rebuilding one beside it.
    """
    M = c["r128_m"] if "r128_m" in c else np.array([])
    # Clip minutes, the same clock 1.1, 1.3 and 1.4 divide by. The 800-clip
    # record in runs/type16-loudness-jump/ divided by the length of the momentary
    # series instead, which is shorter by R128_WARMUP: the jump COUNTS reproduce
    # exactly and the rate differs by ~0.3%, all of it denominator.
    dur = float(c["duration_s"])
    empty = np.array([], np.int64)
    if M.size < 10 or dur <= 0:
        return float("nan"), float("nan"), empty

    I = _integrated_lufs(M)
    if I != I:
        return float("nan"), float("nan"), empty

    hop = float(c["r128_hop"]) if "r128_hop" in c else R128_HOP
    excess = np.asarray(M, np.float64) - I
    ok = excess >= thr_lu
    if approach_lu > 0:
        # The two-term rule 3.2's published numbers were computed with. 1.6
        # SHIPS the one-term rule, so this is off by default -- see `_reveals`.
        ok &= np.nan_to_num(_approach_curve(M, hop), nan=-99.0) >= approach_lu
    hits = np.flatnonzero(ok)
    if hits.size == 0:
        return 0.0, I, empty

    order = hits[np.argsort(-excess[hits], kind="stable")]
    gap = max(1, int(round(refract_s / hop)))
    taken = []
    for i in order:
        i = int(i)
        if all(abs(i - j) >= gap for j in taken):
            taken.append(i)

    return len(taken) / (dur / 60.0), I, np.array(sorted(taken), np.int64)


def _smooth_median(M, win_s, hop):
    """Light running median over the momentary series (3.1's `L`).

    Kills a single hit and keeps a 1 s ramp, which is the difference 3.1's shape
    tests are asking about.
    """
    w = max(1, int(round(win_s / hop)) | 1)
    M = np.asarray(M, np.float64)
    if w == 1 or M.size < w:
        return M
    P = np.pad(M, w // 2, mode="edge")
    return np.median(np.lib.stride_tricks.sliding_window_view(P, w), axis=-1)


def _short_term(M, hop):
    """3 s short-term loudness, ENERGY-averaged out of the momentary series.

    Not measured a second time: BS.1770 short-term loudness is the mean energy
    over 3 s, and the momentary series is already that energy at a 100 ms hop, so
    this is the standard's own arithmetic rather than an approximation of it.
    """
    z = 10 ** (np.asarray(M, np.float64) / 10.0)
    w = int(round(3.0 / hop))
    if z.size < w or w < 1:
        return np.asarray(M, np.float64)
    cs = np.concatenate([[0.0], np.cumsum(z)])
    return 10 * np.log10((cs[w:] - cs[:-w]) / w + 1e-12)


def _loudness_range(M, hop):
    """EBU R128 loudness range: p10 to p95 of gated short-term loudness.

    Gated at -20 LU below the ungated mean, NOT the -10 LU `I` uses. Different
    statistic, and the standard says so.

    This is 3.1's whole reference frame. Every threshold in rounds 1-4 was
    absolute LU and every one of those rounds returned zero confirmed events;
    the median clip here has a range of **6.4 LU** (p10 3.0, p90 12.1), so an
    8-10 LU cut was asking for more range than half the corpus contains.
    """
    S = _short_term(M, hop)
    keep = S > R128_ABS_GATE
    if keep.sum() < 10:
        return float("nan"), float("nan")
    z = 10 ** (S[keep] / 10.0)
    rel = 10 * np.log10(z.mean()) - BR_LRA_REL_GATE
    keep2 = keep & (S > rel)
    if keep2.sum() < 10:
        keep2 = keep
    return float(np.percentile(S[keep2], 10)), float(np.percentile(S[keep2], 95))


def _build_resolve(c, p):
    """3.1: gradual climbs across the clip's own loudness range that come back.

    A candidate ends where the smoothed level first enters the top `BR_REACH` of
    the clip's R128 loudness range and starts at the last time before that it sat
    in the bottom `BR_REACH`. Ten tests then decide, six on the build and three
    on the resolve, all of them shape rather than size -- the range crossing IS
    the size test and a second absolute one on top of it was removed on
    2026-08-24 [human decision] after it proved invisible to every label.

    **The peak is not the first entry into the top band.** Entering the band is
    where a climb becomes visible, not where it ends; walking forward to the true
    local maximum takes Porky Pig's Feat (1943) from 6.9 LU over 1.7 s to 9.8 LU
    over 3.2 s and the 800-clip corpus from 38 gradual builds to 193, because
    truncated climbs had been failing the shape bar. The human caught it on two
    clips and five rounds of apparent rarity were partly this one line.

    Ported from runs/type31-build-resolve/ramp.py (`ramps`, `gradual`,
    `build_ok`, `resolved`), which is the code the labels were collected with.

    Returns (rate per minute, n resolved, n builds). `n_builds` is reported
    beside the rate because the two answer different questions: 14.9% of clips
    contain a qualifying build and 6.0% contain one that also resolves, so the
    resolve is doing most of the work and a reader should be able to see that.
    """
    M = c["r128_m"] if "r128_m" in c else np.array([])
    dur = float(c["duration_s"])
    hop = float(c["r128_hop"]) if "r128_hop" in c else R128_HOP
    if M.size < 40 or dur <= 0 or hop <= 0:
        return float("nan"), 0, 0

    M = np.asarray(M, np.float64)
    L = _smooth_median(M, BR_SMOOTH_S, hop)
    lo, hi = _loudness_range(M, hop)
    if not np.isfinite(lo) or not np.isfinite(hi) or hi - lo < 1.0:
        return 0.0, 0, 0

    rng = hi - lo
    lo_band, hi_band = lo + BR_REACH * rng, hi - BR_REACH * rng
    n = L.size
    i_lo = max(1, int(round(p["br_dur_lo"] / hop)))
    i_hi = int(round(p["br_dur_hi"] / hop))
    peak_tol = max(1.5, BR_REACH * rng)

    n_build = n_resolve = 0
    prev_end = -(10 ** 9)
    for i0 in range(i_lo, n - 20):
        if L[i0] < hi_band or L[i0 - 1] >= hi_band:     # first entry into the top
            continue
        lo_i = max(0, i0 - i_hi)
        below = np.flatnonzero(L[lo_i:i0 + 1] <= lo_band)
        if not below.size:
            continue
        k = lo_i + int(below[-1])                       # last time in the bottom

        i = i0                                          # walk to the TRUE peak
        run_max = L[i0]
        lim = min(n - 1, i0 + int(round(BR_PEAK_EXT_S / hop)))
        j = i0
        while j < lim:
            j += 1
            if L[j] > run_max:
                run_max, i = L[j], j
            elif run_max - L[j] > peak_tol:
                break

        dur_s = (i - k) * hop
        if not (p["br_dur_lo"] <= dur_s <= p["br_dur_hi"]):
            continue
        if k <= prev_end or i >= n - 20:
            continue

        seg = L[k:i + 1]
        rise = float(seg[-1] - seg[0])
        if rise <= 0 or seg.size < 3:
            continue
        prev_end = i

        x = np.arange(seg.size) * hop
        a, b = np.polyfit(x, seg, 1)
        ss_res = float(((seg - (a * x + b)) ** 2).sum())
        ss_tot = float(((seg - seg.mean()) ** 2).sum()) + 1e-12
        r2 = 1.0 - ss_res / ss_tot
        d = np.diff(seg)
        max_step = float(d.max() / rise)
        up_frac = float((d > 0).mean())
        third = max(1, seg.size // 3)
        gains = [float(seg[min(seg.size - 1, (q + 1) * third)] - seg[q * third])
                 for q in range(3)]
        thirds = float(min(gains) / rise)

        if not (r2 >= p["br_r2"] and max_step <= p["br_max_step"]
                and up_frac >= p["br_up_frac"] and thirds >= p["br_thirds"]):
            continue
        n_build += 1

        # The resolve: how much of the climb is given back within one and two
        # seconds of the peak. A BAND, not a floor -- under 45% it never came
        # down, over 130% it crashed past where it started, which is the
        # programme stopping rather than resolving. `give_back_2s` is what
        # separates a real return from a climb that gives back half and stays
        # there.
        gb1 = float(seg[-1] - L[i:min(n, i + int(round(1.0 / hop)))].min()) / rise
        gb2 = float(seg[-1] - L[i:min(n, i + int(round(2.0 / hop)))].min()) / rise
        if p["br_gb1_lo"] <= gb1 <= p["br_gb1_hi"] and gb2 >= p["br_gb2"]:
            n_resolve += 1

    return n_resolve / (dur / 60.0), n_resolve, n_build


def _reveal_onsets(M, peaks, back_s, delta_lu, hop):
    """Where the SOUND that caused each jump arrives, in series indices.

    **This is the load-bearing detail of 3.2 and it was got wrong twice before it
    was measured.** `ebur128` stamps its 400 ms window by the front edge, so a
    jump's peak sits after the sound -- but the lag is not a constant. On
    synthetic events with the sound at exactly t = 5.000, a 20 ms crack peaks at
    +0.00, a 100 ms bang at +0.10 and a decaying crash at +0.30. The peak lag
    runs the full 0.00-0.30 s with the event's SHAPE; the onset -- the last
    instant at the local floor before the climb -- is wrong by a constant -0.10 s
    with no shape dependence at all, so `onset + 1 bin` is the sound.

    Plan revisions before 2026-08-24 subtracted a fixed 0.3 s from the peak,
    which is the maximum of that range rather than its typical value, and every
    claim about where reveals sit relative to cuts was skewed by up to 0.3 s.
    """
    back = max(1, int(round(back_s / hop)))
    out = []
    for pk in np.asarray(peaks, int).tolist():
        lo = max(0, pk - back)
        seg = M[lo:pk + 1]
        if seg.size < 2:
            out.append(pk)
            continue
        floor = np.flatnonzero(seg <= seg.min() + delta_lu)
        out.append((lo + int(floor[-1]) if floor.size else pk) + 1)
    return np.clip(np.asarray(out, int), 0, M.size - 1)


def _reveals(c, cuts, peaks, win_s):
    """3.2: 1.6's loudness jumps whose sound lands within `win_s` of 1.1's cut.

    An interval join over two lists this file already computes, so 3.2 adds
    exactly two numbers to types the plan already defines: a timestamp and a
    tolerance. No new pass and no new decode.

    **The window is symmetric, and that is a human decision against the corpus
    optimum** [2026-08-24]. Corpus lift and label agreement do not pick the same
    window -- 0.0..+0.2 s lifts 1.90 where +/-0.2 lifts 1.42 -- so symmetry costs
    0.48 of lift. It is taken because the construct is COMPLETE alignment, the
    tolerance existing only because a listener cannot resolve a tenth of a
    second, and because the entire difference between the two windows is one
    clip that the labeller heard as containing no sudden sound at all.

    Validated on 24 blind stimuli built as single-variable contrasts: TP 9, FP 2,
    FN 1, TN 12 -- precision 81.8%, recall 90.0%, F1 0.857. The arm holding
    everything fixed but moving the cut 1.5-2 s earlier reads as a reveal 0 of 6,
    which is what establishes that the alignment is the construct rather than an
    artefact of counting. Three of the four errors are 1.6's jump rule, not this
    window (runs/type32-reveals/findings.md).
    """
    dur = float(c["duration_s"])
    if dur <= 0 or not len(cuts) or not len(peaks):
        return (0.0 if dur > 0 else float("nan")), 0
    M = c["r128_m"] if "r128_m" in c else np.array([])
    if M.size < 10:
        return float("nan"), 0

    hop = float(c["r128_hop"]) if "r128_hop" in c else R128_HOP
    t0 = float(c["r128_t0"]) if "r128_t0" in c else R128_WARMUP
    onsets = _reveal_onsets(np.asarray(M, np.float64), peaks,
                            REVEAL_ONSET_BACK_S, REVEAL_ONSET_DELTA_LU, hop)
    sound_t = t0 + onsets * hop
    cut_t = np.sort(_cut_seconds(c, cuts))

    # One jump with two cuts inside its window is one reveal, not two.
    left = np.searchsorted(cut_t, sound_t - win_s, side="left")
    right = np.searchsorted(cut_t, sound_t + win_s, side="right")
    n = int(np.count_nonzero(right > left))
    return n / (dur / 60.0), n


def _level_mean(c, key):
    """2.1 and 2.2: mean over the 2 fps frames of a per-frame pixel mean.

    Both aggregators are means and both were checked rather than assumed
    (`runs/type21-chroma/findings.md` §2): over frames the series is
    near-symmetric, rho 0.985 against a median, and over pixels a median would
    discard the vivid minority Type 2.1 is about.
    """
    v = c[key] if key in c else None
    if v is None or v.size == 0:
        return float("nan")
    return float(np.asarray(v, np.float64).mean())


def derive_one(c, p):
    cuts, fps = _cuts_from_cache(c, p["cut_thr"], p["merge_s"], p["cut_grid"])
    duration_s = float(c["duration_s"])
    minutes = duration_s / 60.0

    cuts_per_min = len(cuts) / minutes if minutes else float("nan")

    # 1.2: every cut, not v1's first 50. 86% of clips have more than 50, so v1
    # measured the opening minutes of exactly the fast-cut clips the type is
    # about (plan §3 1.2). SSIM is taken across the grid pair bracketing each
    # cut, so 1.2 reads the same 67 ms interval as 1.1 and 1.4. The cache holds a
    # superset, so this is a lookup rather than a computation.
    #
    # Reported as `1 - SSIM` [human decision, 2026-08-24]. 1.2 was the last
    # column reading `lower is more stimulating`, which forced the RQ2 composite
    # to carry a per-column sign and left a sign error possible. The flip is
    # affine and `mean(1 - s) == 1 - mean(s)` exactly, so every published SSIM
    # figure converts by hand and nothing goes back through validation. The cache
    # still holds SSIM as computed, because §2's caches hold pre-transform
    # intermediates and renaming it there would buy a five-hour re-extract for a
    # subtraction. The COLUMN rename is load-bearing rather than cosmetic:
    # keeping the old name with flipped values would silently invert every script
    # that reads it, and a KeyError is the correct outcome instead.
    #
    # Values are NOT clamped at 1. SSIM runs to -1 for an anti-correlated pair
    # and 35 of 159,320 cached pairs in a 200-clip sample are negative, which
    # reads past 1 as dissimilarity; clamping would insert a silent non-linearity
    # to tidy 0.02% of pairs. No clip MEAN passes 1.
    src_fps = float(c["src_fps"]) if "src_fps" in c else fps
    have = c["ssim_grids"].tolist() if "ssim_grids" in c else [15.0]
    ssim_grid = p["ssim_grid"]
    if ssim_grid not in have:
        raise SystemExit(
            f"1.2 has no cached SSIM pairs for a {ssim_grid:g} fps grid "
            f"(cached: {have}). Re-extract with that grid in SSIM_GRIDS, or "
            f"1.2 would be reported on a different interval from 1.1.")
    gi = _grid_indices(int(c["n_frames"]), src_fps, ssim_grid)
    lookup = dict(zip(zip(c["pair_i"].tolist(), c["pair_j"].tolist()),
                      c["pair_ssim"].tolist()))
    vals = []
    for cut in cuts.tolist():
        k = min(max(int(np.searchsorted(gi, cut)) - 1, 0), gi.size - 2)
        v = lookup.get((int(gi[k]), int(gi[k + 1])))
        if v is not None:
            vals.append(v)
    dssim_mean = 1.0 - float(np.mean(vals)) if vals else float("nan")

    pal, n_pairs = _palette_rate(c, p["tile_agg"], p["presence"], p["jaccard"])
    flash, n_luma = _lstar_flash(c, cuts, p["luma_fps"], p["luma_thr"])
    motion, n_motion = _motion_frac(c, cuts, p["motion_pct"])

    # 1.6 and 2.3 come out of one call: `lufs` IS 1.6's reference, so deriving
    # them separately would be two chances for them to disagree. 3.2 then joins
    # against 1.6's own peak list for the same reason.
    jumps, lufs, peaks = _loudness_jumps(c, p["excess_lu"], p["jump_refract_s"])
    gated = _high_lufs_frac(c)                      # 2.4, and it takes no threshold
    n_r128 = int(c["r128_m"].size) if "r128_m" in c else 0

    build_resolve, n_br, n_builds = _build_resolve(c, p)

    if p["reveal_approach_lu"] > 0:
        # 3.2 on the two-term jump rule its published record was computed with,
        # rather than on 1.6's shipped one. Off by default; see `_reveals`.
        _, _, rv_peaks = _loudness_jumps(c, p["excess_lu"], p["jump_refract_s"],
                                         p["reveal_approach_lu"])
    else:
        rv_peaks = peaks
    reveals, n_reveals = _reveals(c, cuts, rv_peaks, p["reveal_win_s"])

    def num(v, nd):
        return round(v, nd) if v == v else ""

    return {
        "duration_s": round(duration_s, 2),
        "n_cuts": len(cuts),
        "cuts_per_min": round(cuts_per_min, 3),
        "inter_cut_dssim_mean": round(dssim_mean, 4) if vals else "",
        "n_dssim_cuts": len(vals),
        "palette_change_per_min": num(pal, 3),
        "n_palette_pairs": n_pairs,
        "lstar_flash_per_min": num(flash, 4),
        "n_lstar_pairs": n_luma,
        "motion_frac": num(motion, 4),
        "n_motion_intervals": n_motion,
        "loudness_jumps_per_min": num(jumps, 4),
        "n_loudness_jumps": len(peaks),
        # 2.1 keeps v1's two decimals so the two tables can be diffed directly.
        "mean_saturation": num(_level_mean(c, "sat_level"), 2),
        "mean_lstar": num(_level_mean(c, "lstar_level"), 3),
        "lufs": num(lufs, 2),
        "high_lufs_frac": num(gated, 5),
        "n_r128_blocks": n_r128,
        "build_resolve_per_min": num(build_resolve, 4),
        "n_build_resolve": n_br,
        "n_builds": n_builds,
        "loudness_jump_at_cut_per_min": num(reveals, 4),
        "n_reveals": n_reveals,
    }


FEATURE_COLUMNS = [
    "video_id", "channel_id", "channel_title", "content_category",
    "popularity_tier", "published_at", "view_count", "like_count",
    "subscriber_count", "era", "production_year",
    "duration_s",
    "n_cuts", "cuts_per_min",                       # 1.1
    "inter_cut_dssim_mean", "n_dssim_cuts",         # 1.2
    "palette_change_per_min", "n_palette_pairs",    # 1.3
    "lstar_flash_per_min", "n_lstar_pairs",         # 1.4
    "motion_frac", "n_motion_intervals",            # 1.5
    "loudness_jumps_per_min", "n_loudness_jumps",   # 1.6
    "mean_saturation",                              # 2.1
    "mean_lstar",                                   # 2.2
    "lufs",                                         # 2.3
    "high_lufs_frac",                               # 2.4
    "n_r128_blocks",
    "build_resolve_per_min", "n_build_resolve", "n_builds",   # 3.1
    "loudness_jump_at_cut_per_min", "n_reveals",              # 3.2
]

# The twelve reported columns, in taxonomy order. The `n_*` columns beside them
# are denominators and counts, not features -- they say how much of the clip each
# number was made from, which matters most where a rule deletes samples (1.4 and
# 1.5 both drop cut-straddling pairs) and where a column is mostly zero (3.1 and
# 3.2 both are).
REPORTED_COLUMNS = [
    "cuts_per_min", "inter_cut_dssim_mean", "palette_change_per_min",
    "lstar_flash_per_min", "motion_frac", "loudness_jumps_per_min",
    "mean_saturation", "mean_lstar", "lufs", "high_lufs_frac",
    "build_resolve_per_min", "loudness_jump_at_cut_per_min",
]


# ============================================================
# Plumbing
# ============================================================

def _check_version(c, path):
    """A cache written by an older build has different arrays; say so plainly."""
    v = int(c["version"]) if "version" in c else 0
    if v != CACHE_VERSION:
        raise SystemExit(
            f"{path}: cache version {v}, this build writes {CACHE_VERSION}. "
            f"A structural parameter changed, so the caches must be rebuilt: "
            f"re-run `extract --force`, or point --cache-dir at a fresh one.")


def load_manifest(path):
    rows = {}
    with open(path, "r", encoding="utf-8") as fh:
        for row in csv.DictReader(fh, delimiter="\t"):
            rows[row["video_id"]] = row
    return rows


def resolve_dirs(args):
    script_dir = os.path.dirname(os.path.abspath(__file__))
    with open(os.path.join(script_dir, "config.yaml")) as fh:
        cfg = yaml.safe_load(fh)
    clips_dir = args.clips_dir or os.path.normpath(
        os.path.join(script_dir, cfg["clips_dir"]))
    output_dir = os.path.normpath(os.path.join(script_dir, cfg["output_dir"]))
    return clips_dir, output_dir


def params_from_args(args):
    return {
        "cut_thr": args.cut_threshold,
        "cut_grid": args.cut_grid,
        "merge_s": args.merge_window,
        "ssim_grid": args.ssim_grid,
        "tile_agg": args.tile_agg,
        "presence": args.presence,
        "jaccard": args.jaccard,
        "luma_fps": args.luma_fps,
        "luma_thr": args.luma_threshold,
        "motion_pct": args.motion_threshold,
        "excess_lu": args.excess_threshold,
        "jump_refract_s": args.jump_refractory,
        "br_r2": args.br_r2,
        "br_max_step": args.br_max_step,
        "br_up_frac": args.br_up_frac,
        "br_thirds": args.br_thirds,
        "br_dur_lo": args.br_dur_lo,
        "br_dur_hi": args.br_dur_hi,
        "br_gb1_lo": args.br_gb1_lo,
        "br_gb1_hi": args.br_gb1_hi,
        "br_gb2": args.br_gb2,
        "reveal_win_s": args.reveal_window,
        "reveal_approach_lu": args.reveal_approach,
    }


def cmd_extract(args):
    clips_dir, output_dir = resolve_dirs(args)
    cache_dir = args.cache_dir or os.path.join(output_dir, "cache-v2")
    os.makedirs(cache_dir, exist_ok=True)

    stray = [f for f in os.listdir(cache_dir) if f.endswith(TMP_SUFFIX)]
    for f in stray:
        os.unlink(os.path.join(cache_dir, f))
    if stray:
        print(f"Cleared {len(stray)} partial cache file(s) from an "
              f"interrupted run.", flush=True)

    manifest = load_manifest(args.manifest)
    jobs = []
    for vid in manifest:
        clip = os.path.join(clips_dir, f"{vid}.mp4")
        if not (os.path.exists(clip) and os.path.getsize(clip) > 10000):
            continue
        cached = os.path.join(cache_dir, f"{vid}.npz")
        if os.path.exists(cached) and not args.force:
            continue
        jobs.append((vid, clip, cache_dir, args.ffmpeg_threads,
                     not args.no_flow, args.reuse_from))

    if args.limit:
        jobs = jobs[:args.limit]
    print(f"Manifest: {len(manifest)}  to extract: {len(jobs)}  "
          f"cache: {cache_dir}", flush=True)
    if args.no_flow:
        print("  --no-flow: Farneback skipped over pass A's frames, so 1.5 "
              "`motion_frac` will derive blank for these clips. Since v11 flow "
              "is never in the reused set, so --reuse-from does not change "
              "this.", flush=True)
    if args.reuse_from:
        have = sum(1 for j in jobs
                   if os.path.exists(os.path.join(args.reuse_from,
                                                  f"{j[0]}.npz")))
        print(f"  --reuse-from: {have}/{len(jobs)} clips have a cache in "
              f"{args.reuse_from}. **v11 lifts the AUDIO PASS ONLY** -- pass A's "
              f"frame size, pass B's rate and where flow is measured all moved, "
              f"so every picture-side array re-runs. That is ~0.2 s saved of the "
              f"~18.5 core-seconds a clip costs, and Farneback is ~14.9 s of it. "
              f"v9 and v10 are both acceptable sources: neither touched the "
              f"audio. Any cache that turns out to be the wrong version or short "
              f"an array falls back to a full extract silently and correctly.",
              flush=True)
    if not jobs:
        print("Nothing to extract.")
        return

    t0 = time.time()
    failures = []
    done = 0
    if args.workers > 1:
        import multiprocessing as mp
        with mp.Pool(args.workers, initializer=_init_worker) as pool:
            it = pool.imap_unordered(extract_one, jobs)
            for vid, err, _ in it:
                done += 1
                if err:
                    failures.append((vid, err))
                _tick(done, len(jobs), t0, len(failures))
    else:
        _init_worker()
        for job in jobs:
            vid, err, _ = extract_one(job)
            done += 1
            if err:
                failures.append((vid, err))
            _tick(done, len(jobs), t0, len(failures))

    elapsed = time.time() - t0
    print(f"\nExtracted {done - len(failures)}/{len(jobs)} in {elapsed:.0f}s "
          f"({elapsed / max(done, 1):.2f}s/clip)")
    if failures:
        fail_path = os.path.join(cache_dir, "failures.tsv")
        with open(fail_path, "w", encoding="utf-8") as fh:
            fh.write("video_id\terror\n")
            for vid, err in failures:
                fh.write(f"{vid}\t{err}\n")
        for vid, err in failures[:20]:
            print(f"  FAIL {vid}: {err}", file=sys.stderr)
        print(f"  {len(failures)} failures -> {fail_path}", file=sys.stderr)


def _tick(done, total, t0, n_fail):
    if done % 10 and done != total:
        return
    el = time.time() - t0
    per = el / done
    print(f"  [{done}/{total}] {el:.0f}s elapsed, "
          f"~{per * (total - done):.0f}s remaining, "
          f"{per:.2f}s/clip, {n_fail} failed", flush=True)


def cmd_derive(args):
    _, output_dir = resolve_dirs(args)
    cache_dir = args.cache_dir or os.path.join(output_dir, "cache-v2")
    manifest = load_manifest(args.manifest)
    p = params_from_args(args)

    rows, missing = [], 0
    for vid, meta in manifest.items():
        path = os.path.join(cache_dir, f"{vid}.npz")
        if not os.path.exists(path):
            missing += 1
            continue
        try:
            with np.load(path) as c:
                _check_version(c, path)
                feats = derive_one(c, p)
        except SystemExit:
            raise
        except Exception as exc:                # noqa: BLE001
            raise SystemExit(
                f"{path}: unreadable cache ({type(exc).__name__}: {exc}). "
                f"Delete it and re-run `extract` for this clip.")
        row = {"video_id": vid}
        row.update({k: meta.get(k, "") for k in FEATURE_COLUMNS if k != "video_id"})
        row.update(feats)
        rows.append(row)

    out_path = args.out or os.path.join(output_dir, "features-v3.tsv")
    with open(out_path, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=FEATURE_COLUMNS, delimiter="\t",
                           extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)

    print(f"Derived {len(rows)} rows -> {out_path}"
          + (f"  ({missing} not yet cached)" if missing else ""))
    print("  params: " + "  ".join(f"{k}={v}" for k, v in p.items()))

    # 1.2's coverage against 1.1, corpus-wide (plan §2.5). A cache carries SSIM
    # for a SUPERSET of candidate cuts, so every derived cut should find a pair.
    # v8 built that superset from the union of two detectors, which is far more
    # permissive than the settled rule, so it probably already covers everything
    # -- but probably is not a basis, and a shortfall here is exactly the count
    # of cuts 1.2 could not have measured.
    n_cuts = sum(int(r["n_cuts"]) for r in rows)
    n_pairs = sum(int(r["n_dssim_cuts"]) for r in rows)
    if n_cuts and n_pairs < n_cuts:
        short = [r["video_id"] for r in rows
                 if int(r["n_dssim_cuts"]) < int(r["n_cuts"])]
        print(f"  1.2 COVERAGE: {n_pairs}/{n_cuts} cuts have a cached SSIM "
              f"pair ({n_cuts - n_pairs} short, over {len(short)} clips). "
              f"Those cuts are counted by 1.1 and missing from 1.2.",
              file=sys.stderr)
    elif n_cuts:
        print(f"  1.2 coverage: {n_pairs}/{n_cuts} cuts have a cached SSIM "
              f"pair. Complete.")
    for col in REPORTED_COLUMNS:
        vals = [float(r[col]) for r in rows if r[col] != ""]
        if vals:
            v = np.array(vals)
            print(f"  {col:24s} n={len(v):5d}  min={v.min():8.3f}  "
                  f"med={np.median(v):8.3f}  max={v.max():8.3f}")
        else:
            print(f"  {col:24s} n=    0  -- nothing cached for it")


def cmd_sweep(args):
    """What a threshold change does, off the caches -- no decoding.

    Streams one clip at a time. Loading the corpus at once would need ~7.8 GB:
    the a*b* histograms are 1.2 MB per clip decompressed, against 228 KB on disk.
    """
    _, output_dir = resolve_dirs(args)
    cache_dir = args.cache_dir or os.path.join(output_dir, "cache-v2")
    caches = sorted(f for f in os.listdir(cache_dir)
                    if f.endswith(".npz") and not f.endswith(TMP_SUFFIX))
    if args.limit:
        caches = caches[:args.limit]
    if not caches:
        raise SystemExit(f"no caches in {cache_dir}")

    grids = {
        "jaccard":   [0.30, 0.35, 0.40, 0.4444, 0.449, 0.45, 0.50, 0.55, 0.60],
        "presence":  [0.0005, 0.00075, 0.001, 0.00119, 0.0015, 0.002, 0.003],
        # 1.1: brackets the clean window the 89 labels leave open. Every
        # not-cut scores at most 10.44 and every cut at least 11.55, so 10.5 to
        # 11.5 all read 39/0/0 and the interesting question is what the corpus
        # does either side of it, not where the labels sit.
        "cut":       [8.0, 10.0, 10.5, 11.0, 11.5, 12.0, 15.0, 20.0, 28.0],
        "tile":      [1, 2, 4, 8],
        "luma":      [4.31, 8, 12, 15.3, 18, 20, 21, 24, 28, 32],
        "lumafps":   [5.0, 10.0, 15.0, 20.0, 30.0],
        "cutgrid":   [0.0] + list(FD_GRIDS),
        # 1.5: brackets the two disjoint accuracy maxima on the 50 labels,
        # (6.56, 7.25] and (8.01, 11.09], and reaches far enough either side to
        # show both tails. The job here is to report one-inflation at the low end
        # and dead zeros at the high end, not to re-choose the value.
        "motion":    [1.25, 2.5, 5.0, 6.56, 7.25, 8.01, 10.0, 11.09, 15.0, 20.0],
        # 1.6: brackets (5.16, 6.00]. 8 is here because it was tried and left 73%
        # of the corpus at zero, which is the tail this sweep exists to show.
        "excess":    [3.0, 4.0, 5.0, 5.16, 6.0, 7.0, 8.0, 10.0, 12.0],
    }
    grids["brstep"] = [0.18, 0.20, 0.22, 0.25, 0.28, 0.32, 1.0]
    grids["brdur"] = [0.8, 1.0, 1.2, 1.5, 2.0]
    grids["reveal"] = [0.1, 0.2, 0.3, 0.5, 1.0]
    key = {"jaccard": "jaccard", "presence": "presence",
           "cut": "cut_thr", "tile": "tile_agg", "cutgrid": "cut_grid",
           "luma": "luma_thr", "lumafps": "luma_fps",
           "motion": "motion_pct", "excess": "excess_lu",
           "brstep": "br_max_step", "brdur": "br_dur_lo",
           "reveal": "reveal_win_s"}[args.param]
    cut_params = {"cut", "cutgrid"}
    luma_params = {"luma", "lumafps"}

    base = params_from_args(args)
    values = grids[args.param]
    acc = {v: [] for v in values}

    for fn in caches:
        path = os.path.join(cache_dir, fn)
        with np.load(path) as z:
            _check_version(z, path)
            c = {k: z[k] for k in z.files}
        for v in values:
            q = dict(base, **{key: v})
            if args.param in cut_params:
                cuts, _ = _cuts_from_cache(c, q["cut_thr"], q["merge_s"],
                                           q["cut_grid"])
                acc[v].append(len(cuts) / (float(c["duration_s"]) / 60.0))
            elif args.param in luma_params:
                cuts, _ = _cuts_from_cache(c, q["cut_thr"], q["merge_s"],
                                           q["cut_grid"])
                r, _ = _lstar_flash(c, cuts, q["luma_fps"], q["luma_thr"])
                acc[v].append(r)
            elif args.param == "motion":
                cuts, _ = _cuts_from_cache(c, q["cut_thr"], q["merge_s"],
                                           q["cut_grid"])
                r, _ = _motion_frac(c, cuts, q["motion_pct"])
                acc[v].append(r)
            elif args.param == "excess":
                r, _, _ = _loudness_jumps(c, q["excess_lu"],
                                          q["jump_refract_s"])
                acc[v].append(r)
            elif args.param in ("brstep", "brdur"):
                r, _, _ = _build_resolve(c, q)
                acc[v].append(r)
            elif args.param == "reveal":
                cuts, _ = _cuts_from_cache(c, q["cut_thr"], q["merge_s"],
                                           q["cut_grid"])
                _, _, pk = _loudness_jumps(c, q["excess_lu"],
                                           q["jump_refract_s"])
                r, _ = _reveals(c, cuts, pk, q["reveal_win_s"])
                acc[v].append(r)
            else:
                r, _ = _palette_rate(c, q["tile_agg"], q["presence"],
                                     q["jaccard"])
                acc[v].append(r)

    print(f"Swept over {len(caches)} cached clips\n")
    print(f"{args.param:>10} | {'median':>9} {'mean':>9} {'p90':>9} "
          f"{'at ceiling':>11} {'at zero':>9}")
    print("-" * 66)
    for v in values:
        a = np.array([x for x in acc[v] if x == x])
        if a.size == 0:
            continue
        if args.param in cut_params:
            ceiling = float("inf")
        elif args.param in luma_params:
            ceiling = 60.0 * (v if args.param == "lumafps" else base["luma_fps"])
        elif args.param == "motion":
            ceiling = 1.0                       # a share; 1.5's risk is the TOP
        elif args.param in ("excess", "reveal"):
            ceiling = 60.0 / DEF_JUMP_REFRACT_S  # the refractory gap sets it
        elif args.param in ("brstep", "brdur"):
            ceiling = float("inf")
        else:
            ceiling = 60.0
        print(f"{v:>10} | {np.median(a):9.3f} {a.mean():9.3f} "
              f"{np.percentile(a, 90):9.3f} "
              f"{np.count_nonzero(a >= ceiling * 0.98):11d} "
              f"{np.count_nonzero(a == 0):9d}")


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    def common(sp):
        sp.add_argument("--cache-dir", default="")
        sp.add_argument("--clips-dir", default="")
        sp.add_argument("--limit", type=int, default=0)

    def derive_params(sp):
        sp.add_argument("--cut-threshold", type=float, default=DEF_CUT_THR,
                        help="1.1, on scdet's 0-100 scale. 11 is the midpoint "
                             "of the gap the 89 labels leave: every not-cut "
                             "scores at most 10.44, every cut at least 11.55")
        sp.add_argument("--cut-grid", type=float, default=DEF_CUT_GRID,
                        choices=[0.0] + list(FD_GRIDS),
                        help="1.1 sampling grid in fps; 0 = native adjacent "
                             "frames, which is what the labels were scored on "
                             "and what ships")
        sp.add_argument("--merge-window", type=float, default=DEF_MERGE_S)
        sp.add_argument("--ssim-grid", type=float, default=SSIM_GRIDS[0],
                        choices=list(SSIM_GRIDS),
                        help="1.2's interval, in fps. It is cached for the "
                             "settled 15 fps only; `derive` refuses any other "
                             "rather than reporting 1.2 over a different "
                             "interval from 1.1")
        sp.add_argument("--tile-agg", type=int, default=DEF_TILE_AGG,
                        help="32x32 cache -> tiles: 1=8u 2=16u(chosen) 4=32u")
        sp.add_argument("--presence", type=float, default=DEF_PRESENCE)
        sp.add_argument("--jaccard", type=float, default=DEF_JACCARD)
        sp.add_argument("--luma-fps", type=float, default=DEF_LUMA_FPS)
        sp.add_argument("--luma-threshold", type=float, default=DEF_LUMA_THR)
        sp.add_argument("--motion-threshold", type=float,
                        default=DEF_MOTION_PCT,
                        help="1.5 cut, in %% of frame width per second; it names "
                             "the 15 fps grid it was set on")
        sp.add_argument("--excess-threshold", type=float, default=DEF_EXCESS_LU,
                        help="1.6 cut, in LU above the clip's own `lufs`")
        sp.add_argument("--jump-refractory", type=float,
                        default=DEF_JUMP_REFRACT_S,
                        help="1.6 dedupe window, seconds")
        sp.add_argument("--br-r2", type=float, default=DEF_BR_R2)
        sp.add_argument("--br-max-step", type=float, default=DEF_BR_MAX_STEP,
                        help="3.1: largest single 100 ms rise as a share of the "
                             "climb. Moved 0.22 -> 0.25 [human, 2026-08-24]")
        sp.add_argument("--br-up-frac", type=float, default=DEF_BR_UP_FRAC)
        sp.add_argument("--br-thirds", type=float, default=DEF_BR_THIRDS)
        sp.add_argument("--br-dur-lo", type=float, default=DEF_BR_DUR_LO,
                        help="3.1 minimum climb, seconds. The one gate still "
                             "strict, and the single remaining label miss is a "
                             "1.0 s climb against it")
        sp.add_argument("--br-dur-hi", type=float, default=DEF_BR_DUR_HI)
        sp.add_argument("--br-gb1-lo", type=float, default=DEF_BR_GB1_LO)
        sp.add_argument("--br-gb1-hi", type=float, default=DEF_BR_GB1_HI)
        sp.add_argument("--br-gb2", type=float, default=DEF_BR_GB2)
        sp.add_argument("--reveal-window", type=float,
                        default=DEF_REVEAL_WIN_S,
                        help="3.2 tolerance, seconds either side of the cut")
        sp.add_argument("--reveal-approach", type=float,
                        default=DEF_REVEAL_APPROACH_LU,
                        help="3.2 only: re-derive on the TWO-term jump rule "
                             "(`excess` and `approach`) its published record "
                             "was computed with. 3 reinstates it; 0, the "
                             "default, uses 1.6's shipped one-term rule so the "
                             "two types cannot drift")

    sp = sub.add_parser("extract", help="decode clips and write caches")
    common(sp)
    sp.add_argument("--manifest", required=True)
    sp.add_argument("--workers", type=int, default=8)
    sp.add_argument("--ffmpeg-threads", type=int, default=0,
                    help="threads per ffmpeg; 0 = ffmpeg's default")
    sp.add_argument("--force", action="store_true")
    sp.add_argument("--reuse-from", default="",
                    help="an existing v9 or v10 cache directory to lift the "
                         "AUDIO pass from instead of recomputing it. v11 changes "
                         "pass A's frame size, pass B's rate and where flow is "
                         "measured, so every picture-side array re-runs and only "
                         "`r128_*` is carried over -- worth ~0.2 s of the ~18.5 "
                         "core-seconds a clip costs. Neither v9 nor v10 touched "
                         "the audio, so either works. Anything not reusable "
                         "falls back to a full extract per clip")
    sp.add_argument("--no-flow", action="store_true",
                    help="skip pass 2b. Farneback is ~15 s/clip against ~6 s "
                         "for everything else, so this makes a pilot of the "
                         "other eight features cheap -- at the cost of 1.5, "
                         "which derives blank from such a cache")
    sp.set_defaults(func=cmd_extract)

    sp = sub.add_parser("derive", help="caches -> feature TSV")
    common(sp)
    derive_params(sp)
    sp.add_argument("--manifest", required=True)
    sp.add_argument("--out", default="")
    sp.set_defaults(func=cmd_derive)

    sp = sub.add_parser("sweep", help="threshold sweep off the caches")
    common(sp)
    derive_params(sp)
    sp.add_argument("--param", required=True,
                    choices=["jaccard", "presence", "cut", "cutgrid", "tile",
                             "luma", "lumafps", "motion", "excess",
                             "brstep", "brdur", "reveal"])
    sp.set_defaults(func=cmd_sweep)

    args = ap.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
