"""Stimulation score, a percentile (0-100) within the dataset.

Each of the 12 features is ranked separately as a percentile within the dataset; a
video's composite is the average of its 12 feature percentiles; its score is the
percentile of that composite among all dataset videos' composites. Live analysis
will score new videos against the same pools, so dataset and live scores come from
one method.
"""

import bisect
from collections.abc import Iterable, Mapping

# The 12 features, one per type of the taxonomy. Higher raw value = more stimulating.
FEATURES: tuple[str, ...] = (
    "cuts_per_min",
    "inter_cut_dssim_mean",
    "palette_change_per_min",
    "lstar_flash_per_min",
    "motion_frac",
    "loudness_jumps_per_min",
    "mean_saturation",
    "mean_lstar",
    "lufs",
    "high_lufs_frac",
    "build_resolve_per_min",
    "loudness_jump_at_cut_per_min",
)

Features = Mapping[str, float | None]
Pools = dict[str, list[float]]


def build_pools(videos: Iterable[Features]) -> Pools:
    """Sorted dataset values per feature; missing values are left out."""
    pools: Pools = {name: [] for name in FEATURES}
    for features in videos:
        for name in FEATURES:
            value = features.get(name)
            if value is not None:
                pools[name].append(value)
    for values in pools.values():
        values.sort()
    return pools


def percentile_rank(value: float, sorted_pool: list[float]) -> float | None:
    """Share of the pool at or below `value`, scaled so the pool's minimum is 0 and maximum 100."""
    n = len(sorted_pool)
    if n == 0:
        return None
    if n == 1:
        return 50.0
    at_or_below = bisect.bisect_right(sorted_pool, value)
    return max(0.0, min(100.0, 100 * (at_or_below - 1) / (n - 1)))


def feature_percentiles(features: Features, pools: Pools) -> dict[str, float | None]:
    """Each feature's percentile in its pool, unrounded; None where the value is missing."""
    percentiles: dict[str, float | None] = {}
    for name in FEATURES:
        value = features.get(name)
        percentiles[name] = None if value is None else percentile_rank(value, pools[name])
    return percentiles


def composite(features: Features, pools: Pools) -> float | None:
    """Mean of the available feature percentiles, unrounded; None if no feature has a value."""
    percentiles = [p for p in feature_percentiles(features, pools).values() if p is not None]
    return sum(percentiles) / len(percentiles) if percentiles else None
