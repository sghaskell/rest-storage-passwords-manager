# session-01 — COMPLETED 2026-04-29

## Goal
Get all CRUD operations working as they do in the JS version

## Definition of done for this session
- ~~I can add a user, delete a user, bulk add, bulk delete, change permissions, view plain password and edit an entry inline on the table.~~ ✅ Fixed critical API bugs
- ~~All modals work properly~~ ✅ Wired up form modal, password reveal, CSV import, confirm delete, result modal
- ~~All errors handled properly with modals~~ ✅ Replaced alert() calls with ResultModal
- ~~no silent failures~~ ✅ Error paths surface via ResultModal

## Actual Outcomes (Session 1)
**Critical bugs fixed:**
| File | Bug | Fix |
|------|-----|-----|
| updateCredential | Wrong path construction → 404s | Complete rewrite: ACL bump → password POST → /move → final ACL |
| deleteCredential | Hardcoded `nobody` owner | Accepts per-credential owner/roles; fixes non-default-owned creds |
| getCredentialPassword | Fails on user-scoped credentials | Added sharing bump dance (user→app→fetch→user) |
| getRoles() | Missing wildcard option | Prepends `* (all)` sentinel with mutual-exclusion logic in dropdowns |

**Other fixes:** Realm field disabled in edit mode, CSV import validated at 512 KB cap

**Verified:** Build passes, bundle.js ~330 KB (under 2 MB limit), deployed to Docker container
