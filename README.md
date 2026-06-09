# 🦆 fiftyone-duckdb

In-browser SQL analytics for FiftyOne datasets, powered by
[DuckDB-WASM](https://github.com/duckdb/duckdb-wasm).

Pick a table, pick fields, get an answer in milliseconds. No
notebook switching, no server round-trips for analytics. Every scalar
field in your dataset — including detection-level signals like bbox area,
keypoint counts, prediction confidence — becomes queryable.

## What it does

The plugin discovers every analyzable scalar in the current view:

- **Top-level scalars** (`uniqueness`, `metadata.width`, custom fields, …)
- **One DuckDB table per nested list-of-document root**
  (`ground_truth_detections`, `predictions_classifications`, …) with the
  detection's fields plus exploded `bbox_x/y/w/h/area/cx/cy` and
  `support_start/end/duration` where applicable
- **Per-sample aggregates** on the `samples` table: for every numeric
  leaf of every nested root, `samples` gets `<root>_count`,
  `<root>_<field>_avg`, `<root>_<field>_min`, `<root>_<field>_max`.
  This makes cross-domain correlation a single-table query — no joins.
- **Per-sample label columns**: for every list-of-doc root with a `label`
  field, the `samples` table gets `<root>_top_label` (modal class per
  sample), `<root>_unique_label_count`, and `<root>_label_count_<class>`
  for the top-30 classes (plus `_other` for the tail).
- **Virtual `labels` table** unioning every label-bearing source with a
  `source` discriminator column — makes cross-source comparisons
  (GT vs predicted, multi-model) a one-line `GROUP BY`.

The React panel runs SQL queries against an in-browser DuckDB instance
and renders results with [Plotly](https://plotly.com/javascript/).

**Clicking or lasso-selecting on any chart filters the FiftyOne grid to
the matching samples** — like the embeddings rope-select UX. The View bar's
reset returns to the full dataset.

## Analyses

Eight tabs. The **Classes** tab is label-centric and operates on the
virtual `labels` table by default; the others let you pick any of the
loaded tables.

| Tab | Inputs | Output |
|---|---|---|
| **Classes** | five sub-views (see below) | label-driven charts across one or more sources |
| **Stats** | 1+ numeric fields | count, mean, std, min, Q1, median, Q3, max |
| **Histogram** | 1 numeric field, bin count, bar/area | distribution chart |
| **Correlation** | 2+ numeric fields | heatmap of pairwise correlation coefficients |
| **Outliers** | 1 numeric field, Z-score / IQR method, threshold | scatter of values with outliers highlighted |
| **Scatter** | 2 numeric (X, Y), optional categorical color | colored scatter plot |
| **Group-by** | 1 numeric + 1 categorical, box / violin / bar(mean) | distribution per category |
| **Missing** | (all columns in active table) | null-count audit |

Switch chart types per analysis where it makes sense — the Group-by tab
lets you flip between box plots, violin plots, and bar-of-mean.

### Classes tab sub-views

| View | What it shows |
|---|---|
| **Class Distribution** | bar chart of label counts; filter by one or more sources |
| **GT vs Predicted** | grouped bars per class across two sources — over/under-prediction at a glance |
| **Class Spatial** | 2-D heatmap of bbox centers per chosen class — where in the image each class lives |
| **Confidence per Class** | box plot of confidence per class, sorted by median ascending — model's weakest classes surface first |
| **Co-occurrence** | N×N heatmap showing how often classes appear together in the same sample |

### Interactive selection (chart → grid)

Clicking or lasso-selecting on any chart filters the FiftyOne grid to
the matching samples — no confirmation step, no size cap:

- **Bar charts** (Class Distribution, GT-vs-Pred): click a bar → grid
  filters to samples containing that class.
- **2-D heatmap** (Spatial): box-select a region → grid filters to
  samples whose bbox center falls in the region for that class.
- **Co-occurrence heatmap**: click a cell → grid filters to samples
  containing both classes.
- **Box / violin / bar** (Group-by, Confidence): click a category → grid
  filters to samples in that category.
- **Scatter / Outliers**: lasso a region → grid filters to those rows'
  samples.
- **Histogram**: click a bin → grid filters to samples whose value
  falls in that bin.

The plugin's `on_change_view` handler re-extracts data when the view
changes, so each chart immediately re-renders against the filtered set
— a natural drill-down loop. The View bar's reset returns to the full
dataset.

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

### Using the panel

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

A hybrid panel: Python extracts data and manages lifecycle; the React
component handles DuckDB queries and visualization. See
[`.ref/ARCHITECTURE.md`](./.ref/ARCHITECTURE.md) for the full tour and
[`.ref/LESSONS.md`](./.ref/LESSONS.md) for non-obvious gotchas
(`insertArrowTable` quirks, the JSX-runtime shim, etc.).

## Supported FiftyOne label types

The extraction is dataset-agnostic — anything that is a `ListField` of
an `EmbeddedDocumentField` becomes its own table. Two fixed-shape
numeric leaves are exploded into named columns automatically:

| Leaf | Generated columns |
|---|---|
| `bounding_box` (`[x, y, w, h]`) | `bbox_x`, `bbox_y`, `bbox_w`, `bbox_h`, `bbox_area`, `bbox_cx`, `bbox_cy` |
| `support` (`[start, end]`, temporal) | `support_start`, `support_end`, `support_duration` |

Other variable-length list leaves (`Keypoint.points`,
`Polyline.points`, segmentation masks, attributes, logits) are
silently skipped — they aren't single scalars.

## License

Apache-2.0
