## LOOP.md — Session 2
**Agent:** qwen3.6-27B

## Goal
Fix three bulk upload bugs to achieve parity with native JS version:
1. CSV template missing optional columns (generateCSVTemplate)
2. Default CSV owner hardcoded 'nobody' instead of getCurrentUser()
3. CSV preview is raw text dump, not parsed table with errors + confirmation step

## Bugs identified
- **CSV template missing optional columns**: `generateCSVTemplate()` only outputs 3 of 8 columns; add realm, app, owner, sharing, read, write with defaults and example row (JS L926-1101)
- **Default CSV owner hardcoded 'nobody'**: `parseCSV` defaults to `'nobody'` instead of real user via `getCurrentUser()` — all bulk-imported credentials get wrong owner context (api.js vs js L877)
- **CSV preview is raw text dump, not parsed table**: JS shows full parsed table with per-row errors and Import/Cancel confirmation step before import; React version imports immediately

## Definition of done
1. Bulk upload feature is functional at parity with the native JS version.

## Out of scope this session
- Any other items in DISCOVERIES.md unless they are identified as dependencies during session.
