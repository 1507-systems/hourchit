import type { SendEmailBinding } from './mail/send';

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
  /**
   * Cloudflare Email Sending binding, used for login codes.
   *
   * Optional in the type so the app still builds and runs without outbound mail
   * configured: in that state the emailed-code flow stores a code and logs a
   * send failure, and the break-glass token remains the way in. A required
   * binding would turn "mail is not wired yet" into "the app does not start".
   */
  EMAIL?: SendEmailBinding;
  /**
   * The From address for login codes, e.g. `login@hosted.hourchit.app`.
   *
   * Cloudflare requires the sender to belong to a domain onboarded to Email
   * Service, so this is configuration and never user input.
   */
  LOGIN_MAIL_FROM?: string;
}
