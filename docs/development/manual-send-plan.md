# HourChit Manual Send Development Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Checkboxes track execution, not work already completed.

**Status:** Ready for development; no implementation performed by this planning task.
**Goal:** One manual Send button chooses the best available external mail handoff, with a reliable formatted-body clipboard/mailto fallback and a permanent Download PDF button.
**Architecture:** Keep HourChit's direct sending independent. Share one authenticated invoice composition across native, Web Share and clipboard flows. Use a small browser controller and a versioned native request/result contract to distinguish unsupported capabilities, errors, cancellation and handoff.
**Tech stack:** Existing TypeScript/Hono/Cloudflare Workers, Vitest, Swift 5.9/iOS 17+, UIKit/WebKit. Node >=22.12.0. No new runtime dependency or database migration planned.
**Spec:** The scope and contracts below are the implementation specification, consolidated from Bryce's approved conversation requirements.

## Global constraints

- ONLY Tarnsby may receive this feature or test data. Do not change or deploy matts-av, its core pin, profile, database, mail settings or app enrollment.
- This is exclusively the manual-send flow. Hosted/white-label direct sending stays independent: successful send is logged; failures must never log successful sending.
- Keep ONE primary Send button for eligible manual invoices and a separate Download PDF button at all times.
- Native mail-app picker is preferred, not required. A system picker cannot guarantee recipient/body/subject retention in every destination app. Never describe that path as fully populated unless the exact tested destination supports it.
- No PDF-on-clipboard implementation, custom clipboard PDF format, public invoice URL, SMTP integration or domain-onboarding work.
- Clipboard fallback opens recipient/subject via mailto, copies HTML plus plain text, and instructs the operator to attach the downloaded PDF. If rich copying fails, use plain text; if that fails, expose selectable text.
- An external composer/share completion is not proof of delivery. Only explicit Mark as sent manually updates the invoice; retain resend acknowledgement and database race protection.
- Do not send test messages to actual clients. Test handoffs by inspecting and discarding drafts; actual delivery tests require an explicitly authorized test mailbox.
- Use clean isolated worktrees. The current source checkout has untracked '* 2.ts' files; preserve those files and do not include them or let them contaminate tests.
- All fixture profiles and evidence committed to public repos must be fictional. Redact screenshots and logs. Never log message contents or PDF bytes.
- Full suites run sequentially within each checkout because seed tests share a fixture filename.

## Intended user experience

1. Invoice page always exposes Download PDF. Manual clients see one primary Send control.
2. As eligible manual invoice data becomes available, prepare its handoff in page memory. Show a short Preparing state while PDF generation is pending. Do not add a separate Prepare or Share workflow.
3. On Send, prefer the new shell handoff API; then a working legacy native composer; otherwise use Web Share when the actual PDF is shareable; otherwise use clipboard plus mailto.
4. In the new shell, present a native app picker by default after device qualification. It can include non-mail share destinations; iOS does not provide a universal mail-only picker. Preserve a fully populated Apple Mail composer as the alternative if picker qualification fails or is unavailable. Both are accessed through the single primary Send action, not competing page buttons.
5. Web Share supplies the real PDF, subject as title, and full plain-text body. Display recipient/subject beside status with copy affordances when required; explain that the destination may require those fields to be entered.
6. Fallback copy succeeds before mailto launch; show 'Body copied. Paste it into your email, then download and attach the PDF.' If plain text only: say formatting could not be copied. Never claim a PDF was copied.
7. Cancellation returns to the invoice. Do not immediately open a different composer. A confirmed unsupported/unavailable capability can fall through. Unknown handoff outcomes must not launch a second composer automatically.
8. After external handoff, retain the explicit manual sent confirmation and link back to the invoice.

## Current code and verified gaps

