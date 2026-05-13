import { useCallback, useEffect, useState } from "react";
import * as duckdb from "@duckdb/duckdb-wasm";
import * as arrow from "apache-arrow";

export type TableInfo = {
  numeric: string[];
  categorical: string[];
};

export type FieldInfo = {
  tables: Record<string, TableInfo>;
  sample_count: number;
  dataset_name: string | null;
  error?: string;
  /** Map of {root_safe: {original_class: slug}} — for prettifying labels in UI. */
  label_class_aliases?: Record<string, Record<string, string>>;
  /** Safe-named sources that appear in the virtual `labels` table. */
  label_bearing_sources?: string[];
};

export type ColumnarTable = Record<string, (number | string | boolean | null)[]>;
export type Tables = Record<string, ColumnarTable>;

type State = {
  ready: boolean;
  loading: boolean;
  error: string | null;
  queryTime: number;
  loadedTables: string[];
};

// ---------- Module-level singletons ----------
// The DuckDB connection (and the set of ingested tables) persist across
// React component re-mounts so panel-tab focus changes don't tear down and
// rebuild the entire WASM database. Without this, the user sees the chart
// disappear for several seconds while DuckDB re-initializes on every
// re-mount. The Python signature guard in __init__.py keeps the input
// `tables` / `info` references structurally stable, so the ingest effect
// short-circuits on the second mount via the cached `_dataKey`.
let _db: duckdb.AsyncDuckDB | null = null;
let _conn: duckdb.AsyncDuckDBConnection | null = null;
// _worker is held to keep the WASM worker alive for the lifetime of the page.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
let _worker: Worker | null = null;
let _initPromise: Promise<void> | null = null;
let _dataKey: string = "";
let _loadedTables: string[] = [];
let _ingestPromise: Promise<void> = Promise.resolve();
let _queryTime: number = 0;

async function ensureDuckDBInit(): Promise<void> {
  if (_conn) return;
  if (_initPromise) return _initPromise;
  _initPromise = (async () => {
    try {
      const bundles = duckdb.getJsDelivrBundles();
      const bundle = await duckdb.selectBundle(bundles);
      const workerScript = URL.createObjectURL(
        new Blob([`importScripts("${bundle.mainWorker!}");`], {
          type: "text/javascript",
        }),
      );
      const worker = new Worker(workerScript);
      URL.revokeObjectURL(workerScript);
      const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING);
      const db = new duckdb.AsyncDuckDB(logger, worker);
      await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
      const conn = await db.connect();
      _db = db;
      _conn = conn;
      _worker = worker;
    } catch (e) {
      _initPromise = null; // allow retry on next call
      throw e;
    }
  })();
  return _initPromise;
}

function inferKind(values: any[]): "numeric" | "categorical" | "unknown" {
  for (const v of values) {
    if (v === null || v === undefined) continue;
    if (typeof v === "number" || typeof v === "boolean") return "numeric";
    if (typeof v === "string") return "categorical";
    return "unknown";
  }
  return "unknown";
}

function buildColumns(table: ColumnarTable): Record<string, ArrayLike<any>> {
  const out: Record<string, ArrayLike<any>> = {};
  for (const [name, values] of Object.entries(table)) {
    if (!values || values.length === 0) continue;
    const kind = inferKind(values);
    if (kind === "numeric") {
      const hasNull = values.some((v) => v === null || v === undefined);
      out[name] = hasNull
        ? values.map((v) =>
            v === null || v === undefined ? null : Number(v),
          )
        : Float64Array.from(values as number[]);
    } else {
      out[name] = values.map((v) =>
        v === null || v === undefined ? null : String(v),
      );
    }
  }
  return out;
}

const q = (name: string) => `"${name.replace(/"/g, '""')}"`;

