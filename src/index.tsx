import { registerComponent, PluginComponentType } from "@fiftyone/plugins";
import { DuckDBAnalyticsPanel } from "./DuckDBAnalyticsPanel";

registerComponent({
  name: "DuckDBAnalyticsView",
  label: "DuckDB Analytics",
  component: DuckDBAnalyticsPanel,
  type: PluginComponentType.Component,
  activator: () => true,
});