| Location | Responsibility / required change |
|---|---|
| core src/ui/invoice.ts | Current primary manual compose link and fire-and-forget native fetch script; replace dispatch, keep PDF action |
| core src/ui/invoice-mail-app.ts | Existing robust copy/textarea/manual sent UI; reuse as fallback and no-JS destination |
| core src/mail/invoice-composition.ts | Shared subject/body/html; use without new email template |
| core src/index.ts | Existing authenticated /invoices/:id/mail-app/compose and PDF routes; add plain-text body and handoff metadata to composition response |
| core src/config/profile.ts | Add optional manualSendHandoffEnabled boolean, default false |
| core src/ui/manual-send.ts (new) | Small generated browser controller and rendering helpers following current inline-script conventions |
| core test/manual-send.test.ts (new) | Capability and state tests using the existing DOM/VM style from manual-copy tests |
| iOS Sources/HourChitCore/NativeBridgeScript.swift | Versioned native promise bridge; currently mailCompose is always true and composeMail has no result |
| iOS Sources/HourChitCore/MailHandoff.swift (new) | Codable validated request/result types, independent of UIKit |
| iOS XcodeApp/Sources/MailHandoffCoordinator.swift (new) | Native picker/composer presentation and temporary attachment lifecycle |
| iOS XcodeApp/Sources/TenantWebView.swift | Register handlers, validate origin, dispatch and return safe results |
| iOS Tests/HourChitCoreTests/MailHandoffTests.swift (new) | Contract validation and capability/result tests |
| private tenants/tarnsby/profile.json and core.ref | Opt in Tarnsby only and pin reviewed core release |

Existing shell canSendMail failure silently returns. Invalid PDF currently permits composition without an attachment. Existing browser native fetches do not check HTTP status and have no recovery. These gaps are part of this implementation because graceful degradation depends on them.

## Contracts

### Server/browser composition

Extend GET /invoices/:id/mail-app/compose additively:

```ts
interface ManualInvoiceDraft {
  to: string | null;
  subject: string;
  body: string; // full plain-text shared email
  html: string; // full formatted shared email
  pdfUrl: string; // same-origin authenticated endpoint only
  pdfFilename: string; // existing sanitized invoice filename
}
```

Keep existing mode/status authorization. Use Cache-Control: private, no-store for sensitive composition/PDF preparation responses. Handle authorization redirects as failures, never as a PDF. Validate response.ok, expected content type, nonempty bytes and PDF signature before handoff. Cap prepared PDF at 5 MiB for the initial feature and show normal manual-download fallback above that size. Server-side generation remains the existing canonical renderer.

### Browser dispatch contract

```ts
type HandoffPath = 'native-v2' | 'native-legacy' | 'web-share' | 'clipboard';
type HandoffState = 'loading' | 'ready' | 'opening' | 'returned' | 'cancelled' | 'fallback' | 'error';
interface PreparedInvoice { draft: ManualInvoiceDraft; pdf: File | null; }
```

Use explicit capability checks, not user-agent names. New shell capabilities must reflect actual support. Legacy native API is invoked at most once; since it has no result, show manual fallback instructions after return rather than guessing that a timeout means failure. No silent downgrade after an API has potentially opened a destination.

PDF preparation is asynchronous; Web Share itself MUST be invoked synchronously from the fresh Send click with prepared File data. Do not await PDF fetch or clipboard writes before share. If preparation is not ready, keep the same button in Preparing state, then restore Send for a fresh tap. Single button does not mean a browser can guarantee one tap under every slow-network or expired-activation condition.

Keep PDF data in memory only. Clear on pagehide, reload on pageshow after BFCache restoration, and invalidate prepared data after relevant invoice changes. Clipboard and share availability can change; handle rejection at call time.

### Native v2 contract

```ts
interface NativeMailRequest {
  version: 2;
  requestId: string;
  to: string | null;
  subject: string;
  body: string;
  html: string;
  pdfBase64: string;
  pdfFilename: string;
}
type NativeMailResult =
  | { requestId: string; status: 'handedOff' | 'cancelled' | 'savedDraft' }
  | { requestId: string; status: 'unavailable' | 'failed'; reason: string };
// window.native.handoffInvoice(request): Promise<NativeMailResult>
```

