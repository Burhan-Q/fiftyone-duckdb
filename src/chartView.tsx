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
    case "heatmap2d":
      return [
        {
          type: "histogram2d",
          x: pickValues(result, binding.x),
          y: binding.y ? pickValues(result, binding.y) : undefined,
          colorscale: "YlOrRd",
        },
      ];
    case "box":
    case "violin": {
      // Group by binding.x (categorical), values from binding.y (numeric)
      const groups = new Map<string, number[]>();
      result.rows.forEach((r) => {
        const k = String(r[binding.x] ?? "(null)");
        if (!groups.has(k)) groups.set(k, []);
        const v = r[binding.y ?? "value"];
        if (typeof v === "number") groups.get(k)!.push(v);
      });
      return Array.from(groups.entries()).map(([name, values]) => ({
        type: binding.type,
        name,
        y: values,
        boxpoints: "outliers",
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
  const handleEvent = (evt: any) => {
    if (!onSelectIndices) return;
    const pts = evt?.points ?? [];
    const idxs = pts
      .map((p: any) => (typeof p.customdata === "number" ? p.customdata : p.pointIndex))
      .filter((v: any) => typeof v === "number");
    if (idxs.length > 0) onSelectIndices(idxs);
  };
  // Chart-type-specific drag mode:
  // - bar / heatmap / box / violin / line / histogram: clicks select a
  //   category/cell directly, so dragmode stays "zoom" (or "false") to
  //   allow click events to reach the trace.
  // - scatter / heatmap2d: regions of points/density are selected via
  //   lasso, so dragmode is "lasso".
  const lassoTypes = new Set(["scatter", "heatmap2d"]);
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
