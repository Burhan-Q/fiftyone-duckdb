import React, { useEffect, useMemo, useState } from "react";
import {
  FormField,
  Select,
  SingleValueSlider,
  Spinner,
  Stack,
  Text,
  Toast,
  Orientation,
  Spacing,
  Size,
  Variant,
  TextColor,
} from "@voxel51/voodo";

import {
  GroupByChart,
  HeatmapChart,
  Heatmap2DChart,
  BarChart,
} from "./charts";
import { FieldInfo } from "./useDuckDB";
import { SelectionCriteria } from "./selection";

type Subview =
  | "distribution"
  | "gt_vs_pred"
  | "spatial"
  | "confidence"
  | "cooccurrence";

const SUBVIEWS: { id: Subview; label: string }[] = [
  { id: "distribution", label: "Class Distribution" },
  { id: "gt_vs_pred", label: "GT vs Predicted" },
  { id: "spatial", label: "Class Spatial" },
  { id: "confidence", label: "Confidence per Class" },
  { id: "cooccurrence", label: "Co-occurrence" },
];

const q = (name: string) => `"${name.replace(/"/g, '""')}"`;
const esc = (v: string) => v.replace(/'/g, "''");

// ---------- SQL generators ----------

function distributionSQL(sources: string[], topN: number): string {
  const inList = sources.map((s) => `'${esc(s)}'`).join(", ") || "''";
  return `SELECT label, COUNT(*)::INTEGER AS n
    FROM labels
    WHERE source IN (${inList}) AND label IS NOT NULL
    GROUP BY label
    ORDER BY n DESC
    LIMIT ${topN}`;
}

function gtVsPredSQL(gt: string, pred: string, topN: number): string {
  return `WITH agg AS (
    SELECT label, source, COUNT(*)::INTEGER AS n
    FROM labels
    WHERE source IN ('${esc(gt)}', '${esc(pred)}') AND label IS NOT NULL
    GROUP BY label, source
  ),
  totals AS (
    SELECT label, SUM(n)::INTEGER AS total
    FROM agg GROUP BY label
    ORDER BY total DESC LIMIT ${topN}
  )
  SELECT a.label, a.source, a.n, t.total
  FROM agg a JOIN totals t USING (label)
  ORDER BY t.total DESC, a.label, a.source`;
}

function spatialSQL(source: string, label: string): string {
  return `SELECT bbox_cx, bbox_cy
    FROM labels
    WHERE source = '${esc(source)}' AND label = '${esc(label)}'
      AND bbox_cx IS NOT NULL AND bbox_cy IS NOT NULL`;
}

function confidenceSQL(source: string, topN: number): string {
  return `WITH top_classes AS (
    SELECT label
    FROM labels
    WHERE source = '${esc(source)}' AND confidence IS NOT NULL AND label IS NOT NULL
    GROUP BY label
    ORDER BY COUNT(*) DESC
    LIMIT ${topN}
  )
  SELECT label, confidence
  FROM labels
  WHERE source = '${esc(source)}'
    AND confidence IS NOT NULL
    AND label IN (SELECT label FROM top_classes)`;
}

function cooccurrenceSQL(source: string, topN: number): string {
  return `WITH per_sample AS (
    SELECT DISTINCT sample_id, label
    FROM labels
    WHERE source = '${esc(source)}' AND label IS NOT NULL
  ),
  topcls AS (
    SELECT label FROM per_sample
    GROUP BY label ORDER BY COUNT(*) DESC LIMIT ${topN}
  ),
  filt AS (
    SELECT * FROM per_sample WHERE label IN (SELECT label FROM topcls)
  )
  SELECT a.label AS l1, b.label AS l2, COUNT(*)::INTEGER AS n
  FROM filt a JOIN filt b USING (sample_id)
  GROUP BY l1, l2`;
}

// ---------- Component ----------

export interface ClassesViewProps {
  ready: boolean;
  loadedTables: string[];
  fieldInfo: FieldInfo | null;
  runQuery: <T = any>(sql: string) => Promise<T[]>;
  /** Chart-to-view-selection dispatcher (Phase 7). */
  onSelect?: (criteria: SelectionCriteria) => void;
}

const toOpts = (xs: string[]) =>
  xs.map((x) => ({ id: x, data: { label: x } }));

export function ClassesView(props: ClassesViewProps) {
  const { ready, loadedTables, fieldInfo, runQuery, onSelect } = props;

  const sources = fieldInfo?.label_bearing_sources ?? [];
  const labelsLoaded = loadedTables.includes("labels");

  const [subview, setSubview] = useState<Subview>("distribution");

  // Per-subview controls
  const [distSources, setDistSources] = useState<string[]>([]);
  const [topNDist, setTopNDist] = useState(20);

  const [gtSrc, setGtSrc] = useState<string>("");
  const [predSrc, setPredSrc] = useState<string>("");
  const [topNGtPred, setTopNGtPred] = useState(20);

  const [spatialSrc, setSpatialSrc] = useState<string>("");
  const [spatialClass, setSpatialClass] = useState<string>("");
  const [spatialClassOpts, setSpatialClassOpts] = useState<string[]>([]);

  const [confSrc, setConfSrc] = useState<string>("");
  const [topNConf, setTopNConf] = useState(15);

  const [coocSrc, setCoocSrc] = useState<string>("");
  const [topNCooc, setTopNCooc] = useState(15);

  // ----- Defaults when sources arrive -----
  useEffect(() => {
    if (sources.length === 0) return;
    setDistSources((prev) => (prev.length > 0 ? prev : sources));
    // Heuristic: anything containing "gt" or "ground_truth" → gtSrc;
    //            anything containing "pred" → predSrc.
    const findBy = (rx: RegExp) => sources.find((s) => rx.test(s));
    const gt = findBy(/^(gt|ground_truth)/) ?? sources[0];
    const pr =
      findBy(/^(pred|prediction)/) ??
      (sources.find((s) => s !== gt) ?? sources[0]);
    setGtSrc((p) => p || gt);
    setPredSrc((p) => p || pr);
    setSpatialSrc((p) => p || gt);
    setConfSrc((p) => p || pr);
    setCoocSrc((p) => p || gt);
  }, [sources.join("|")]);

  // ----- Result state -----
  const [result, setResult] = useState<any>(null);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [querying, setQuerying] = useState(false);

  // Clear stale result on subview / source change
  useEffect(() => {
    setResult(null);
    setQueryError(null);
  }, [subview]);

  // ----- Spatial class options come from the labels table -----
  useEffect(() => {
    if (subview !== "spatial" || !ready || !labelsLoaded || !spatialSrc) return;
    const sql = `SELECT label, COUNT(*)::INTEGER AS n
      FROM labels WHERE source='${esc(spatialSrc)}' AND label IS NOT NULL
      GROUP BY label ORDER BY n DESC LIMIT 50`;
    runQuery<{ label: string }>(sql).then((rows) => {
      const opts = rows.map((r) => r.label);
      setSpatialClassOpts(opts);
      if (opts.length && !opts.includes(spatialClass)) {
        setSpatialClass(opts[0]);
      }
    });
  }, [subview, ready, labelsLoaded, spatialSrc, runQuery]);

  // ----- Query orchestration -----
  useEffect(() => {
    if (!ready || !labelsLoaded) return;
    let sql: string | null = null;
    let post: (rows: any[]) => any = (rows) => rows;
    const my = subview;

    if (subview === "distribution") {
      if (distSources.length === 0) return;
      sql = distributionSQL(distSources, topNDist);
    } else if (subview === "gt_vs_pred") {
      if (!gtSrc || !predSrc) return;
      sql = gtVsPredSQL(gtSrc, predSrc, topNGtPred);
      // Reshape rows: { label, source, n, total } → labels[] + per-source counts
      post = (rows: any[]) => {
        const labelsOrdered: string[] = [];
        const seen = new Set<string>();
        const byLabel: Record<string, Record<string, number>> = {};
        for (const r of rows) {
          if (!seen.has(r.label)) {
            seen.add(r.label);
            labelsOrdered.push(r.label);
            byLabel[r.label] = {};
          }
          byLabel[r.label][r.source] = Number(r.n);
        }
        return {
          labels: labelsOrdered,
          gt: labelsOrdered.map((l) => byLabel[l]?.[gtSrc] ?? 0),
          pred: labelsOrdered.map((l) => byLabel[l]?.[predSrc] ?? 0),
        };
      };
    } else if (subview === "spatial") {
      if (!spatialSrc || !spatialClass) return;
      sql = spatialSQL(spatialSrc, spatialClass);
    } else if (subview === "confidence") {
      if (!confSrc) return;
      sql = confidenceSQL(confSrc, topNConf);
      // Reshape: rows → { group, values } per class for GroupByChart
      post = (rows: any[]) => {
        const groups = new Map<string, number[]>();
        for (const r of rows) {
          if (!groups.has(r.label)) groups.set(r.label, []);
          groups.get(r.label)!.push(Number(r.confidence));
        }
        // Sort by median confidence ascending — weakest classes first
        const sorted = Array.from(groups.entries())
          .map(([g, vs]) => ({ g, vs, med: median(vs) }))
          .sort((a, b) => a.med - b.med)
          .map(({ g, vs }) => ({ group: g, values: vs }));
        return sorted;
      };
    } else if (subview === "cooccurrence") {
      if (!coocSrc) return;
      sql = cooccurrenceSQL(coocSrc, topNCooc);
      post = (rows: any[]) => {
        // Determine label order from diagonal (a == b) counts, desc
        const diagonals: Record<string, number> = {};
        for (const r of rows) {
          if (r.l1 === r.l2) diagonals[r.l1] = Number(r.n);
        }
        const labels = Object.keys(diagonals).sort(
          (a, b) => (diagonals[b] ?? 0) - (diagonals[a] ?? 0),
        );
        const idx = new Map(labels.map((l, i) => [l, i]));
        const matrix: number[][] = labels.map(() => labels.map(() => 0));
        for (const r of rows) {
          const i = idx.get(r.l1);
          const j = idx.get(r.l2);
          if (i === undefined || j === undefined) continue;
          matrix[i][j] = Number(r.n);
        }
        return { labels, matrix };
      };
    }

    if (!sql) {
      setResult(null);
      return;
    }
    setQuerying(true);
    setQueryError(null);
    runQuery(sql)
      .then((rows) => {
        if (my !== subview) return; // stale
        setResult(post(rows));
      })
      .catch((e) => setQueryError(e?.message ?? String(e)))
      .finally(() => setQuerying(false));
  }, [
    ready,
    labelsLoaded,
    subview,
    distSources.join("|"),
    topNDist,
    gtSrc,
    predSrc,
    topNGtPred,
    spatialSrc,
    spatialClass,
    confSrc,
    topNConf,
    coocSrc,
    topNCooc,
    runQuery,
  ]);

  // ----- Empty state -----
  if (!fieldInfo) return null;

  if (sources.length === 0) {
    return (
      <div style={{ padding: 16 }}>
        <Toast
          open
          variant={Variant.Secondary}
          description="No label-bearing fields in this dataset (e.g. no Detections, Classifications, or Polylines with a `label` field)."
        />
      </div>
    );
  }

  // ----- Controls per subview -----
  const controls = renderControls({
    subview,
    sources,
    distSources, setDistSources, topNDist, setTopNDist,
    gtSrc, setGtSrc, predSrc, setPredSrc, topNGtPred, setTopNGtPred,
    spatialSrc, setSpatialSrc, spatialClass, setSpatialClass,
    spatialClassOpts,
    confSrc, setConfSrc, topNConf, setTopNConf,
    coocSrc, setCoocSrc, topNCooc, setTopNCooc,
  });

  // ----- Result area -----
  let resultArea: React.ReactNode = null;
  if (querying) {
    resultArea = (
      <Stack
        align={"center" as any}
        justify={"center" as any}
        style={{ flex: 1 }}
      >
        <Spinner size={Size.Md} />
      </Stack>
    );
  } else if (queryError) {
    resultArea = (
      <Toast open variant={Variant.Danger} title="Query failed" description={queryError} />
    );
  } else if (!result) {
    resultArea = (
      <div
        style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          height: "100%", padding: 32,
          color: "var(--fo-palette-text-secondary, #888)",
        }}
      >
        Pick options to run an analysis.
      </div>
    );
  } else if (subview === "distribution") {
    resultArea = (
      <BarChart
        x={(result as any[]).map((r) => String(r.label))}
        y={(result as any[]).map((r) => Number(r.n))}
        xLabel="label"
        yLabel="count"
        onSelectBar={
          onSelect
            ? (label) =>
                onSelect({
                  kind: "labels",
                  sources: distSources,
                  labels: [label],
                })
            : undefined
        }
      />
    );
  } else if (subview === "gt_vs_pred") {
    resultArea = (
      <BarChart
        x={(result as any).labels}
        y={(result as any).gt}
        xLabel="label"
        yLabel="count"
        groups={[
          { name: gtSrc, y: (result as any).gt },
          { name: predSrc, y: (result as any).pred },
        ]}
        onSelectBar={
          onSelect
            ? (label) =>
                onSelect({
                  kind: "labels",
                  sources: [gtSrc, predSrc].filter(Boolean),
                  labels: [label],
                })
            : undefined
        }
      />
    );
  } else if (subview === "spatial") {
    resultArea = (
      <Heatmap2DChart
        x={(result as any[]).map((r) => Number(r.bbox_cx))}
        y={(result as any[]).map((r) => Number(r.bbox_cy))}
        xLabel="bbox_cx"
        yLabel="bbox_cy"
        onSelectRegion={
          onSelect
            ? (region) => {
                if (!region) {
                  onSelect({ kind: "row_ids", sampleIds: [] });
                  return;
                }
                onSelect({
                  kind: "labels",
                  sources: [spatialSrc],
                  labels: [spatialClass],
                  bbox: region,
                });
              }
            : undefined
        }
      />
    );
  } else if (subview === "confidence") {
    resultArea = (
      <GroupByChart
        groups={result as any}
        groupLabel="class"
        valueLabel="confidence"
        variant="box"
        onSelectGroup={
          onSelect
            ? (g) =>
                onSelect({
                  kind: "labels",
                  sources: [confSrc],
                  labels: [g],
                })
            : undefined
        }
      />
    );
  } else if (subview === "cooccurrence") {
    if (!(result as any).labels?.length) {
      resultArea = (
        <Toast
          open variant={Variant.Secondary}
          description="No co-occurring classes found."
        />
      );
    } else {
      resultArea = (
        <HeatmapChart
          matrix={(result as any).matrix}
          labels={(result as any).labels}
          onSelectCell={
            onSelect
              ? (cell) =>
                  onSelect({
                    kind: "labels_cooccur",
                    source: coocSrc,
                    labelA: cell.row,
                    labelB: cell.col,
                  })
              : undefined
          }
        />
      );
    }
  }

  // ----- Layout -----
  return (
    <Stack
      orientation={Orientation.Column}
      spacing={Spacing.Md}
      style={{ flex: 1, minHeight: 0 }}
    >
      <Stack orientation={Orientation.Row} spacing={Spacing.Md} align={"center" as any}>
        <FormField
          label="View"
          control={
            <Select
              exclusive
              value={subview}
              options={SUBVIEWS.map((s) => ({ id: s.id, data: { label: s.label } }))}
              onChange={(v) => setSubview((typeof v === "string" ? v : "distribution") as Subview)}
            />
          }
        />
      </Stack>

      {controls}

      <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        <div style={{ flex: 1, minHeight: 0, height: "100%" }}>{resultArea}</div>
      </div>
    </Stack>
  );
}

