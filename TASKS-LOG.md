# TASKS LOG

## T-001
- Date: 2026-07-08 (Asia/Shanghai)
- Commit:
	- 43479c8f2ec12bc1aa39a7eeaa5af9e4246200fc — implementation commit
	- 4c52ec2b2c10910319d30cb5bd26c2c2afd77c53 — desktop drag/menu follow-up
- Changes:
	- desktop/main.js: Converted the desktop window to a transparent frameless always-on-top pet window, added right-bottom default placement, persisted/clamped position via `pet-position.json`, implemented content-driven resizing with bottom-right anchoring, added WS focus forwarding for `tabId`/`latest`, added native one-item quit menu, and implemented manual IPC-based dragging so click-vs-drag can use the 4px threshold.
	- desktop/preload.js: Replaced old companion controls with pet-specific IPC bridge methods for open/focus, resize, drag, menu, and quit.
	- desktop/renderer/index.html: Rebuilt the renderer shell as a transparent pet-only surface with icon, card stack, collapse arrow, and collapsed count badge.
	- desktop/renderer/renderer.js: Rebuilt UI logic for the inline SVG pet icon, live conversation cards, running spinner/done status, 6-second done fallback visibility, collapse/expand memory state, click-to-focus behavior, right-click quit menu, content resize reporting, and click-vs-drag distinction.
	- desktop/renderer/styles.css: Rebuilt transparent desktop pet styling, card stack, status spinner/check, dark/light color handling, and reduced-motion behavior.
	- src/background/service-worker.js: Added snapshot `title` and `lastInput` fields while keeping existing fields, persisted/restored `lastInput`, cleaned Notion title suffixes, and added desktop `focus` support for `tabId:"latest"` with fallback to any open Notion tab and no new tab creation.
	- src/content/interceptor.js: Read the existing file first, preserved original code, and only appended an additive safe request-body parser/fetch wrapper to extract recent user input up to 80 characters without throwing on parse errors.
	- src/content/content.js: Removed all page-visible pet mounting while preserving the state machine, NAI_STATE reporting, snapshot/PiP code block, and added forwarding of `document.title` plus `lastInput`.
	- src/content/pet.css: Cleared visible page UI CSS to a comment placeholder.
- Self test:
	- Manifest permissions checked after change: unchanged (`notifications`, `storage`, `offscreen`; host permissions unchanged).
	- GitHub commit stats checked for changed files; no binary files were added.
	- Attempted `cd desktop && npm start` in the sandbox, but the sandbox could not clone the repository because external DNS for github.com was unavailable (`Could not resolve host: github.com`). Runtime acceptance should be run locally with `cd desktop && npm start`.
- Remaining:
	- Local runtime acceptance still required for the Electron window/Notion tab integration because the sandbox cannot launch the committed repository from GitHub.

## T-002
- Date: 2026-07-09 (Asia/Shanghai)
- Commit:
	- 9e157a4b2a4f10d2a03a38e0dca802331647cf5a — fix implementation
	- TBD — task log update
- Changes:
	- desktop/renderer/styles.css: Removed all `-webkit-app-region` drag/no-drag rules from the pet/card/collapse/badge area so renderer mouse events are no longer swallowed by the OS drag region.
	- desktop/renderer/renderer.js: Replaced pointer/app-region drag handling with JS `mousedown`/`mousemove`/`mouseup` handling based on `screenX/screenY`; movement under 4px now triggers the original `pet:open-notion({ tabId: "latest" })` click path, while movement at/above 4px sends move IPC events.
	- desktop/preload.js: Updated the IPC bridge to expose the necessary JS-drag methods (`dragStart`, `move`, `dragEnd`) and keep the existing open/resize/menu/quit bridge.
	- desktop/main.js: Reworked drag IPC to record the starting screen coordinate/window bounds and move the frameless window with `setPosition`; drag end still persists `pet-position.json`. Added `[NAI-PET] focus latest sent` logging on the click/focus path.
	- src/background/service-worker.js: Added `[NAI-PET] focus latest received` logging when the extension receives desktop `tabId:"latest"`, while preserving the existing latest-Notion-tab fallback behavior.
- Self test:
	- Commit stats checked for T-002: only the allowed files changed (`desktop/main.js`, `desktop/preload.js`, `desktop/renderer/renderer.js`, `desktop/renderer/styles.css`, `src/background/service-worker.js`).
	- Manifest checked after change: permissions and host permissions remain unchanged.
	- No binary files were added.
	- Full runtime acceptance (`cd desktop && npm start`) could not be executed in the sandbox because repository cloning/runtime launch is not available here; please run locally to verify click-to-focus, JS dragging, persisted position, and right-click quit.
- Remaining:
	- Local runtime acceptance still required for the Electron/Chrome integration path.
