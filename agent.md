# Agent Guide

Read the minimum needed. Do not start by scanning the whole repository.

## Reading Order

### Layer 0: Always read
- [PROJECT_STATE.md](/D:/workspace/code/mail/PROJECT_STATE.md)

### Layer 1: Read for any code or behavior change
- [ARCHITECTURE.md](/D:/workspace/code/mail/ARCHITECTURE.md)

### Layer 2: Read only for the matching task
- Product/run usage: [README.md](/D:/workspace/code/mail/README.md)
- Manual QA or browser verification: [manual-test-checklist.md](/D:/workspace/code/mail/docs/manual-test-checklist.md)

### Layer 3: Read only the touched code
- Backend entry: [server.js](/D:/workspace/code/mail/server.js)
- Storage: [db.js](/D:/workspace/code/mail/src/db.js)
- Mail sync routing: [mailService.js](/D:/workspace/code/mail/src/mailService.js)
- Outlook OAuth inbox sync: [outlookApi.js](/D:/workspace/code/mail/src/outlookApi.js)
- OAuth token refresh: [oauth.js](/D:/workspace/code/mail/src/oauth.js)
- Import/export parsing: [importExport.js](/D:/workspace/code/mail/src/importExport.js)
- Frontend: [index.html](/D:/workspace/code/mail/public/index.html), [app.js](/D:/workspace/code/mail/public/app.js), [styles.css](/D:/workspace/code/mail/public/styles.css)
- Tests: files in [tests](/D:/workspace/code/mail/tests)

## Do Not Read Unless Needed
- `node_modules/`
- `coverage/`
- `data/`
- `test_mail.txt`
  This file contains disposable live test credentials and is intentionally excluded from git. Read it only when explicitly running live mailbox validation.

## Current Truths
- Outlook OAuth mailbox sync currently uses the Outlook mail REST endpoint, not IMAP.
- IMAP code still exists for non-Outlook or future extensions.
- `/api/accounts/sync` now runs accounts in paced batches with retry on provider throttling and transient network errors.
- Quality bar: every feature change needs automated tests when practical, otherwise manual test steps must be updated.
- Coverage gate: `lines >= 80`, `statements >= 80`, `functions >= 75`, `branches >= 60`.

## Commands
- Install: `npm install`
- Run app: `npm start`
- Run tests: `npm test`
- Watch tests: `npm run test:watch`

## Change Rules
- Keep docs compact and update `PROJECT_STATE.md` when project state changes.
- If architecture or major behavior changes, update `ARCHITECTURE.md`.
- If manual-only verification is required, update [manual-test-checklist.md](/D:/workspace/code/mail/docs/manual-test-checklist.md).
- Do not commit secrets or local databases.