Preserve composeMail for old web deployments. Advertise invoiceHandoff version 2 separately. Promise resolution must be correlated to one outstanding request; reject duplicate or malformed requests. Transport completion means handoff, not delivery. A native composer 'saved' result must not be reported as sent; return savedDraft and map to the browser returned state without database mutation.

Validate script messages are from the enrolled HTTPS main-frame origin, not merely an allowed navigation. Use structured serialization for responses, no string interpolation of untrusted invoice fields into evaluateJavaScript. Enforce decoded size, valid PDF data, safe filename and bounded field sizes before presenting anything.

Use UIActivityViewController with temporary PDF URL and text item; use UIActivityItemSource to supply subject metadata where supported. Handle iPad popover anchoring. Delete temporary files only after the activity/composer completes or fails; clear stale temporary handoff files on subsequent launch. An unavailable presenter returns a recoverable error. Do not send without a valid PDF.

## Task 1 — Isolate, baseline and lock scope

- [ ] Create clean worktrees from current main for core and iOS; read each repo's AGENTS.md and build instructions. Do not reuse dirty synced files.
- [ ] Record core/iOS/private-repo revisions and Tarnsby current core/config/schema. Use private repo read-only inspection to record matts-av's existing pin without making a network request or change to that tenant.
- [ ] Inspect private Workers Builds path filters BEFORE pushing deployment changes. Require Tarnsby-only triggers; if matts-av builds every push, do not merge a pin bump that will redeploy it. Use an isolated Tarnsby deployment branch/trigger or approved existing tenant-specific deployment mechanism instead.
- [ ] Run baseline npm test, npm run typecheck and swift test sequentially as applicable. Record unrelated baseline failures separately; do not claim they belong to this feature.
- [ ] Add manualSendHandoffEnabled opt-in and tests proving absent/false preserves existing rendering. Enable only fictional local fixtures and private Tarnsby profile.
- [ ] Commit scoped groundwork after tests pass.

## Task 2 — Shared composition and preparation

Files: src/index.ts, src/mail/invoice-composition.ts, test/invoice-mail-app-route.test.ts, test/invoice-composition.test.ts, src/ui/manual-send.ts.

- [ ] Add failing route tests for full body/html/subject/filename parity, no-store, unauthenticated request, other delivery mode, cancelled invoice and missing recipient.
- [ ] Extend response additively; native older versions still receive every old field.
- [ ] Implement preparation with AbortController, a 30-second timeout, safe filename, 5 MiB cap, content checks and same-origin URL validation. Failure must leave Download PDF usable.
- [ ] Test delayed success, HTML login response, HTTP 403/404/500, empty or malformed PDF, oversize PDF, abort and retry; assert no send POST occurs.
- [ ] Run focused tests and typecheck; commit.

## Task 3 — Single-button browser dispatch and fallback

Files: src/ui/manual-send.ts, src/ui/invoice.ts, src/ui/invoice-mail-app.ts, test/manual-send.test.ts, test/manual-copy.test.ts, test/invoice-ui.test.ts.

- [ ] Write failing capability precedence and state-transition tests. Baseline tests must demonstrate no new behavior without tenant opt-in.
- [ ] Implement ready-state native/Web Share/clipboard dispatch. Check canShare({files:[pdf]}) as well as the final payload. Never replace a rejected file share with text-only sharing silently.
- [ ] Reuse HTML/plain clipboard logic. Execute rich copy under user activation; failed rich/plain attempts must expose a fresh same-button retry or selectable fallback rather than falsely report success. Preserve the body on screen even if mailto is blocked.
- [ ] Add copy recipient/subject helpers as secondary tools within fallback details, not additional Send actions.
- [ ] Handle Web Share AbortError neutrally (cancelled or no targets), NotAllowedError with fallback instructions/fresh gesture, and other failures without duplicate launch.
- [ ] Ensure PDF button remains visible for hosted, manual and disabled modes, no JS, loading and error states. Existing PDF endpoint behavior remains canonical.
- [ ] Verify the explicit sent form is the only external-flow database mutation and duplicate sent/resend guards remain active.
- [ ] Run focused tests and typecheck; commit.

