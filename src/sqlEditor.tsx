import React, { useCallback } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { sql, SQLDialect } from "@codemirror/lang-sql";

const DUCKDB_DIALECT = SQLDialect.define({
  keywords:
    "select from where group by order limit with as case when then else end "
    + "and or not in is null distinct on having union all create view drop "
    + "table if exists count sum avg min max stddev corr coalesce cast "
    + "between like ilike join left right inner outer cross using",
  builtin:
    "labels samples ground_truth_detections predictions_detections "
    + "varchar integer double bigint timestamp",
  hashComments: false,
  doubleQuotedStrings: false,
  unquotedBitLiterals: false,
  treatBitsAsBytes: false,
});

const extensions = [sql({ dialect: DUCKDB_DIALECT, upperCaseKeywords: true })];

export type SqlEditorProps = {
  value: string;
  onChange: (next: string) => void;
  onRun: () => void;
  height?: string;
};

export function SqlEditor({ value, onChange, onRun, height = "180px" }: SqlEditorProps) {
  const onKeyDown = useCallback(
    (evt: React.KeyboardEvent) => {
      if ((evt.metaKey || evt.ctrlKey) && evt.key === "Enter") {
        evt.preventDefault();
        onRun();
      }
    },
    [onRun],
  );
  return (
    <div onKeyDown={onKeyDown} style={{ border: "1px solid var(--fo-palette-divider, #2c2c2c)", borderRadius: 4 }}>
      <CodeMirror
        value={value}
        height={height}
        extensions={extensions}
        onChange={onChange}
        basicSetup={{
          lineNumbers: true,
          highlightActiveLine: true,
          bracketMatching: true,
          autocompletion: false,
        }}
        theme="dark"
      />
    </div>
  );
}
