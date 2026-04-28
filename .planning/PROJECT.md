# Project: REST storage/passwords Manager v3.0.0

## What This Is

A Splunk app that provides a modern React-based interface for managing credentials stored in Splunk's `storage/passwords` REST endpoint. This is a complete rewrite of the existing v2.x application (which uses vanilla JavaScript with splunkjs/mvc) into a React application with Webpack build tooling.

The app enables users to:
- Create, read, update, and delete credentials via a CRUD dashboard
- Manage permissions (roles for read/write, owner, sharing scope)
- Bulk import credentials from CSV files
- Reveal clear-text passwords securely in a modal
- Filter credentials in real-time
- View credentials with pagination

## What This Is Not

- Not a Splunk SDK or library
- Not a general-purpose password manager
- Not a replacement for Splunk's built-in credential storage (it uses that storage)

## Value Proposition

- **Modern UI** - React with proper component architecture, faster than vanilla JS
- **Splunk Cloud compatible** - No deprecated splunkjs/mvc components
- **Proven workflow** - Build → Package → Deploy to Splunk (local or cloud)
- **Maintainable** - Clear separation of concerns, TypeScript-ready structure

## Context

### Current State
- Version 2.1.1 is deployed and working; v3.0.0 React rewrite in progress
- Phase 01.5 complete — production build hardened (Terser, externals), Playwright CRUD tests, bundle verified at 820 KB
- Phase 01.4 complete — CredentialForm upgraded to Splunk React UI components with sharing/ACL wiring
- Phase 01.2.1 complete — API contract bugs fixed: buildAclPath helper, credential naming, password reveal, moveCredential exported
- V3 bundle at `appserver/static/react/bundle.js` compiles production-ready (820 KB, no sourcemaps, React externalized)

### Target State
- Version 3.0.0 with React 18.2.0
- Built with Webpack into `appserver/static/react/bundle.js`
- Uses `@splunk/react-ui` for Splunk-consistent components
- Code organized in proper React components

## Requirements

### Validated

- ✓ User can list all credentials in a table
- ✓ User can create new credentials with username, password, realm
- ✓ User can update credential passwords and permissions
- ✓ User can delete credentials
- ✓ User can reveal clear-text passwords in a modal
- ✓ User can filter credentials by username, realm, or app
- ✓ User can bulk import credentials from CSV
- ✓ User can download a CSV template for import
- ✓ ACL controls use correct role/user pickers
- ✓ Splunk Cloud compatible (passes AppInspect cloud tags)

### Active

- [ ] React component architecture (proper separation into components)
- [ ] Deployment to local Splunk Docker container (build and package ready; requires manual Splunk install test)
- [ ] Component structure matches legacy functionality

### Validated in Phase 01.2.1

- ✓ Webpack build tooling configured and working (verified via npm run build during gap fixes)

### Validated in Phase 01.4-wave-2-ui-upgrades (Validated)

- ✓ Component structure uses @splunk/react-ui primitives with ControlGroup wrapping
- ✓ Sharing selector with global/app/user options wired through API layer
- ✓ Two-step ACL pattern for user-scoped credentials matches legacy behavior
- ✓ Bundle handlers pass sharing parameter to create/update/delete API calls
- ✓ Password confirmation with native Splunk validation (ControlGroup.errorText)

### Validated in Phase 01.5-build-deployment

- ✓ Production build generates correct bundle output — webpack hardening with Terser minification, conditional sourcemaps, React/ReactDOM externals produces 820 KB optimized bundle
- ✓ App packaging for Splunk deployment — .spl generation validated; legacy password-crud.js co-exists with React bundle
- ✓ CI-ready verification scripts — check:bundle-size and verify:legacy npm scripts for automated gates

### Out of Scope

- Not changing the UI design (keep existing visual style)
- Not adding new credential fields beyond what v2.x supports
- Not changing the REST API interaction patterns
- Not removing legacy `password-crud.js` until v3.0.0 is fully verified

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| React 18.2.0 | Current stable, matches `@splunk/react-ui` compatibility | Modern UI framework |
| Webpack build | Splunk-recommended, mature ecosystem, better RequireJS compatibility | Splunk-native build tool |
| UMD bundle format | Works with Splunk's RequireJS loader | Compatibility with Splunk's loader |
| Keep legacy password-crud.js | Safety during migration, rollback option | Gradual deprecation path |
| Use @splunk/react-ui | Splunk's official UI library, ensures consistency | Splunk-native look and feel |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-28 after Phase 01.5-build-deployment completion*