Representative controller acceptance tests (adapt imports to the small controller's final testable export):

```ts
it('never sends hosted mail during manual handoff', async () => {
  await manualSend.click();
  expect(requests.filter(r => r.method === 'POST' && r.url.endsWith('/email'))).toEqual([]);
});
it('does not mark sent when the share promise resolves', async () => {
  share.mockResolvedValue(undefined);
  await manualSend.click();
  expect(requests.filter(r => r.method === 'POST' && r.url.endsWith('/send'))).toEqual([]);
});
it('keeps cancellation terminal for this click', async () => {
  share.mockRejectedValue(new DOMException('Cancelled', 'AbortError'));
  await manualSend.click();
  expect(openMailto).not.toHaveBeenCalled();
  expect(copyBody).not.toHaveBeenCalled();
});
```

The fixture names above represent the test harness to implement in test/manual-send.test.ts: requests captures fetch calls; share, openMailto and copyBody are injected spies; manualSend.click dispatches the real controller's click event. Test through the production event handler, not a duplicate decision tree.

## Task 4 — Native capability and result bridge

Files: NativeBridgeScript.swift, MailHandoff.swift, TenantWebView.swift, existing NativeBridgeScriptTests.swift and new MailHandoffTests.swift.

- [ ] Add failing Swift tests for request decoding, version, size, filename, origin checks, duplicate request IDs and result encoding. Test script strings with quotes, newlines and Unicode.
- [ ] Implement native-v2 request correlation and Promise result delivery; preserve legacy composeMail signature and behavior for older pages.
- [ ] Replace unconditional availability claims with honest capabilities. New API may report picker support even when Apple Mail is unavailable; mailCompose availability must reflect canSendMail.
- [ ] Reject malformed/missing PDF before presenting. A shell failure returns an actionable result to the web controller instead of only a log line.
- [ ] Add web tests for v2 results, legacy bridge, missing bridge, failed/unavailable response, unknown outcome and callback after navigation. No automatic fallback on an ambiguous timeout.
- [ ] Run swift test and focused web tests; commit independently reviewed contract.

## Task 5 — Native picker and composer qualification

Files: MailHandoffCoordinator.swift, TenantWebView.swift, iOS README.md and PROJECT_LOG.md.

- [ ] Implement UIActivityViewController plus PDF file lifecycle and subject item source. Preserve the fully populated MFMailComposeViewController path as compatibility fallback.
- [ ] Handle configured/unconfigured Apple Mail, missing presenter, duplicate taps, iPhone/iPad, cancellation and app backgrounding. Return structured outcomes.
- [ ] Run swift test. Discover checked-in Xcode scheme with xcodebuild -list and use repo's documented xcodegen/build command; compile iOS simulator target. Do not guess signing or distribute an app as part of a code-only test.
- [ ] Install a development shell enrolled ONLY in Tarnsby on a test device. Inspect Apple Mail and Outlook draft content and actual PDF attachment; discard drafts.
- [ ] Picker preference is released only if device evidence shows usable transfer of PDF/body and understandable missing-field behavior. If it fails qualification, release reliable native composer and record picker as deferred. Do not block the whole browser fallback feature on the optional picker.
- [ ] Record exact OS, browser/app versions, recipient/subject/body formatting/attachment outcomes and cancellation results. No simulator-only claim of mail-app interoperability.

## Task 6 — Cross-platform acceptance and full review

| Environment | Required evidence |
|---|---|
| New iOS shell, Apple Mail configured | Native picker/composer payload, attachment opens, return/cancel, no sent mutation |
| New iOS shell, Apple Mail unconfigured | Picker if available or explicit fallback, no silent dead button |
| Older installed shell | Existing composer contract works; uncertain result cannot trigger duplicate handoff |
| iPhone/iPad Safari → Apple Mail and Outlook | Real PDF received; document recipient/subject/body handling; iPad picker anchored |
| Android Chrome → Gmail | Actual PDF and text arrive; record subject/recipient behavior |
| Desktop Safari/Chrome/Edge | Available sharing tested; otherwise mailto recipient/subject plus HTML/plain clipboard |
| Unsupported browser/clipboard denied/no mail handler | Manual body selection and PDF download remain available; no false copy success |
| Slow/offline/session expired | Preparation errors/retry; no HTML attached as PDF; no stale automatic share |
| Hosted and disabled modes, fictional local fixtures | New controller never runs; direct-send tests preserve complete message/PDF and sent logging |

- [ ] Use fictional Tarnsby manual-delivery fixtures, including Unicode, multi-line invoice, missing recipient, already-sent invoice and cancelled invoice.
- [ ] Check narrow/mobile layout, keyboard activation/focus, visible error copy, aria-live status and restored page behavior.
- [ ] Run the full core suite and typecheck on Node 22.12+; npm audit; Worker dry-run bundle; swift test and simulator compile. Compare results with baseline.
- [ ] Review source for auth/tenant isolation, XSS/bridge injection, invoice-data leakage, stale temporary files and silent PDF omission. Update README/SPEC/PROJECT_LOG with exact verified limits.
- [ ] Obtain independent review of both web and native changes. Fix blockers and rerun affected checks. Green code tests do not replace the real-device evidence matrix.
- [ ] If a device is unavailable, record the specific cell as unverified and keep that path out of claimed supported configurations. Do not declare the full feature qualified until required cells are satisfied.

## Task 7 — Tarnsby-only release, verify and rollback

- [ ] Merge reviewed core PR once CI is green. This is not permission to bump every tenant.
- [ ] In private release worktree, change ONLY tenants/tarnsby/core.ref and the Tarnsby opt-in. Inspect diff and build trigger configuration before push. matts-av pin and profile must be byte-for-byte unchanged.
- [ ] Ensure remote Tarnsby schema matches code (no new migrations expected). Do not seed production or run migrations on another tenant.
- [ ] Deploy Tarnsby through the established pinned-core pipeline. If shared CI would deploy other tenants, use the existing Tarnsby-specific pipeline with correct recorded config revision; never deploy an unrecorded core override.
- [ ] Verify Tarnsby /health reports exact core/config versions, configured true and expected schema; verify its build logs explicitly completed successfully.
- [ ] Run Tarnsby-only read/draft smoke tests and the available native/browser matrix. Do not perform a real send without the authorized test mailbox.
- [ ] Confirm only the Tarnsby worker was targeted using release/build metadata. No matts-av live smoke or write operations.
- [ ] Rollback: revert only the Tarnsby opt-in/pin to recorded pre-release values and redeploy Tarnsby if manual Send is broken, attachments are omitted, or tenant/auth boundaries fail. Retain original installed shell compatibility; keep native-v2 additive.
- [ ] Record release SHAs, Tarnsby evidence, device coverage and remaining limitations in Cortex and committed project log. Wider rollout requires a separate explicit user instruction.

## Completion criteria

- One manual Send control chooses an available path without duplicate handoffs.
- Download PDF remains independently usable at all times.
- No PDF clipboard claims or implementation.
- Native direct composer provides all fields and PDF; picker/share limitations are documented from actual devices.
- Clipboard fallback has correct recipient/subject, formatted or plain text, and explicit attachment instructions.
- Cancellation never logs sent; only explicit manual confirmation does so.
- Hosted/white-label sending behavior remains independent and covered by regression tests.
- Tarnsby is verified live; no other tenant has been changed, redeployed or used for testing.

## Technical references

- Web Share fields and user activation: https://www.w3.org/TR/web-share/
- Clipboard supported formats: https://www.w3.org/TR/clipboard-apis/
- Native presentation APIs: Apple UIKit UIActivityViewController and MessageUI MFMailComposeViewController documentation must be checked during native implementation against the deployment SDK.
