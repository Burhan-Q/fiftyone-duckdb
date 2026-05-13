/**
 * Chart-to-view selection (Phase 7).
 *
 * Generic plumbing that turns a chart-side click/lasso event into a list of
 * FiftyOne sample IDs and ships them to the Python ``select_samples``
 * handler, which calls ``ctx.ops.set_view`` to filter the App's grid.
 *
 * Modelled on the embeddings rope-select UX: no confirmation step, no size
 * cap, clearing the chart selection (or the View bar's reset) reverts.
 */
import { useCallback, useRef } from "react";
import { useTriggerPanelEvent } from "@fiftyone/operators";
import { usePanelId } from "@fiftyone/spaces";

const q = (name: string) => `"${name.replace(/"/g, '""')}"`;
const esc = (v: string) => v.replace(/'/g, "''");

/**
 * Criteria the dispatcher knows how to turn into a SELECT ... sample_id query.
 *
 * - ``labels``: match labels in the virtual ``labels`` table by source/label.
 * - ``range``: match rows in any table where ``field`` ∈ [min,max] (or two
 *   fields each in their own range, for 2-D box selections).
 * - ``values``: match a single field against a list of values
 *   (e.g. Group-by click on a category).
 * - ``row_ids``: pre-computed sample ids (Scatter/Outliers lasso, where the
 *   chart already has access to the row data).
 */
export type SelectionCriteria =
  | {
      kind: "labels";
      sources: string[];
      labels: string[];
      /** Optional rectangular bbox filter; for the Spatial sub-view. */
      bbox?: { x0: number; x1: number; y0: number; y1: number };
    }
  | {
      kind: "range";
      table: string;
      field: string;
      min: number;
      max: number;
      /** Optional second field range (for box-select on a 2-D plot). */
      field2?: string;
      min2?: number;
      max2?: number;
    }
  | {
      kind: "values";
      table: string;
      field: string;
      values: Array<string | number>;
    }
  | {
      kind: "row_ids";
      /** Already-resolved sample ids from a chart whose rows carry them. */
      sampleIds: string[];
    }
  | { kind: "labels_cooccur"; source: string; labelA: string; labelB: string };

export function criteriaToSampleIdSql(c: SelectionCriteria): string | null {
  if (c.kind === "row_ids") return null; // no SQL needed
  if (c.kind === "labels") {
    if (c.sources.length === 0 || c.labels.length === 0) return null;
    const srcList = c.sources.map((s) => `'${esc(s)}'`).join(", ");
    const labList = c.labels.map((s) => `'${esc(s)}'`).join(", ");
    const bbox = c.bbox
      ? ` AND bbox_cx BETWEEN ${c.bbox.x0} AND ${c.bbox.x1}` +
        ` AND bbox_cy BETWEEN ${c.bbox.y0} AND ${c.bbox.y1}`
      : "";
    return `SELECT DISTINCT sample_id
      FROM labels
      WHERE source IN (${srcList}) AND label IN (${labList})${bbox}`;
  }
  if (c.kind === "values") {
    if (c.values.length === 0) return null;
    const inList = c.values
      .map((v) => (typeof v === "number" ? String(v) : `'${esc(String(v))}'`))
      .join(", ");
    // Tables other than ``samples`` carry a ``sample_id`` FK; the samples
    // table uses its own ``id``.
    const idCol = c.table === "samples" ? "id" : "sample_id";
    return `SELECT DISTINCT ${q(idCol)} AS sample_id
      FROM ${q(c.table)}
      WHERE ${q(c.field)} IN (${inList})`;
  }
  if (c.kind === "range") {
    const idCol = c.table === "samples" ? "id" : "sample_id";
    const second =
      c.field2 !== undefined && c.min2 !== undefined && c.max2 !== undefined
        ? ` AND ${q(c.field2)} BETWEEN ${c.min2} AND ${c.max2}`
        : "";
    return `SELECT DISTINCT ${q(idCol)} AS sample_id
      FROM ${q(c.table)}
      WHERE ${q(c.field)} BETWEEN ${c.min} AND ${c.max}${second}`;
  }
  if (c.kind === "labels_cooccur") {
    return `SELECT a.sample_id
      FROM labels a JOIN labels b USING (sample_id)
      WHERE a.source = '${esc(c.source)}' AND b.source = '${esc(c.source)}'
        AND a.label = '${esc(c.labelA)}' AND b.label = '${esc(c.labelB)}'`;
  }
  return null;
}

/**
 * Hook returning a ``dispatch(criteria)`` callback.
 *
 * - Coalesces rapid-fire dispatches: only the most recent criteria's SQL
 *   result is shipped to Python (older in-flight queries are discarded).
 * - Resolves to an empty id list → triggers ``clear_view`` on the Python
 *   side via the same handler.
 */
export interface UseSelectionDispatcherOpts {
  runQuery: <T = any>(sql: string) => Promise<T[]>;
  selectSamplesOp: any;
}

export function useSelectionDispatcher({
  runQuery,
  selectSamplesOp,
}: UseSelectionDispatcherOpts) {
  const triggerEvent = useTriggerPanelEvent();
  const panelId = usePanelId();
  const inflightRef = useRef(0);

  return useCallback(
    async (criteria: SelectionCriteria) => {
      const token = ++inflightRef.current;
      let ids: string[];
      if (criteria.kind === "row_ids") {
        ids = criteria.sampleIds;
      } else {
        const sql = criteriaToSampleIdSql(criteria);
        if (!sql) {
          ids = [];
        } else {
          try {
            const rows = await runQuery<{ sample_id: string }>(sql);
            if (token !== inflightRef.current) return; // stale
            ids = rows.map((r) => r.sample_id).filter(Boolean);
          } catch {
            return; // swallow; user can retry
          }
        }
      }
      if (token !== inflightRef.current) return;
      triggerEvent(panelId, {
        operator: selectSamplesOp,
        params: { ids },
      });
    },
    [runQuery, triggerEvent, panelId, selectSamplesOp],
  );
}
