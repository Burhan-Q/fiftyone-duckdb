import { registerComponent, PluginComponentType } from "@fiftyone/plugins";
import { DuckDBPanel } from "./panel";

registerComponent({
  name: "duckdb_analytics",
  label: "DuckDB Analytics",
  component: DuckDBPanel,
  type: PluginComponentType.Panel,
  activator: () => true,
});
