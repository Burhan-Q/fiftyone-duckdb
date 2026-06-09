# SQL syntax — DuckDB Analytics panel

A guide to what you can query in the panel's SQL editor.

The panel reads your FiftyOne dataset and exposes it as a small set of
in-browser SQL tables. You write standard SQL against those tables and
see the result as a chart or table. This document tells you which
tables exist, what columns each one has, and what SQL operations work
against them.

If you are brand new to SQL, the **Quick start** section below covers
the handful of patterns you will use most.

---

## Quick start

The panel ships with templates (top-right "Template" dropdown) — pick
one to see a working example. The shape of every SQL statement looks
like this:

```sql
SELECT <which columns>
FROM   <which table>
WHERE  <which rows to keep>
GROUP BY <which columns to aggregate over>
ORDER BY <sort column>
LIMIT  <max rows>
```

Only `SELECT` and `FROM` are required. Everything else is optional.

**Three patterns you'll use over and over:**

```sql
-- 1. Count rows
SELECT COUNT(*) AS n FROM samples;

-- 2. Group + count (e.g. "how many of each class do I have")
SELECT label, COUNT(*) AS n FROM ground_truth_detections
GROUP BY label ORDER BY n DESC LIMIT 20;

-- 3. Filter + select (e.g. "show only small bboxes")
SELECT sample_id, bbox_w, bbox_h FROM ground_truth_detections
WHERE bbox_w < 0.1 AND bbox_h < 0.1;
```

**Selection tip.** If your query result includes a column called
`sample_id` (or `id`, for the `samples` table), you can click points in
the resulting chart to filter the FiftyOne grid to those samples. If
the result has no such column (because you collapsed it away with a
`GROUP BY`), chart-to-grid selection is disabled — the panel will say
"no sample_id — no selection".

---

## What tables you have

Every dataset gets at least the `samples` table. Additional tables are
created automatically based on the **label-list fields** in your
dataset (Detections, Classifications, etc.). One extra `labels` view
combines all your label-list fields into one virtual table for easy
cross-field comparison.

| Table | What it contains | One row per |
|---|---|---|
| `samples` | Top-level scalar fields of each sample | sample |
| One per label-list field | Detection / Classification / Polyline / Keypoint / TemporalDetection instances | label instance |
| `labels` | Combined view of every label-list field that has a `label` string | label instance |

The exact set of label-list tables depends on your dataset. The next
sections explain how their names are built.

---

## The `samples` table

One row per sample. Always exposes these columns:

| Column | Type | Comes from |
|---|---|---|
| `id` | text | The sample's id |

Plus every other **scalar** field on your dataset (numbers, booleans,
strings). For example, on the standard `quickstart` dataset:

| Column | Type | Comes from |
|---|---|---|
| `id` | text | sample id |
| `uniqueness` | number | the `uniqueness` field added by FiftyOne brains |
| `metadata_size_bytes` | number | `metadata.size_bytes` (file size) |
| `metadata_width` | number | `metadata.width` (image width in pixels) |
| `metadata_height` | number | `metadata.height` (image height) |
| `metadata_num_channels` | number | `metadata.num_channels` |
| `metadata_mime_type` | text | `metadata.mime_type` |

**Field naming**: dotted fields like `metadata.width` become
underscore-joined column names like `metadata_width`. You reference
them in SQL as plain identifiers — no quotes, no dots:

```sql
SELECT metadata_width, metadata_height FROM samples LIMIT 5;
```

**Custom scalar fields** you have added (any number, boolean, or
string field on `dataset.add_sample_field(...)`) will appear here
automatically.

To see exactly what's on YOUR `samples` table, run:

```sql
SELECT * FROM samples LIMIT 1;
```

---

## Label tables (one per label-list field)

If your dataset has a field of type **Detections**, **Classifications**,
**Polylines**, **Keypoints**, or **TemporalDetections**, the panel
creates a dedicated table for it.

**Naming rule.** The table name is your field name plus the inner
list-field name of the label class, joined with an underscore:

`<your_field_name>_<inner_list_field>`

The inner list-field name is fixed per label class — see each section
below.

### Detections — inner list is `detections`

A FiftyOne `Detections` field named `X` produces table `X_detections`.

**Examples:**
- `dataset.ground_truth = fo.Detections(...)` → table `ground_truth_detections`
- `dataset.predictions = fo.Detections(...)` → table `predictions_detections`
- `dataset.model_a = fo.Detections(...)` → table `model_a_detections`

One row per detection. Columns:

