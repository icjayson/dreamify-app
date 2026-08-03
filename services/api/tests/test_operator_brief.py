"""Unit tests for the deterministic Operator Brief core (no AWS, no LLM)."""

from app.services import operator_brief


def test_extract_snapshot_falls_back_to_counts_without_asset():
    snap = operator_brief.extract_snapshot(asset=None, row_count=120, column_count=8)
    assert snap == {"__rows__": 120.0, "__cols__": 8.0}


def test_extract_snapshot_falls_back_when_asset_has_no_s3_keys():
    snap = operator_brief.extract_snapshot(
        asset={"asset_id": "a1"}, row_count=50, column_count=4
    )
    assert snap == {"__rows__": 50.0, "__cols__": 4.0}


def test_detect_changes_ignores_small_and_housekeeping_moves():
    prev = {"revenue": 1000.0, "spend": 100.0, "__rows__": 10.0}
    curr = {"revenue": 1080.0, "spend": 100.0, "__rows__": 999.0}  # +8% rev, flat spend
    changes = operator_brief.detect_changes(prev, curr)
    assert changes == []  # 8% is below the 15% floor; __rows__ is skipped


def test_detect_changes_ranks_biggest_mover_first():
    prev = {"revenue": 1000.0, "spend": 100.0}
    curr = {"revenue": 780.0, "spend": 160.0}  # -22% revenue, +60% spend
    changes = operator_brief.detect_changes(prev, curr)
    metrics = [c.metric for c in changes]
    assert metrics[0] == "spend"  # |+60%| > |-22%|
    assert "revenue" in metrics
    spend = next(c for c in changes if c.metric == "spend")
    assert spend.direction == "up"
    assert spend.severity == "alert"  # >= 40%


def test_detect_changes_handles_new_metric_without_baseline():
    changes = operator_brief.detect_changes({}, {"revenue": 500.0})
    assert changes == []  # no prior value → not a "change"


def test_compose_brief_first_run_is_a_baseline():
    brief = operator_brief.compose_brief("shopify", "My Store", [], is_first_run=True)
    assert "baseline" in brief.headline.lower()
    assert brief.severity == "info"


def test_compose_brief_steady_when_nothing_moved():
    brief = operator_brief.compose_brief("ga4", "Web", [], is_first_run=False)
    assert "steady" in brief.headline.lower()


def test_compose_brief_recommends_reviewing_spend_when_cost_up_revenue_down():
    prev = {"revenue": 1000.0, "ad_spend": 100.0}
    curr = {"revenue": 700.0, "ad_spend": 180.0}  # rev -30%, spend +80%
    changes = operator_brief.detect_changes(prev, curr)
    brief = operator_brief.compose_brief("meta_ads", "Tet Campaign", changes)
    assert brief.severity == "alert"
    assert "spend" in brief.recommendation.lower()
    assert brief.recommendation  # a concrete next action, not empty
    # The rendered text leads with a severity icon and ends with an action arrow.
    text = brief.as_text()
    assert text.startswith("🔴")
    assert "→" in text


def test_compose_brief_flags_inventory_dropping():
    prev = {"inventory_units": 500.0}
    curr = {"inventory_units": 200.0}  # -60%
    changes = operator_brief.detect_changes(prev, curr)
    brief = operator_brief.compose_brief("shopify", "Store", changes)
    assert "reorder" in brief.recommendation.lower()
