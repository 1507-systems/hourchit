export interface Env {
  /** D1 binding (see wrangler.jsonc). */
  DB: D1Database;
  /** Selects profiles/<key>.json. Set per environment in wrangler.jsonc. */
  TENANT_PROFILE: string;
  /** Shared-secret gate. If unset, the app runs open (local dev only). */
  ACCESS_TOKEN?: string;
}
