import { useCallback, useEffect, useState } from "react";
import * as duckdb from "@duckdb/duckdb-wasm";
import * as arrow from "apache-arrow";

import type { DatasetPayload, FieldInfo, QueryResult, Tables } from "./types";

// Module-level singletons survive React re-mounts so panel-tab focus
// changes don't tear down the WASM database.
let _db: duckdb.AsyncDuckDB | null = null;
let _conn: duckdb.AsyncDuckDBConnection | null = null;
let _worker: Worker | null = null;
let _initPromise: Promise<void> | null = null;
let _ingestKey = "";
let _ingestPromise: Promise<void> = Promise.resolve();
let _loadedTables: string[] = [];

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
      _initPromise = null;
      throw e;
    }
  })();
  return _initPromise;
}

const q = (name: string) => `"${name.replace(/"/g, '""')}"`;

function inferKind(values: any[]): "numeric" | "categorical" | "unknown" {
  for (const v of values) {
    if (v === null || v === undefined) continue;
    if (typeof v === "number" || typeof v === "boolean") return "numeric";
    if (typeof v === "string") return "categorical";
    return "unknown";
  }
  return "unknown";
}

function buildColumns(
  table: Tables[string],
): Record<string, ArrayLike<any>> {
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

async function buildLabelsView(
  conn: duckdb.AsyncDuckDBConnection,
  fieldInfo: FieldInfo,
): Promise<void> {
  const sources = fieldInfo.label_bearing_sources || [];
  if (sources.length === 0) {
    await conn.query(`DROP VIEW IF EXISTS labels`);
    return;
  }
  const labelCols = [
    "confidence",
    "bbox_x",
    "bbox_y",
    "bbox_w",
    "bbox_h",
    "bbox_area",
    "bbox_cx",
    "bbox_cy",
  ];
  const branches = sources.map((src) => {
    const ti = fieldInfo.tables[src];
    if (!ti) return null;
    const colExprs = labelCols.map((c) =>
      ti.numeric.includes(c) ? c : `NULL::DOUBLE AS ${c}`,
    );
    return `SELECT sample_id, '${src.replace(/'/g, "''")}' AS source, label,
      ${colExprs.join(", ")}
    FROM ${q(src)}`;
  });
  const branchSql = branches.filter(Boolean).join("\n  UNION ALL\n");
  await conn.query(`CREATE OR REPLACE VIEW labels AS ${branchSql}`);
}

export function useDuckDB(payload: DatasetPayload | null) {
  const [state, setState] = useState({
    ready: !!_conn,
    loading: !_conn,
    error: null as string | null,
    loadedTables: _loadedTables,
  });

  useEffect(() => {
    let cancelled = false;
    ensureDuckDBInit()
      .then(() => {
        if (cancelled) return;
        setState((s) => ({
          ...s,
          ready: true,
          loading: false,
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
    };
  }, []);

  useEffect(() => {
    if (!_conn || !state.ready || !payload) return;
    const { tables, field_info } = payload;
    const sig = `${field_info.dataset_name ?? ""}|${field_info.view_stage_hash}|${Object.keys(tables).sort().join(",")}`;
    if (sig === _ingestKey) {
      if (state.loadedTables !== _loadedTables) {
        setState((s) => ({ ...s, loadedTables: _loadedTables }));
      }
      return;
    }
    _ingestKey = sig;
    _ingestPromise = (async () => {
      const loaded: string[] = [];
      try {
        for (const [tname, columns] of Object.entries(tables)) {
          await _conn!.query(`DROP TABLE IF EXISTS ${q(tname)}`);
          const firstCol = Object.values(columns)[0];
          if (!firstCol || firstCol.length === 0) continue;
          const cols = buildColumns(columns);
          if (Object.keys(cols).length === 0) continue;
          const table = arrow.tableFromArrays(cols as any);
          const ipc = arrow.tableToIPC(table, "stream");
          await _conn!.insertArrowFromIPCStream(ipc, {
            name: tname,
            create: true,
          });
          loaded.push(tname);
        }
        await buildLabelsView(_conn!, field_info);
        _loadedTables = loaded.concat(
          field_info.label_bearing_sources?.length ? ["labels"] : [],
        );
        setState((s) => ({
          ...s,
          loadedTables: _loadedTables,
          error: null,
        }));
      } catch (e: any) {
        setState((s) => ({ ...s, error: e?.message ?? String(e) }));
      }
    })();
  }, [payload, state.ready]);

  const runQuery = useCallback(async (sql: string): Promise<QueryResult> => {
    if (!_conn) throw new Error("DuckDB not ready");
    await _ingestPromise;
    const t0 = performance.now();
    const result = await _conn.query<any>(sql);
    const fields = result.schema.fields;
    const columns = fields.map((f: any) => ({
      name: f.name,
      type: String(f.type),
    }));
    const rows = result.toArray().map((r: any) => {
      const j = r.toJSON();
      // Coerce BigInt → Number so Plotly + JS arithmetic just work.
      for (const k of Object.keys(j)) {
        if (typeof j[k] === "bigint") j[k] = Number(j[k]);
      }
      return j;
    });
    const queryTimeMs = performance.now() - t0;
    return { columns, rows, queryTimeMs };
  }, []);

  void _db;
  void _worker;

  return {
    ready: state.ready,
    loading: state.loading,
    error: state.error,
    loadedTables: state.loadedTables,
    runQuery,
  };
}
