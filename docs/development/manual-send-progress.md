# Execution ledger — manual-send-plan.md

- Baseline core: 270d257; native: be75378. Isolated worktrees, original local changes preserved.
- Ruling: use recorded private release branch and tenant-specific local deploy because both Workers Builds triggers match all main changes; merging private main would redeploy Matt's tenant. Cost: private release branch must be reconciled before later broad rollout.
- Ruling: native main has no composer implementation; implement additive native support against clean main, preserving legacy API contract. Cost: more native implementation/test scope already specified in Tasks 4–5.
- Preflight interfaces: draft body addition is backward compatible; native v2 outcome is not sent confirmation; optional flag keeps non-opted-in tenants unchanged.
- Physical device qualification is required; untested picker remains disabled by default.

- Core baseline: 417 tests passed and both TS configs passed. Native baseline passed after sandbox cache access was granted.
- Tasks 1–3 implemented: default-off profile opt-in, additive full-body/private compose response, in-memory PDF validation/preparation, single native/share/clipboard dispatcher and manual confirmation. Core full suite now includes failure/cancel/duplicate/BFCache coverage.
- Tasks 4–5 implemented in native branch: validated v2 request/result bridge, exact main-frame origin, replay gate, complete native composer, activity picker implementation disabled pending physical qualification. Swift 19 tests and simulator build pass.
- Review P2 fixed: manual controls hidden in print, confirmed unavailable native allows Web Share on a fresh click. Both regressions observed RED then GREEN.
- Review BFCache finding regraded important (stale result can overwrite restored session status); generation guard added with RED/GREEN regression. Disabled anchor replaced with real button, also RED/GREEN.
- Task 6 physical matrix remains unverified. Available paired iPhone detected; no mail interoperability asserted. Swift bridge string tests do not substitute for real WKWebView/device callback tests.
- Ruling: optional native picker stays disabled because no physical qualification exists; cost is Apple Mail composer rather than app choice in new shell until verified.

- Superseding September 20 decision: retire all browser Web Share dispatch after actual Safari/Mail evidence. Native capability chooses full composer; browsers get HTML clipboard plus addressed/subject mailto and above-Send manual PDF reminder. Physical native qualification remains pending.

- User confirms formatted browser mail and first shell Send work. Shell reminder now remains hidden for entire lifecycle; collapsed manual recovery and complete pre-retry instructions replace expanded/late guidance. Exact device versions still unknown.
