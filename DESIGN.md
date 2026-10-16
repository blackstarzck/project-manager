# Planit interface design

Planit is a Korean planning workspace for writing requirements, reviewing AI changes, and moving between features, flows and independently versioned wireframes. The document is the primary work surface. User data and approval boundaries are more important than visual novelty.

## Visual contract

- Locally hosted Pretendard Variable. Body, inputs, primary controls and tabs: 14px; secondary information: 12–13px; headings: 18/22/28px. Body line height 1.6–1.7.
- Palette: ink `#252631`, secondary `#555d6d`, muted `#626b7c`, surface `#ffffff`, workspace `#f5f6f8`, violet accent `#6b50e5`. Meaningful text meets 4.5:1 contrast. Focus uses a distinct violet outline; status combines words and icons.
- Spacing uses 4px increments. Default controls 36px, icon targets 32px, radii 6/8/12px. Use whitespace to group related controls, not repeated ornamental cards.
- Writing is concise Korean: name the action and its target. Explain whether a generated change is pending or saved. Preserve the user's vocabulary and chosen typeface.

## Workspace layout

Global rail: projects, AI, help, settings. Document tabs: PRD, features, flow, wireframes. Save status is persistent. Document width has priority over ancillary panels.

`global rail | optional AI | document list/outline | document/canvas | optional properties`

- AI preferred dock width 360px (320–480). Dock only if the editor retains 640px for documents or 600px for canvases after preferred sidebars. Otherwise use a nonmodal overlay. Floating mode remains an explicit user choice.
- Panels can collapse independently. On constrained canvases, collapse the list before properties. Opening a constrained panel shows an overlay without shrinking or resetting the canvas.
- Responsive placement is derived; it never overwrites preferred dimensions or changes document revision. Reflow and toggling never discard AI input or in-flight activity.
- At 970/1280/1440px and 200% browser zoom, primary actions, close and review controls remain reachable. Mobile-specific authoring is outside this iteration.

## Editing and approval

Navigation flushes edits before changing document or project. Failed saves keep the current draft, location and recovery actions. Tabs use manual keyboard activation. `#project/{id}/{artifact}` is the address contract; legacy project links open PRD.

AI review shows target document/version and added/updated/deleted counts. The scrollable comparison has a persistent action footer; compare columns stack in constrained windows. Selection, partial approval, conflicts and version isolation remain server-controlled. Pending resolution disables close and repeat submission.

The PRD writing assistant opens an editable request draft without starting generation. Existing request text and running work survive reopening. The visible `AI 생성 요청` action submits; Enter inserts a line break. After partial approval or rejection, remaining changes start unselected, including after reopening or reloading, and feedback separates processed changes from pending changes.

Creating a PRD item focuses its new body once so typing can start immediately. Loading existing content, save acknowledgements and tab navigation must not reclaim focus. Project history provides an explicit, read-only content preview with counts, titles and PRD text before whole-project restoration; previous history remains preserved. The user approved one additive historical-snapshot GET endpoint for this preview. Existing endpoint responses and the database schema remain unchanged.

User-created wireframe element styles are content, not app chrome. Do not theme them through broad selectors. PNG captures reflect document typography; independent HTML export themes remain unchanged.

## Implementation and evidence

Use existing CSS tokens with Radix Dialog/Tabs/Dropdown/Tooltip, keeping Tiptap and React Flow. Storybook stories are synthetic and never contact the product API. Automated checks combine functional E2E, axe and reviewed screenshot baselines; final checks run against built assets and an isolated SQLite database.

Skills installed at project scope:
- frontend-design: `anthropics/skills@dbd4588f9e1033efb41dad4bef2f7947c8993d44`.
- web-design-guidelines: `vercel-labs/agent-skills@063bee94c3f4df8453406c830b0a7df0f2860278`.
- Initial guideline snapshot: `vercel-labs/web-interface-guidelines@434b7f91364665f2f733b310ec54809bf8f37937`.

The approved brief takes precedence over generic skill defaults. No Tailwind migration, Impeccable runtime, new database schema, or automatic AI retry. Live validation uses synthetic PRD → features → flow → one selected wireframe page, at most four actual Groq HTTP requests, stopping on the first failure. Manyfast generation calls: zero. User acceptance is recorded separately from agent validation.
