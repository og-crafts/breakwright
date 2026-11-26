# Breakwright (OGCrafts)
Public repo. Read README.md and docs/DECISIONS.md.
- `kit/` and `src/tokens.css` are copies or generated: never edit them here.
- App styles use tokens only; class names starting with `k-` belong to the kit.
- The page talks to the local helper only and gets no native commands. AI and MCP propose, never apply.
- Public words start from the person's problem; never compare with another product.
- Tests: `npm test` (Node's runner), `npx vitest run` (the kit), `node scripts/walk.mjs` (the real app in a browser).
