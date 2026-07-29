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
  /**
   * Domain that tenant mail arrives on. Addresses are
   * <TENANT_PROFILE>@<HOSTED_MAIL_DOMAIN>. Defaulted in code so a tenant config
   * that omits it still rejects foreign mail rather than accepting everything.
   */
  HOSTED_MAIL_DOMAIN?: string;
  /** R2 bucket for raw MIME and attachment bytes. Optional: without it, mail is
   * still stored, minus the raw copy. */
  MAIL_RAW?: R2Bucket;
}
