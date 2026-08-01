import type { SendEmailBinding } from './mail/send';
import type { BrowserRunBinding } from './mail/invoice-pdf';

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
   * Cloudflare Browser Run, used to render an invoice PDF for attachment.
   *
   * Optional in the type, but the invoice send path REFUSES rather than sending
   * without the attachment. Bryce, 2026-07-31: "there needs to be a PDF
   * attached." An email whose body carries the invoice is readable, but the
   * client's accounts payable file a document -- and quietly dropping the
   * attachment would leave the operator believing they had sent one.
   *
   * Needs compatibility_date >= 2026-03-24 for quickAction(). No API token: the
   * Worker reaches Browser Run over Cloudflare's own network.
   */
  BROWSER?: BrowserRunBinding;
  /**
   * The From address for login codes, e.g. `login@hosted.hourchit.app`.
   *
   * Cloudflare requires the sender to belong to a domain onboarded to Email
   * Service, so this is configuration and never user input.
   */
  LOGIN_MAIL_FROM?: string;
}
