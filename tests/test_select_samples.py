"""Tests for the select_samples Python operator."""

from __init__ import SelectSamples


def test_empty_ids_calls_clear_view(quickstart, fake_ctx_factory):
    op = SelectSamples()
    ctx = fake_ctx_factory(dataset=quickstart, params={"ids": []})
    op.execute(ctx)
    assert ctx.clear_view_calls == 1
    assert ctx.set_view_calls == []


def test_non_empty_ids_calls_set_view(quickstart, fake_ctx_factory):
    ids = quickstart.values("id")[:3]
    op = SelectSamples()
    ctx = fake_ctx_factory(dataset=quickstart, params={"ids": ids})
    op.execute(ctx)
    assert ctx.clear_view_calls == 0
    assert len(ctx.set_view_calls) == 1
    sent_view = ctx.set_view_calls[0]
    assert set(sent_view.values("id")) == set(ids)


def test_stale_ids_silently_dropped(quickstart, fake_ctx_factory):
    op = SelectSamples()
    ctx = fake_ctx_factory(
        dataset=quickstart,
        params={"ids": ["doesnotexist1234567890abcdef"]},
    )
    op.execute(ctx)  # must not raise
    assert ctx.clear_view_calls == 0
    assert len(ctx.set_view_calls) == 1
