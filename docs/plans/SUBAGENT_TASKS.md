---
title: "Subagent Task Descriptions — Sequential Implementation"
date: 2026-05-26
---

# Subagent Task Descriptions

Each subagent is given ONE task. They run sequentially — subagent N+1 starts only after subagent N commits successfully. The orchestrator does NOT read the codebase — it only monitors subagent completion and triggers the next.

---

## Task 1: Feature #006 — Expiry Notifications

**Plan file:** `docs/plans/2026-05-26-006-feat-expiry-notifications.md`

**Task description:**

```
You are implementing Feature #006: Password Expiry Notifications.

Read the full plan at: docs/plans/2026-05-26-006-feat-expiry-notifications.md
Read the existing files before modifying:
- appserver/static/react/api.js (focus on getRotationStatus around line 1757)
- appserver/static/react/bundle.jsx (focus on navigation/view state around line 121, loadCredentials around line 440, credential enrichment around line 449)
- appserver/static/react/components/CredentialTable.jsx (rotation column rendering)

Implementation steps (in order):
1. Update api.js — add getDueSoonThreshold(), setDueSoonThreshold(), make getRotationStatus() use dynamic threshold, add email alert CRUD functions (createOrUpdateExpiryAlert, getExpiryAlert, deleteExpiryAlert), export all new functions
2. Create components/ExpiryDashboard.jsx — dashboard view with stats bar, sorted table, color-coded rows, auto-refresh
3. Create components/ExpiryAlertConfig.jsx — email alert settings modal
4. Update bundle.jsx — add ExpiryDashboard import, viewMode state, navigation toggle, conditional rendering, ExpiryAlertConfig modal

After completing:
- Verify no syntax errors: node -c appserver/static/react/api.js
- git add all changed/new files
- git commit -m "feat: expiry notifications dashboard with configurable threshold and email alerts (#006)"
```

---

## Task 2: Feature #007 — Password Policy Enforcement

**Plan file:** `docs/plans/2026-05-26-007-feat-password-policy.md`

**Task description:**

```
You are implementing Feature #007: Password Policy Enforcement.

Read the full plan at: docs/plans/2026-05-26-007-feat-password-policy.md
Read the existing files before modifying:
- appserver/static/react/api.js (read module.exports at end, note last exported function)
- appserver/static/react/components/CredentialForm.jsx (focus on handleSubmit around line 155, password fields around line 200, generator panel around line 400, formField helper)
- appserver/static/react/bundle.jsx (modals state around line 138, toolbar around line 1081)

Implementation steps (in order):
1. Update api.js — add POLICY_KEY, DEFAULT_POLICY, loadPolicy(), savePolicy(), validatePasswordAgainstPolicy(), updateSplunkValidator(), getSplunkValidator(), export all new functions
2. Update components/CredentialForm.jsx — add policy banner, policy validation in handleSubmit(), policy-aware generator min length, policy error display
3. Create components/PasswordPolicySettings.jsx — settings modal with toggles, sliders, banned passwords textarea, Save Locally vs Save & Apply to Splunk
4. Update bundle.jsx — import PasswordPolicySettings, add policySettings modal state, toolbar button, modal rendering

Important constraints:
- Policy defaults to DISABLED — no existing credentials are affected
- DO NOT modify realm format or expiry logic
- DO NOT change module.exports in api.js (only ADD to the existing object)

After completing:
- Verify no syntax errors: node -c appserver/static/react/api.js
- git add all changed/new files
- git commit -m "feat: password policy enforcement with inline validation and Splunk sync (#007)"
```

---

## Task 3: Feature #008 — Credential Tagging

**Plan file:** `docs/plans/2026-05-26-008-feat-credential-tagging.md`

**Task description:**

