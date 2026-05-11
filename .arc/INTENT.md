# INTENT.md

## What I'm building
A CRUD interface to Splunk's storage/passwords rest endpoint. Fully functional standalone javascript version works. I am building a react version using Splunk's native react UI components, according to vercel react best practics (local vercel skill). The react app should mirror the JS version exactly.

## Why
To have it be a Splunk native react app instead of custom Javascript.

## What this is NOT
- A derivitive lacking parity
- A less functional clone

## What I'm sure of
- REST call behavior must match password-crud.js exactly. Implementation may differ where react idioms require it; behavioral parity is non-negotiable, line-by-line parity is not.
- **Realm field immutable post-create**: disabled in edit mode; REST API doesn't allow modification
- **Auth strategy**: cookie + CSRF via `splunkd/__raw` proxy, NOT .env credentials

## Key Technical Decisions (Ratified)
- ACL path must go through `/configs/conf-passwords/credential:${realm}:${username}:`, not `${rest_uri}/acl` (returns 404)
- User-scoped credentials require temporary sharing bump (`user→app→fetch→user`) for password reveal and deletion
- `* (all)` sentinel role option with mutual-exclusion in read/write dropdowns
- CSV import capped at 512 KB to avoid Splunk API payload limits
- **Migration order**: parity lock first, @splunk/react-ui component swap last

## What I'm no longer guessing at
- Splunk REST ACL behavior fully understood from reverse-engineering JS version
- Update sequence: ACL bump sharing=app → POST password only → `/move` if app changed → final ACL
- Delete sequence: per-credential ACL bump → DELETE via explicit owner/app path
 - Splunk v5.9.1 API details verified from `.d.ts`:
    * `ControlGroup` component wraps labeled form fields with aria attributes, error/help text, and required indicators — use this for form fields
    * `Text` props: uses `type` attribute (not `typeReact`), `error` prop for validation state (not `invalid`)
    * CJS import pattern: `var Mod = require('@splunk/react-ui/X'); var Comp = Mod.default;`

## What I'm still uncertain about
- Dark theme CSS overrides — only minimal inline styles exist currently

## What the agent must never do
- Always use the JS version as reference if you get stuck; line numbers matter (e.g., L511-554 is update flow)
- always check splunk's react docs - https://splunkui.splunk.com/Packages/react-ui/Overview
- always ask questions if you are unclear of my intent, don't assume you know what I want