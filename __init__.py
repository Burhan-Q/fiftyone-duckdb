"""fo-duckdb — FiftyOne plugin entry point.

Registers the :class:`DuckDBAnalyticsPanel` hybrid panel with FiftyOne. The
Python side discovers all scalar information in the current view — both
top-level fields *and* nested list-of-document fields (e.g. detections,
keypoints, polylines, classifications, temporal detections) — and pushes a
columnar payload to the React component, which loads each into a DuckDB-WASM
table for browser-side SQL analytics.

The extraction is dataset-agnostic: it inspects the schema and processes any
``ListField`` of an ``EmbeddedDocumentField``. Fixed-shape numeric list leaves
(``bounding_box``, ``support``) are exploded into per-component columns; other
list leaves are skipped (they are not single scalars).
"""

import fiftyone as fo
import fiftyone.operators as foo
import fiftyone.operators.types as types

NUMERIC_TYPES = (fo.IntField, fo.FloatField, fo.BooleanField)
CATEGORICAL_TYPES = (fo.StringField,)
SKIP_TOP = ("_id", "tags")  # 'id' kept for joining to nested tables

# Hard cap so a weird schema can't blow up DuckDB or the wire payload.
MAX_COLS_PER_TABLE = 256

# Per-class count columns on the samples table are capped to keep widths sane.
# Top-K classes by global frequency get dedicated columns; the rest roll up
# into a single ``_label_count_other`` column.
TOP_K_LABEL_COLUMNS = 30
LABEL_LEAF_NAME = "label"


def _kind_for(field):
    """Return ``"numeric"`` / ``"categorical"`` / ``None`` for a Field."""
    if isinstance(field, NUMERIC_TYPES):
        return "numeric"
    if isinstance(field, CATEGORICAL_TYPES):
        return "categorical"
    return None


def _safe_name(path):
    """Turn a dotted FiftyOne path into a DuckDB-friendly table name."""
    return path.replace(".", "_")


def _list_doc_roots(schema):
    """Find ListField-of-EmbeddedDocumentField roots — table candidates."""
    return [
        path for path, field in schema.items()
        if isinstance(field, fo.ListField)
        and isinstance(field.field, fo.EmbeddedDocumentField)
    ]


def _label_bearing_roots(schema):
    """List-of-doc roots whose embedded schema has a ``label`` StringField."""
    out = []
    for root in _list_doc_roots(schema):
        leaf = f"{root}.{LABEL_LEAF_NAME}"
        field = schema.get(leaf)
        if isinstance(field, fo.StringField):
            out.append(root)
    return out


def _top_classes_for_root(view_or_dataset, root, k=TOP_K_LABEL_COLUMNS):
    """Return ``(top_k, rest)`` lists of ``(class, count)`` pairs.

    ``top_k`` holds the up-to-``k`` most frequent classes (count-desc, then
    alphabetical for stability); ``rest`` is everything beyond that.
    """
    counts = view_or_dataset.count_values(f"{root}.{LABEL_LEAF_NAME}") or {}
    pairs = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))
    return pairs[:k], pairs[k:]


def _safe_class(name):
    """Slugify a class name to a DuckDB-friendly identifier.

    Lowercases, replaces any non-``[a-z0-9_]`` run with ``_``, and trims
    leading/trailing underscores. Always returns a non-empty string
    (falls back to a hex digest of the input when the slug would be empty,
    e.g. for non-Latin scripts).
    """
    import hashlib
    import re

    s = re.sub(r"[^a-z0-9_]+", "_", str(name).lower()).strip("_")
    if not s:
        s = "c_" + hashlib.md5(str(name).encode("utf-8")).hexdigest()[:8]
    return s


def _build_class_alias_map(classes):
    """Map each original class name → DuckDB-safe slug, disambiguating clashes.

    Iteration is order-preserving so callers can pass an ordered list and
    get stable slugs. When two distinct inputs would slugify to the same
    string, later entries get a numeric suffix (``_1``, ``_2``, ...).
    """
    aliases = {}
    used = set()
    for name in classes:
        base = _safe_class(name)
        slug = base
        i = 1
        while slug in used:
            slug = f"{base}_{i}"
            i += 1
        used.add(slug)
        aliases[name] = slug
    return aliases