// ---------- helpers ----------

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
}

function renderControls(p: {
  subview: Subview;
  sources: string[];
  distSources: string[];
  setDistSources: (xs: string[]) => void;
  topNDist: number;
  setTopNDist: (n: number) => void;
  gtSrc: string; setGtSrc: (s: string) => void;
  predSrc: string; setPredSrc: (s: string) => void;
  topNGtPred: number; setTopNGtPred: (n: number) => void;
  spatialSrc: string; setSpatialSrc: (s: string) => void;
  spatialClass: string; setSpatialClass: (s: string) => void;
  spatialClassOpts: string[];
  confSrc: string; setConfSrc: (s: string) => void;
  topNConf: number; setTopNConf: (n: number) => void;
  coocSrc: string; setCoocSrc: (s: string) => void;
  topNCooc: number; setTopNCooc: (n: number) => void;
}) {
  const opts = (xs: string[]) =>
    xs.map((x) => ({ id: x, data: { label: x } }));

  if (p.subview === "distribution") {
    return (
      <Stack orientation={Orientation.Row} spacing={Spacing.Md}>
        <FormField
          label="Sources"
          control={
            <Select
              exclusive={false}
              value={p.distSources}
              options={opts(p.sources)}
              onChange={(v) =>
                p.setDistSources(Array.isArray(v) ? v : v ? [v] : [])
              }
            />
          }
        />
        <FormField
          label={`Top N: ${p.topNDist}`}
          control={
            <SingleValueSlider
              min={5} max={50} step={1}
              value={p.topNDist}
              onChange={(v) => p.setTopNDist(v)}
            />
          }
        />
      </Stack>
    );
  }
  if (p.subview === "gt_vs_pred") {
    return (
      <Stack orientation={Orientation.Row} spacing={Spacing.Md}>
        <FormField
          label="GT source"
          control={
            <Select exclusive value={p.gtSrc || undefined} options={opts(p.sources)}
              onChange={(v) => p.setGtSrc(typeof v === "string" ? v : "")}
            />
          }
        />
        <FormField
          label="Pred source"
          control={
            <Select exclusive value={p.predSrc || undefined} options={opts(p.sources)}
              onChange={(v) => p.setPredSrc(typeof v === "string" ? v : "")}
            />
          }
        />
        <FormField
          label={`Top N: ${p.topNGtPred}`}
          control={
            <SingleValueSlider min={5} max={50} step={1}
              value={p.topNGtPred}
              onChange={(v) => p.setTopNGtPred(v)}
            />
          }
        />
      </Stack>
    );
  }
  if (p.subview === "spatial") {
    return (
      <Stack orientation={Orientation.Row} spacing={Spacing.Md}>
        <FormField
          label="Source"
          control={
            <Select exclusive value={p.spatialSrc || undefined} options={opts(p.sources)}
              onChange={(v) => p.setSpatialSrc(typeof v === "string" ? v : "")}
            />
          }
        />
        <FormField
          label="Class"
          control={
            <Select exclusive value={p.spatialClass || undefined} options={opts(p.spatialClassOpts)}
              onChange={(v) => p.setSpatialClass(typeof v === "string" ? v : "")}
            />
          }
        />
      </Stack>
    );
  }
  if (p.subview === "confidence") {
    return (
      <Stack orientation={Orientation.Row} spacing={Spacing.Md}>
        <FormField
          label="Source"
          control={
            <Select exclusive value={p.confSrc || undefined} options={opts(p.sources)}
              onChange={(v) => p.setConfSrc(typeof v === "string" ? v : "")}
            />
          }
        />
        <FormField
          label={`Top N: ${p.topNConf}`}
          control={
            <SingleValueSlider min={3} max={30} step={1}
              value={p.topNConf}
              onChange={(v) => p.setTopNConf(v)}
            />
          }
        />
      </Stack>
    );
  }
  // cooccurrence
  return (
    <Stack orientation={Orientation.Row} spacing={Spacing.Md}>
      <FormField
        label="Source"
        control={
          <Select exclusive value={p.coocSrc || undefined} options={opts(p.sources)}
            onChange={(v) => p.setCoocSrc(typeof v === "string" ? v : "")}
          />
        }
      />
      <FormField
        label={`Top N: ${p.topNCooc}`}
        control={
          <SingleValueSlider min={3} max={25} step={1}
            value={p.topNCooc}
            onChange={(v) => p.setTopNCooc(v)}
          />
        }
      />
    </Stack>
  );
}