export function useDuckDB(tables: Tables | null, info: FieldInfo | null) {
  // Initialize state from the module cache. On a fresh page, all module
  // singletons are empty so we render "Loading…" once; on every subsequent
  // re-mount within the same page, `_conn` and `_loadedTables` are already
  // populated and the panel renders its persisted chart immediately.
  const [state, setState] = useState<State>(() => ({
    ready: !!_conn,
    loading: !_conn,
    error: null,
    queryTime: _queryTime,
    loadedTables: _loadedTables,
  }));

  // ---- DuckDB init (no-op if module singleton already initialized) ----
  useEffect(() => {
    let cancelled = false;
    ensureDuckDBInit()
      .then(() => {
        if (cancelled) return;
        setState((s) => ({
          ...s,
          ready: true,
          loading: false,
          error: null,
          loadedTables: _loadedTables,
        }));
      })
      .catch((e) => {
        if (cancelled) return;
        setState((s) => ({
          ...s,
          ready: false,
          loading: false,
          error: e?.message ?? String(e),
        }));
      });
    return () => {
      cancelled = true;
      // Intentionally NOT terminating the module-level db/conn/worker —
      // they persist across re-mounts so a subsequent mount finds them
      // ready instead of paying the WASM init cost again. The whole page
      // load owns one DuckDB instance; the browser cleans it up on page
      // unload.
    };
  }, []);

  // ---- Ingest all tables when payload changes ----
  useEffect(() => {
    if (!_conn || !state.ready || !tables || !info) return;
    const sig = Object.entries(tables)
      .map(([t, cols]) => `${t}(${Object.keys(cols).sort().join(",")})`)
      .sort()
      .join("|");
    const key = `${info.dataset_name ?? ""}|${info.sample_count}|${sig}`;
    if (key === _dataKey) {
      // Same payload as the last successful ingest — sync state and bail.
      if (state.loadedTables !== _loadedTables) {
        setState((s) => ({ ...s, loadedTables: _loadedTables }));
      }
      return;
    }
    _dataKey = key;
    _ingestPromise = (async () => {
      const loaded: string[] = [];
      try {
        for (const [tname, columns] of Object.entries(tables)) {
          await _conn!.query(`DROP TABLE IF EXISTS ${q(tname)}`);
          if (!columns || Object.keys(columns).length === 0) continue;
          const firstCol = Object.values(columns)[0];
          if (!firstCol || firstCol.length === 0) continue;
          const cols = buildColumns(columns);
          if (Object.keys(cols).length === 0) continue;
          const table = arrow.tableFromArrays(cols as any);
          // Note: ``insertArrowTable`` silently fails in some duckdb-wasm
          // versions; serializing to IPC and using ``insertArrowFromIPCStream``
          // is the reliable path.
          const ipc = arrow.tableToIPC(table, "stream");
          await _conn!.insertArrowFromIPCStream(ipc, {
            name: tname,
            create: true,
          });
          loaded.push(tname);
        }
        _loadedTables = loaded;
        setState((s) => ({ ...s, loadedTables: loaded, error: null }));
      } catch (e: any) {
        setState((s) => ({ ...s, error: e?.message ?? String(e) }));
      }
    })();
  }, [tables, info, state.ready]);

  const runQuery = useCallback(async <T = any>(sql: string): Promise<T[]> => {
    if (!_conn) throw new Error("DuckDB not ready");
    await _ingestPromise;
    const t0 = performance.now();
    const result = await _conn.query<any>(sql);
    const rows = result.toArray().map((r: any) => r.toJSON()) as T[];
    const elapsed = performance.now() - t0;
    _queryTime = elapsed;
    setState((s) => ({ ...s, queryTime: elapsed }));
    return rows;
  }, []);

  // _db / _worker are kept as module references for debugging but not read
  // after init; suppress the unused-locals warning.
  void _db;
  void _worker;

  return {
    ready: state.ready,
    loading: state.loading,
    error: state.error,
    queryTime: state.queryTime,
    loadedTables: state.loadedTables,
    runQuery,
  };
}
