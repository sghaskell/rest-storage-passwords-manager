---
title: "Sequential Feature Implementation — Agent Handoff"
date: 2026-05-26
---

# Sequential Feature Implementation — Agent Handoff

## Mission

Implement 4 features sequentially using subagents. Each subagent reads a plan file, modifies the codebase, and commits. The orchestrator waits for completion before starting the next.

**Project:** REST Storage Passwords Manager for Splunk
**Stack:** React + webpack, Splunk JS Stack, Splunk REST APIs, kvstore
**Source dir:** `appserver/static/react/`
**Branch:** `feature/expiry-notifications-policy-tagging-roles`

**CRITICAL: No new npm dependencies. Use only `@splunk/react-ui` components.**
**CRITICAL: Realm format `baseRealm;expiry_YYYY-MM-DD` must NEVER be broken.**

---

## Context Management Rules for Orchestrator

1. **DO NOT read plan files or source files into context.** Subagents do this themselves.
2. **DO NOT collect subagent output inline.** Subagents write files to disk directly.
3. **After each subagent completes, verify with `git diff` or `git status`** — not by reading diff output into context.
4. **Between subagents, run a quick git commit** to checkpoint progress.
5. **Use `background: false` for subagents** — wait for each to finish before starting the next.
6. **Subagent output should be minimal** — just "done" or file path. The actual code is on disk.

---

## Sequential Plan

### Order: #006 → #007 → #008 → #009

Each feature is self-contained. No feature depends on another's implementation. The order is chosen so smaller changes come first (less merge risk).

### Step 1: Feature #006 — Expiry Notifications

```
subagent({
    agent: "implement",
    task: "Implement Plan #006 from docs/plans/2026-05-26-006-feat-expiry-notifications.md. Read the full plan, read the source files mentioned, implement all phases. Commit when done with message 'feat: password expiry notifications (#006)'.",
    skill: true
})
```

**Verification after step 1:**
```bash
git status  # should show modified api.js, new ExpiryDashboard.jsx, ExpiryAlertConfig.jsx, modified bundle.jsx
git diff --stat HEAD  # verify the commit
```

### Step 2: Feature #007 — Password Policy Enforcement

```
subagent({
    agent: "implement",
    task: "Implement Plan #007 from docs/plans/2026-05-26-007-feat-password-policy.md. Read the full plan, read the source files mentioned, implement all phases. Commit when done with message 'feat: password policy enforcement (#007)'.",
    skill: true
})
```

**Verification:** Check `git diff --stat HEAD` — should show modified `api.js`, `CredentialForm.jsx`, new `PasswordPolicySettings.jsx`, modified `bundle.jsx`.

### Step 3: Feature #008 — Credential Tagging

```
subagent({
    agent: "implement",
    task: "Implement Plan #008 from docs/plans/2026-05-26-008-feat-credential-tagging.md. Read the full plan, read the source files mentioned, implement all phases. Commit when done with message 'feat: credential tagging (#008)'.",
    skill: true
})
```

**Verification:** Should show new `ExpiryDashboard.jsx`/`ExpiryAlertConfig.jsx` from #006, modified `api.js`, `CredentialForm.jsx`, `CredentialTable.jsx`, `bundle.jsx`.

### Step 4: Feature #009 — Role-Based Access at Scale

```
subagent({
    agent: "implement",
    task: "Implement Plan #009 from docs/plans/2026-05-26-009-feat-role-based-access.md. Read the full plan, read the source files mentioned, implement all phases. Commit when done with message 'feat: role-based access at scale (#009)'.",
    skill: true
})
```

**Verification:** Should show new `RoleAccessDashboard.jsx`, `BulkRoleAssignmentModal.jsx`, modified `api.js`, `bundle.jsx`.

---

## Orchestrator Workflow

```javascript
// Pseudocode for the orchestrator agent workflow:
// 1. Confirm branch and clean working tree
await bash("git status --short && git branch --show-current")

// 2. Run each feature sequentially, waiting for completion
await implementFeature(6)  // waits for subagent to finish
await verifyAndCommit(6)   // checkpoint

await implementFeature(7)
await verifyAndCommit(7)

await implementFeature(8)
await verifyAndCommit(8)

await implementFeature(9)
await verifyAndCommit(9)

// 3. Final verification
await bash("git log --oneline -4")  // verify all 4 commits
await bash("git diff --stat HEAD~4")  // verify total changes
```

---

## Key Integration Points Across Features

