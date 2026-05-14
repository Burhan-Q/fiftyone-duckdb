import type { ChartBinding, ColumnMeta } from "./types";

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
