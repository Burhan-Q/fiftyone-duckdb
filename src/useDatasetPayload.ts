import { useCallback, useEffect, useRef, useState } from "react";
import { useOperatorExecutor } from "@fiftyone/operators";

import type { DatasetPayload } from "./types";

const LOAD_OP = "@Burhan-Q/fo-duckdb/load_dataset_payload";

export function useDatasetPayload() {
  const [payload, setPayload] = useState<DatasetPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const executor = useOperatorExecutor(LOAD_OP);
  const hasFiredRef = useRef(false);

  const refresh = useCallback(() => {
    setLoading(true);
    setError(null);
    executor.execute({});
  }, [executor]);

  // Fire once on mount; subsequent invocations come from the Refresh button.
  useEffect(() => {
    if (hasFiredRef.current) return;
    hasFiredRef.current = true;
    refresh();
  }, [refresh]);

  // Watch the executor's `result` — the canonical pattern for top-level
  // Python operators in FiftyOne JS panels. `execute()` is fire-and-
  // forget; the result lands here when the operator's Python side returns.
  useEffect(() => {
    const r = executor.result;
    if (r == null) return;
    // FiftyOne wraps operator outputs as `{result: <outputs>}`; if the
    // top-level shape already matches DatasetPayload, accept it directly.
    const data: any = (r && typeof r === "object" && "tables" in r)
      ? r
      : (r as any)?.result;
    if (!data || typeof data !== "object" || !data.tables) {
      setError("Operator returned an empty payload");
      setPayload(null);
      setLoading(false);
      return;
    }
    setPayload(data as DatasetPayload);
    setError(null);
    setLoading(false);
  }, [executor.result]);

  // Surface operator errors.
  useEffect(() => {
    if (executor.error) {
      setError(
        typeof executor.error === "string"
          ? executor.error
          : (executor.error as any)?.message ?? String(executor.error),
      );
      setLoading(false);
    }
  }, [executor.error]);

  return { payload, loading, error, refresh };
}
