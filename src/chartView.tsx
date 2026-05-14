import Plotly from "plotly.js-cartesian-dist-min";
import createPlotlyComponent from "react-plotly.js/factory";

import type { ChartBinding, QueryResult } from "./types";
import { autopick } from "./autopick";

export { autopick };

const Plot = createPlotlyComponent(Plotly);

const PLOT_LAYOUT = {
  paper_bgcolor: "rgba(0,0,0,0)",
  plot_bgcolor: "rgba(0,0,0,0)",
  font: { color: "var(--fo-palette-text-primary, #ddd)" },
  margin: { l: 56, r: 16, t: 16, b: 56 },
  autosize: true,
};
const PLOT_CONFIG = { displayModeBar: false, responsive: true };

function pickValues(result: QueryResult, col: string): any[] {
  return result.rows.map((r) => r[col]);
}

function buildTraces(result: QueryResult, binding: ChartBinding) {
  switch (binding.type) {
    case "histogram":
      return [
        {
          type: "histogram",
          x: pickValues(result, binding.x),
          nbinsx: 20,
          marker: { color: "var(--fo-palette-primary, #ff6d04)" },
        },
      ];
    case "bar":
      if (binding.color) {
        const groups = new Map<string, number[]>();
        result.rows.forEach((r, i) => {
          const k = String(r[binding.color!] ?? "(null)");
          if (!groups.has(k)) groups.set(k, []);
          groups.get(k)!.push(i);
        });
        return Array.from(groups.entries()).map(([name, idxs]) => ({
          type: "bar",
          name,
          x: idxs.map((i) => result.rows[i][binding.x]),
          y: binding.y ? idxs.map((i) => result.rows[i][binding.y!]) : undefined,
          customdata: idxs,
        }));
      }
      return [
        {
          type: "bar",
          x: pickValues(result, binding.x),
          y: binding.y ? pickValues(result, binding.y) : undefined,
          customdata: result.rows.map((_, i) => i),
        },
      ];
    case "scatter":
      if (binding.color) {
        const groups = new Map<string, number[]>();
        result.rows.forEach((r, i) => {
          const k = String(r[binding.color!] ?? "(null)");
          if (!groups.has(k)) groups.set(k, []);
          groups.get(k)!.push(i);
        });
        return Array.from(groups.entries()).map(([name, idxs]) => ({
          type: "scattergl",
          mode: "markers",
          name,
          x: idxs.map((i) => result.rows[i][binding.x]),
          y: idxs.map((i) => result.rows[i][binding.y!]),
          customdata: idxs,
        }));
      }
      return [
        {
          type: "scattergl",
          mode: "markers",
          x: pickValues(result, binding.x),
          y: binding.y ? pickValues(result, binding.y) : undefined,
          customdata: result.rows.map((_, i) => i),
        },
      ];
    case "line":
      return [
        {
          type: "scatter",
          mode: "lines",
          x: pickValues(result, binding.x),
          y: binding.y ? pickValues(result, binding.y) : undefined,
        },
      ];
    case "heatmap": {
      // result rows look like { x_col: str, y_col: str, value: num }
      const valueCol =
        result.columns.find((c) => c.name !== binding.x && c.name !== binding.y)
          ?.name ?? "n";
      const xCats = Array.from(new Set(result.rows.map((r) => String(r[binding.x]))));
      const yCats = Array.from(new Set(result.rows.map((r) => String(r[binding.y!]))));
      const z = yCats.map((yv) =>
        xCats.map((xv) => {
          const r = result.rows.find(
            (row) => String(row[binding.x]) === xv && String(row[binding.y!]) === yv,
          );
          return r ? (r[valueCol] as number) : null;
        }),
      );
      return [{ type: "heatmap", x: xCats, y: yCats, z, colorscale: "YlOrRd" }];
    }
    case "heatmap2d": {
      // Use scattergl with customdata so every point is individually
      // selectable. A histogram2d aggregates points into bins and does
      // not expose per-point indices in selection events — which broke
      // chart-to-view selection on the class-spatial template.
      return [
        {
          type: "scattergl",
          mode: "markers",
          x: pickValues(result, binding.x),
          y: binding.y ? pickValues(result, binding.y) : undefined,
          customdata: result.rows.map((_, i) => i),
          marker: { size: 6, opacity: 0.55 },
        },
      ];
    }
    case "box":
    case "violin": {
      // Group by binding.x (categorical), values from binding.y (numeric).
      // Carry per-point customdata = original row index so:
      //  - lasso over outliers / individual points → selection events
      //    return customdata directly.
      //  - click on a box body → handleEvent identifies the group name
      //    and selects every row in that group.
      const groups = new Map<string, { ys: number[]; idxs: number[] }>();
      result.rows.forEach((r, i) => {
        const k = String(r[binding.x] ?? "(null)");
        if (!groups.has(k)) groups.set(k, { ys: [], idxs: [] });
        const v = r[binding.y ?? "value"];
        if (typeof v === "number") {
          const g = groups.get(k)!;
          g.ys.push(v);
          g.idxs.push(i);
        }
      });
      return Array.from(groups.entries()).map(([name, { ys, idxs }]) => ({
        type: binding.type,
        name,
        y: ys,
        customdata: idxs,
        boxpoints: "all",
        jitter: 0.4,
        pointpos: 0,
        marker: { size: 4, opacity: 0.6 },
      }));
    }
    default:
      return [];
  }
}

