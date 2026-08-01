/**
 * The invoice as a PDF, for attaching to the email that carries it.
 *
 * WHY BOTH A BODY AND AN ATTACHMENT, when the body already has the whole
 * invoice. They are read by different people for different reasons. The body is
 * for the human who opens the mail: no click, no download, nothing that looks
 * like the link in a fraudulent invoice. The attachment is for what happens
 * next -- accounts payable file a DOCUMENT, their system ingests one, and an
 * invoice that exists only as the body of an email is awkward to forward,
 * impossible to file, and reads as less serious than one that arrived as paper
 * would have.
 *
 * RENDERED THROUGH BROWSER RUN'S BINDING rather than its REST API, which means
 * no API token exists to be stored, rotated or leaked -- the Worker reaches
 * Browser Run over Cloudflare's own network. It needs a compatibility date of
 * 2026-03-24 or later for quickAction() to exist at all.
 */

/**
 * Structural type for the binding, as with SendEmailBinding.
 *
 * Browser Rendering was renamed Browser Run and grew quickAction() during the
 * period this app has been built; typing against whichever @cloudflare
 * workers-types happens to be installed makes a routine bump a compile break.
 * What we depend on is one method returning a Response.
 */
export interface BrowserRunBinding {
  quickAction(
    action: 'pdf',
    options: {
      html?: string;
      url?: string;
      pdfOptions?: { format?: string; printBackground?: boolean; margin?: Record<string, string> };
    },
  ): Promise<Response>;
}

export class PdfNotConfiguredError extends Error {
  constructor() {
    super(
      'The BROWSER binding is not configured on this Worker, so an invoice PDF cannot be rendered. ' +
        'Add `"browser": { "binding": "BROWSER" }` to wrangler.jsonc and redeploy.',
    );
    this.name = 'PdfNotConfiguredError';
  }
}

/**
 * Render HTML to PDF bytes.
 *
 * THROWS RATHER THAN RETURNING NULL, deliberately. A null would invite the
 * caller to send the email anyway, minus the attachment, and the operator would
 * have no way to tell that from a successful send -- they would believe a
 * document went out that did not. Refusing is recoverable; a quietly incomplete
 * invoice is discovered by the client.
 */
export async function renderPdf(
  browser: BrowserRunBinding | undefined,
  html: string,
): Promise<ArrayBuffer> {
  if (!browser) throw new PdfNotConfiguredError();

  const res = await browser.quickAction('pdf', {
    html,
    pdfOptions: {
      format: 'Letter',
      // The invoice's own print stylesheet already hides the app chrome and
      // forces light colours; printBackground keeps any deliberate fills.
      printBackground: true,
      margin: { top: '0.6in', bottom: '0.6in', left: '0.6in', right: '0.6in' },
    },
  });

  if (!res.ok) {
    // Include a slice of the body: Browser Run reports a useful reason, and
    // "PDF rendering failed" with no detail is the kind of error that costs an
    // hour to reproduce.
    const detail = (await res.text().catch(() => '')).slice(0, 300);
    throw new Error(`Browser Run returned ${res.status} rendering the invoice PDF. ${detail}`);
  }

  const bytes = await res.arrayBuffer();
  if (bytes.byteLength === 0) {
    throw new Error('Browser Run returned an empty PDF.');
  }
  // Cloudflare caps a message, attachments included, at 5 MiB. Catching it here
  // names the actual problem instead of letting send() fail on a size limit.
  if (bytes.byteLength > 4 * 1024 * 1024) {
    throw new Error(
      `The rendered invoice PDF is ${Math.round(bytes.byteLength / 1024)} KiB, too large to attach ` +
        '(a message may not exceed 5 MiB in total).',
    );
  }
  return bytes;
}

/** A filename accounts payable can file without renaming it. */
export function invoicePdfFilename(invoiceNumber: string): string {
  // No spaces: some mail clients and ingestion systems mangle them, and the
  // number is what the document is filed under anyway.
  return `Invoice-${invoiceNumber.replace(/[^A-Za-z0-9._-]/g, '-')}.pdf`;
}
