---
title: "Orchestrator Agent — Run Instructions"
date: 2026-05-26
---

# Orchestrator Agent — Run Instructions

## You are the orchestrator. Spawn 4 subagents sequentially.

**Project:** `/home/scott/Documents/code/rest-storage-passwords-manager`
**Branch:** `feature/expiry-notifications-policy-tagging-roles`

## Instructions

1. Read `docs/plans/SUBAGENT_TASKS.md` — each task has the exact description to give each subagent
2. For each of the 4 features, spawn ONE subagent with the corresponding task description
3. Wait for each subagent to complete before starting the next
4. After each subagent finishes, verify: `git log --oneline -1` shows the commit
5. After all 4 complete: `git log --oneline -4 && git status`

## Sequential Execution

```
Subagent 1 → Feature #006 (Expiry Notifications)
   ↓ wait for commit
Subagent 2 → Feature #007 (Password Policy)
   ↓ wait for commit
Subagent 3 → Feature #008 (Credential Tagging)
   ↓ wait for commit
Subagent 4 → Feature #009 (Role-Based Access)
```

## Context Rules — DO NOT VIOLATE

- **Do NOT read source files yourself.** Subagents handle all reading and writing.
- **Do NOT output diffs or file contents.** After each subagent, only check `git log --oneline -1` and `git status --short`.
- **Do NOT summarize subagent output.** Just confirm the commit exists and proceed.
- If a subagent fails, tell the user — don't retry automatically.

## Key Constraints Every Subagent Must Follow

- No new npm dependencies
- Realm format `baseRealm;expiry_YYYY-MM-DD` is DO NOT BREAK
- `api.js` module.exports — ADD only, never overwrite
- Use `@splunk/react-ui` components only
- Dark theme CSS matching existing `GlobalStyles` pattern in `bundle.jsx`

## Final Verification

After all 4 commits:
```bash
git log --oneline -4
# Should show 4 commits: #006, #007, #008, #009
git diff HEAD~4 --stat
# Should show all changed files across 4 features
```
