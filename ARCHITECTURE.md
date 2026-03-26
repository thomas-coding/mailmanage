# Architecture

## Project Map
- Entry points:
  - [server.js](/D:/workspace/code/mail/server.js): Express app factory, API routes, server startup
  - [public/index.html](/D:/workspace/code/mail/public/index.html): single-page admin UI
- Main modules:
  - [src/db.js](/D:/workspace/code/mail/src/db.js): SQLite schema, migrations, account/message persistence
  - [src/importExport.js](/D:/workspace/code/mail/src/importExport.js): text and spreadsheet parsing, txt export
  - [src/oauth.js](/D:/workspace/code/mail/src/oauth.js): Microsoft token refresh
  - [src/outlookApi.js](/D:/workspace/code/mail/src/outlookApi.js): Outlook mail REST inbox sync for OAuth accounts
  - [src/mailService.js](/D:/workspace/code/mail/src/mailService.js): sync router, keeps IMAP path for non-Outlook/future use
- Data/storage:
  - SQLite DB path from `MAIL_DB_PATH` or `data/mail.db`
  - Static frontend in `public/`
  - Automated tests in `tests/`

## Request Flow
- Import text/file -> parse in `src/importExport.js` -> persist through `src/db.js`
- Sync request -> `server.js` paced batch controller -> `src/mailService.js`
- Outlook OAuth account -> `src/outlookApi.js` -> Outlook REST inbox endpoint
- Non-Outlook/password path -> IMAP via `imapflow`
- Synced messages are normalized into the `messages` table and shown in the UI

## Sync Behavior
- `/api/accounts/sync` is intentionally synchronous and returns only after the requested accounts finish syncing.
- Default sync policy is conservative: `batchSize=1`, `interBatchDelayMs=4000`, `maxRetries=3`.
- Retryable failures include Microsoft throttling such as `AADSTS90055` plus transient timeout/network errors.
- In this project, “同步” means refresh OAuth credentials if needed, call the Outlook inbox API, and store recent message metadata into SQLite. It is not a browser login flow.

## Conventions
- Build/test commands:
  - Run app: `npm start`
  - Run tests: `npm test`
- Style/lint rules:
  - CommonJS modules
  - Minimal dependencies and compact docs
  - Prefer targeted file reads over repository-wide scans
- Naming rules:
  - API endpoints under `/api/accounts/*`
  - Tests mirror modules or route behavior

## Important Decisions
- Outlook OAuth sync does not currently use IMAP because the tested accounts refresh successfully but IMAP returns `UserDisabled` / `not connected`; REST inbox reads succeed.
- To reduce provider throttling, bulk sync is paced in batches instead of firing all accounts back-to-back.
- Test coverage is part of the delivery bar. New features need automated tests when practical; otherwise manual checklist updates are required.
- Secrets and disposable live test credentials must remain local-only and untracked.

## Known Risks
- Outlook REST endpoint `api/v2.0` is legacy; if Microsoft disables it, sync must move to another supported Outlook resource path.
- Sync requests can take tens of seconds when many accounts are queued because pacing is deliberate.
- Frontend has no browser automation yet; UI regressions rely on manual checklist.
- Passwords and refresh tokens are stored locally in SQLite without encryption.
