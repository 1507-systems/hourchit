export interface Env {
  /** D1 binding (see wrangler.jsonc). */
  DB: D1Database;
  /** Selects profiles/<key>.json. Set per environment in wrangler.jsonc. */
  TENANT_PROFILE: string;
  /**
   * Shared-secret gate. REQUIRED, the app fails closed (503) without it, in
   * production and locally alike. Production: `wrangler secret put ACCESS_TOKEN`.
   * Local: put it in `.dev.vars` (gitignored; see `.dev.vars.example`).
   */
  ACCESS_TOKEN?: string;
}
