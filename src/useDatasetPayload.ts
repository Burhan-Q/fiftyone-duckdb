import { useCallback, useEffect, useState } from "react";
import { useOperatorExecutor } from "@fiftyone/operators";

import type { DatasetPayload } from "./types";

const LOAD_OP = "@Burhan-Q/fo-duckdb/load_dataset_payload";

export function useDatasetPayload() {
  const [payload, setPayload] = useState<DatasetPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const executor = useOperatorExecutor(LOAD_OP);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await executor.execute({});
      const data = (res as any)?.result ?? null;
      if (!data || typeof data !== "object" || !data.tables) {
        throw new Error("Operator returned an empty payload");
      }
      setPayload(data as DatasetPayload);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [executor]);

  // Auto-fetch on first mount only. View-change detection is handled
  // by the caller (panel.tsx) via the fos.view subscription.
  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { payload, loading, error, refresh };
}
