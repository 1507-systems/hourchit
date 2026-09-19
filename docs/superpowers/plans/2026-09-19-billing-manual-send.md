# Billing and manual send implementation plan

Goal: tenant-level pending-billing display, selected-entry invoicing, and full manual email composition.
Architecture: reuse D1 settings and shared invoice renderers. Keep invoice/PDF rendering unchanged. Save invoices and selected sources in one guarded D1 batch. Execute inline with test-first verification.
Spec: approved September 19 conversation, captured below.

## Approved constraints
- Three tenant display modes: task + description, task only, description only. Pending billings only; entries remain separate.
- Checkboxes, select/deselect all, selected hours and charges. Only selected entries invoiced.
- Shared full email body; subject/recipient mailto; PDF download instructions; explicit Mark as sent manually. Preserve native composer.
- Clipboard failure leaves selectable text and instructions. No status mutation on copy/download/open-email.
- Share invoice deferred to fast follow.

## Tasks
- [ ] Add real SQLite D1 test adapter and failing settings/selection tests.
- [ ] Add pending-billing domain mode/selection helpers and tenant setting in DB/routes/settings UI.
- [ ] Reuse per-attendance invoice calculation for individual pending rows and selection totals. Add selection form; require explicit IDs at POST /invoices. Transactionally validate and save invoice/lines/source links.
- [ ] Test full-body parity, copy fallback, escaping, missing recipient, duplicate confirmation. Update browser manual-send UI with shared text/HTML body, subject-only mailto, PDF instructions, manual status confirmation.
- [ ] Full suite, typecheck, bundle, browser smoke, security audit and review. Update README/SPEC/PROJECT_LOG; commit/push branch and PR.

## Safety cases
Reject empty, malformed, duplicate, foreign, running, voided and billed IDs. Recheck availability within atomic batch. Roll back on stale source rows or line/link failures. Require confirmation to overwrite sent record. Keep invoice appearance unchanged.

## Verification
npm test; npm run typecheck; npx wrangler deploy --dry-run; npm audit; git diff --check.
