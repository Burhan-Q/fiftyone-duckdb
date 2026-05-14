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

export function DuckDBPanel() {
  const { payload, loading, error, refresh } = useDatasetPayload();
  const {
    ready,
    error: dbError,
    loadedTables,
  } = useDuckDB(payload);

  if (loading) {
    return (
      <Stack
        orientation={Orientation.Column}
        spacing={Spacing.Md}
        style={{ padding: 16 }}
      >
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
      <Stack orientation={Orientation.Row} spacing={Spacing.Md}>
        <TextBadge>{info?.dataset_name ?? "—"}</TextBadge>
        <TextBadge>{info?.sample_count ?? 0} samples</TextBadge>
        <TextBadge>
          tables: {tableNames.join(", ") || "—"}
        </TextBadge>
        <TextBadge>db ready: {String(ready)}</TextBadge>
        <TextBadge>loaded: {loadedTables.join(", ") || "—"}</TextBadge>
      </Stack>
      <button onClick={refresh}>Refresh data</button>
      <Text color={TextColor.Secondary}>
        Editor + charts arrive in later tasks.
      </Text>
    </Stack>
  );
}
