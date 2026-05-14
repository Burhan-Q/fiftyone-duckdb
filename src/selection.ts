import { useCallback } from "react";
import { useSetRecoilState } from "recoil";
import { extendedSelection, selectedSamples } from "@fiftyone/state";

import type { QueryResult } from "./types";

const PANEL_SCOPE = "duckdb_analytics";

function pickIdColumn(result: QueryResult): string | null {
  const names = result.columns.map((c) => c.name);
  if (names.includes("sample_id")) return "sample_id";
  if (names.includes("id")) return "id";
  return null;
}

/**
 * Lasso-to-view selection for the DuckDB Analytics panel.
 *
 * Per ``.ref/FIFTYONE_LASSO_VIEW_UPDATE.md`` (the embeddings-panel
 * reference flow), the canonical JS-only path is:
 *
 *   1. ``setSelectedSamples(new Map())`` — clear any grid-click selection
 *      so the lasso supersedes.
 *   2. ``setExtendedSelection({selection: ids, scope: PANEL_SCOPE})`` —
 *      writing the atom triggers ``extendedStagesUnsorted`` to derive a
 *      ``Select(sample_ids=...)`` view stage; the grid re-filters
 *      automatically via Relay.
 *
 * The legacy closure-current bug on ``extendedSelection`` only affects
 * hybrid panels (those that trigger GraphQL refetches via Python
 * lifecycle handlers). The redesigned DuckDB panel is JS-only and has
 * no such handlers, so this path is reliable.
 */
export function useSelectionDispatcher(result: QueryResult | null) {
  const setExtendedSelection = useSetRecoilState(extendedSelection);
  const setSelectedSamples = useSetRecoilState(selectedSamples);

  return useCallback(
    (indices: number[]) => {
      if (!result) return;
      const idCol = pickIdColumn(result);
      if (!idCol) return;
      const ids = Array.from(
        new Set(
          indices
            .map((i) => result.rows[i]?.[idCol])
            .filter((v): v is string => typeof v === "string" && v.length > 0),
        ),
      );
      setSelectedSamples(new Map());
      setExtendedSelection({
        selection: ids.length > 0 ? ids : null,
        scope: PANEL_SCOPE,
      });
    },
    [result, setExtendedSelection, setSelectedSamples],
  );
}

export function resultHasSelectableIds(result: QueryResult | null): boolean {
  if (!result) return false;
  return pickIdColumn(result) !== null;
}

/**
 * Returns a callback that clears the panel's current chart-driven
 * selection: drops the ``extendedSelection`` overlay so the grid
 * returns to its underlying view, and wipes any grid-click selections
 * that might still be lingering.
 */
export function useClearSelection() {
  const setExtendedSelection = useSetRecoilState(extendedSelection);
  const setSelectedSamples = useSetRecoilState(selectedSamples);
  return useCallback(() => {
    setExtendedSelection({ selection: null, scope: PANEL_SCOPE });
    setSelectedSamples(new Map());
  }, [setExtendedSelection, setSelectedSamples]);
}