def _top_level_scalar_fields(schema, list_roots):
    """Yield ``(path, kind)`` for scalar fields outside any ListField."""
    skip_prefixes = tuple(
        k + "." for k, v in schema.items() if isinstance(v, fo.ListField)
    )
    for path, field in schema.items():
        if path in SKIP_TOP or path == "filepath":
            continue
        if path.startswith(skip_prefixes):
            continue
        kind = _kind_for(field)
        if kind is not None:
            yield path, kind


# Known fixed-shape list leaves we expand into named columns.
_FIXED_LIST_EXPANSIONS = {
    # bounding_box: [x, y, w, h] → x, y, w, h, area, cx, cy
    "bounding_box": {
        "size": 4,
        "components": [
            ("bbox_x", lambda v: v[0]),
            ("bbox_y", lambda v: v[1]),
            ("bbox_w", lambda v: v[2]),
            ("bbox_h", lambda v: v[3]),
            ("bbox_area", lambda v: v[2] * v[3]),
            ("bbox_cx", lambda v: v[0] + v[2] / 2),
            ("bbox_cy", lambda v: v[1] + v[3] / 2),
        ],
    },
    # support: [start_frame, end_frame] → start, end, duration
    "support": {
        "size": 2,
        "components": [
            ("support_start", lambda v: v[0]),
            ("support_end", lambda v: v[1]),
            ("support_duration", lambda v: v[1] - v[0]),
        ],
    },
}


def _nested_leaves(schema, root):
    """Yield ``(leaf_path, leaf_name, kind)`` for direct scalar children.

    ``kind`` is ``"numeric"`` / ``"categorical"`` / ``"fixed_list:<name>"``;
    everything else (mask arrays, attributes dicts, sub-lists, embedded docs)
    is silently skipped.
    """
    prefix = root + "."
    skip_leaves = {"id", "_id", "tags", "attributes", "mask", "logits"}
    for path, field in schema.items():
        if not path.startswith(prefix):
            continue
        leaf = path[len(prefix):]
        if "." in leaf or leaf in skip_leaves:
            continue
        kind = _kind_for(field)
        if kind is not None:
            yield path, leaf, kind
            continue
        if isinstance(field, fo.ListField) and leaf in _FIXED_LIST_EXPANSIONS:
            yield path, leaf, f"fixed_list:{leaf}"


def _expand_fixed_list(leaf, raw):
    """Map a list of fixed-length numeric lists to component columns."""
    spec = _FIXED_LIST_EXPANSIONS[leaf]
    size = spec["size"]
    columns = {col: [] for col, _ in spec["components"]}
    for v in raw:
        ok = (
            v is not None
            and isinstance(v, (list, tuple))
            and len(v) == size
            and all(x is not None for x in v)
        )
        for col, fn in spec["components"]:
            try:
                columns[col].append(fn(v) if ok else None)
            except Exception:
                columns[col].append(None)
    return columns


