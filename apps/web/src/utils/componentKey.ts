/**
 * Canonical identity for a dashboard component.
 *
 * Component identity is referenced inconsistently across the app: chart
 * mentions carry `component.id`, the highlight diff keys on `id || title`, and
 * components expose both `component.id` and `component.component_config.id`. In
 * the standard extraction path (`project.tsx`) those two ids are populated from
 * the same source value, so this helper collapses them into a single key.
 *
 * This is the single source of truth for matching a component to per-component
 * UI state (e.g. the "Applying your change…" overlay). Later phases reuse it.
 */
import type { DashboardComponent } from "@/types/dashboard";

export function getComponentKey(
  component: Pick<DashboardComponent, "id" | "component_config"> & {
    title?: string;
  }
): string {
  const configId = (component.component_config as { id?: string } | undefined)?.id;
  return String(configId ?? component.id ?? component.title ?? "");
}
