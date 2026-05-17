---
title: Multi-agent outputs flooding context window
date: 2026-05-11
category: workflow-issues
module: context-mode
problem_type: workflow_issue
component: tooling
severity: high
symptoms:
  - "Multiple parallel agent outputs exceed provider token limit"
  - "Automatic compaction triggered, wiping all review results"
  - "Context window overflow from 55-100KB+ markdown reports"
root_cause: missing_workflow_step
resolution_type: workflow_improvement
applies_when:
  - "Spawning 2+ parallel agents whose combined output may exceed 20KB"
tags:
  - multi-agent
  - context-overflow
  - sandbox-routing
  - agents-md
  - code-review
---

# Multi-agent outputs flooding context window

## Context

Spawning multiple parallel agent sub-agents (reviewers, analyzers, auditors) without routing their output through the context-mode sandbox caused their full reports to land directly in context. With 11 reviewers each producing 5-10KB of markdown, the total injection of 55-100KB+ exceeded the provider's token limit and triggered automatic compaction, wiping all findings.

## Guidance

When spawning multiple agents, **never** let raw output enter context. Route all multi-agent output through `ctx_batch_execute` or `ctx_execute` sandbox — only `console.log` summaries enter context. The full reports stay indexed in the knowledge base for later retrieval via `ctx_search`.

**Rule added to AGENTS.md:**

```markdown
### Multi-agent outputs — MANDATORY sandbox routing
When spawning multiple agents (reviewers, analyzers, etc.), **NEVER** let raw output enter context.

- **DO:** Route through `ctx_batch_execute` or `ctx_execute` sandbox — `console.log` only summaries.
- **DON'T:** Spawn tasks and let full reports land in context, even if parallel.

Exception: Single small output (<2KB) OK direct. Multiple outputs or large output — sandbox only.
```

## Why This Matters

Without this rule, each agent's output is treated as a tool response appended to context. With N agents producing K KB each, total context injection is N×K. A single code review with 11 reviewers blew past the token limit and lost all findings to compaction. The sandbox breaks this linear accumulation: full output stays in the subprocess, only controlled summaries reach context, and `ctx_batch_execute` auto-indexes everything for later search.

## When to Apply

- Code reviews with multiple reviewer agents
- Parallel analysis tasks (security audits, performance profiling, pattern detection)
- Any workflow spawning 2+ sub-agents where combined output may exceed 20KB

## Examples

**Before (context blowup):**
```
# Spawn 11 reviewers — each dumps full report into context
task(description: "Correctness reviewer", ...)
task(description: "Security reviewer", ...)
task(description: "Testing reviewer", ...)
# ... 8 more ...
# Result: 55-100KB in context, token limit exceeded, compaction wipes all
```

**After (sandbox routed):**
```
# Route through ctx_batch_execute — full reports indexed, summaries only
ctx_batch_execute(
  commands: [
    {label: "Correctness", command: "review --correctness ..."},
    {label: "Security", command: "review --security ..."},
    # ...
  ],
  queries: ["P0 blockers", "security issues"]
)
# Result: ~2KB summaries in context, full reports searchable via ctx_search
```

## Related

- AGENTS.md — mandatory routing rules (source of truth)
- context-mode `ctx_batch_execute` — runs commands, auto-indexes output, returns search results
- context-mode `ctx_search` — retrieves indexed content on-demand
