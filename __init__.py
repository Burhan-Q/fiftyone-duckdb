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


SKIP_NESTED_LEAVES = ("id", "_id", "tags", "attributes", "mask", "logits")
FIXED_LIST_LEAVES = {
    "bounding_box": ["x", "y", "w", "h"],
    "support": ["start", "end"],
}


def _nested_leaves(schema, root):
    """Yield (leaf_path, kind, base_leaf_name) for a list-of-doc root."""
    prefix = root + "."
    for path, field in schema.items():
        if not path.startswith(prefix):
            continue
        leaf = path[len(prefix):]
        if "." in leaf:
            continue
        if leaf in SKIP_NESTED_LEAVES:
            continue
        if leaf in FIXED_LIST_LEAVES:
            yield path, "fixed_list", leaf
            continue
        kind = _kind_for(field)
        if kind is None:
            continue
        yield path, kind, leaf


def _safe_name(path):
    return path.replace(".", "_")


def _bbox_derived(x, y, w, h):
    """Compute (area, cx, cy) given bbox component lists, with None preserved."""
    n = len(x)
    area = [None] * n
    cx = [None] * n
    cy = [None] * n
    for i in range(n):
        if x[i] is None or y[i] is None or w[i] is None or h[i] is None:
            continue
        area[i] = float(w[i]) * float(h[i])
        cx[i] = float(x[i]) + float(w[i]) / 2.0
        cy[i] = float(y[i]) + float(h[i]) / 2.0
    return area, cx, cy


def _extract_nested_table(view, root, schema, sample_ids):
    """Extract one row per nested doc with sample_id FK + leaf columns."""
    leaves = list(_nested_leaves(schema, root))
    if not leaves:
        return None, []

    counts = view.values(root + ".id")  # list[list[str] | None] — one per sample
    if counts is None:
        return None, []
    counts = [(0 if v is None else len(v)) for v in counts]

    out_sample_id = []
    for sid, c in zip(sample_ids, counts):
        out_sample_id.extend([sid] * c)
    if not out_sample_id:
        return None, []
    data = {"sample_id": out_sample_id}
    columns = [("sample_id", "categorical")]

    for leaf_path, kind, leaf_name in leaves:
        if kind == "fixed_list":
            try:
                per_sample = view.values(leaf_path)
            except Exception:
                continue
            flat = []
            for arr in per_sample or []:
                if arr is None:
                    continue
                flat.extend(arr)
            comps = FIXED_LIST_LEAVES[leaf_name]
            if not flat:
                continue
            for i, comp in enumerate(comps):
                col_name = f"{leaf_name}_{comp}"
                data[col_name] = [
                    (v[i] if v is not None and i < len(v) else None)
                    for v in flat
                ]
                columns.append((col_name, "numeric"))
            if leaf_name == "bounding_box":
                area, cx, cy = _bbox_derived(
                    data["bounding_box_x"],
                    data["bounding_box_y"],
                    data["bounding_box_w"],
                    data["bounding_box_h"],
                )
                for orig, new in (
                    ("bounding_box_x", "bbox_x"),
                    ("bounding_box_y", "bbox_y"),
                    ("bounding_box_w", "bbox_w"),
                    ("bounding_box_h", "bbox_h"),
                ):
                    data[new] = data.pop(orig)
                    columns = [
                        (new, "numeric") if c == orig else (c, k)
                        for c, k in columns
                    ]
                data["bbox_area"] = area
                data["bbox_cx"] = cx
                data["bbox_cy"] = cy
                columns += [
                    ("bbox_area", "numeric"),
                    ("bbox_cx", "numeric"),
                    ("bbox_cy", "numeric"),
                ]
        else:
            try:
                per_sample = view.values(leaf_path)
            except Exception:
                continue
            flat = []
            for arr in per_sample or []:
                if arr is None:
                    continue
                flat.extend(arr)
            data[leaf_name] = flat
            columns.append((leaf_name, kind))
    return data, columns


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

        sample_ids = samples_data["id"]
        tables = {"samples": samples_data}
        tables_info = {
            "samples": {
                "numeric": [c for c, k in samples_cols if k == "numeric"],
                "categorical": [c for c, k in samples_cols if k == "categorical"],
            }
        }
        label_bearing = []
        for root in list_roots:
            data, cols = _extract_nested_table(view, root, schema, sample_ids)
            if not data:
                continue
            tname = _safe_name(root)
            tables[tname] = data
            tables_info[tname] = {
                "numeric": [c for c, k in cols if k == "numeric"],
                "categorical": [c for c, k in cols if k == "categorical"],
            }
            if "label" in data:
                label_bearing.append(tname)

        return {
            "tables": tables,
            "field_info": {
                "tables": tables_info,
                "sample_count": len(view),
                "dataset_name": ctx.dataset.name,
                "view_stage_hash": _view_stage_hash(view),
                "label_bearing_sources": label_bearing,
            },
        }


def register(p):
    p.register(LoadDatasetPayload)
