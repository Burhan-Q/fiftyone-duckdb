# @Burhan-Q/fo-duckdb

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

The React panel runs SQL queries against an in-browser DuckDB instance
and renders results with [Plotly](https://plotly.com/javascript/).

## Analyses

Seven tabs. Each works on any loaded table.

| Tab | Inputs | Output |
|---|---|---|
| **Stats** | 1+ numeric fields | count, mean, std, min, Q1, median, Q3, max |
| **Histogram** | 1 numeric field, bin count, bar/area | distribution chart |
| **Correlation** | 2+ numeric fields | heatmap of pairwise correlation coefficients |
| **Outliers** | 1 numeric field, Z-score / IQR method, threshold | scatter of values with outliers highlighted |
| **Scatter** | 2 numeric (X, Y), optional categorical color | colored scatter plot |
| **Group-by** | 1 numeric + 1 categorical, box / violin / bar(mean) | distribution per category |
| **Missing** | (all columns in active table) | null-count audit |

Switch chart types per analysis where it makes sense — the Group-by tab
lets you flip between box plots, violin plots, and bar-of-mean.

## Installation

```bash
fiftyone plugins download https://github.com/Burhan-Q/fo-duckdb
```

Or symlink/clone the repo into your configured FiftyOne plugins directory.

The plugin loads DuckDB-WASM's worker and WASM binary from the jsDelivr
CDN at runtime, so the local install stays small.

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