def _extract_top_table(view, fields, list_roots, schema):
    """Build the ``samples`` table.

    Returns ``(data, columns, label_aliases)`` where ``data`` is the columnar
    dict, ``columns`` is a list of ``(col_name, kind)`` pairs, and
    ``label_aliases`` is ``{root_safe: {original_class: slug}}`` for every
    label-bearing root.

    For each list-of-doc root we additionally synthesize per-sample
    aggregates (``<root>_count``, plus ``<root>_<field>_avg/min/max`` for
    each numeric leaf, and label-specific columns for any root whose
    embedded schema has a ``label`` field) so the samples table is a
    one-stop view that enables cross-domain correlations without explicit
    SQL joins.
    """
    label_roots = set(_label_bearing_roots(schema))
    label_aliases: dict = {}

    data = {"id": view.values("id")}
    columns = [("id", "categorical")]
    for path, kind in fields[:MAX_COLS_PER_TABLE]:
        col = _safe_name(path)
        data[col] = view.values(path)
        columns.append((col, kind))

    for root in list_roots:
        if len(columns) >= MAX_COLS_PER_TABLE:
            break
        per_sample = view.values(root)  # list of (list-or-None) per sample
        counts = [(len(x) if x else 0) for x in per_sample]
        root_safe = _safe_name(root)
        data[f"{root_safe}_count"] = counts
        columns.append((f"{root_safe}_count", "numeric"))

        # Per-sample aggregates of numeric leaves + the synthesized
        # bbox/support components.
        leaves = list(_nested_leaves(schema, root))
        numeric_leaves: list[tuple[str, str]] = []  # (col_name, view_path)
        for path, leaf, kind in leaves:
            if kind == "numeric":
                numeric_leaves.append((leaf, path))
            elif kind.startswith("fixed_list:"):
                spec = _FIXED_LIST_EXPANSIONS[leaf]
                for col, _fn in spec["components"]:
                    numeric_leaves.append((col, path))

        if not numeric_leaves:
            continue

        # We need per-detection values grouped by sample. Easiest: get the
        # raw 2-D values (or 3-D for bbox/support) and aggregate manually.
        for leaf_col, leaf_path in numeric_leaves:
            if len(columns) + 3 > MAX_COLS_PER_TABLE:
                break
            is_bbox = leaf_col.startswith("bbox_")
            is_support = leaf_col.startswith("support_")
            raw_2d = view.values(leaf_path)

            def _per_sample_values(per_sample_raw):
                """Yield (sample_idx, [vals...]) for each sample."""
                for i, x in enumerate(per_sample_raw):
                    if not x:
                        yield i, []
                        continue
                    if is_bbox:
                        spec = _FIXED_LIST_EXPANSIONS["bounding_box"]
                        fn = next(f for c, f in spec["components"] if c == leaf_col)
                        vals = []
                        for v in x:
                            if v is None or len(v) != 4 or any(
                                vv is None for vv in v
                            ):
                                continue
                            try:
                                vals.append(fn(v))
                            except Exception:
                                pass
                        yield i, vals
                    elif is_support:
                        spec = _FIXED_LIST_EXPANSIONS["support"]
                        fn = next(f for c, f in spec["components"] if c == leaf_col)
                        vals = []
                        for v in x:
                            if v is None or len(v) != 2 or any(
                                vv is None for vv in v
                            ):
                                continue
                            try:
                                vals.append(fn(v))
                            except Exception:
                                pass
                        yield i, vals
                    else:
                        vals = [v for v in x if v is not None]
                        yield i, vals

            mins, maxs, avgs = [], [], []
            for _i, vs in _per_sample_values(raw_2d):
                if not vs:
                    mins.append(None); maxs.append(None); avgs.append(None)
                    continue
                mins.append(min(vs))
                maxs.append(max(vs))
                avgs.append(sum(vs) / len(vs))

            prefix = f"{root_safe}_{leaf_col}"
            data[f"{prefix}_avg"] = avgs
            data[f"{prefix}_min"] = mins
            data[f"{prefix}_max"] = maxs
            columns.append((f"{prefix}_avg", "numeric"))
            columns.append((f"{prefix}_min", "numeric"))
            columns.append((f"{prefix}_max", "numeric"))

        # --- Label-driven columns ---
        # Only roots whose embedded schema has a ``label`` StringField. Adds
        # ``<root>_top_label`` (modal class), ``<root>_unique_label_count``,
        # ``<root>_label_count_<class>`` for top-K classes, and
        # ``<root>_label_count_other`` for the tail.
        if root not in label_roots:
            continue
        if len(columns) >= MAX_COLS_PER_TABLE:
            continue

        per_sample_labels = view.values(f"{root}.{LABEL_LEAF_NAME}")
        top_pairs, rest_pairs = _top_classes_for_root(view, root)
        top_classes = [c for c, _ in top_pairs]
        rest_classes_set = {c for c, _ in rest_pairs}

        # Build alias map across both top and tail so the UI can label nicely.
        # Iteration order: top first (most useful), then tail.
        root_safe = _safe_name(root)
        aliases = _build_class_alias_map(top_classes + sorted(rest_classes_set))
        label_aliases[root_safe] = aliases

        modal = []
        unique_count = []
        for ls in per_sample_labels:
            if not ls:
                modal.append(None)
                unique_count.append(0)
                continue
            cnt: dict = {}
            for x in ls:
                if x is None:
                    continue
                cnt[x] = cnt.get(x, 0) + 1
            if not cnt:
                modal.append(None)
                unique_count.append(0)
                continue
            # Tie-break: most frequent, then alphabetical for determinism.
            top = sorted(cnt.items(), key=lambda kv: (-kv[1], kv[0]))[0][0]
            modal.append(top)
            unique_count.append(len(cnt))

        data[f"{root_safe}_top_label"] = modal
        columns.append((f"{root_safe}_top_label", "categorical"))
        data[f"{root_safe}_unique_label_count"] = unique_count
        columns.append((f"{root_safe}_unique_label_count", "numeric"))

        # Per-class count columns
        for cls in top_classes:
            if len(columns) >= MAX_COLS_PER_TABLE:
                break
            slug = aliases[cls]
            col = f"{root_safe}_label_count_{slug}"
            data[col] = [
                sum(1 for x in (ls or []) if x == cls)
                for ls in per_sample_labels
            ]
            columns.append((col, "numeric"))

        # Roll-up column for the tail
        if rest_classes_set and len(columns) < MAX_COLS_PER_TABLE:
            col = f"{root_safe}_label_count_other"
            data[col] = [
                sum(1 for x in (ls or []) if x in rest_classes_set)
                for ls in per_sample_labels
            ]
            columns.append((col, "numeric"))

    return data, columns, label_aliases


