# Phase 1.2: Core Components

## Goal

Implement the core React components that mirror the legacy functionality from `password-crud.js`.

## Plans

### 1.2.1: Create CredentialManager (main app component)
- Create `appserver/static/react/components/CredentialManager.jsx`
- Set up main component structure with state management
- Implement credential data fetching
- Set up event handlers for CRUD operations

### 1.2.2: Create CredentialTable (table with pagination, filtering)
- Create `appserver/static/react/components/CredentialTable.jsx`
- Implement table rendering with credentials data
- Add pagination controls
- Add real-time filtering by username, realm, or app
- Implement sort functionality

### 1.2.3: Create CredentialForm (create/update forms)
- Create `appserver/static/react/components/CredentialForm.jsx`
- Form for creating new credentials (username, password, realm)
- Form for updating existing credentials
- Implement form validation
- Handle ACL controls (roles for read/write, owner, sharing)

### 1.2.4: Create Modal component for password reveal and imports
- Create `appserver/static/react/components/Modal.jsx`
- Password reveal modal (securely display clear-text passwords)
- Import CSV modal (drag/drop or file upload)
- Confirm delete modal

## Dependencies

- Phase 1.1 (Project Setup) - Build infrastructure must be in place

## Acceptance Criteria

- [ ] All four components created with proper React patterns
- [ ] Components render without errors
- [ ] Component structure matches legacy functionality
- [ ] Code organized in proper React component hierarchy
- [ ] Bundle builds successfully with new components
- [ ] Development server runs (if configured)

## Technical Notes

- Use `@splunk/react-ui` components for Splunk-consistent styling
- Follow existing code patterns from `password-crud.js`
- Maintain compatibility with Splunk's RequireJS loader (UMD format)
