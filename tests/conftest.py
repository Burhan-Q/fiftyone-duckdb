import os
import sys

import fiftyone as fo
import fiftyone.zoo as foz
import pytest

# Make the plugin root importable as the package under test.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


@pytest.fixture(scope="session")
def quickstart():
    """A 200-sample fiftyone.zoo quickstart dataset shared across tests."""
    name = "redesign_tests_quickstart"
    if fo.dataset_exists(name):
        fo.delete_dataset(name)
    ds = foz.load_zoo_dataset("quickstart", dataset_name=name)
    yield ds
    fo.delete_dataset(name)


class FakeCtx:
    """Minimal stand-in for fiftyone.operators.ExecutionContext.

    Captures ``params``, exposes ``dataset`` / ``view``, and records calls
    to ``ctx.ops.set_view`` / ``ctx.ops.clear_view`` for assertion.
    """

    def __init__(self, dataset, view=None, params=None):
        self.dataset = dataset
        self.view = view
        self.params = params or {}
        self.set_view_calls = []
        self.clear_view_calls = 0
        self.ops = self  # lets `ctx.ops.set_view(...)` resolve to this object

    def set_view(self, view=None, **_):
        self.set_view_calls.append(view)

    def clear_view(self):
        self.clear_view_calls += 1


@pytest.fixture
def fake_ctx_factory():
    return FakeCtx