```
You are implementing Feature #008: Credential Tagging.

Read the full plan at: docs/plans/2026-05-26-008-feat-credential-tagging.md
Read the existing files before modifying:
- appserver/static/react/api.js (read splunkdRequest for kvstore usage pattern, read module.exports at end)
- appserver/static/react/bundle.jsx (loadCredentials enrichment around line 449, handleDeleteCredential around line 621, handleBulkDeleteConfirm around line 721)
- appserver/static/react/components/CredentialForm.jsx (form field layout, handleSubmit, gridRow helper)
- appserver/static/react/components/CredentialTable.jsx (COLUMNS array, buildDataCell, FILTER_FIELDS, COLUMN_TO_FILTER, filtering logic)
- appserver/static/react/components/Modal.jsx (BulkEditModal for bulk tag operations)

Implementation steps (in order):
1. Update api.js — add TAGS_COLLECTION/TAG_DEFS_COLLECTION constants, ensureCollection(), ensureTagCollections(), tagCredKey(), setTagsForCredential(), getTagsForCredential(), removeTagFromCredential(), getAllTagDefinitions(), getAllTagsData(), deleteTagsForCredential(), deleteTagDefinition(), hashToColor(), export all new functions
2. Update bundle.jsx — enhance loadCredentials() to fetch and merge tag data, add tag cleanup to delete handlers (handleDeleteCredential, handleBulkDeleteConfirm)
3. Update components/CredentialForm.jsx — add tag input section with autocomplete, tag state management, save tags on submit
4. Update components/CredentialTable.jsx — add tags column to COLUMNS, tag pills data cell builder, tag filter in FILTER_FIELDS and filtering logic
5. Update components/Modal.jsx — add tag operations to BulkEditModal

Important constraints:
- Tags are stored in kvstore ONLY — DO NOT modify realm format
- DO NOT modify parseExpiryFromRealm() or buildRealmWithExpiry()
- Tag names: lowercase, alphanumeric + hyphens + underscores, max 50 chars
- Max 5 tags per credential
- DO NOT change module.exports in api.js (only ADD to the existing object)

After completing:
- Verify no syntax errors: node -c appserver/static/react/api.js
- git add all changed/new files
- git commit -m "feat: credential tagging with kvstore, colored pills, and bulk operations (#008)"
```

---

## Task 4: Feature #009 — Role-Based Access at Scale

**Plan file:** `docs/plans/2026-05-26-009-feat-role-based-access.md`

**Task description:**

```
You are implementing Feature #009: Role-Based Access at Scale.

Read the full plan at: docs/plans/2026-05-26-009-feat-role-based-access.md
Read the existing files before modifying:
- appserver/static/react/api.js (getRoles around line 743, _setAcl around line 318, buildAclPath around line 223, module.exports at end)
- appserver/static/react/bundle.jsx (modals state, fetchReferenceData around line 280, navigation/view mode from #006, toolbar around line 1081)
- appserver/static/react/components/CredentialTable.jsx (existing aclRead/aclWrite column rendering)
- appserver/static/react/components/Modal.jsx (BulkEditModal for bulk role assignment pattern)

Implementation steps (in order):
1. Update api.js — add _rolesCapabilitiesCache, getRolesWithCapabilities(), clearRolesCapabilitiesCache(), aggregateByRole(), setCredentialRoles(), bulkAssignRoles(), getAdminWritableCredentials(), export all new functions
2. Update bundle.jsx — add viewMode state integration with #006 navigation, add roleAccess/bulkRoleAssignment modal states, fetch roles with capabilities in fetchReferenceData(), render RoleAccessDashboard conditionally, render BulkRoleAssignmentModal
3. Create components/RoleAccessDashboard.jsx — dashboard with table + matrix views, stats cards, filters (open access, admin-writable), role×credential matrix
4. Create components/BulkRoleAssignmentModal.jsx — bulk role assignment form with replace/add mode, multi-select role pickers, wildcard warning

Important constraints:
- Navigation tabs (#006 Expiry Dashboard + #009 Role Access) co-exist in same toggle
- DO NOT modify realm format or expiry logic
- Use existing aclRead/aclWrite columns as visual reference for color coding
- DO NOT change module.exports in api.js (only ADD to the existing object)

After completing:
- Verify no syntax errors: node -c appserver/static/react/api.js
- git add all changed/new files
- git commit -m "feat: role-based access dashboard with matrix view and bulk assignment (#009)"
```

---

## Orchestrator Workflow

```
// Pseudocode for the orchestrator:

const tasks = [
    { name: "Feature #006: Expiry Notifications", task: "READ_TASK_1_ABOVE" },
    { name: "Feature #007: Password Policy", task: "READ_TASK_2_ABOVE" },
    { name: "Feature #008: Credential Tagging", task: "READ_TASK_3_ABOVE" },
    { name: "Feature #009: Role-Based Access", task: "READ_TASK_4_ABOVE" },
];

for (const task of tasks) {
    // Spawn subagent for this task
    result = await subagent({
        agent: "builtin",
        task: task.task,
    });

    // Check if subagent committed successfully
    if (result.status !== "success") {
        console.error(`${task.name} failed: ${result.error}`);
        // Ask user to review before continuing
        break;
    }

    console.log(`${task.name} committed successfully`);
}

// Final verification
git log --oneline -4;
git status;
```

**Context management for the orchestrator:**

- Do NOT read any source files yourself. Subagents handle all file reads and modifications.
- After each subagent completes, verify the commit exists: `git log --oneline -1`
- Between subagents, only check `git status` — don't read diffs.
- If context runs low, the work is committed. Start a fresh session and continue from the next unimplemented feature.
