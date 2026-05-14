// Minimal type shims for FiftyOne packages that are provided at runtime by
// the FiftyOne App. We declare only the surface we use.

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