| Column | Type | Comes from |
|---|---|---|
| `sample_id` | text | id of the sample that owns this detection |
| `label` | text | `Detection.label` (the class name) |
| `confidence` | number | `Detection.confidence` (often missing for ground truth) |
| `index` | number | `Detection.index` (if set; used for object tracking) |
| `mask_path` | text | `Detection.mask_path` (if set; path to instance mask) |
| `bbox_x` | number | bounding box left edge (0–1, normalized) |
| `bbox_y` | number | bounding box top edge (0–1) |
| `bbox_w` | number | bounding box width (0–1) |
| `bbox_h` | number | bounding box height (0–1) |
| `bbox_area` | number | `bbox_w × bbox_h` (pre-computed) |
| `bbox_cx` | number | bounding box center X (pre-computed) |
| `bbox_cy` | number | bounding box center Y (pre-computed) |

Plus any **custom attributes** you've added to your detections (for
example `Detection(label="cat", quality=0.92)` would add a `quality`
column).

### Classifications — inner list is `classifications`

A FiftyOne `Classifications` field named `X` produces table
`X_classifications`. (For a single `Classification` — not a list —
no table is created; only label-list fields are extracted.)

**Examples:**
- `dataset.scene_tags = fo.Classifications(...)` → table `scene_tags_classifications`
- `dataset.predictions = fo.Classifications(...)` → table `predictions_classifications`

One row per classification. Columns:

| Column | Type | Comes from |
|---|---|---|
| `sample_id` | text | id of the parent sample |
| `label` | text | `Classification.label` |
| `confidence` | number | `Classification.confidence` |

Plus any **custom attributes** on your classifications.

### Polylines — inner list is `polylines`

A FiftyOne `Polylines` field named `X` produces table `X_polylines`.

**Examples:**
- `dataset.lanes = fo.Polylines(...)` → table `lanes_polylines`
- `dataset.regions = fo.Polylines(...)` → table `regions_polylines`

One row per polyline. Columns:

| Column | Type | Comes from |
|---|---|---|
| `sample_id` | text | id of the parent sample |
| `label` | text | `Polyline.label` |
| `confidence` | number | `Polyline.confidence` |
| `index` | number | `Polyline.index` |
| `closed` | number | `1` if closed, `0` if open |
| `filled` | number | `1` if filled, `0` if outline-only |

Plus custom attributes. **Note:** the polyline's `points` (the actual
coordinates) are NOT exposed — they're variable-length nested arrays.
Use FiftyOne's Python API directly if you need the geometry.

### Keypoints — inner list is `keypoints`

A FiftyOne `Keypoints` field named `X` produces table `X_keypoints`.

**Examples:**
- `dataset.pose = fo.Keypoints(...)` → table `pose_keypoints`
- `dataset.landmarks = fo.Keypoints(...)` → table `landmarks_keypoints`

