# LOOP.md — Session 3
**Agent:** Qwen3.6-27B

## Goal
Migrate the React app from bespoke DOM and inline styles to @splunk/react-ui components, fixing pagination in the process. Determine whether any other bespoke JS can be eliminated with Splunk React components and pull into scope.

## Definition of done
1. All UI elements (table, modals, forms, layout) and any other identified bespoke components sourced from @splunk/react-ui with no bespoke table/modal/form elements remaining.
2. Pagination renders all credentials correctly; full CRUD and bulk operations verified functional post-migration.

## Out of scope this session
- Dark theme beyond what Splunk design tokens provide out of box
- Unit test suite (DISCOVERIES.md parked)
- Error message dangerouslySetInnerHTML sanitization (DISCOVERIES.md parked)
