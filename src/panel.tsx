import { useCallback, useState } from "react";
import { usePanelStatePartial } from "@fiftyone/spaces";
import {
  Stack,
  Text,
  TextBadge,
  Toast,
  Orientation,
  Spacing,
  Variant,
  TextColor,
} from "@voxel51/voodo";

import { useDatasetPayload } from "./useDatasetPayload";
import { useDuckDB } from "./useDuckDB";
import { SqlEditor } from "./sqlEditor";
import { ResultTable } from "./resultTable";
import type { QueryResult } from "./types";

const DEFAULT_SQL = "SELECT COUNT(*) AS n FROM samples";

export function DuckDBPanel() {
  const { payload, loading, error, refresh } = useDatasetPayload();
  const { ready, error: dbError, loadedTables, runQuery } = useDuckDB(payload);

  const [sqlText, setSqlText] = usePanelStatePartial<string>(
    "sql", DEFAULT_SQL, true,
  );
  const [result, setResult] = useState<QueryResult | null>(null);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [querying, setQuerying] = useState(false);

  const onRun = useCallback(async () => {
    if (!ready) return;
    setQuerying(true);
    setQueryError(null);
    try {
      const r = await runQuery(sqlText);
      setResult(r);
    } catch (e: any) {
      setQueryError(e?.message ?? String(e));
      setResult(null);
    } finally {
      setQuerying(false);
    }
  }, [ready, runQuery, sqlText]);

  if (loading) {
    return (
      <Stack orientation={Orientation.Column} spacing={Spacing.Md} style={{ padding: 16 }}>
        <Text>Loading dataset…</Text>
      </Stack>
    );
  }
  if (error) {
    return (
      <div style={{ padding: 16 }}>
        <Toast open variant={Variant.Danger} title="Load failed" description={error} />
      </div>
    );
  }
  if (dbError) {
    return (
      <div style={{ padding: 16 }}>
        <Toast open variant={Variant.Danger} title="DuckDB error" description={dbError} />
      </div>
    );
  }
  const info = payload?.field_info;
  const tableNames = info ? Object.keys(info.tables) : [];

  return (
    <Stack
      orientation={Orientation.Column}
      spacing={Spacing.Md}
      style={{ height: "100%", padding: 16 }}
    >
      <Stack orientation={Orientation.Row} spacing={Spacing.Md} align={"center" as any}>
        <TextBadge>{info?.dataset_name ?? "—"}</TextBadge>
        <TextBadge>{info?.sample_count ?? 0} samples</TextBadge>
        <TextBadge>tables: {tableNames.join(", ") || "—"}</TextBadge>
        <button onClick={refresh}>Refresh data</button>
        <button disabled={!ready || querying} onClick={onRun}>
          {querying ? "Running…" : "Run (⌘↵)"}
        </button>
      </Stack>

      <SqlEditor value={sqlText} onChange={setSqlText} onRun={onRun} />

      {queryError ? (
        <Toast open variant={Variant.Danger} title="Query failed" description={queryError} />
      ) : result ? (
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          <Stack orientation={Orientation.Row} spacing={Spacing.Md}>
            <TextBadge>
              {result.rows.length.toLocaleString()} rows · {result.queryTimeMs.toFixed(1)} ms
            </TextBadge>
            <TextBadge>{result.columns.length} cols</TextBadge>
          </Stack>
          <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
            <ResultTable result={result} />
          </div>
        </div>
      ) : (
        <Text color={TextColor.Secondary}>
          Loaded tables: {loadedTables.join(", ") || "(none)"}.
          Press Run or ⌘↵ to execute.
        </Text>
      )}
    </Stack>
  );
}
