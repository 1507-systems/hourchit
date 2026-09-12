export const DASHBOARD_MODULES = [
  'timer',
  'manual-hours',
  'mileage',
  'mail',
  'invoices',
  'unbilled',
  'recent-mileage',
] as const;

export type DashboardModuleId = (typeof DASHBOARD_MODULES)[number];

export interface DashboardPreferences {
  order: DashboardModuleId[];
  hidden: DashboardModuleId[];
}

export function sanitizeDashboardPreferences(value: unknown): DashboardPreferences {
  const source = isRecord(value) ? value : {};
  const requestedOrder = Array.isArray(source.order) ? source.order : [];
  const requestedHidden = Array.isArray(source.hidden) ? source.hidden : [];

  const order = uniqueKnown(requestedOrder);
  for (const moduleId of DASHBOARD_MODULES) {
    if (!order.includes(moduleId)) order.push(moduleId);
  }
  return { order, hidden: uniqueKnown(requestedHidden) };
}

export function moveDashboardModule(
  preferences: DashboardPreferences,
  moduleId: string,
  direction: 'up' | 'down',
): DashboardPreferences {
  if (!isDashboardModuleId(moduleId)) return preferences;
  const order = [...preferences.order];
  const index = order.indexOf(moduleId);
  const target = direction === 'up' ? index - 1 : index + 1;
  if (index < 0 || target < 0 || target >= order.length) return preferences;
  [order[index], order[target]] = [order[target], order[index]];
  return { ...preferences, order };
}

export function moveDashboardModuleSkipping(
  preferences: DashboardPreferences,
  moduleId: string,
  direction: 'up' | 'down',
  skipped: readonly DashboardModuleId[],
): DashboardPreferences {
  if (!isDashboardModuleId(moduleId) || skipped.includes(moduleId)) return preferences;
  const visible = preferences.order.filter((id) => !skipped.includes(id));
  const index = visible.indexOf(moduleId);
  const target = direction === 'up' ? index - 1 : index + 1;
  if (index < 0 || target < 0 || target >= visible.length) return preferences;
  const order = [...preferences.order];
  const from = order.indexOf(moduleId);
  const to = order.indexOf(visible[target]);
  [order[from], order[to]] = [order[to], order[from]];
  return { ...preferences, order };
}

export function setDashboardModuleHidden(
  preferences: DashboardPreferences,
  moduleId: string,
  hidden: boolean,
): DashboardPreferences {
  if (!isDashboardModuleId(moduleId)) return preferences;
  const next = preferences.hidden.filter((id) => id !== moduleId);
  if (hidden) next.push(moduleId);
  return { ...preferences, hidden: next };
}

function uniqueKnown(values: unknown[]): DashboardModuleId[] {
  const result: DashboardModuleId[] = [];
  for (const value of values) {
    if (typeof value === 'string' && isDashboardModuleId(value) && !result.includes(value)) {
      result.push(value);
    }
  }
  return result;
}

export function isDashboardModuleId(value: string): value is DashboardModuleId {
  return (DASHBOARD_MODULES as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
