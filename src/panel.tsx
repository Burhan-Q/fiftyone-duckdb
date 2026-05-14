import { useCallback, useEffect, useState } from "react";
import { usePanelStatePartial } from "@fiftyone/spaces";
import {
  FormField,
  Select,
  Stack,
  Text,
  TextBadge,
  Toast,
  Orientation,
  Spacing,
  Variant,
  TextColor,
} from "@voxel51/voodo";

import { useDatasetPayload } from "./useDatasetPayload";
import { useDuckDB } from "./useDuckDB";
import { SqlEditor } from "./sqlEditor";
import { ResultTable } from "./resultTable";
import { ChartView, autopick } from "./chartView";
import type { ChartBinding, ChartType, QueryResult } from "./types";

const DEFAULT_SQL = "SELECT COUNT(*) AS n FROM samples";

const CHART_OPTIONS: { id: ChartType; label: string }[] = [
  { id: "auto", label: "Auto" },
  { id: "table", label: "Table" },
  { id: "bar", label: "Bar" },
  { id: "histogram", label: "Histogram" },
  { id: "scatter", label: "Scatter" },
  { id: "line", label: "Line" },
  { id: "heatmap", label: "Heatmap" },
  { id: "heatmap2d", label: "Heatmap (2D)" },
  { id: "box", label: "Box plot" },
  { id: "violin", label: "Violin" },
];

export function DuckDBPanel() {
  const { payload, loading, error, refresh } = useDatasetPayload();
  const { ready, error: dbError, loadedTables, runQuery } = useDuckDB(payload);

  const [sqlText, setSqlText] = usePanelStatePartial<string>("sql", DEFAULT_SQL, true);
  const [chartType, setChartType] = usePanelStatePartial<ChartType>(
    "chartType", "auto", true,
  );
  const [xCol, setXCol] = usePanelStatePartial<string>("xCol", "", true);
  const [yCol, setYCol] = usePanelStatePartial<string>("yCol", "", true);
  const [colorCol, setColorCol] = usePanelStatePartial<string>("colorCol", "", true);

  const [result, setResult] = useState<QueryResult | null>(null);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [querying, setQuerying] = useState(false);

  const onRun = useCallback(async () => {
    if (!ready) return;
    setQuerying(true);
    setQueryError(null);
    try {
      const r = await runQuery(sqlText);
      setResult(r);
    } catch (e: any) {
      setQueryError(e?.message ?? String(e));
      setResult(null);
    } finally {
      setQuerying(false);
    }
  }, [ready, runQuery, sqlText]);

  // When a fresh result arrives, fall back to auto-picked binding for any
  // currently-empty / invalid column selections. User-set values survive.
  useEffect(() => {
    if (!result) return;
    const names = result.columns.map((c) => c.name);
    const auto = autopick(result.columns);
    if (!xCol || !names.includes(xCol)) setXCol(auto.x);
    if (auto.y && (!yCol || !names.includes(yCol))) setYCol(auto.y);
    else if (yCol && !names.includes(yCol)) setYCol("");
    if (auto.color && (!colorCol || !names.includes(colorCol))) setColorCol(auto.color);
    else if (colorCol && !names.includes(colorCol)) setColorCol("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  const effectiveBinding: ChartBinding | null = (() => {
    if (!result) return null;
    if (chartType === "auto") return autopick(result.columns);
    return {
      type: chartType,
      x: xCol || autopick(result.columns).x,
      y: yCol || undefined,
      color: colorCol || undefined,
    };
  })();

  if (loading) {
    return (
      <Stack orientation={Orientation.Column} spacing={Spacing.Md} style={{ padding: 16 }}>
        <Text>Loading dataset…</Text>
      </Stack>
    );
  }
  if (error) {
    return <div style={{ padding: 16 }}><Toast open variant={Variant.Danger} title="Load failed" description={error} /></div>;
  }
  if (dbError) {
    return <div style={{ padding: 16 }}><Toast open variant={Variant.Danger} title="DuckDB error" description={dbError} /></div>;
  }
  const info = payload?.field_info;
  const tableNames = info ? Object.keys(info.tables) : [];
  const colNames = result?.columns.map((c) => c.name) ?? [];

  return (
    <Stack orientation={Orientation.Column} spacing={Spacing.Md} style={{ height: "100%", padding: 16 }}>
      <Stack orientation={Orientation.Row} spacing={Spacing.Md} align={"center" as any}>
        <TextBadge>{info?.dataset_name ?? "—"}</TextBadge>
        <TextBadge>{info?.sample_count ?? 0} samples</TextBadge>
        <TextBadge>tables: {tableNames.join(", ") || "—"}</TextBadge>
        <button onClick={refresh}>Refresh data</button>
        <button disabled={!ready || querying} onClick={onRun}>
          {querying ? "Running…" : "Run (⌘↵)"}
        </button>
      </Stack>

      <SqlEditor value={sqlText} onChange={setSqlText} onRun={onRun} />

      {queryError ? (
        <Toast open variant={Variant.Danger} title="Query failed" description={queryError} />
      ) : result && effectiveBinding ? (
        <Stack
          orientation={Orientation.Column}
          spacing={Spacing.Sm}
          style={{ flex: 1, minHeight: 0 }}
        >
          <Stack orientation={Orientation.Row} spacing={Spacing.Md} align={"center" as any}>
            <TextBadge>
              {result.rows.length.toLocaleString()} rows · {result.queryTimeMs.toFixed(1)} ms
            </TextBadge>
            <FormField
              label="Chart"
              control={
                <Select
                  exclusive
                  value={chartType}
                  options={CHART_OPTIONS.map((o) => ({ id: o.id, data: { label: o.label } }))}
                  onChange={(v) => setChartType((typeof v === "string" ? v : "auto") as ChartType)}
                />
              }
            />
            {chartType !== "auto" && chartType !== "table" && (
              <>
                <FormField
                  label="X"
                  control={
                    <Select
                      exclusive
                      value={xCol || effectiveBinding.x}
                      options={colNames.map((n) => ({ id: n, data: { label: n } }))}
                      onChange={(v) => setXCol(typeof v === "string" ? v : v?.[0] ?? "")}
                    />
                  }
                />
                <FormField
                  label="Y"
                  control={
                    <Select
                      exclusive
                      value={yCol}
                      options={[
                        { id: "", data: { label: "(none)" } },
                        ...colNames.map((n) => ({ id: n, data: { label: n } })),
                      ]}
                      onChange={(v) => setYCol(typeof v === "string" ? v : v?.[0] ?? "")}
                    />
                  }
                />
                <FormField
                  label="Color"
                  control={
                    <Select
                      exclusive
                      value={colorCol}
                      options={[
                        { id: "", data: { label: "(none)" } },
                        ...colNames.map((n) => ({ id: n, data: { label: n } })),
                      ]}
                      onChange={(v) => setColorCol(typeof v === "string" ? v : v?.[0] ?? "")}
                    />
                  }
                />
              </>
            )}
          </Stack>
          <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
            {effectiveBinding.type === "table"
              ? <ResultTable result={result} />
              : <ChartView result={result} binding={effectiveBinding} />}
          </div>
        </Stack>
      ) : (
        <Text color={TextColor.Secondary}>
          Loaded tables: {loadedTables.join(", ") || "(none)"}.
          Press Run or ⌘↵ to execute.
        </Text>
      )}
    </Stack>
  );
}
