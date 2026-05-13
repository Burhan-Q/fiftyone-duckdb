import React, { useEffect, useMemo, useState } from "react";
import "@voxel51/voodo/theme.css";
import { usePanelStatePartial } from "@fiftyone/spaces";
import {
  FormField,
  Select,
  SingleValueSlider,
  Spinner,
  Stack,
  Text,
  TextBadge,
  Toast,
  ToggleSwitch,
  ToggleSwitchVariant,
  Orientation,
  Spacing,
  Size,
  Variant,
  TextColor,
} from "@voxel51/voodo";

import {
  GroupByChart,
  GroupByVariant,
  HeatmapChart,
  HistogramChart,
  HistogramVariant,
  MissingTable,
  ScatterChart,
  StatsTable,
} from "./charts";
import {
  FieldInfo,
  Tables,
  TableInfo,
  useDuckDB,
} from "./useDuckDB";
import { ClassesView } from "./ClassesView";
import { useSelectionDispatcher, SelectionCriteria } from "./selection";

type Analysis =
  | "classes"
  | "stats"
  | "histogram"
  | "correlation"
  | "outliers"
  | "scatter"
  | "groupby"
  | "missing";

const ANALYSES: { id: Analysis; label: string }[] = [
  { id: "classes", label: "Classes" },
  { id: "stats", label: "Stats" },
  { id: "histogram", label: "Histogram" },
  { id: "correlation", label: "Correlation" },
  { id: "outliers", label: "Outliers" },
  { id: "scatter", label: "Scatter" },
  { id: "groupby", label: "Group-by" },
  { id: "missing", label: "Missing" },
];

const q = (name: string) => `"${name.replace(/"/g, '""')}"`;

/** The samples FK column for ``table`` (``id`` for ``samples``, else ``sample_id``). */
const sampleIdCol = (table: string) => (table === "samples" ? "id" : "sample_id");

// ---------- SQL generators ----------

function statsSQL(table: string, fields: string[]): string {
  return fields
    .map(
      (f) => `SELECT '${f.replace(/'/g, "''")}' AS field,
      COUNT(${q(f)}) AS count,
      AVG(${q(f)}::DOUBLE) AS mean,
      STDDEV_POP(${q(f)}::DOUBLE) AS std,
      MIN(${q(f)}::DOUBLE) AS min,
      QUANTILE_CONT(${q(f)}::DOUBLE, 0.25) AS q1,
      QUANTILE_CONT(${q(f)}::DOUBLE, 0.5)  AS median,
      QUANTILE_CONT(${q(f)}::DOUBLE, 0.75) AS q3,
      MAX(${q(f)}::DOUBLE) AS max
    FROM ${q(table)} WHERE ${q(f)} IS NOT NULL`,
    )
    .join("\nUNION ALL\n");
}

function histogramSQL(table: string, field: string, bins: number): string {
  return `WITH bounds AS (
    SELECT MIN(${q(field)}::DOUBLE) AS lo, MAX(${q(field)}::DOUBLE) AS hi
    FROM ${q(table)} WHERE ${q(field)} IS NOT NULL
  )
  SELECT
    bucket,
    lo + (bucket + 0.5) * (hi - lo) / ${bins} AS bin_center,
    COUNT(*) AS count
  FROM (
    SELECT
      CASE
        WHEN hi = lo THEN 0
        ELSE LEAST(
          CAST(FLOOR((${q(field)}::DOUBLE - lo) / (hi - lo) * ${bins}) AS INTEGER),
          ${bins - 1}
        )
      END AS bucket,
      lo, hi
    FROM ${q(table)}, bounds WHERE ${q(field)} IS NOT NULL
  )
  GROUP BY bucket, lo, hi
  ORDER BY bucket`;
}

function correlationSQL(table: string, fields: string[]): string {
  const pieces: string[] = [];
  for (const a of fields) {
    for (const b of fields) {
      pieces.push(
        `SELECT '${a.replace(/'/g, "''")}' AS a,
                '${b.replace(/'/g, "''")}' AS b,
                CORR(${q(a)}::DOUBLE, ${q(b)}::DOUBLE) AS corr
         FROM ${q(table)}`,
      );
    }
  }
  return pieces.join("\nUNION ALL\n");
}

