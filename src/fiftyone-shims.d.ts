// Minimal type shims for FiftyOne packages that are provided at runtime by
// the FiftyOne App. We declare only the surface we use.
//
// Also: type shims for Plotly distributions that ship without `.d.ts`.

declare module "plotly.js-cartesian-dist-min" {
  const Plotly: any;
  export default Plotly;
}

declare module "react-plotly.js/factory" {
  const createPlotlyComponent: (plotly: any) => any;
  export default createPlotlyComponent;
}

declare module "@fiftyone/plugins" {
  export enum PluginComponentType {
    Component = "Component",
    Panel = "Panel",
  }
  export interface RegisterComponentParams {
    name: string;
    label: string;
    component: any;
    type: PluginComponentType;
    activator?: (ctx?: any) => boolean;
  }
  export function registerComponent(params: RegisterComponentParams): void;
}

declare module "@fiftyone/spaces" {
  export function usePanelStatePartial<T>(
    key: string,
    defaultState?: T,
    local?: boolean,
    scope?: string,
  ): [T, (v: T) => void];
  export function usePanelId(): string;
}

declare module "@fiftyone/state" {
  export const view: any;
  /**
   * FiftyOne's lasso-selection atom. Shape:
   *   { selection: string[] | null, scope?: string, ... }
   * Setting this with ``{selection: [ids], scope: PANEL_SCOPE}`` causes
   * the App's grid to filter via the ``extendedStagesUnsorted`` selector
   * (which derives a ``Select(sample_ids=...)`` view stage). This is the
   * correct pattern for chart-to-view selection in JS-only panels per
   * the embeddings-panel reference flow.
   */
  export const extendedSelection: any;
  /**
   * Grid-checkbox selections (``Map<id, "default" | "alt">``). Cleared
   * to ``new Map()`` immediately before writing ``extendedSelection``
   * so the lasso supersedes any prior grid clicks.
   */
  export const selectedSamples: any;
}

declare module "recoil" {
  export function useRecoilValue<T>(atom: any): T;
  export function useSetRecoilState<T>(atom: any): (v: T | ((prev: T) => T)) => void;
}

declare module "@fiftyone/operators" {
  /**
   * Returns a callback ``trigger(eventUri, params?)`` to invoke a Python
   * panel event handler from JS. (Legacy hybrid-panel surface; the
   * redesign uses ``useOperatorExecutor`` for top-level operators.)
   */
  export function useTriggerPanelEvent(): (
    event: string,
    params?: Record<string, any>,
    prompt?: boolean,
    callback?: (result: any) => void,
  ) => void;

  /**
   * Returns an executor object for a top-level Python operator.
   * Pattern: call ``op.execute({params})`` (fire-and-forget); subscribe
   * to ``op.result`` via ``useEffect`` to react when the response lands.
   * The same hook serves both ``load_dataset_payload`` and
   * ``select_samples`` calls from the redesigned panel.
   */
  export function useOperatorExecutor(uri: string): {
    execute: (params?: Record<string, any>) => void;
    result: any;
    isExecuting?: boolean;
    error?: any;
    hasExecuted?: boolean;
  };
}
