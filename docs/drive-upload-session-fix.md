# Drive uploads: Proxy invariant and session investigation

Scope: current main `6345b82`, ticket evidence/signature uploads and the immediate mutation/sync flow. No production operations, credentials or real Google requests were used for validation.

## Root cause and correction

The Drive observer returned a different object for `rawDriveApi.files`. When that own property is non-configurable and non-writable, JavaScript requires the exact original value: the observer itself throws before the upload can run. A regression fixture reproduces the original TypeError.

A plain facade now binds the actual resource methods, without proxying or modifying Google objects. It covers every current call site: files.create/get/list/copy/update/export and permissions.create/delete. Each call records one metric on resolve, reject or synchronous throw. Arguments, streams, response/error identities and resource `this` are preserved. Existing upload retries and Drive transport are unchanged.

## Apparent session reset

Inspected AuthContext, requestErrors, api, moduleApi, syncManager, largeEvidenceUpload, ticket detail/upload callbacks and backend error dispatch. No causal path from the Drive TypeError to session deletion was found. The backend reports this untyped error as 500; the public signature action does not imply an authenticated session failure.

AuthProvider clears the session for an authentication error (401, or an explicit UNAUTHORIZED code below 500). Ordinary 403, 500/502/503, Drive failures, SERVER_BUSY, network failure and sync refresh-required errors do not clear it. Sync unsafe reconciliation is distinct from security invalidation. A real security scope change can request auth.me; only a genuine authentication failure closes the session. No authentication behavior was changed.

The production UNAUTHORIZED bursts remain unexplained by this bug. Correlate sanitized request IDs, authentication error reasons and session expiry/revocation timestamps to establish their cause; unchanged bootId/PID does not establish session validity.

## Narrow request fan-out

Ticket upload callbacks already patch the affected evidence; returnPending intentionally refreshes that ticket once. However, every media-upload-idle event previously polled all visited sync resources, even after a failed file. It now resumes a poll only when an actual scheduled sync was deferred by active media. Focus/online/timer/offline-replay triggers remain intact. This removes an identified fan-out; it does not establish the cause of all 1,017 production reads.

## Validation

- `npm test`: 525 characterization tests and 85 backend tests passed, including backend syntax checks. Added the root test alias to these existing suites.
- `npm run build`: passed.
- Drive tests: immutable resource regression; all eight used methods on resolve/reject/throw; one metric each; streams remain unconsumed.
- Upload flow: actual uploadBuffer/uploadBase64 with fake Google transport, byte preservation, followed by actual returnPending handler; nonretryable error identity preserved.
- Session tests: actual AuthProvider through the existing style of hook harness, eight error cases; temporary errors retain session and true 401 clears it.
- Scheduler test: ten upload completions cause zero unsolicited global polls; a deferred timer resumes exactly once.

Tests are synthetic and do not establish production latency or eliminate other causes of 401s. Production evidence/signature uploads and session correlation remain to be verified after an independently authorized deployment. No merge or deploy is part of this change.