function outlierSQL(
  table: string,
  field: string,
  method: "z" | "iqr",
  threshold: number,
): string {
  const sid = q(sampleIdCol(table));
  if (method === "z") {
    return `SELECT row_number() OVER () AS idx,
              ${q(field)}::DOUBLE AS value,
              ((${q(field)}::DOUBLE - AVG(${q(field)}::DOUBLE) OVER())
                / NULLIF(STDDEV_POP(${q(field)}::DOUBLE) OVER(), 0)) AS z_score,
              ${sid} AS sample_id
        FROM ${q(table)} WHERE ${q(field)} IS NOT NULL`;
  }
  return `WITH q AS (
    SELECT QUANTILE_CONT(${q(field)}::DOUBLE, 0.25) AS q1,
           QUANTILE_CONT(${q(field)}::DOUBLE, 0.75) AS q3
    FROM ${q(table)} WHERE ${q(field)} IS NOT NULL
  )
  SELECT row_number() OVER () AS idx,
         ${q(field)}::DOUBLE AS value,
         (q3 - q1) AS iqr,
         q1 - ${threshold} * (q3 - q1) AS lo_bound,
         q3 + ${threshold} * (q3 - q1) AS hi_bound,
         ${sid} AS sample_id
  FROM ${q(table)}, q WHERE ${q(field)} IS NOT NULL`;
}

function scatterSQL(
  table: string,
  x: string,
  y: string,
  color?: string,
): string {
  const cols = [
    `${q(x)}::DOUBLE AS x`,
    `${q(y)}::DOUBLE AS y`,
    `${q(sampleIdCol(table))} AS sample_id`,
  ];
  if (color) cols.push(`${q(color)} AS color`);
  return `SELECT ${cols.join(", ")}
    FROM ${q(table)}
    WHERE ${q(x)} IS NOT NULL AND ${q(y)} IS NOT NULL`;
}

function groupbySQL(
  table: string,
  numField: string,
  groupField: string,
): string {
  return `SELECT ${q(groupField)} AS grp,
            ${q(numField)}::DOUBLE AS value
    FROM ${q(table)}
    WHERE ${q(numField)} IS NOT NULL AND ${q(groupField)} IS NOT NULL`;
}

function missingSQL(
  table: string,
  fields: { name: string; type: string }[],
): string {
  return fields
    .map(
      ({ name, type }) =>
        `SELECT '${name.replace(/'/g, "''")}' AS field,
                '${type}' AS type,
                COUNT(*) AS total,
                COUNT(*) - COUNT(${q(name)}) AS null_count,
                CASE WHEN COUNT(*) = 0 THEN 0
                     ELSE 100.0 * (COUNT(*) - COUNT(${q(name)})) / COUNT(*)
                END AS null_pct
         FROM ${q(table)}`,
    )
    .join("\nUNION ALL\n");
}

// ---------- VOODO Select helpers ----------

const toOpts = (xs: string[]) =>
  xs.map((x) => ({ id: x, data: { label: x } }));

function MultiField({
  label,
  values,
  options,
  onChange,
  hint,
}: {
  label: string;
  values: string[];
  options: string[];
  onChange: (v: string[]) => void;
  hint?: string;
}) {
  return (
    <FormField
      label={
        <Stack orientation={Orientation.Row} spacing={Spacing.Sm}>
          <span>{label}</span>
          {hint ? <Text color={TextColor.Secondary}>· {hint}</Text> : null}
        </Stack>
      }
      control={
        <Select
          exclusive={false}
          value={values}
          options={toOpts(options)}
          onChange={(v) => onChange(Array.isArray(v) ? v : v ? [v] : [])}
        />
      }
    />
  );
}

function SingleField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <FormField
      label={label}
      control={
        <Select
          exclusive
          value={value || undefined}
          options={toOpts(options)}
          onChange={(v) => onChange((typeof v === "string" ? v : "") || "")}
        />
      }
    />
  );
}

// ---------- Main component ----------

