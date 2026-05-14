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