def _extract_nested_table(view, root, leaves, sample_ids):
    """Columnar dict for a list-of-doc root.

    Returns ``(data, columns)`` where ``columns`` lists
    ``(col_name, kind)`` for the field_info payload.
    """
    if not leaves:
        return None, []

    # Counts per sample come from any leaf — pick a scalar leaf if possible
    probe_path = next(
        (p for p, _, k in leaves if k in ("numeric", "categorical")),
        leaves[0][0],
    )
    per_sample = view.values(probe_path)  # 2D
    counts = [len(x) if x else 0 for x in per_sample]
    flat_ids = []
    for sid, cnt in zip(sample_ids, counts):
        flat_ids.extend([sid] * cnt)
    if not flat_ids:
        return None, []

    data = {"sample_id": flat_ids}
    columns = [("sample_id", "categorical")]

    for path, leaf, kind in leaves:
        if len(columns) >= MAX_COLS_PER_TABLE:
            break
        if kind.startswith("fixed_list:"):
            # 3D values [sample][detection][component]; flatten one level.
            raw_flat = []
            for per_sample_list in view.values(path):
                if per_sample_list:
                    raw_flat.extend(per_sample_list)
            expanded = _expand_fixed_list(leaf, raw_flat)
            for col, values in expanded.items():
                if len(columns) >= MAX_COLS_PER_TABLE:
                    break
                data[col] = values
                columns.append((col, "numeric"))
        else:
            data[leaf] = view.values(path, unwind=True)
            columns.append((leaf, kind))

    # Defensive length check — every column must match flat_ids length
    expected = len(flat_ids)
    for col, vals in list(data.items()):
        if len(vals) != expected:
            data.pop(col)
            columns = [(c, k) for c, k in columns if c != col]
    return data, columns