export function DuckDBAnalyticsPanel(props: { schema?: any } = {}) {
  // The composite-view receives `schema.view.<kwarg>` for each kwarg passed to
  // ``types.View(...)`` in Python's ``render()``. We use this to obtain the
  // URI of the ``select_samples`` event handler for Phase 7 dispatching.
  const selectSamplesOp = props?.schema?.view?.select_samples;
  const [panelData] = usePanelStatePartial<{
    tables?: Tables;
    field_info?: FieldInfo;
  }>("data", {}, true);
  const tables = panelData?.tables ?? null;
  const fieldInfo = panelData?.field_info ?? null;

  const { ready, loading, error, runQuery, queryTime, loadedTables } =
    useDuckDB(tables, fieldInfo);

  const dispatchSelection = useSelectionDispatcher({
    runQuery,
    selectSamplesOp,
  });

  const tableNames = useMemo(() => {
    if (!fieldInfo?.tables) return [];
    return Object.keys(fieldInfo.tables).sort((a, b) => {
      if (a === "samples") return -1;
      if (b === "samples") return 1;
      return a.localeCompare(b);
    });
  }, [fieldInfo?.tables]);

  const [tableName, setTableName] = useState<string>("");
  const currentTable: TableInfo = useMemo(() => {
    return (tableName && fieldInfo?.tables?.[tableName]) || {
      numeric: [],
      categorical: [],
    };
  }, [tableName, fieldInfo?.tables]);

  const numeric = currentTable.numeric;
  const categorical = currentTable.categorical;

  const [analysis, setAnalysis] = useState<Analysis>("stats");
  const [multi, setMulti] = useState<string[]>([]);
  const [single, setSingle] = useState<string>("");
  const [single2, setSingle2] = useState<string>("");
  const [colorBy, setColorBy] = useState<string>("");
  const [bins, setBins] = useState<number>(20);
  const [outlierMethod, setOutlierMethod] = useState<"z" | "iqr">("z");
  const [outlierThreshold, setOutlierThreshold] = useState<number>(3);
  const [histVariant, setHistVariant] = useState<HistogramVariant>("bar");
  const [groupVariant, setGroupVariant] = useState<GroupByVariant>("box");

  const [results, setResults] = useState<any>(null);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [querying, setQuerying] = useState(false);

  // Pick the first available table on first load / table list changes
  useEffect(() => {
    if (tableNames.length === 0) {
      setTableName("");
      return;
    }
    if (!tableName || !tableNames.includes(tableName)) {
      setTableName(tableNames[0]);
    }
  }, [tableNames.join("|")]);

  // Reset selections when active table / dataset changes
  useEffect(() => {
    setMulti([]);
    setSingle("");
    setSingle2("");
    setColorBy("");
    setResults(null);
    setQueryError(null);
  }, [tableName, fieldInfo?.dataset_name, fieldInfo?.sample_count]);

  // Clear stale results when analysis switches so we never feed
  // old-shape results to a different chart component.
  useEffect(() => {
    setResults(null);
    setQueryError(null);
  }, [analysis]);

  // Run query whenever inputs are valid for the active analysis
  useEffect(() => {
    if (!ready || !tableName) return;
    if (!loadedTables.includes(tableName)) return;
    // Classes tab runs its own queries against the virtual `labels` table.
    if (analysis === "classes") return;
    let sql: string | null = null;
    let postProcess: (rows: any[]) => any = (rows) => rows;

    if (analysis === "stats" && multi.length > 0) {
      sql = statsSQL(tableName, multi);
    } else if (analysis === "histogram" && single) {
      sql = histogramSQL(tableName, single, bins);
    } else if (analysis === "correlation" && multi.length >= 2) {
      const labels = [...multi];
      sql = correlationSQL(tableName, labels);
      postProcess = (rows) => {
        const matrix: (number | null)[][] = labels.map(() =>
          labels.map(() => null),
        );
        const idx = new Map(labels.map((l, i) => [l, i]));
        for (const r of rows) {
          const i = idx.get(r.a);
          const j = idx.get(r.b);
          if (i === undefined || j === undefined) continue;
          const corr = r.corr;
          matrix[i][j] =
            corr === null || corr === undefined ? null : Number(corr);
        }
        return { labels, matrix };
      };
    } else if (analysis === "outliers" && single) {
      sql = outlierSQL(tableName, single, outlierMethod, outlierThreshold);
    } else if (analysis === "scatter" && single && single2) {
      sql = scatterSQL(tableName, single, single2, colorBy || undefined);
    } else if (analysis === "groupby" && single && single2) {
      sql = groupbySQL(tableName, single, single2);
      postProcess = (rows) => {
        const groups = new Map<string, number[]>();
        for (const r of rows) {
          const k = r.grp == null ? "(null)" : String(r.grp);
          if (!groups.has(k)) groups.set(k, []);
          groups.get(k)!.push(Number(r.value));
        }
        return Array.from(groups.entries())
          .sort((a, b) => b[1].length - a[1].length)
          .slice(0, 20)
          .map(([group, values]) => ({ group, values }));
      };
    } else if (analysis === "missing") {
      const fields = [
        ...numeric.map((n) => ({ name: n, type: "numeric" })),
        ...categorical.map((n) => ({ name: n, type: "categorical" })),
      ];
      if (fields.length === 0) return;
      sql = missingSQL(tableName, fields);
    }

    if (!sql) {
      setResults(null);
      return;
    }
    setQuerying(true);
    setQueryError(null);
    const myAnalysis = analysis;
    runQuery(sql)
      .then((rows) => {
        // Guard against an analysis change mid-flight.
        if (myAnalysis !== analysis) return;
        setResults(postProcess(rows));
      })
      .catch((e) => setQueryError(e?.message ?? String(e)))
      .finally(() => setQuerying(false));
  }, [
    ready,
    tableName,
    loadedTables.join("|"),
    analysis,
    multi.join("|"),
    single,
    single2,
    colorBy,
    bins,
    outlierMethod,
    outlierThreshold,
    runQuery,
    fieldInfo?.dataset_name,
    fieldInfo?.sample_count,
  ]);

  // ---------- Field-control UI per analysis ----------
  const controls = useMemo(() => {
    const histVariantPicker = (
      <FormField
        label="Chart"
        control={
          <Select
            exclusive
            value={histVariant}
            options={[
              { id: "bar", data: { label: "Bar" } },
              { id: "area", data: { label: "Area" } },
            ]}
            onChange={(v) =>
              setHistVariant((typeof v === "string" ? v : "bar") as HistogramVariant)
            }
          />
        }
      />
    );
    const groupVariantPicker = (
      <FormField
        label="Chart"
        control={
          <Select
            exclusive
            value={groupVariant}
            options={[
              { id: "box", data: { label: "Box plot" } },
              { id: "violin", data: { label: "Violin" } },
              { id: "bar", data: { label: "Bar (mean)" } },
            ]}
            onChange={(v) =>
              setGroupVariant((typeof v === "string" ? v : "box") as GroupByVariant)
            }
          />
        }
      />
    );

    switch (analysis) {
      case "stats":
        return (
          <MultiField
            label="Numeric fields"
            options={numeric}
            values={multi}
            onChange={setMulti}
            hint="1+ fields"
          />
        );
      case "histogram":
        return (
          <Stack orientation={Orientation.Row} spacing={Spacing.Md}>
            <SingleField
              label="Numeric field"
              options={numeric}
              value={single}
              onChange={setSingle}
            />
            <FormField
              label={`Bins: ${bins}`}
              control={
                <SingleValueSlider
                  min={5}
                  max={100}
                  step={1}
                  value={bins}
                  onChange={(v) => setBins(v)}
                />
              }
            />
            {histVariantPicker}
          </Stack>
        );
      case "correlation":
        return (
          <MultiField
            label="Numeric fields"
            options={numeric}
            values={multi}
            onChange={setMulti}
            hint="2+ fields (tip: pick aggregates like *_avg, *_max for cross-domain)"
          />
        );
      case "outliers":
        return (
          <Stack orientation={Orientation.Row} spacing={Spacing.Md}>
            <SingleField
              label="Numeric field"
              options={numeric}
              value={single}
              onChange={setSingle}
            />
            <FormField
              label="Method"
              control={
                <Select
                  exclusive
                  value={outlierMethod}
                  options={[
                    { id: "z", data: { label: "Z-score" } },
                    { id: "iqr", data: { label: "IQR" } },
                  ]}
                  onChange={(v) =>
                    setOutlierMethod((typeof v === "string" ? v : "z") as "z" | "iqr")
                  }
                />
              }
            />
            <FormField
              label={`Threshold: ${outlierThreshold}`}
              control={
                <SingleValueSlider
                  min={1}
                  max={6}
                  step={0.1}
                  value={outlierThreshold}
                  onChange={(v) => setOutlierThreshold(v)}
                />
              }
            />
          </Stack>
        );
      case "scatter":
        return (
          <Stack orientation={Orientation.Row} spacing={Spacing.Md}>
            <SingleField
              label="X (numeric)"
              options={numeric}
              value={single}
              onChange={setSingle}
            />
            <SingleField
              label="Y (numeric)"
              options={numeric}
              value={single2}
              onChange={setSingle2}
            />
            <SingleField
              label="Color (optional)"
              options={["", ...categorical]}
              value={colorBy}
              onChange={setColorBy}
            />
          </Stack>
        );
      case "groupby":
        return (
          <Stack orientation={Orientation.Row} spacing={Spacing.Md}>
            <SingleField
              label="Numeric field"
              options={numeric}
              value={single}
              onChange={setSingle}
            />
            <SingleField
              label="Group by (categorical)"
              options={categorical}
              value={single2}
              onChange={setSingle2}
            />
            {groupVariantPicker}
          </Stack>
        );
      case "missing":
        return (
          <Text color={TextColor.Secondary}>
            Audits every scalar column in <em>{tableName}</em>.
          </Text>
        );
    }
  }, [
    analysis,
    numeric,
    categorical,
    multi,
    single,
    single2,
    colorBy,
    bins,
    outlierMethod,
    outlierThreshold,
    histVariant,
    groupVariant,
    tableName,
  ]);

  // ---------- Result rendering ----------
  const resultArea = useMemo(() => {
    if (querying) {
      return (
        <Stack
          align={"center" as any}
          justify={"center" as any}
          style={{ flex: 1 }}
        >
          <Spinner size={Size.Md} />
        </Stack>
      );
    }
    if (queryError) {
      return (
        <Toast
          open
          variant={Variant.Danger}
          title="Query failed"
          description={queryError}
        />
      );
    }
    if (!results) {
      return (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            height: "100%",
            padding: 32,
            color: "var(--fo-palette-text-secondary, #888)",
          }}
        >
          Pick fields to run an analysis.
        </div>
      );
    }

    // Defensive: results shape varies per analysis. After a tab switch the
    // stale shape may briefly render before the effect re-runs the query, so
    // we guard with Array.isArray / property checks.
    switch (analysis) {
      case "stats":
        if (!Array.isArray(results)) return null;
        return <StatsTable rows={results} />;
      case "histogram": {
        if (!Array.isArray(results)) return null;
        const bins = results.map((r: any) => r.bin_center);
        const counts = results.map((r: any) => r.count);
        return (
          <HistogramChart
            bins={bins}
            counts={counts}
            field={single}
            variant={histVariant}
            onSelectBin={
              selectSamplesOp
                ? (range) =>
                    dispatchSelection({
                      kind: "range",
                      table: tableName,
                      field: single,
                      min: range.min,
                      max: range.max,
                    })
                : undefined
            }
          />
        );
      }
      case "correlation":
        if (!results || !results.matrix || !results.labels) return null;
        return (
          <HeatmapChart matrix={results.matrix} labels={results.labels} />
        );
      case "outliers": {
        if (!Array.isArray(results)) return null;
        const points = results.map((r: any) => ({
          x: Number(r.idx),
          y: Number(r.value),
        }));
        const sampleIds = results.map((r: any) => r.sample_id);
        return (
          <ScatterChart
            points={points}
            xLabel="row index"
            yLabel={single}
            onSelectIndices={
              selectSamplesOp
                ? (idxs) =>
                    dispatchSelection({
                      kind: "row_ids",
                      sampleIds: idxs
                        .map((i) => sampleIds[i])
                        .filter(Boolean),
                    })
                : undefined
            }
          />
        );
      }
      case "scatter": {
        if (!Array.isArray(results)) return null;
        const hasColor = !!colorBy;
        const points = results.map((r: any) => ({
          x: Number(r.x),
          y: Number(r.y),
          ...(hasColor ? { group: r.color ?? null } : {}),
        }));
        const sampleIds = results.map((r: any) => r.sample_id);
        return (
          <ScatterChart
            points={points}
            xLabel={single}
            yLabel={single2}
            colorLabel={colorBy || undefined}
            onSelectIndices={
              selectSamplesOp
                ? (idxs) =>
                    dispatchSelection({
                      kind: "row_ids",
                      sampleIds: idxs
                        .map((i) => sampleIds[i])
                        .filter(Boolean),
                    })
                : undefined
            }
          />
        );
      }
      case "groupby":
        if (
          !(
            Array.isArray(results)
            && results.every((r: any) => Array.isArray(r?.values))
          )
        ) return null;
        return (
          <GroupByChart
            groups={results}
            groupLabel={single2}
            valueLabel={single}
            variant={groupVariant}
            onSelectGroup={
              selectSamplesOp
                ? (g) =>
                    dispatchSelection({
                      kind: "values",
                      table: tableName,
                      field: single2,
                      values: [g],
                    })
                : undefined
            }
          />
        );
      case "missing":
        if (!Array.isArray(results)) return null;
        return <MissingTable rows={results} />;
    }
  }, [
    results,
    querying,
    queryError,
    analysis,
    single,
    single2,
    colorBy,
    histVariant,
    groupVariant,
    tableName,
    selectSamplesOp,
    dispatchSelection,
  ]);

  // ---------- Top-level shell ----------

  if (loading) {
    return (
      <Stack
        align={"center" as any}
        justify={"center" as any}
        style={{ height: "100%" }}
      >
        <Spinner size={Size.Lg} />
        <Text color={TextColor.Secondary}>Loading DuckDB-WASM…</Text>
      </Stack>
    );
  }
  if (error) {
    return (
      <div style={{ padding: 16 }}>
        <Toast
          open
          variant={Variant.Danger}
          title="DuckDB init failed"
          description={error}
        />
      </div>
    );
  }
  if (fieldInfo?.error) {
    return (
      <div style={{ padding: 16 }}>
        <Toast open variant={Variant.Secondary} description={fieldInfo.error} />
      </div>
    );
  }
  if (tableNames.length === 0) {
    return (
      <div style={{ padding: 16 }}>
        <Toast
          open
          variant={Variant.Secondary}
          description="No analyzable scalar fields found in the current view."
        />
      </div>
    );
  }

  // ToggleSwitch renders the active tab's content; we share one body across
  // all tabs whose contents depend on the current ``analysis`` state.
  // The Classes tab is special: it owns its own controls + queries and
  // operates on the virtual `labels` table, so it short-circuits.
  const tabBody = analysis === "classes" ? (
    <ClassesView
      ready={ready}
      loadedTables={loadedTables}
      fieldInfo={fieldInfo}
      runQuery={runQuery}
      onSelect={selectSamplesOp ? dispatchSelection : undefined}
    />
  ) : (
    <Stack
      orientation={Orientation.Column}
      spacing={Spacing.Md}
      style={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div>{controls}</div>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "auto",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div style={{ flex: 1, minHeight: 0 }}>{resultArea}</div>
      </div>
    </Stack>
  );

  const tabs = ANALYSES.map((a) => ({
    id: a.id,
    data: { label: a.label, content: tabBody },
  }));
  const activeIndex = Math.max(
    0,
    ANALYSES.findIndex((a) => a.id === analysis),
  );

  return (
    <Stack
      orientation={Orientation.Column}
      spacing={Spacing.Md}
      style={{ height: "100%", padding: 16 }}
    >
      <Stack
        orientation={Orientation.Row}
        spacing={Spacing.Md}
        align={"center" as any}
        style={{ flexWrap: "wrap" }}
      >
        <FormField
          label="Table"
          control={
            <Select
              exclusive
              value={tableName}
              options={tableNames.map((t) => {
                const ti = fieldInfo!.tables[t];
                const n = ti.numeric.length + ti.categorical.length;
                return {
                  id: t,
                  data: { label: t, content: <span>{t} ({n} cols)</span> },
                };
              })}
              onChange={(v) =>
                setTableName(typeof v === "string" ? v : v?.[0] ?? "")
              }
            />
          }
        />
      </Stack>

      <ToggleSwitch
        variant={ToggleSwitchVariant.Default}
        tabs={tabs as any}
        defaultIndex={activeIndex}
        onChange={(idx) => {
          const next = ANALYSES[idx]?.id;
          if (next) setAnalysis(next);
        }}
        fullWidth
        tabPanelClassName="fo-duckdb-tab-panel"
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
        }}
      />

      <Stack
        orientation={Orientation.Row}
        spacing={Spacing.Md}
        style={{
          borderTop: "1px solid var(--fo-palette-divider, #2c2c2c)",
          paddingTop: 8,
        }}
      >
        <TextBadge>
          {fieldInfo?.sample_count?.toLocaleString() ?? 0} samples
        </TextBadge>
        <TextBadge>{loadedTables.length} tables</TextBadge>
        <TextBadge>
          {numeric.length} num · {categorical.length} cat in {tableName}
        </TextBadge>
        <TextBadge>
          query: {queryTime ? `${queryTime.toFixed(1)}ms` : "—"}
        </TextBadge>
      </Stack>
    </Stack>
  );
}
