import React from "react";
import createPlotlyComponent from "react-plotly.js/factory";
import Plotly from "plotly.js-cartesian-dist-min";
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from "@voxel51/voodo";

const Plot = createPlotlyComponent(Plotly as any);

const COMMON_CONFIG = {
  responsive: true,
  displayModeBar: false,
} as const;

const COMMON_LAYOUT = {
  autosize: true,
  margin: { l: 64, r: 24, t: 24, b: 56 },
  paper_bgcolor: "transparent",
  plot_bgcolor: "transparent",
  font: { color: "var(--fo-palette-text-primary, #ddd)" },
  hoverlabel: {
    bgcolor: "var(--fo-palette-background-paper, #1f1f1f)",
    font: { color: "var(--fo-palette-text-primary, #ddd)" },
  },
} as const;

const ORANGE = "#ff6d05";

const num = (v: any): number | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === "bigint") return Number(v);
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

const fmt = (n: number | null | undefined, digits = 4) =>
  n === null || n === undefined || Number.isNaN(n)
    ? "—"
    : Number(n).toLocaleString(undefined, {
        maximumFractionDigits: digits,
      });

// ---------- Stats summary table ----------
export type StatsRow = {
  field: string;
  count: number;
  mean: number | null;
  std: number | null;
  min: number | null;
  q1: number | null;
  median: number | null;
  q3: number | null;
  max: number | null;
};

