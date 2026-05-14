// @ts-expect-error: no type defs for the cartesian-dist sub-export
import Plotly from "plotly.js-cartesian-dist-min";
import createPlotlyComponent from "react-plotly.js/factory";

import type { ChartBinding, ColumnMeta, QueryResult } from "./types";

const Plot = createPlotlyComponent(Plotly);

const PLOT_LAYOUT = {
  paper_bgcolor: "rgba(0,0,0,0)",
  plot_bgcolor: "rgba(0,0,0,0)",
  font: { color: "var(--fo-palette-text-primary, #ddd)" },
  margin: { l: 56, r: 16, t: 16, b: 56 },
  autosize: true,
};
const PLOT_CONFIG = { displayModeBar: false, responsive: true };

const NUMERIC_TYPES = new Set([
  "Float64", "Float32", "Int64", "Int32", "Int16", "Int8",
  "Uint64", "Uint32", "Uint16", "Uint8",
]);

function isNumeric(c: ColumnMeta): boolean {
  // DuckDB-WASM arrow type names look like "Float64", "Utf8", etc.
  // Match against a known set; default to "not numeric" when in doubt.
  for (const k of NUMERIC_TYPES) {
    if (c.type.includes(k)) return true;
  }
  return false;
}

function isCategorical(c: ColumnMeta): boolean {
  return c.type.includes("Utf8") || c.type.includes("Utf16") || c.type === "Bool";
}

export function autopick(cols: ColumnMeta[]): ChartBinding {
  if (cols.length === 0) return { type: "table", x: "" };
  if (cols.length === 1) {
    const c = cols[0];
    if (isNumeric(c)) return { type: "histogram", x: c.name };
    return { type: "bar", x: c.name };
  }
  if (cols.length === 2) {
    const [a, b] = cols;
    if (isNumeric(a) && isNumeric(b)) return { type: "scatter", x: a.name, y: b.name };
    if (isCategorical(a) && isNumeric(b)) return { type: "bar", x: a.name, y: b.name };
    if (isNumeric(a) && isCategorical(b)) return { type: "bar", x: b.name, y: a.name };
  }
  if (cols.length === 3) {
    const [a, b, c] = cols;
    const numerics = [a, b, c].filter(isNumeric);
    const cats = [a, b, c].filter(isCategorical);
    if (numerics.length === 2 && cats.length === 1) {
      return {
        type: "scatter",
        x: numerics[0].name,
        y: numerics[1].name,
        color: cats[0].name,
      };
    }
    // (cat, cat, num) heatmap pattern — matches `l1, l2, n` style results
    if (cats.length === 2 && numerics.length === 1) {
      return { type: "heatmap", x: cats[0].name, y: cats[1].name };
    }
  }
  return { type: "table", x: "" };
}

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
      return [
        {
          type: "bar",
          x: pickValues(result, binding.x),
          y: binding.y ? pickValues(result, binding.y) : undefined,
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
  return (
    <Plot
      data={traces as any}
      layout={
        {
          ...PLOT_LAYOUT,
          xaxis: { title: binding.x },
          yaxis: { title: binding.y },
          dragmode: onSelectIndices ? "lasso" : "zoom",
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
