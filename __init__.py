"""fo-duckdb — FiftyOne plugin entry point.

JS-only panel that uses two Python operators to fetch dataset payload
and dispatch chart-to-view selection.
"""

import hashlib
import json

import fiftyone as fo
import fiftyone.operators as foo
import fiftyone.operators.types as types

NUMERIC_TYPES = (fo.IntField, fo.FloatField, fo.BooleanField)
CATEGORICAL_TYPES = (fo.StringField,)
SKIP_TOP_FIELDS = ("_id", "tags", "filepath", "metadata")


def _kind_for(field):
    if isinstance(field, NUMERIC_TYPES):
        return "numeric"
    if isinstance(field, CATEGORICAL_TYPES):
        return "categorical"
    return None


def _list_doc_roots(schema):
    return [
        path for path, field in schema.items()
        if isinstance(field, fo.ListField)
        and isinstance(field.field, fo.EmbeddedDocumentField)
    ]


def _top_level_scalar_fields(schema, list_roots):
    """Top-level scalar fields excluding list-rooted descendants + skip set."""
    list_prefixes = tuple(r + "." for r in list_roots)
    for path, field in schema.items():
        if path.startswith(list_prefixes):
            continue
        if "." in path:
            continue  # nested-but-not-list-rooted (rare; skip for v1)
        if path in SKIP_TOP_FIELDS:
            continue
        kind = _kind_for(field)
        if kind is not None:
            yield path, kind


def _view_stage_hash(view):
    stages = (
        [s._serialize() for s in view._stages]
        if getattr(view, "_stages", None) else []
    )
    payload = json.dumps(stages, sort_keys=True, default=str)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _extract_samples_table(view, fields):
    """Return (data, columns) where data is columnar and columns is
    list of (name, kind)."""
    data = {"id": [str(_id) for _id in view.values("id")]}
    columns = [("id", "categorical")]
    for path, kind in fields:
        if path == "id":
            continue
        try:
            data[path] = view.values(path)
        except Exception:
            continue
        columns.append((path, kind))
    return data, columns


class LoadDatasetPayload(foo.Operator):
    @property
    def config(self):
        return foo.OperatorConfig(
            name="load_dataset_payload",
            label="DuckDB Analytics — load dataset payload",
            description="Extract columnar dataset payload for in-browser SQL analytics",
            unlisted=True,
        )

    def execute(self, ctx):
        if ctx.dataset is None:
            return {
                "tables": {},
                "field_info": {
                    "tables": {},
                    "sample_count": 0,
                    "dataset_name": None,
                    "view_stage_hash": "",
                    "label_bearing_sources": [],
                },
            }
        view = ctx.view if ctx.view is not None else ctx.dataset.view()
        schema = ctx.dataset.get_field_schema(flat=True)
        list_roots = _list_doc_roots(schema)
        top_fields = list(_top_level_scalar_fields(schema, list_roots))

        samples_data, samples_cols = _extract_samples_table(view, top_fields)

        tables = {"samples": samples_data}
        tables_info = {
            "samples": {
                "numeric": [c for c, k in samples_cols if k == "numeric"],
                "categorical": [c for c, k in samples_cols if k == "categorical"],
            }
        }

        return {
            "tables": tables,
            "field_info": {
                "tables": tables_info,
                "sample_count": len(view),
                "dataset_name": ctx.dataset.name,
                "view_stage_hash": _view_stage_hash(view),
                "label_bearing_sources": [],
            },
        }


def register(p):
    p.register(LoadDatasetPayload)
