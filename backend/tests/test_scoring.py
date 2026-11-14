import pytest

from hyperstim_api.scoring import (
    FEATURES,
    build_pools,
    composite,
    feature_percentiles,
    percentile_rank,
)


def test_percentile_rank_spans_0_to_100() -> None:
    pool = [1.0, 2.0, 3.0, 4.0, 5.0]
    assert percentile_rank(1.0, pool) == 0.0
    assert percentile_rank(3.0, pool) == 50.0
    assert percentile_rank(5.0, pool) == 100.0


def test_percentile_rank_ties_count_as_at_or_below() -> None:
    assert percentile_rank(2.0, [1.0, 2.0, 2.0, 3.0]) == pytest.approx(200 / 3)


def test_percentile_rank_outside_the_pool_is_clamped() -> None:
    assert percentile_rank(-5.0, [1.0, 2.0]) == 0.0
    assert percentile_rank(9.0, [1.0, 2.0]) == 100.0


def test_percentile_rank_small_pools() -> None:
    assert percentile_rank(1.0, []) is None
    assert percentile_rank(1.0, [7.0]) == 50.0


def test_composite_is_the_mean_of_feature_percentiles() -> None:
    low = dict.fromkeys(FEATURES, 0.0)
    high = dict.fromkeys(FEATURES, 1.0)
    mixed = {name: float(i % 2) for i, name in enumerate(FEATURES)}
    pools = build_pools([low, high, mixed])
    # Half the features have the pool [0, 0, 1], where mixed's 0 sits at 50; the other
    # half [0, 1, 1], where its 1 sits at 100.
    assert composite(high, pools) == 100.0
    assert composite(low, pools) == 25.0
    assert composite(mixed, pools) == pytest.approx((6 * 50 + 6 * 100) / 12)


def test_composite_skips_missing_features() -> None:
    pools = build_pools([{"lufs": 1.0}, {"lufs": 2.0}, {"lufs": 3.0}])
    assert composite({"lufs": 3.0, "motion_frac": None}, pools) == 100.0
    assert composite({"motion_frac": None}, pools) is None


def test_feature_percentiles_per_feature() -> None:
    pools = build_pools([{"lufs": 1.0}, {"lufs": 2.0}, {"lufs": 3.0}])
    percentiles = feature_percentiles({"lufs": 2.0, "motion_frac": None}, pools)
    assert list(percentiles) == list(FEATURES)
    assert percentiles["lufs"] == 50.0
    assert percentiles["motion_frac"] is None
    assert percentiles["cuts_per_min"] is None  # absent counts as missing
