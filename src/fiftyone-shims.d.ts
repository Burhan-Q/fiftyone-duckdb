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
}

declare module "@fiftyone/operators" {
  export function useTriggerPanelEvent(): (event: any, params?: any) => void;
}
