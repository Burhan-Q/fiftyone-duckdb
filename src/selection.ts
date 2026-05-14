import { useCallback, useRef } from "react";
import { useOperatorExecutor } from "@fiftyone/operators";

import type { QueryResult } from "./types";

const SELECT_OP = "@Burhan-Q/fo-duckdb/select_samples";

function pickIdColumn(result: QueryResult): string | null {
  const names = result.columns.map((c) => c.name);
  if (names.includes("sample_id")) return "sample_id";
  if (names.includes("id")) return "id";
  return null;
}

export function useSelectionDispatcher(result: QueryResult | null) {
  const executor = useOperatorExecutor(SELECT_OP);
  const inflightRef = useRef(0);

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
      // Token bookkeeping is preserved so a future move to an async
      // executor (or a debouncer) has the inflight guard ready.
      inflightRef.current += 1;
      executor.execute({ ids });
    },
    [executor, result],
  );
}

export function resultHasSelectableIds(result: QueryResult | null): boolean {
  if (!result) return false;
  return pickIdColumn(result) !== null;
}
