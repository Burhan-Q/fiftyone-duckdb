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
   * Returns a callback to trigger a Python-side panel event handler from JS.
   * Used by Phase 7 to invoke ``select_samples`` after a chart selection.
   */
  export function useTriggerPanelEvent(): (
    panelId: string,
    options: { operator: any; params?: Record<string, any>; callback?: (result: any) => void },
  ) => void;
}