### Shared API Functions (api.js)
- `getRotationStatus()` — modified by #006 (dynamic threshold), used by #006 dashboard
- `validatePasswordAgainstPolicy()` — added by #007, used by `CredentialForm.jsx`
- Tag functions (`setTagsForCredential`, etc.) — added by #008, used by form + table
- Role functions (`getRolesWithCapabilities`, `bulkAssignRoles`) — added by #009

### Shared Components (bundle.jsx)
- Navigation tabs: #006 adds "Expiry Dashboard" tab, #009 adds "Role Access" tab
- Both features co-exist in the same navigation bar
- Credential enrichment in `loadCredentials()` — #006 adds rotation data, #008 adds tag data

### CredentialForm.jsx
- #007 adds policy validation + banner
- #008 adds tag input section
- Both modifications are in separate sections of the form — no conflicts

### CredentialTable.jsx
- #008 adds `tags` column
- Existing `aclRead`/`aclWrite` columns are reused by #009 (no modification needed to the table itself)

---

## Subagent Implementation Guidelines

Each subagent should follow this pattern:

1. **Read the plan file** — `docs/plans/2026-05-26-XXX-*.md`
2. **Read existing source files** — all files listed in "Files to Modify"
3. **Implement phase by phase** — follow the plan's numbered phases
4. **Write code to files** — use `write` for new files, `edit` for modifications
5. **Test syntax** — run `node -c` on JS files to check for syntax errors
6. **Commit** — `git add` + `git commit` with the specified message

### Rules for Code Changes

- **Never break the realm format.** `parseExpiryFromRealm()` and `buildRealmWithExpiry()` are already implemented — modify carefully.
- **Use existing patterns.** Match the CommonJS `require()` pattern, not ES modules.
- **Splunk UI only.** Use `@splunk/react-ui` components (Button, Modal, Text, Selector, MultiSelector, Switch, ControlGroup, Chip, Table, Paginator, Dropdown).
- **No new imports outside Splunk.** No lodash, no date-fns, no external libs.
- **Preserve existing exports.** When modifying `module.exports` in `api.js`, ADD to the existing object — don't overwrite.
- **Dark theme support.** If adding new styled elements, add dark-theme CSS matching the existing `GlobalStyles` pattern in `bundle.jsx`.

### Realm Format Reference

```
Valid formats:
- "prod"                          → realm only, no expiry
- "expiry_2026-05-26"            → expiry only, no base realm
- "prod;expiry_2026-05-26"       → combined (preferred)
- ""                            → empty, no realm

DO NOT modify parseExpiryFromRealm() or buildRealmWithExpiry() unless the plan explicitly says so.
```

---

## Quick Reference: File Map

| File | Purpose | Modified by |
|---|---|---|
| `api.js` | REST API, auth, utilities | All 4 features |
| `bundle.jsx` | Main app shell, routing | #006, #007, #008, #009 |
| `components/CredentialForm.jsx` | Create/edit form | #007, #008 |
| `components/CredentialTable.jsx` | Table display | #008 |
| `components/Modal.jsx` | Modals (bulk edit, etc.) | #008 (bulk tag ops) |
| `components/ExpiryDashboard.jsx` | **NEW** — expiry dashboard | #006 |
| `components/ExpiryAlertConfig.jsx` | **NEW** — email alert config | #006 |
| `components/PasswordPolicySettings.jsx` | **NEW** — policy settings | #007 |
| `components/RoleAccessDashboard.jsx` | **NEW** — role dashboard | #009 |
| `components/BulkRoleAssignmentModal.jsx` | **NEW** — bulk role modal | #009 |

---

## Success Criteria

After all 4 subagents complete:

1. `git log --oneline -4` shows 4 commits, one per feature
2. Each feature's files exist and are syntactically valid
3. No merge conflicts between features (sequential prevents this)
4. Realm format preserved — `parseExpiryFromRealm()` and `buildRealmWithExpiry()` unchanged
5. No new npm dependencies — `package.json` unchanged
6. All `module.exports` in `api.js` are additive (nothing removed)

---

## If Something Goes Wrong

- **Context overflow:** If the orchestrator runs low on context, the subagent work is already committed. Start a new session and continue from the next unimplemented feature.
- **Merge conflict:** Sequential implementation prevents conflicts. If a conflict occurs, it means a subagent modified a file unexpectedly — check `git diff` and fix.
- **Syntax error:** Subagents should `node -c` their changes. If a file is broken, the next subagent will see the error — fix the previous feature first.