One row per keypoint object (which usually represents one full pose
or one face's landmarks). Columns:

| Column | Type | Comes from |
|---|---|---|
| `sample_id` | text | id of the parent sample |
| `label` | text | `Keypoint.label` |
| `index` | number | `Keypoint.index` |

Plus custom attributes. **Note:** the keypoint `points` array and
per-point `confidence` list are NOT exposed (variable length). The
single-instance `label` and `index` are.

### TemporalDetections — inner list is `detections` (video datasets)

A FiftyOne `TemporalDetections` field named `X` produces table
`X_detections` — same naming pattern as image Detections (because the
inner list field is also named `detections`).

**Examples:**
- `dataset.actions = fo.TemporalDetections(...)` → table `actions_detections`
- `dataset.events = fo.TemporalDetections(...)` → table `events_detections`

One row per temporal segment. Columns:

| Column | Type | Comes from |
|---|---|---|
| `sample_id` | text | id of the parent video sample |
| `label` | text | `TemporalDetection.label` |
| `confidence` | number | `TemporalDetection.confidence` |
| `support_start` | number | start frame (inclusive) |
| `support_end` | number | end frame (inclusive) |

Plus custom attributes.

---

## The `labels` view

For convenience, the panel creates a virtual table named `labels` that
combines **every label-list table that has a `label` column** into one
shape with a `source` discriminator. Useful for cross-field analysis
(e.g. "ground truth vs. predictions per class").

| Column | Type | Notes |
|---|---|---|
| `sample_id` | text | id of the parent sample |
| `source` | text | name of the contributing table (e.g. `'ground_truth_detections'`) |
| `label` | text | the class name |
| `confidence` | number / NULL | NULL when the contributing table doesn't have confidence |
| `bbox_x` | number / NULL | NULL when the contributing table isn't detection-shaped |
| `bbox_y`, `bbox_w`, `bbox_h` | number / NULL | same |
| `bbox_area`, `bbox_cx`, `bbox_cy` | number / NULL | same |

To restrict to a particular label-list field:

```sql
SELECT label, COUNT(*) FROM labels
WHERE source = 'ground_truth_detections'
GROUP BY label;
```

---

## SQL you can write

The DuckDB engine running in your browser supports a broad SQL
dialect. Everything below has been tested in the templates that ship
with the panel.

### Filtering (`WHERE`)

```sql
WHERE label = 'person'                       -- equality (string)
WHERE confidence > 0.5                       -- comparison
WHERE bbox_area BETWEEN 0.01 AND 0.1         -- range
WHERE label IN ('cat', 'dog', 'bird')        -- set membership
WHERE label LIKE 'car%'                      -- pattern match (case-sensitive)
WHERE label ILIKE 'car%'                     -- pattern match (case-insensitive)
WHERE confidence IS NOT NULL                 -- exclude missing values
WHERE NOT (label = 'background')             -- negate
```

Combine with `AND` / `OR` and parentheses:

```sql
WHERE source = 'predictions_detections'
  AND (confidence < 0.3 OR confidence IS NULL)
```

### Aggregating (`GROUP BY`)

```sql
SELECT label, COUNT(*) AS n,
       AVG(confidence) AS mean_conf,
       MIN(bbox_area) AS smallest,
       MAX(bbox_area) AS largest,
       MEDIAN(bbox_area) AS median_area,
       STDDEV(bbox_area) AS area_spread
FROM   ground_truth_detections
GROUP BY label
HAVING COUNT(*) > 5
ORDER BY n DESC
LIMIT 20;
```

Other available aggregates: `SUM`, `COUNT(DISTINCT col)`,
`QUANTILE_CONT(col, 0.75)` (for arbitrary percentiles),
`CORR(col_a, col_b)`, `STRING_AGG(col)` (concatenates values).

### Combining tables (`JOIN`)

A `JOIN` links each row in one table to matching rows in another. The
panel's nested tables all carry a `sample_id` you can join on:

```sql
SELECT s.id, s.uniqueness, COUNT(g.label) AS n_detections
FROM   samples s
LEFT JOIN ground_truth_detections g ON s.id = g.sample_id
GROUP BY s.id, s.uniqueness;
```

- `INNER JOIN` (or just `JOIN`) — keep only matched rows.
- `LEFT JOIN` — keep all rows from the left table, even if no match.
- `RIGHT JOIN`, `FULL JOIN` — analogous.
- Shorthand: `JOIN x USING (sample_id)` is the same as
  `JOIN x ON main.sample_id = x.sample_id`.

### Reusable sub-queries (`WITH`)

A "common table expression" gives a sub-query a name so you can refer
to it later:

```sql
WITH top10 AS (
  SELECT label FROM labels
  GROUP BY label ORDER BY COUNT(*) DESC LIMIT 10
)
SELECT * FROM labels
WHERE label IN (SELECT label FROM top10);
```

You can chain multiple CTEs separated by commas.

### Useful expressions

```sql
COALESCE(confidence, 0)                       -- replace NULL with 0
NULLIF(denominator, 0)                        -- avoid divide-by-zero
CASE WHEN confidence > 0.8 THEN 'high'
     WHEN confidence > 0.4 THEN 'medium'
     ELSE 'low' END                           -- discrete bins
FLOOR(bbox_area * 10)                         -- round down
ABS(bbox_cx - 0.5)                            -- distance from image center
LEAST(a, b), GREATEST(a, b)                   -- min/max of expressions
CAST(my_int AS DOUBLE)                        -- type cast
my_count::INT                                 -- shorthand cast
```

---

## Common recipes

### Count detections per class
```sql
SELECT label, COUNT(*) AS n
FROM   ground_truth_detections
GROUP BY label
ORDER BY n DESC LIMIT 20;
```

### Compare ground truth vs. predictions
```sql
SELECT label, source, COUNT(*) AS n
FROM   labels
WHERE  source IN ('ground_truth_detections', 'predictions_detections')
GROUP BY label, source
ORDER BY label, source;
```

### Find samples with the smallest bounding boxes
```sql
SELECT sample_id, label, bbox_area
FROM   ground_truth_detections
ORDER BY bbox_area ASC
LIMIT 50;
```

### Low-confidence predictions
```sql
SELECT sample_id, label, confidence
FROM   predictions_detections
WHERE  confidence < 0.3
ORDER BY confidence ASC;
```

### Correlation between two scalar fields
```sql
SELECT CORR(uniqueness, metadata_width) AS corr_uw,
       CORR(uniqueness, metadata_height) AS corr_uh
FROM   samples;
```

### Samples that have at least one detection of a given class
```sql
SELECT DISTINCT sample_id
FROM   ground_truth_detections
WHERE  label = 'cat';
```

### Histogram (bucketed counts) of a scalar field
```sql
WITH bounds AS (
  SELECT MIN(uniqueness) AS lo, MAX(uniqueness) AS hi FROM samples
),
bucketed AS (
  SELECT LEAST(
           CAST(FLOOR((uniqueness - lo) / NULLIF(hi - lo, 0) * 20) AS INT),
           19
         ) AS bucket,
         lo + (CAST(FLOOR((uniqueness - lo) / NULLIF(hi - lo, 0) * 20) + 0.5 AS DOUBLE))
           * ((hi - lo) / 20.0) AS bin_center
  FROM samples, bounds
  WHERE uniqueness IS NOT NULL
)
SELECT bin_center, COUNT(*) AS count
FROM   bucketed
GROUP BY bucket, bin_center
ORDER BY bucket;
```

(Histograms need the manual bucketing pattern because the underlying
engine doesn't have a built-in `WIDTH_BUCKET`.)

---

## What's not exposed

The panel does not surface every part of a FiftyOne dataset — it
focuses on scalar values that fit cleanly into SQL tables. The
following are deliberately omitted:

- **Segmentation masks** — `Segmentation` labels are stored as 2D
  arrays (or paths to mask files), not as per-pixel rows. They can't
  be efficiently queried as SQL.
- **Heatmaps** — same as above (2D arrays).
- **Embedding vectors and logits** — the `logits` field on
  `Classification` and embedding vectors anywhere on samples are
  skipped (variable-length numeric arrays).
- **Polyline points** and **Keypoint points** — the actual `(x, y)`
  coordinates inside `Polyline` and `Keypoint` are skipped (variable
  length per instance).
- **The `tags` field** on samples — string list; would need its own
  helper table to be SQL-shaped.
- **The `filepath` field** — string; intentionally hidden because
  it's long and rarely useful for analytics.
- **Timestamp fields** like `created_at` and `last_modified_at` —
  DuckDB-WASM in this build doesn't ergonomically expose them yet.
- **Custom attributes whose types aren't scalar** — only int, float,
  boolean, and string custom attributes appear as columns. Dict /
  list / embedded-doc custom attributes are skipped.

If you need any of these, use the FiftyOne Python API alongside this
panel — the panel is a complement to it, not a replacement.

---

## Quirks worth knowing

1. **`WIDTH_BUCKET` is not available.** Use the manual `FLOOR` pattern
   shown in the histogram recipe above.

2. **Column names with dots are flattened to underscores.** Write
   `metadata_width`, not `metadata.width` or `"metadata.width"`.

3. **String literals use single quotes.** Double quotes are for
   identifiers (column or table names). To put a literal apostrophe in
   a string, double it: `WHERE label = 'driver''s seat'`.

4. **`COUNT(*)` returns a very large integer type.** This usually
   doesn't matter to you — the result is converted to a normal number
   before the chart sees it — but if you want a smaller, cleaner type
   in the result table, add `::INT`:
   ```sql
   SELECT COUNT(*)::INT AS n FROM samples;
   ```

5. **The `labels` view has `NULL` in its bbox columns for non-detection
   contributors.** Filter to detection-style rows with
   `WHERE bbox_cx IS NOT NULL`.

6. **Chart-to-grid selection needs a `sample_id` column.** Aggregating
   queries that group away the id (e.g. `SELECT label, COUNT(*) FROM
   labels GROUP BY label`) cannot drive a grid filter. If you want
   click-to-filter, keep `sample_id` in your `SELECT` — for example by
   adding `STRING_AGG(sample_id, ',') AS sample_ids` as a column.

7. **The panel loads your dataset once.** If you change the dataset's
   view in the FiftyOne app sidebar, a banner will appear inside the
   DuckDB panel saying "View changed — click Refresh data to update."
   The data does not auto-refresh unless you turn the "Auto-refresh"
   toggle to On.
