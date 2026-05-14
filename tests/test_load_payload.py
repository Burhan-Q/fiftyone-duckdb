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
