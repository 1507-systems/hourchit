import type { Env } from '../env';
import { getCustomer, getInvoice, invoiceLines, type Customer, type Invoice } from '../db';
import { loadProfile } from '../config/profiles';
import { termsFor, type TenantProfile } from '../config/profile';
import { renderInvoice } from '../ui/invoice';
import { invoiceEmailSubject, type InvoiceEmailView } from './invoice-email';

/**
 * What would go out for this invoice, assembled once and shared by every
 * delivery path -- hosted send, the mail-app handoff, and the confirm page
 * that previews either.
 *
 * ONE ASSEMBLY, so what an operator is shown and what the invoice actually
 * contains cannot drift apart, and so a client on `mail_app` mode gets the
 * exact same recipient, subject and PDF a `hosted` client would have gotten,
 * not a second implementation of "what is this invoice" that can disagree.
 */
export interface InvoiceComposition {
  invoice: Invoice;
  customer: Customer | null;
  profile: TenantProfile;
  view: InvoiceEmailView;
  /** Only meaningful for hosted transport; a mail-app send never has a "from" HourChit controls. */
  from: string;
  /** Null when the client record has no billing email -- never guessed. */
  to: string | null;
  subject: string;
  /** The web invoice, rendered for the PDF attachment/download. */
  printHtml: () => string;
}

/**
 * Who an invoice comes FROM over hosted transport, and it is not the same
 * address as a login code.
 *
 * The four-party rule, 2026-07-30: anything from HourChit (the 1507 product)
 * to ITS users -- a tenant such as Example Contracting -- comes from the
 * hourchit apex, because that is the app speaking as itself. Anything from a
 * TENANT to THEIR OWN clients comes from that tenant's own subdomain, unless
 * the tenant has configured their own mail entirely. Think of it the way a
 * white-labelled SaaS suite runs.
 *
 * An invoice is squarely the second: Example Contracting billing its
 * institutional client. Sending it from noreply@hourchit.app would put a
 * vendor the client has never heard of on a demand for money, which is both
 * confusing and exactly the shape of an invoice-fraud email.
 */
function tenantBillingAddress(env: Env): string {
  return `billing@${env.TENANT_MAIL_DOMAIN ?? ''}`;
}

/**
 * What a mail_app draft carries, deliberately narrower than the hosted body.
 *
 * No line items and no total breakdown: a mailto: body has no reliable length
 * guarantee, and this text is what the operator's own mail app actually sends
 * to the client, over transport HourChit is not part of -- so unlike the
 * hosted intro, it never mentions HourChit at all, the same way a tenant on
 * their own domain never gets the sent-on-behalf-of disclosure.
 */
export interface MailAppDraft {
  to: string | null;
  subject: string;
  body: string;
}

export function invoiceMailAppDraft(args: {
  invoice: Invoice;
  business: { name: string };
  customer: { name: string };
  to: string | null;
}): MailAppDraft {
  const subject = invoiceEmailSubject({ invoice: args.invoice, business: args.business });
  return {
    to: args.to,
    subject,
    body: `Hi ${args.customer.name}, please find attached invoice ${args.invoice.number}. Let us know if you have any questions.`,
  };
}

/**
 * A mailto: link for the draft above.
 *
 * Plain percent-encoding (encodeURIComponent), not the "+ for space"
 * form-encoding a query string sometimes gets: RFC 6068 mailto hfields are
 * pct-encoded like any other URI component, and a mail client that takes
 * "+" literally would hand the client an invoice email reading "please+find".
 * ui/notice.ts's existing mailto: link uses the same convention.
 */
export function mailtoHref(draft: { to: string | null; subject: string; body: string }): string {
  return `mailto:${encodeURIComponent(draft.to ?? '')}?subject=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(draft.body)}`;
}

export async function buildInvoiceComposition(env: Env, id: number): Promise<InvoiceComposition | null> {
  const invoice = await getInvoice(env, id);
  if (!invoice) return null;
  const profile = loadProfile(env.TENANT_PROFILE);
  const customer = await getCustomer(env, invoice.customer_id);
  const lines = await invoiceLines(env, id);

  const from = tenantBillingAddress(env);
  const view: InvoiceEmailView = {
    invoice,
    lines,
    business: profile.business,
    customer: { name: customer?.name ?? 'Client' },
    // The disclosure belongs on mail leaving over HourChit's shared domain. A
    // tenant sending from their own would be naming a vendor not in the path.
    // Any hourchit.app domain means HourChit is in the path and the disclosure
    // applies. A tenant on their OWN domain is sending as themselves, and
    // naming a vendor who is not involved would be untrue.
    viaHourChit: /@([a-z0-9-]+\.)*hourchit\.app$/i.test(from),
  };
  return {
    invoice,
    customer,
    profile,
    view,
    from,
    to: customer?.email?.trim() ? customer.email.trim() : null,
    subject: invoiceEmailSubject(view),
    printHtml: () =>
      renderInvoice({
        business: profile.business,
        customer: customer as NonNullable<typeof customer>,
        invoice,
        contents: { timeEntries: [], mileage: [] },
        terms: termsFor(profile),
        lines,
        forPrint: true,
      }),
  };
}