export function StatsTable({ rows }: { rows: StatsRow[] }) {
  return (
    <Table style={{ width: "100%" }}>
      <TableHeader>
        <TableRow>
          {["Field", "Count", "Mean", "Std", "Min", "Q1", "Median", "Q3", "Max"].map(
            (h) => (
              <TableHead key={h}>{h}</TableHead>
            ),
          )}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.field}>
            <TableCell>{r.field}</TableCell>
            <TableCell>{fmt(num(r.count), 0)}</TableCell>
            <TableCell>{fmt(num(r.mean))}</TableCell>
            <TableCell>{fmt(num(r.std))}</TableCell>
            <TableCell>{fmt(num(r.min))}</TableCell>
            <TableCell>{fmt(num(r.q1))}</TableCell>
            <TableCell>{fmt(num(r.median))}</TableCell>
            <TableCell>{fmt(num(r.q3))}</TableCell>
            <TableCell>{fmt(num(r.max))}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

// ---------- Histogram ----------
export type HistogramVariant = "bar" | "area";

export function HistogramChart({
  bins,
  counts,
  field,
  variant = "bar",
}: {
  bins: (number | bigint)[];
  counts: (number | bigint)[];
  field: string;
  variant?: HistogramVariant;
}) {
  const x = bins.map((v) => num(v) ?? 0);
  const y = counts.map((v) => num(v) ?? 0);
  if (x.length === 0) {
    return <EmptyChart message="No values to plot" />;
  }
  const trace: any =
    variant === "area"
      ? {
          type: "scatter",
          x,
          y,
          mode: "lines",
          fill: "tozeroy",
          line: { color: ORANGE, shape: "spline" },
          hovertemplate: `${field}: %{x:.4f}<br>count: %{y}<extra></extra>`,
        }
      : {
          type: "bar",
          x,
          y,
          marker: { color: ORANGE, line: { color: ORANGE, width: 0 } },
          hovertemplate: `${field}: %{x:.4f}<br>count: %{y}<extra></extra>`,
        };
  return (
    <Plot
      data={[trace]}
      layout={{
        ...COMMON_LAYOUT,
        bargap: 0.04,
        xaxis: { title: { text: field } },
        yaxis: { title: { text: "count" }, rangemode: "tozero" },
      }}
      config={COMMON_CONFIG}
      style={{ width: "100%", height: "100%" }}
      useResizeHandler
    />
  );
}

// ---------- Heatmap (correlation matrix) ----------
export function HeatmapChart({
  matrix,
  labels,
}: {
  matrix: (number | null)[][];
  labels: string[];
}) {
  if (!matrix || matrix.length === 0 || !labels || labels.length === 0) {
    return <EmptyChart message="Pick 2+ numeric fields to correlate" />;
  }
  const safeMatrix = matrix.map((row) =>
    row.map((v) => (v === null || v === undefined ? Number.NaN : Number(v))),
  );
  const text = safeMatrix.map((row) =>
    row.map((v) => (Number.isFinite(v) ? v.toFixed(2) : "—")),
  );
  return (
    <Plot
      data={[
        {
          type: "heatmap",
          z: safeMatrix,
          x: labels,
          y: labels,
          colorscale: "RdBu",
          zmin: -1,
          zmax: 1,
          reversescale: true,
          hovertemplate: "%{y} ↔ %{x}: %{z:.3f}<extra></extra>",
          text,
          texttemplate: "%{text}",
          textfont: { color: "white", size: 11 },
        } as any,
      ]}
      layout={{
        ...COMMON_LAYOUT,
        xaxis: { tickangle: -30, automargin: true },
        yaxis: { autorange: "reversed", automargin: true },
      }}
      config={COMMON_CONFIG}
      style={{ width: "100%", height: "100%" }}
      useResizeHandler
    />
  );
}

// ---------- Scatter ----------
export type ScatterPoint = {
  x: number;
  y: number;
  group?: string | null;
};

export function ScatterChart({
  points,
  xLabel,
  yLabel,
  colorLabel,
}: {
  points: ScatterPoint[];
  xLabel: string;
  yLabel: string;
  colorLabel?: string;
}) {
  if (!points || points.length === 0) {
    return <EmptyChart message="No points to plot" />;
  }
  const hasGroups = points.some((p) => p.group !== undefined);
  let traces: any[];
  if (hasGroups) {
    const groups = new Map<string, ScatterPoint[]>();
    for (const p of points) {
      const k = p.group == null ? "(null)" : String(p.group);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(p);
    }
    traces = Array.from(groups.entries()).map(([name, pts]) => ({
      type: "scattergl",
      mode: "markers",
      name,
      x: pts.map((p) => num(p.x)),
      y: pts.map((p) => num(p.y)),
      marker: { size: 5, opacity: 0.7 },
    }));
  } else {
    traces = [
      {
        type: "scattergl",
        mode: "markers",
        x: points.map((p) => num(p.x)),
        y: points.map((p) => num(p.y)),
        marker: { size: 5, opacity: 0.7, color: ORANGE },
      },
    ];
  }
  return (
    <Plot
      data={traces}
      layout={{
        ...COMMON_LAYOUT,
        xaxis: { title: { text: xLabel } },
        yaxis: { title: { text: yLabel } },
        showlegend: hasGroups,
        legend: { title: { text: colorLabel ?? "" } },
      }}
      config={COMMON_CONFIG}
      style={{ width: "100%", height: "100%" }}
      useResizeHandler
    />
  );
}

// ---------- Group-by ----------
export type GroupedValues = { group: string; values: number[] };
export type GroupByVariant = "box" | "violin" | "bar";

export function GroupByChart({
  groups,
  groupLabel,
  valueLabel,
  variant = "box",
}: {
  groups: GroupedValues[];
  groupLabel: string;
  valueLabel: string;
  variant?: GroupByVariant;
}) {
  if (!groups || groups.length === 0) {
    return <EmptyChart message="Pick a numeric and a categorical field" />;
  }
  let traces: any[];
  if (variant === "bar") {
    traces = [
      {
        type: "bar",
        x: groups.map((g) => g.group),
        y: groups.map((g) => {
          const vals = g.values.map((v) => num(v) ?? 0);
          if (vals.length === 0) return 0;
          return vals.reduce((a, b) => a + b, 0) / vals.length;
        }),
        marker: { color: ORANGE },
        hovertemplate: `${groupLabel}: %{x}<br>mean ${valueLabel}: %{y:.4f}<extra></extra>`,
      },
    ];
  } else if (variant === "violin") {
    traces = groups.map((g) => ({
      type: "violin",
      name: g.group,
      y: g.values.map((v) => num(v) ?? 0),
      points: "outliers",
      box: { visible: true },
      meanline: { visible: true },
    }));
  } else {
    traces = groups.map((g) => ({
      type: "box",
      name: g.group,
      y: g.values.map((v) => num(v) ?? 0),
      boxpoints: "outliers",
    }));
  }
  return (
    <Plot
      data={traces}
      layout={{
        ...COMMON_LAYOUT,
        xaxis: { title: { text: groupLabel }, automargin: true },
        yaxis: { title: { text: valueLabel } },
        showlegend: false,
      }}
      config={COMMON_CONFIG}
      style={{ width: "100%", height: "100%" }}
      useResizeHandler
    />
  );
}

// ---------- Missing values table ----------
export type MissingRow = {
  field: string;
  type: "numeric" | "categorical";
  total: number;
  null_count: number;
  null_pct: number;
};

export function MissingTable({ rows }: { rows: MissingRow[] }) {
  return (
    <Table style={{ width: "100%" }}>
      <TableHeader>
        <TableRow>
          {["Field", "Type", "Total", "Null", "Null %"].map((h) => (
            <TableHead key={h}>{h}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.field}>
            <TableCell>{r.field}</TableCell>
            <TableCell>{r.type}</TableCell>
            <TableCell>{fmt(num(r.total), 0)}</TableCell>
            <TableCell>{fmt(num(r.null_count), 0)}</TableCell>
            <TableCell>{fmt(num(r.null_pct), 1)}%</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

// ---------- Helpers ----------
function EmptyChart({ message }: { message: string }) {
  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--fo-palette-text-secondary, #999)",
        fontSize: 13,
      }}
    >
      {message}
    </div>
  );
}
