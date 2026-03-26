# Project State

## Goal
- Primary objective: maintain a local Outlook OAuth mailbox manager that supports bulk import, sync, export, and reliable handoff to future AI agents.

## Current Status
- Branch: `main`
- GitHub remote: `https://github.com/thomas-coding/mailmanage.git`
- Working tree: see `git status --short` for exact dirty/clean state
- Focus area: make bulk sync resilient against Microsoft throttling

## Done Recently
- Built local mailbox manager UI and Express backend
- Added OAuth account import via text and file upload
- Added automated tests with Vitest, Supertest, and coverage thresholds
- Switched Outlook OAuth sync from failing IMAP path to working Outlook mail REST path
- Verified live sync with 5 disposable test mailboxes from local `test_mail.txt`
- Added paced batch sync with retry for throttling and transient network failures
- Re-validated live batch sync on March 26, 2026 with 5/5 test mailboxes succeeding

## In Progress
- Update docs and knowledge base to reflect paced batch sync behavior

## Blockers
- None currently

## Next Step
- Commit and push the batch sync reliability changes

## Files To Read First
- [agent.md](/D:/workspace/code/mail/agent.md)
- [server.js](/D:/workspace/code/mail/server.js)
- [ARCHITECTURE.md](/D:/workspace/code/mail/ARCHITECTURE.md)
- [tests/api.test.js](/D:/workspace/code/mail/tests/api.test.js)
- [README.md](/D:/workspace/code/mail/README.md)

## Notes
- Live credential file `test_mail.txt` is local-only and should stay out of git.
- `test_mail.txt` currently contains 5 disposable live Outlook OAuth test mailboxes.
- Replace stale bullets instead of growing this file indefinitely.
