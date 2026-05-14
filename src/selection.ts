import { useCallback } from "react";
import { useSetView } from "@fiftyone/state";

import type { QueryResult } from "./types";

function pickIdColumn(result: QueryResult): string | null {
  const names = result.columns.map((c) => c.name);
  if (names.includes("sample_id")) return "sample_id";
  if (names.includes("id")) return "id";
  return null;
}

/**
 * Build the FiftyOne view stages for a sample-id selection.
 *
 * - Empty ids: empty stage list (clears the view).
 * - Non-empty: single Select stage with the ids.
 *
 * Format matches what ``ctx.ops.set_view`` produces server-side, but
 * we apply it directly to the client's view atom via useSetView, which
 * is materially faster and skips the operator-queue round-trip.
 */
function buildSelectStages(ids: string[]): any[] {
  if (ids.length === 0) return [];
  return [
    {
      _cls: "fiftyone.core.stages.Select",
      kwargs: [
        ["sample_ids", ids],
        ["ordered", false],
      ],
    },
  ];
}

export function useSelectionDispatcher(result: QueryResult | null) {
  const setView = useSetView();

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
      setView(buildSelectStages(ids));
    },
    [result, setView],
  );
}

export function resultHasSelectableIds(result: QueryResult | null): boolean {
  if (!result) return false;
  return pickIdColumn(result) !== null;
}
