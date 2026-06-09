# 🦆 fiftyone-duckdb

In-browser SQL analytics for FiftyOne datasets, powered by
[DuckDB-WASM](https://github.com/duckdb/duckdb-wasm).

Write SQL against your dataset, see the result as a chart or table, and
click/lasso to filter the FiftyOne grid. No notebook switching, no
server round-trips for analytics — DuckDB runs in the browser via
WASM.

## What it does

On load the plugin walks the current view's schema and ships a
columnar payload to the browser, where DuckDB-WASM ingests it as a
small set of SQL tables:

- **`samples`** — one row per sample, with `id` plus every top-level
  scalar field (`uniqueness`, custom fields, …) and flattened
  `metadata.*` leaves (`metadata_width`, `metadata_size_bytes`, …).
- **One table per `ListField[EmbeddedDocumentField]` root** —
  `ground_truth_detections`, `predictions_classifications`,
  `pose_keypoints`, `actions_detections`, etc. Each row has
  `sample_id` (FK → `samples.id`) plus every scalar leaf of the
  embedded doc (`label`, `confidence`, `index`, …). `bounding_box`
  explodes to `bbox_x/y/w/h` + derived `bbox_area/cx/cy`; `support`
  explodes to `support_start/end`.
- **`labels` view** — `UNION ALL` over every label-bearing nested
  table with a `source` discriminator column, so cross-source
  comparisons (GT vs predicted, multi-model) are a one-line `GROUP BY`.

The React panel runs SQL queries against the in-browser DuckDB
instance and renders results with [Plotly](https://plotly.com/javascript/).

Full SQL reference: [`SYNTAX.md`](./SYNTAX.md).

## Using the panel

One unified surface — no tabs:

- **Template dropdown** — 13 starter queries (sample overview, numeric
  stats, histogram, correlation matrix, Z-score outliers, scatter,
  box-plot group-by, missing-values audit, class distribution,
  GT-vs-predicted, class spatial heatmap, confidence per class, class
  co-occurrence). Picking one fills the SQL editor and pre-selects a
  matching chart type.
- **SQL editor** (CodeMirror, ⌘↵ / Ctrl↵ to run) — edit a template or
  write your own.
- **Chart picker** — 10 render modes: Auto, Table, Bar, Histogram,
  Scatter, Line, Heatmap, 2-D Heatmap, Box plot, Violin. **Auto**
  inspects the result's column types and picks a sensible chart.
  Per-type X / Y / Color binding selectors appear when relevant.
- **Refresh data** — re-runs the Python extractor.
- **Auto-refresh toggle** — when on, the panel re-extracts automatically
  whenever the FiftyOne view changes. When off, a banner appears if the
  view drifts away from the loaded payload.

### Chart → grid selection

If your query result has a `sample_id` column (nested tables) or `id`
column (`samples` table), clicking or lasso-selecting on the chart
filters the FiftyOne grid to those samples — same UX as the
embeddings panel's rope-select. The status badge above the chart says
either `select → filter grid` or `no sample_id — no selection`.

The **Clear selection** button (visible when selection is enabled)
resets the grid back to the underlying view. Selection writes to the
`extendedSelection` recoil atom, so it composes with — rather than
replaces — any existing view-bar filters.

## Installation

Install the plugin straight from GitHub with the FiftyOne CLI:

```bash
fiftyone plugins download https://github.com/Burhan-Q/fiftyone-duckdb
```

This downloads the plugin into your configured FiftyOne plugins directory
(`~/fiftyone/__plugins__` by default, or whatever `FIFTYONE_PLUGINS_DIR`
points to).

Verify it's registered:

```bash
fiftyone plugins list
# Expect to see: @Burhan-Q/fo-duckdb        (enabled)
```

If it shows up as disabled, enable it:

```bash
fiftyone plugins enable @Burhan-Q/fo-duckdb
```

### Manual install (alternative)

If you prefer to clone or symlink the repo yourself:

```bash
git clone https://github.com/Burhan-Q/fiftyone-duckdb \
    "$(fiftyone config plugins_dir)/@Burhan-Q/fo-duckdb"
```

The directory name on disk must match the plugin name declared in
`fiftyone.yml` (`@Burhan-Q/fo-duckdb`).

### First launch

Launch the FiftyOne App against any dataset, open a new panel (the `+`
tab in the workspace), and pick **DuckDB Analytics**.

```python
import fiftyone as fo
import fiftyone.zoo as foz

dataset = foz.load_zoo_dataset("quickstart")
fo.launch_app(dataset)
```

The plugin loads DuckDB-WASM's worker and WASM binary from the jsDelivr
CDN at runtime, so the local install stays small. No Python dependencies
beyond FiftyOne itself.

### Updating

```bash
fiftyone plugins download https://github.com/Burhan-Q/fiftyone-duckdb --overwrite
```

## Development

```bash
npm install
npm run build      # builds dist/index.umd.js (~2.5 MB / 730 KB gz)
# OR: npm run dev  # watch mode
```

The build:
- Externalizes `react`, `recoil`, all `@fiftyone/*` packages, and
  `@mui/material` — these are provided by the FiftyOne App at runtime.
- Bundles DuckDB-WASM JS, apache-arrow, react-plotly, plotly.js-cartesian,
  and `@voxel51/voodo` (with its CSS inlined into the UMD).
- Aliases `react/jsx-runtime` to a shim so VOODO's automatic JSX
  imports resolve against the classic `React` global.

## Architecture

JS-only React panel + two Python operators
(`load_dataset_payload`, `select_samples`). The panel owns its own
lifecycle — no `foo.Panel` hybrid, no Python-side `on_change_view`
handler. See [`.ref/ARCHITECTURE.md`](./.ref/ARCHITECTURE.md) for the
full tour and [`.ref/LESSONS.md`](./.ref/LESSONS.md) for non-obvious
gotchas (`insertArrowFromIPCStream` quirks, the JSX-runtime shim,
Plotly bundle selection, etc.).

## Supported FiftyOne label types

The extraction is dataset-agnostic — anything that is a `ListField` of
an `EmbeddedDocumentField` becomes its own table. Two fixed-shape
numeric leaves are exploded into named columns automatically:

| Leaf | Generated columns |
|---|---|
| `bounding_box` (`[x, y, w, h]`) | `bbox_x`, `bbox_y`, `bbox_w`, `bbox_h`, `bbox_area`, `bbox_cx`, `bbox_cy` |
| `support` (`[start, end]`, temporal) | `support_start`, `support_end` |

Other variable-length list leaves (`Keypoint.points`,
`Polyline.points`, segmentation masks, attributes, logits) are
silently skipped — they aren't single scalars.

## License

Apache-2.0
