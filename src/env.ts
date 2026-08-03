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
   * This tenant's OWN mail domain, e.g. `tarnsby.hourchit.app`.
   *
   * Replaces the shared `hosted.hourchit.app`, where the tenant was the LOCAL
   * PART. Now the DOMAIN identifies the tenant and the local part is a mailbox
   * -- billing@, hello@ -- which is what a business's mail actually looks like.
   *
   * The move was forced by delivery events: a Cloudflare Email Sending event
   * subscription is scoped to one sending DOMAIN, so a shared domain would put
   * every tenant's recipients and subject lines on one queue. It turned out to
   * be the better shape anyway, because a shared sending domain also means a
   * SHARED SENDER REPUTATION -- one tenant's spam complaints would degrade
   * deliverability for every other tenant, and for an invoicing product an
   * invoice in the junk folder is the whole failure.
   *
   * REQUIRED IN PRACTICE. There is no default: a wrong guess here would either
   * reject the tenant's real mail or, worse, accept another tenant's.
   */
  TENANT_MAIL_DOMAIN?: string;
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
