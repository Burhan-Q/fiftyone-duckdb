import { describe, it, expect } from "vitest";
import { autopick } from "../../src/chartView";

const col = (name: string, type: string) => ({ name, type });

describe("autopick", () => {
  it("returns histogram for one numeric column", () => {
    expect(autopick([col("uniqueness", "Float64")])).toMatchObject({
      type: "histogram",
      x: "uniqueness",
    });
  });

  it("returns bar for [categorical, numeric]", () => {
    expect(autopick([col("label", "Utf8"), col("n", "Int64")])).toMatchObject({
      type: "bar",
      x: "label",
      y: "n",
    });
  });

  it("returns scatter for two numerics", () => {
    expect(
      autopick([col("bbox_w", "Float64"), col("bbox_h", "Float64")]),
    ).toMatchObject({ type: "scatter", x: "bbox_w", y: "bbox_h" });
  });

  it("returns scatter with color for [num, num, cat]", () => {
    expect(
      autopick([
        col("bbox_w", "Float64"),
        col("bbox_h", "Float64"),
        col("label", "Utf8"),
      ]),
    ).toMatchObject({
      type: "scatter",
      x: "bbox_w",
      y: "bbox_h",
      color: "label",
    });
  });

  it("returns heatmap for (cat, cat, num) named l1/l2/n", () => {
    expect(
      autopick([col("l1", "Utf8"), col("l2", "Utf8"), col("n", "Int64")]),
    ).toMatchObject({ type: "heatmap", x: "l1", y: "l2" });
  });

  it("returns table fallback for unrecognised shapes", () => {
    expect(
      autopick([
        col("a", "Utf8"),
        col("b", "Utf8"),
        col("c", "Utf8"),
        col("d", "Int64"),
      ]),
    ).toMatchObject({ type: "table" });
  });
});
