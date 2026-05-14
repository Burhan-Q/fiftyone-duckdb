import { describe, it, expect } from "vitest";
import { TEMPLATES } from "../../src/templates";

describe("TEMPLATES", () => {
  it("has 13 entries", () => {
    expect(TEMPLATES).toHaveLength(13);
  });
  it("every template has a unique id, non-empty sql, label", () => {
    const ids = new Set();
    for (const t of TEMPLATES) {
      expect(t.id).toBeTruthy();
      expect(t.label).toBeTruthy();
      expect(t.sql.trim().length).toBeGreaterThan(0);
      expect(ids.has(t.id)).toBe(false);
      ids.add(t.id);
    }
  });
  it("SQL strings look like SELECT statements", () => {
    for (const t of TEMPLATES) {
      expect(t.sql.toUpperCase()).toMatch(/SELECT|WITH/);
    }
  });
});
