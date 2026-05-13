import { useCallback, useEffect, useRef, useState } from "react";
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

const initial: State = {
  ready: false,
  loading: true,
  error: null,
  queryTime: 0,
  loadedTables: [],
};

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
  const dbRef = useRef<duckdb.AsyncDuckDB | null>(null);
  const connRef = useRef<duckdb.AsyncDuckDBConnection | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const dataKeyRef = useRef<string>("");
  const tableReadyRef = useRef<Promise<void>>(Promise.resolve());
  const [state, setState] = useState<State>(initial);

  // ---- DuckDB init ----
  useEffect(() => {
    let cancelled = false;
    (async () => {
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
        if (cancelled) {
          await conn.close();
          await db.terminate();
          worker.terminate();
          return;
        }
        dbRef.current = db;
        connRef.current = conn;
        workerRef.current = worker;
        setState((s) => ({ ...s, ready: true, loading: false, error: null }));
      } catch (e: any) {
        if (!cancelled) {
          setState((s) => ({
            ...s,
            ready: false,
            loading: false,
            error: e?.message ?? String(e),
          }));
        }
      }
    })();
    return () => {
      cancelled = true;
      const conn = connRef.current;
      const db = dbRef.current;
      const worker = workerRef.current;
      connRef.current = null;
      dbRef.current = null;
      workerRef.current = null;
      (async () => {
        try {
          if (conn) await conn.close();
          if (db) await db.terminate();
          worker?.terminate();
        } catch {
          /* ignore */
        }
      })();
    };
  }, []);

  // ---- Ingest all tables when payload changes ----
  useEffect(() => {
    const conn = connRef.current;
    if (!conn || !state.ready || !tables || !info) return;
    const sig = Object.entries(tables)
      .map(([t, cols]) => `${t}(${Object.keys(cols).sort().join(",")})`)
      .sort()
      .join("|");
    const key = `${info.dataset_name ?? ""}|${info.sample_count}|${sig}`;
    if (key === dataKeyRef.current) return;
    dataKeyRef.current = key;
    tableReadyRef.current = (async () => {
      const loaded: string[] = [];
      try {
        for (const [tname, columns] of Object.entries(tables)) {
          await conn.query(`DROP TABLE IF EXISTS ${q(tname)}`);
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
          await conn.insertArrowFromIPCStream(ipc, {
            name: tname,
            create: true,
          });
          loaded.push(tname);
        }
        setState((s) => ({ ...s, loadedTables: loaded, error: null }));
      } catch (e: any) {
        setState((s) => ({ ...s, error: e?.message ?? String(e) }));
      }
    })();
  }, [tables, info, state.ready]);

  const runQuery = useCallback(async <T = any>(sql: string): Promise<T[]> => {
    const conn = connRef.current;
    if (!conn) throw new Error("DuckDB not ready");
    await tableReadyRef.current;
    const t0 = performance.now();
    const result = await conn.query<any>(sql);
    const rows = result.toArray().map((r: any) => r.toJSON()) as T[];
    setState((s) => ({ ...s, queryTime: performance.now() - t0 }));
    return rows;
  }, []);

  return {
    ready: state.ready,
    loading: state.loading,
    error: state.error,
    queryTime: state.queryTime,
    loadedTables: state.loadedTables,
    runQuery,
  };
}
