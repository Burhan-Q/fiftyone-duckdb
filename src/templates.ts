import type { Template } from "./types";

export const TEMPLATES: Template[] = [
  {
    id: "samples-overview",
    label: "Sample overview",
    description: "First 100 rows of the samples table.",
    sql: "SELECT * FROM samples LIMIT 100",
    chart: { type: "table", x: "" },
  },
  {
    id: "numeric-stats",
    label: "Numeric stats: uniqueness",
    description: "Count, mean, stddev, min/max, quartiles for `uniqueness`.",
    sql:
      "SELECT 'uniqueness' AS field,\n" +
      "       COUNT(uniqueness)::INT AS n,\n" +
      "       AVG(uniqueness) AS mean,\n" +
      "       STDDEV(uniqueness) AS std,\n" +
      "       MIN(uniqueness) AS min,\n" +
      "       QUANTILE_CONT(uniqueness, 0.25) AS q1,\n" +
      "       MEDIAN(uniqueness) AS median,\n" +
      "       QUANTILE_CONT(uniqueness, 0.75) AS q3,\n" +
      "       MAX(uniqueness) AS max\n" +
      "FROM samples",
    chart: { type: "table", x: "" },
  },
  {
    id: "histogram",
    label: "Histogram: uniqueness (20 bins)",
    description: "Buckets a numeric field into 20 bins.",
    sql:
      "WITH bounds AS (\n" +
      "  SELECT MIN(uniqueness) AS lo, MAX(uniqueness) AS hi FROM samples\n" +
      "),\n" +
      "bucketed AS (\n" +
      "  SELECT LEAST(CAST(FLOOR((uniqueness - lo) / NULLIF(hi - lo, 0) * 20) AS INT), 19) AS bucket,\n" +
      "         lo + (CAST(FLOOR((uniqueness - lo) / NULLIF(hi - lo, 0) * 20) + 0.5 AS DOUBLE)) * ((hi - lo) / 20.0) AS bin_center\n" +
      "  FROM samples, bounds\n" +
      "  WHERE uniqueness IS NOT NULL\n" +
      ")\n" +
      "SELECT bin_center, COUNT(*)::INT AS count\n" +
      "FROM bucketed GROUP BY bucket, bin_center ORDER BY bucket",
    chart: { type: "bar", x: "bin_center", y: "count" },
  },
  {
    id: "correlation-matrix",
    label: "Correlation matrix: numeric samples columns",
    description: "Pairwise CORR() between a couple of numeric fields.",
    sql:
      "SELECT 'uniqueness' AS a, 'uniqueness' AS b, CORR(uniqueness, uniqueness) AS corr FROM samples\n" +
      "UNION ALL SELECT 'uniqueness', 'metadata_width', CORR(uniqueness, metadata_width) FROM samples\n" +
      "UNION ALL SELECT 'metadata_width', 'uniqueness', CORR(metadata_width, uniqueness) FROM samples\n" +
      "UNION ALL SELECT 'metadata_width', 'metadata_width', CORR(metadata_width, metadata_width) FROM samples",
    chart: { type: "heatmap", x: "a", y: "b" },
  },
  {
    id: "outliers-z",
    label: "Z-score outliers: uniqueness",
    description: "Rows whose |z| > 2 on a chosen numeric field.",
    sql:
      "WITH stats AS (SELECT AVG(uniqueness) AS m, STDDEV(uniqueness) AS s FROM samples)\n" +
      "SELECT id AS sample_id, uniqueness AS value, (uniqueness - m) / NULLIF(s, 0) AS z\n" +
      "FROM samples, stats\n" +
      "WHERE ABS((uniqueness - m) / NULLIF(s, 0)) > 2\n" +
      "ORDER BY ABS((uniqueness - m) / NULLIF(s, 0)) DESC",
    chart: { type: "scatter", x: "value", y: "z" },
  },
  {
    id: "scatter-2d",
    label: "Scatter: bbox_w vs bbox_h",
    description: "Detection bbox width vs height with color by label.",
    sql:
      "SELECT sample_id, bbox_w, bbox_h, label\n" +
      "FROM ground_truth_detections\n" +
      "WHERE bbox_w IS NOT NULL AND bbox_h IS NOT NULL\n" +
      "LIMIT 5000",
    chart: { type: "scatter", x: "bbox_w", y: "bbox_h", color: "label" },
  },
  {
    id: "groupby-box",
    label: "Box plot: bbox_area by class (top 10)",
    description: "Distribution of bbox area per class for the top-10 classes.",
    sql:
      "WITH top10 AS (\n" +
      "  SELECT label FROM ground_truth_detections\n" +
      "  WHERE label IS NOT NULL GROUP BY label ORDER BY COUNT(*) DESC LIMIT 10\n" +
      ")\n" +
      "SELECT sample_id, label, bbox_area\n" +
      "FROM ground_truth_detections WHERE label IN (SELECT label FROM top10) AND bbox_area IS NOT NULL",
    chart: { type: "box", x: "label", y: "bbox_area" },
  },
  {
    id: "missing-values",
    label: "Missing values (samples)",
    description: "Per-column null count and percent on the samples table.",
    sql:
      "SELECT 'uniqueness' AS field,\n" +
      "       COUNT(*) - COUNT(uniqueness) AS null_count,\n" +
      "       100.0 * (COUNT(*) - COUNT(uniqueness)) / COUNT(*) AS null_pct\n" +
      "FROM samples",
    chart: { type: "table", x: "" },
  },
  {
    id: "class-distribution",
    label: "Class distribution (labels)",
    description: "Top-N classes by count across all label-bearing sources.",
    sql:
      "SELECT label, COUNT(*)::INT AS n\n" +
      "FROM labels WHERE label IS NOT NULL\n" +
      "GROUP BY label ORDER BY n DESC LIMIT 20",
    chart: { type: "bar", x: "label", y: "n" },
  },
  {
    id: "gt-vs-pred",
    label: "GT vs predicted class counts",
    description: "Side-by-side class counts from ground truth and predictions.",
    sql:
      "WITH agg AS (\n" +
      "  SELECT label, source, COUNT(*)::INT AS n\n" +
      "  FROM labels WHERE source IN ('ground_truth_detections', 'predictions_detections')\n" +
      "  GROUP BY label, source\n" +
      "),\n" +
      "totals AS (SELECT label, SUM(n)::INT AS total FROM agg GROUP BY label ORDER BY total DESC LIMIT 15)\n" +
      "SELECT a.label, a.source, a.n FROM agg a JOIN totals t USING (label)\n" +
      "ORDER BY t.total DESC, a.label, a.source",
    chart: { type: "bar", x: "label", y: "n", color: "source" },
  },
  {
    id: "class-spatial",
    label: "Class spatial: bbox centers",
    description: "2-D density of bbox centers for a single class.",
    sql:
      "SELECT sample_id, bbox_cx, bbox_cy\n" +
      "FROM labels\n" +
      "WHERE source = 'ground_truth_detections' AND label = 'person'\n" +
      "  AND bbox_cx IS NOT NULL",
    chart: { type: "heatmap2d", x: "bbox_cx", y: "bbox_cy" },
  },
  {
    id: "confidence-per-class",
    label: "Confidence per class",
    description: "Box plot of confidence per class (top 10) for predictions.",
    sql:
      "WITH top10 AS (\n" +
      "  SELECT label FROM labels WHERE source = 'predictions_detections' AND confidence IS NOT NULL\n" +
      "  GROUP BY label ORDER BY COUNT(*) DESC LIMIT 10\n" +
      ")\n" +
      "SELECT sample_id, label, confidence FROM labels\n" +
      "WHERE source = 'predictions_detections' AND label IN (SELECT label FROM top10)",
    chart: { type: "box", x: "label", y: "confidence" },
  },
  {
    id: "class-cooccurrence",
    label: "Class co-occurrence",
    description: "How often class pairs appear in the same sample.",
    sql:
      "WITH per_sample AS (\n" +
      "  SELECT DISTINCT sample_id, label FROM labels\n" +
      "  WHERE source = 'ground_truth_detections' AND label IS NOT NULL\n" +
      "),\n" +
      "top15 AS (SELECT label FROM per_sample GROUP BY label ORDER BY COUNT(*) DESC LIMIT 15),\n" +
      "filt AS (SELECT * FROM per_sample WHERE label IN (SELECT label FROM top15))\n" +
      "SELECT a.label AS l1, b.label AS l2, COUNT(*)::INT AS n\n" +
      "FROM filt a JOIN filt b USING (sample_id) GROUP BY l1, l2",
    chart: { type: "heatmap", x: "l1", y: "l2" },
  },
];
