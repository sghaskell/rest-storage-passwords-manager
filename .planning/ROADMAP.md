# Roadmap

## Milestone 1: React Dashboard Rewrite (v3.0.0)

### Phase 1.1: Project Setup ✅ COMPLETED
**Goal:** Configure the development environment and project structure for React development.

**Plans:**
- 1.1.1: Setup React component structure
- 1.1.2: Configure Webpack build for Splunk compatibility
- 1.1.3: Create development server configuration

**Depends on:** -

**Status:** Complete
- Build working: `npm run build` generates `appserver/static/react/bundle.js`
- UMD format compatible with Splunk's RequireJS loader

---

### Phase 1.2: Core Components ✅ COMPLETED
**Goal:** Implement the core React components that mirror the legacy functionality.

**Plans:**
- 1.2.1: Create CredentialManager (main app component)
- 1.2.2: Create CredentialTable (table with pagination, filtering)
- 1.2.3: Create CredentialForm (create/update forms)
- 1.2.4: Create Modal component for password reveal and imports

**Depends on:** 1.1

**Status:** Complete
- CredentialManager.jsx - Main application component with state management
- CredentialTable.jsx - Table with pagination, filtering, sorting
- CredentialForm.jsx - Create/update credential forms
- Modal.jsx - Password reveal, CSV import, delete confirmation modals
- api.js - REST API service for Splunk storage/passwords endpoint

---

### Phase 01.2.1: Wave 1 Critical Gap Fixes (INSERTED)

**Goal:** Fix blocking API contract bugs (ACL path, credential naming, password reveal, app move) that prevent CRUD operations from working correctly in Splunk.
**Requirements**: GAP-C01, GAP-C06, GAP-C07, GAP-C08, GAP-C09, GAP-U04
**Depends on:** Phase 1.2
**Plans:** 2 plans

Plans:
- [ ] 01.2.1-01-PLAN.md — API contract fixes (buildAclPath, credential naming, table key uniqueness)
- [ ] 01.2.1-02-PLAN.md — New API functions (getCredentialPassword, moveCredential) + Modal wiring

### Phase 1.3: API Integration
**Goal:** Implement REST API calls to Splunk's storage/passwords endpoint.

**Plans:**
- 1.3.1: Implement credential fetching (read)
- 1.3.2: Implement credential creation (create)
- 1.3.3: Implement credential update (update)
- 1.3.4: Implement credential deletion (delete)
- 1.3.5: Implement ACL management (read/write roles, owner, sharing)

**Depends on:** 1.2  

**Status:** Planned

---

### Phase 1.4: Advanced Features
**Goal:** Implement bulk import and other advanced features.

**Plans:**
- 1.4.1: CSV import modal with drag/drop
- 1.4.2: CSV template download
- 1.4.3: Password reveal functionality
- 1.4.4: Validation and error handling

**Depends on:** 1.2, 1.3  

**Status:** Planned

---

### Phase 1.5: Build & Deployment
**Goal:** Build and deploy the React application, verify compatibility.

**Plans:**
- 1.5.1: Production build verification
- 1.5.2: Splunk Cloud compatibility verification
- 1.5.3: AppInspect validation
- 1.5.4: Documentation update

**Depends on:** 1.1, 1.2, 1.3, 1.4  

**Status:** Planned

---

## Summary

| Phase | Status | Plans | Depends on |
|-------|--------|-------|------------|
| 1.1 | ✅ Complete | 3 | - |
| 1.2 | ✅ Complete | 4 | 1.1 |
| 1.3 | Planned | 5 | 1.2 |
| 1.4 | Planned | 4 | 1.2, 1.3 |
| 1.5 | Planned | 4 | 1.1, 1.2, 1.3, 1.4 |
| **Total** | **2/20** | | |
