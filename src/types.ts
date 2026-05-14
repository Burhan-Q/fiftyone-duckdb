export type Kind = "numeric" | "categorical";

export type TableInfo = {
  numeric: string[];
  categorical: string[];
};

export type FieldInfo = {
  tables: Record<string, TableInfo>;
  sample_count: number;
  dataset_name: string | null;
  view_stage_hash: string;
  label_bearing_sources: string[];
};

export type ColumnarTable = Record<
  string,
  (number | string | boolean | null)[]
>;

export type Tables = Record<string, ColumnarTable>;

export type DatasetPayload = {
  tables: Tables;
  field_info: FieldInfo;
};

export type ColumnMeta = { name: string; type: string };

export type QueryResult = {
  columns: ColumnMeta[];
  rows: Record<string, unknown>[];
  queryTimeMs: number;
};

export type ChartType =
  | "auto"
  | "table"
  | "bar"
  | "histogram"
  | "scatter"
  | "line"
  | "heatmap"
  | "heatmap2d"
  | "box"
  | "violin";

export type ChartBinding = {
  type: ChartType;
  x: string;
  y?: string;
  color?: string;
};

export type Template = {
  id: string;
  label: string;
  description: string;
  sql: string;
  chart?: ChartBinding;
};
