"""Tests for the load_dataset_payload Python operator."""

from __init__ import LoadDatasetPayload


def test_returns_tables_and_field_info(quickstart, fake_ctx_factory):
    op = LoadDatasetPayload()
    ctx = fake_ctx_factory(dataset=quickstart, view=quickstart.view())
    out = op.execute(ctx)
    assert "tables" in out
    assert "field_info" in out


def test_samples_table_has_id_column(quickstart, fake_ctx_factory):
    op = LoadDatasetPayload()
    ctx = fake_ctx_factory(dataset=quickstart, view=quickstart.view())
    out = op.execute(ctx)
    samples = out["tables"]["samples"]
    assert "id" in samples
    assert len(samples["id"]) == len(quickstart)


def test_field_info_lists_numeric_and_categorical(quickstart, fake_ctx_factory):
    op = LoadDatasetPayload()
    ctx = fake_ctx_factory(dataset=quickstart, view=quickstart.view())
    out = op.execute(ctx)
    samples_info = out["field_info"]["tables"]["samples"]
    assert isinstance(samples_info["numeric"], list)
    assert isinstance(samples_info["categorical"], list)
    assert "uniqueness" in samples_info["numeric"]


def test_metadata_columns_flattened(quickstart, fake_ctx_factory):
    """metadata.* leaves are flattened to metadata_<leaf> on the samples table."""
    op = LoadDatasetPayload()
    ctx = fake_ctx_factory(dataset=quickstart, view=quickstart.view())
    out = op.execute(ctx)
    samples = out["tables"]["samples"]
    info = out["field_info"]["tables"]["samples"]
    assert "metadata_width" in samples
    assert "metadata_height" in samples
    assert "metadata_width" in info["numeric"]
    assert "metadata_height" in info["numeric"]
    # Dotted name must NOT appear (we flattened it)
    assert "metadata.width" not in samples


def test_ground_truth_detections_table_present(quickstart, fake_ctx_factory):
    op = LoadDatasetPayload()
    ctx = fake_ctx_factory(dataset=quickstart, view=quickstart.view())
    out = op.execute(ctx)
    assert "ground_truth_detections" in out["tables"]
    gt = out["tables"]["ground_truth_detections"]
    assert "sample_id" in gt
    assert "label" in gt
    assert "bbox_x" in gt
    assert "bbox_y" in gt
    assert "bbox_w" in gt
    assert "bbox_h" in gt
    assert "bbox_area" in gt
    assert "bbox_cx" in gt
    assert "bbox_cy" in gt


def test_nested_table_row_count_positive(quickstart, fake_ctx_factory):
    op = LoadDatasetPayload()
    ctx = fake_ctx_factory(dataset=quickstart, view=quickstart.view())
    out = op.execute(ctx)
    gt = out["tables"]["ground_truth_detections"]
    assert len(gt["sample_id"]) > 0
    assert len(gt["bbox_x"]) == len(gt["sample_id"])
    assert len(gt["label"]) == len(gt["sample_id"])


def test_label_bearing_sources_populated(quickstart, fake_ctx_factory):
    op = LoadDatasetPayload()
    ctx = fake_ctx_factory(dataset=quickstart, view=quickstart.view())
    out = op.execute(ctx)
    sources = out["field_info"]["label_bearing_sources"]
    assert "ground_truth_detections" in sources
    assert "predictions_detections" in sources


def test_view_stage_hash_stable_for_same_view(quickstart, fake_ctx_factory):
    op = LoadDatasetPayload()
    ctx1 = fake_ctx_factory(dataset=quickstart, view=quickstart.view())
    ctx2 = fake_ctx_factory(dataset=quickstart, view=quickstart.view())
    h1 = op.execute(ctx1)["field_info"]["view_stage_hash"]
    h2 = op.execute(ctx2)["field_info"]["view_stage_hash"]
    assert h1 == h2


def test_view_stage_hash_changes_on_filter(quickstart, fake_ctx_factory):
    op = LoadDatasetPayload()
    base = quickstart.view()
    filtered = quickstart.limit(10)
    h_base = op.execute(fake_ctx_factory(quickstart, base))["field_info"][
        "view_stage_hash"
    ]
    h_filt = op.execute(fake_ctx_factory(quickstart, filtered))["field_info"][
        "view_stage_hash"
    ]
    assert h_base != h_filt
