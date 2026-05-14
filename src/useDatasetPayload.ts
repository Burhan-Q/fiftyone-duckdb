import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRecoilValue } from "recoil";
import { useOperatorExecutor } from "@fiftyone/operators";
import * as fos from "@fiftyone/state";

import type { DatasetPayload } from "./types";

const LOAD_OP = "@Burhan-Q/fo-duckdb/load_dataset_payload";

async function hashStages(stages: any): Promise<string> {
  const payload = JSON.stringify(stages ?? []);
  const enc = new TextEncoder().encode(payload);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function useDatasetPayload(autoRefresh: boolean) {
  const [payload, setPayload] = useState<DatasetPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentViewHash, setCurrentViewHash] = useState("");
  const executor = useOperatorExecutor(LOAD_OP);
  const hasFiredRef = useRef(false);

  const viewStages = useRecoilValue<any>(fos.view);

  const refresh = useCallback(() => {
    setLoading(true);
    setError(null);
    executor.execute({});
  }, [executor]);

  // Fire once on mount; subsequent invocations come from the Refresh button
  // or auto-refresh logic.
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

  // Track current view's stage hash (client-side) and compare against
  // the hash baked into the last operator response.
  useEffect(() => {
    let cancelled = false;
    hashStages(viewStages).then((h) => {
      if (!cancelled) setCurrentViewHash(h);
    });
    return () => {
      cancelled = true;
    };
  }, [viewStages]);

  const payloadViewHash = payload?.field_info.view_stage_hash ?? "";
  const stale = useMemo(() => {
    if (!payload) return false;
    if (!currentViewHash) return false;
    return currentViewHash !== payloadViewHash;
  }, [payload, currentViewHash, payloadViewHash]);

  // Auto-refresh on view change when the toggle is on.
  useEffect(() => {
    if (autoRefresh && stale) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh, stale]);

  return { payload, loading, error, refresh, stale };
}