class DuckDBAnalyticsPanel(foo.Panel):
    @property
    def config(self):
        return foo.PanelConfig(
            name="duckdb_analytics",
            label="DuckDB Analytics",
            icon="analytics",
            surfaces="grid modal",
            help_markdown=(
                "In-browser SQL analytics over every scalar field in your "
                "dataset — top-level metadata, nested detections, "
                "keypoints, polylines, and more. Powered by DuckDB-WASM."
            ),
        )

    def on_load(self, ctx):
        # on_load fires on first panel-mount of the session and again on
        # page reload. FiftyOne persists global panel state (which is where
        # ``_push_sig`` lives) across page reloads, but the *local* atom
        # carrying the actual ``tables`` / ``field_info`` is session-scoped
        # and resets on reload. So we always invalidate the cached signature
        # on ``on_load`` and push fresh data. The signature cache still
        # short-circuits the tab-switch case (``on_change_view``), which is
        # the source of the visible re-mount thrashing the user reported.
        ctx.panel.set_state("_push_sig", None)
        self._push_data(ctx)

    def on_change_view(self, ctx):
        self._push_data(ctx)

    def on_change_dataset(self, ctx):
        ctx.panel.set_state("_push_sig", None)
        self._push_data(ctx)

    def _push_data(self, ctx):
        if ctx.dataset is None:
            ctx.panel.set_data("tables", {})
            ctx.panel.set_data("field_info", {
                "tables": {},
                "sample_count": 0,
                "dataset_name": None,
                "error": "No dataset loaded",
            })
            ctx.panel.set_state("_push_sig", None)
            return

        # Idempotency guard: FiftyOne fires ``on_load`` (and often
        # ``on_change_view``) on every panel re-mount, e.g. when the user
        # switches sibling panel tabs and returns. Without this guard each
        # re-mount re-runs the (expensive) field extraction below and pushes
        # fresh ``tables`` / ``field_info`` references to the JS atom, which
        # causes ``useDuckDB`` to re-ingest every table and the query effects
        # to re-fire — visible as the chart flashing and multiple
        # ``/operators/execute`` calls in the network panel.
        view = ctx.view if ctx.view is not None else ctx.dataset
        view_stages = (
            [s._serialize() for s in view._stages]
            if getattr(view, "_stages", None)
            else []
        )
        sig = [ctx.dataset.name, view_stages, len(view)]
        if ctx.panel.get_state("_push_sig") == sig:
            return
        ctx.panel.set_state("_push_sig", sig)

        schema = ctx.dataset.get_field_schema(flat=True)
        list_roots = _list_doc_roots(schema)

        # --- samples table ---
        top_fields = list(_top_level_scalar_fields(schema, list_roots))
        samples_data, samples_cols, label_aliases = _extract_top_table(
            view, top_fields, list_roots, schema
        )
        tables = {"samples": samples_data}
        tables_info = {
            "samples": {
                "numeric": [c for c, k in samples_cols if k == "numeric"],
                "categorical": [c for c, k in samples_cols if k == "categorical"],
            }
        }

        # --- nested tables ---
        sample_ids = samples_data["id"]
        for root in list_roots:
            leaves = list(_nested_leaves(schema, root))
            if not leaves:
                continue
            data, cols = _extract_nested_table(view, root, leaves, sample_ids)
            if not data:
                continue
            tname = _safe_name(root)
            tables[tname] = data
            tables_info[tname] = {
                "numeric": [c for c, k in cols if k == "numeric"],
                "categorical": [c for c, k in cols if k == "categorical"],
            }

        # --- virtual labels table (Phase 3) ---
        # UNION of every label-bearing nested table with a ``source``
        # discriminator. Sources that don't carry a particular column
        # (e.g. classifications have no bbox) emit NULL for it. Lets the
        # frontend express GT-vs-pred and other cross-source questions
        # as one-line GROUP BYs without manual joins.
        label_roots = _label_bearing_roots(schema)
        label_bearing_sources: list = []
        labels_data = {
            "sample_id": [], "source": [], "label": [],
            "confidence": [],
            "bbox_x": [], "bbox_y": [], "bbox_w": [], "bbox_h": [],
            "bbox_area": [], "bbox_cx": [], "bbox_cy": [],
        }
        for root in label_roots:
            src = _safe_name(root)
            t = tables.get(src)
            if not t or not t.get("sample_id"):
                continue
            n = len(t["sample_id"])
            labels_bearing_label_col = t.get("label", [None] * n)
            labels_data["sample_id"].extend(t["sample_id"])
            labels_data["source"].extend([src] * n)
            labels_data["label"].extend(labels_bearing_label_col)
            for col in ("confidence",
                        "bbox_x", "bbox_y", "bbox_w", "bbox_h",
                        "bbox_area", "bbox_cx", "bbox_cy"):
                labels_data[col].extend(t.get(col, [None] * n))
            label_bearing_sources.append(src)

        if labels_data["sample_id"]:
            tables["labels"] = labels_data
            tables_info["labels"] = {
                "numeric": ["confidence",
                            "bbox_x", "bbox_y", "bbox_w", "bbox_h",
                            "bbox_area", "bbox_cx", "bbox_cy"],
                "categorical": ["sample_id", "source", "label"],
            }

        ctx.panel.set_data("tables", tables)
        ctx.panel.set_data("field_info", {
            "tables": tables_info,
            "sample_count": len(view),
            "dataset_name": ctx.dataset.name,
            "label_class_aliases": label_aliases,
            "label_bearing_sources": label_bearing_sources,
        })

    def select_samples(self, ctx):
        """Filter the FiftyOne App's grid to the given sample ids.

        Called by the React panel when a chart-selection gesture resolves to
        a list of sample ids. Empty list clears any active view.
        """
        ids = ctx.params.get("ids") or []
        if not ids:
            ctx.ops.clear_view()
            return
        view = ctx.dataset.select(ids, ordered=False)
        ctx.ops.set_view(view=view)

    def render(self, ctx):
        panel = types.Object()
        return types.Property(
            panel,
            view=types.View(
                component="DuckDBAnalyticsView",
                composite_view=True,
                select_samples=self.select_samples,
            ),
        )


def register(p):
    p.register(DuckDBAnalyticsPanel)