export function ChartView({
  result,
  binding,
  onSelectIndices,
}: {
  result: QueryResult;
  binding: ChartBinding;
  onSelectIndices?: (rowIndices: number[]) => void;
}) {
  if (binding.type === "table") return null;
  const traces = buildTraces(result, binding);
  if (traces.length === 0) return null;

  // Resolve a Plotly event into row indices.
  //
  // Three event-shape branches:
  // 1. ``customdata`` numeric → direct row index (scatter / scattergl /
  //    bar with color group / box+violin all-points / heatmap2d-as-scatter).
  // 2. ``pointIndex`` numeric, no customdata → single-trace bar/line index
  //    that matches a row in ``result.rows`` directly.
  // 3. Box / violin click on the box body itself (no point coordinates,
  //    just ``fullData.name``) → expand to all rows whose ``binding.x``
  //    matches the group name.
  const handleEvent = (evt: any) => {
    if (!onSelectIndices) return;
    const pts = evt?.points ?? [];
    if (pts.length === 0) return;
    const idxs: number[] = [];
    for (const p of pts) {
      if (typeof p.customdata === "number") {
        idxs.push(p.customdata);
        continue;
      }
      if (typeof p.pointIndex === "number" && p.customdata == null) {
        // Pure single-trace cartesian (line/histogram-bin click): pointIndex
        // is the row index in ``result.rows`` for that trace.
        idxs.push(p.pointIndex);
        continue;
      }
    }
    // Box/violin body-click expansion: if we still have no indices but
    // a trace name is present, select all rows in that group.
    if (
      idxs.length === 0 &&
      (binding.type === "box" || binding.type === "violin") &&
      pts[0]?.data?.name
    ) {
      const groupName = String(pts[0].data.name);
      result.rows.forEach((r, i) => {
        if (String(r[binding.x] ?? "(null)") === groupName) idxs.push(i);
      });
    }
    if (idxs.length > 0) onSelectIndices(idxs);
  };

  // Chart-type-specific drag mode:
  // - lasso for charts where the user expects to draw a region:
  //   scatter, heatmap2d (now a scatter), box, violin (over points).
  // - zoom for everything else; clicks on a bar / line / heatmap cell
  //   still fire plotly_click in zoom mode.
  const lassoTypes = new Set(["scatter", "heatmap2d", "box", "violin"]);
  const dragmode = onSelectIndices && lassoTypes.has(binding.type) ? "lasso" : "zoom";
  return (
    <Plot
      data={traces as any}
      layout={
        {
          ...PLOT_LAYOUT,
          xaxis: { title: binding.x },
          yaxis: { title: binding.y },
          dragmode,
        } as any
      }
      config={PLOT_CONFIG}
      onClick={handleEvent}
      onSelected={handleEvent}
      style={{ width: "100%", height: "100%" }}
      useResizeHandler
    />
  );
}
