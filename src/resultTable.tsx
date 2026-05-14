import React from "react";
import { Text, TextColor } from "@voxel51/voodo";

import type { QueryResult } from "./types";

export function ResultTable({ result }: { result: QueryResult }) {
  if (result.rows.length === 0) {
    return <Text color={TextColor.Secondary}>0 rows.</Text>;
  }
  const cols = result.columns.map((c) => c.name);
  const preview = result.rows.slice(0, 500);
  return (
    <div style={{ overflow: "auto", maxHeight: "100%" }}>
      <table
        style={{
          borderCollapse: "collapse",
          fontFamily: "var(--fo-font-mono, monospace)",
          fontSize: 12,
        }}
      >
        <thead>
          <tr>
            {cols.map((c) => (
              <th
                key={c}
                style={{
                  textAlign: "left",
                  borderBottom: "1px solid var(--fo-palette-divider, #2c2c2c)",
                  padding: "4px 8px",
                  position: "sticky",
                  top: 0,
                  background: "var(--fo-palette-background, #111)",
                }}
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {preview.map((row, i) => (
            <tr key={i}>
              {cols.map((c) => (
                <td
                  key={c}
                  style={{
                    padding: "2px 8px",
                    borderBottom:
                      "1px solid var(--fo-palette-divider-soft, #1c1c1c)",
                  }}
                >
                  {row[c] === null || row[c] === undefined
                    ? <span style={{ opacity: 0.4 }}>null</span>
                    : String(row[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {result.rows.length > preview.length && (
        <Text color={TextColor.Secondary}>
          Showing {preview.length} of {result.rows.length} rows.
        </Text>
      )}
    </div>
  );
}
