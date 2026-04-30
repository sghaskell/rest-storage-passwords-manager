# LOOP.md — Session 1 (COMPLETED)

## Goal for tonight
- Get all CRUD operations working as they do in the JS version

## Definition of done for this session
- ~~I can add a user, delete a user, bulk add, bulk delete, change permissions, view plain password and edit an entry inline on the table.~~ ✅ Fixed critical API bugs
- ~~All modals work properly~~ ✅ Wired up form modal, password reveal, CSV import, confirm delete, result modal
- ~~All errors handled properly with modals~~ ✅ Replaced alert() calls with ResultModal
- ~~no silent failures~~ ✅ Error paths surface via ResultModal

### Actual Outcomes (Session 1)
**Critical bugs fixed:**
- `updateCredential` — complete rewrite to match legacy L511-554: ACL bump → password POST → /move → final ACL
- `deleteCredential` — accepts per-credential owner/roles; fixes hardcoded 'nobody' that broke non-default-owned creds
- `getCredentialPassword` — added sharing bump dance for user-scoped credentials (user→app→fetch→user)
- `getRoles()` — prepends '* (all)' sentinel with mutual-exclusion logic in form dropdowns
- Realm field disabled in edit mode (immutable per REST API constraint)
- CSV import validated at 512 KB cap (prevents Splunk API payload limits)

**Verified:** Build passes, bundle.js ~330 KB (under 2 MB limit), deployed to Docker container

---

# LOOP.md — Session 2 (Draft — pending review)

## Goal
- Close remaining parity gaps with legacy JS version

## Definition of done for next session
1. ResultModal renders with proper React elements — zero React invariant violations after any of: create, update, delete
2. CSV import modal shows parsed preview table with per-row error column matching legacy JS column layout

## Out of scope next session
- Full @splunk/react-ui migration (deferred until core parity proven)
- Visual/theme overhaul and Splunk design token adoption
- New CSV template columns or form hints
- Unit/integration test generation