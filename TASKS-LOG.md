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
	- 19fee59beb56b74240b7ac5dd2c44190e930cc65 — task log update
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

## T-003
- Date: 2026-07-09 (Asia/Shanghai)
- Commit:
	- this commit — persistent conversation cards
- Changes:
	- src/background/service-worker.js: Added a persistent `conversationTabs` record set so snapshots/session storage/desktop WS output include every tab that has had a conversation; content-side done->idle fallback now keeps existing conversation records visible as `done`; tab close remains the only removal path. Existing notification and badge paths are left intact.
	- desktop/renderer/renderer.js: Removed the 6-second done-card visibility filter and refresh timer; done cards now remain visible as long as the snapshot contains them, and the collapsed badge now shows total visible card count (running + completed).
- Self test:
	- `node --check src/background/service-worker.js` passed.
	- `node --check desktop/renderer/renderer.js` passed.
	- Simulated service worker messages verified: initial idle does not create a card; thinking/responding/done creates one card; done followed by content fallback idle keeps the card as `done`; tab close removes the card; session snapshot and desktop snapshot still carry records; completion notification still triggers.
	- Ran `cd desktop && npm install --registry=https://registry.npmmirror.com` successfully, then `npm start` launched Electron and was stopped with SIGINT after startup. Full Chrome extension + Notion runtime acceptance was not completed in this environment.
- Remaining:
	- Manual runtime acceptance still needed with a loaded Chrome extension and real Notion AI conversation: card should spin, become ✓, remain visible, disappear only when the tab closes, collapsed badge should show total card count, and card/icon click should focus the right Notion tab.

## T-004
- Date: 2026-07-10 (Asia/Shanghai)
- Commit:
	- this commit — SW heartbeat keepalive and click fallback
- Changes:
	- desktop/main.js: Added a 20s WebSocket heartbeat that sends `{type:"ping"}` to connected extension clients and records `{type:"pong"}` replies; changed extension sends to report whether any client accepted the message; added `shell.openExternal("https://app.notion.com/chat")` fallback with `[NAI-PET] focus fallback openExternal` logging when pet click has no connected extension client or sending fails.
	- src/background/service-worker.js: Added desktop WS `{type:"ping"}` handling and replies with `{type:"pong"}` while preserving the existing `snapshot` and `focus` message shapes and the existing 5s reconnect interval.
- Self test:
	- `node --check desktop/main.js` passed.
	- `node --check src/background/service-worker.js` passed.
	- Simulated desktop/SW messaging verified: desktop heartbeat emits `ping`; service worker replies `pong`; desktop records pong time; pet open with no connected client triggers the openExternal fallback.
	- `cd desktop && npm start` launched Electron without JS startup errors and was stopped with SIGINT after startup. The macOS IMK mach-port warning appeared, but the app process started.
- Remaining:
	- Manual long-running acceptance still recommended on a real Chrome extension session: leave the pet idle past MV3's normal SW sleep window, then click the pet and confirm focus works via live WS; also confirm fallback opens Notion AI if the extension is not connected.

## T-005
- Date: 2026-07-10 (Asia/Shanghai)
- Commit:
	- this commit — converge stale spinner to done
- Changes:
	- src/background/service-worker.js: Changed the existing conversation idle convergence so any tab with prior conversation state reports `idle` as persisted `done`, including stale `thinking`/`responding` records when a real done message was missed. Added `[NAI-BG] 状态流` logging with `tabId` and old-to-new state. Completion notifications remain limited to real `done` messages and are not emitted by idle convergence.
	- desktop/renderer/renderer.js: Reviewed only; no code change needed because spinner rendering is already limited to `thinking`/`responding`, and `done` renders `✓`.
- Self test:
	- `node --check src/background/service-worker.js` passed.
	- `node --check desktop/renderer/renderer.js` passed.
	- Simulated service worker messages verified: initial idle does not create a card; thinking followed directly by idle converges to a `done` snapshot without notification; real thinking→done still creates a done snapshot and triggers one notification.
	- `cd desktop && npm start` launched Electron without JS startup errors and was stopped with SIGINT after startup. The macOS IMK mach-port warning appeared; no app startup failure was observed.
- Remaining:
	- Manual runtime acceptance still recommended with a real Notion AI conversation where done is missed or delayed: the next idle report should flip the card from spinner to ✓ without a duplicate completion notification.

## T-006
- Date: 2026-07-12 (Asia/Shanghai)
- Commit:
	- this commit — open tab fallback and read-on-click dismissal
- Changes:
	- src/background/service-worker.js: Added a shared Notion AI fallback URL and changed `tabId:"latest"` focus so, when no Notion tab exists, it opens `https://app.notion.com/chat` via `chrome.tabs.create`. Explicit tab focus now dismisses completed conversation records after focusing the tab, immediately syncing storage and pushing a new desktop snapshot; running conversations are kept. `tabId:"latest"` never dismisses records.
	- desktop/renderer/renderer.js: Reviewed only; no code change needed because card clicks already send explicit `{ tabId: c.tabId }`, while icon clicks send `{ tabId: "latest" }`.
- Self test:
	- `node --check src/background/service-worker.js` passed.
	- `node --check desktop/renderer/renderer.js` passed.
	- Simulated service worker messages verified: explicit focus for a done record focuses and removes the record from snapshots; explicit focus for a thinking record focuses without removal; `latest` focus does not dismiss; no Notion tabs triggers `chrome.tabs.create({ url: "https://app.notion.com/chat" })`; snapshot push after dismissal excludes the read record.
	- `cd desktop && npm start` launched Electron without JS startup errors and was stopped with SIGINT after startup.
- Remaining:
	- Manual runtime acceptance still recommended: close all Notion tabs and click the pet icon to confirm a new Notion AI tab opens; click a completed card to confirm it disappears, while clicking a running card keeps it visible.

## T-007
- Date: 2026-07-13 (Asia/Shanghai)
- Commit:
	- this commit — unified read-on-view dismissal
- Changes:
	- src/background/service-worker.js: Added unified read dismissal through `markConversationRead(tabId)`. Done conversations are dismissed when the tracked tab is actually viewed via tab activation, Chrome window focus, notification click, explicit card focus, latest focus, or when a done state arrives while the tab is already active in a focused window. Running conversations are preserved. Done notifications still fire on real done reports.
	- desktop/renderer/renderer.js: Reviewed only; no code change needed because cards are snapshot-driven, card clicks send explicit tab ids, and icon clicks send `latest`.
- Self test:
	- `node --check src/background/service-worker.js` passed.
	- `node --check desktop/renderer/renderer.js` passed.
	- Simulated service worker messages/events verified: foreground done reports notify but do not create a card; notification clicks dismiss; explicit done card focus dismisses; explicit running card focus keeps the card; `latest` dismisses only the located done record; tab activation/window focus dismiss done records; repeated calls are idempotent.
- Remaining:
	- Manual runtime acceptance still recommended for the full Chrome/Electron path: notification click, card click, icon click, manual tab switch, and foreground completion should all remove only viewed completed cards.

## T-008
- Date: 2026-07-13 (Asia/Shanghai)
- Commit:
	- this commit — auto show/hide with Notion usage
- Changes:
	- src/background/service-worker.js: Added `notionTabs` to snapshot responses and desktop WS snapshot messages by querying the currently open Notion tabs using the existing manifest host domains (`app.notion.com` and `*.notion.so`). Tab URL/load changes and tab removal paths now push updated snapshots so the desktop side can react when Notion tabs appear or disappear. Existing conversation, notification, badge, and focus behavior is unchanged.
	- desktop/main.js: Added pet window visibility scheduling driven by WS connection state and `notionTabs`: show when an extension client is connected and at least one Notion tab is open; hide after 5s with zero Notion tabs; hide after 10s with no WS client. The Electron process remains running, the previous openExternal fallback remains, and `[NAI-PET] pet hidden/shown` logs were added for acceptance.
- Self test:
	- `node --check src/background/service-worker.js` passed.
	- `node --check desktop/main.js` passed.
	- Simulated service worker snapshots verified: initial Notion tab count is included, opening a Notion tab pushes `notionTabs: 2`, closing one pushes `notionTabs: 1`, and the existing `conversations` snapshot field remains present.
	- Simulated desktop visibility scheduling verified: `notionTabs >= 1` shows the pet, `notionTabs = 0` hides after the 5s path, reconnection with a Notion tab shows again, and WS disconnect hides after the 10s path.
	- `cd desktop && npm start` launched Electron; with no extension WS client connected it logged `[NAI-PET] pet hidden disconnected` and was stopped with SIGINT after startup.
- Remaining:
	- Manual runtime acceptance still recommended with real Chrome/Electron: Chrome quit should hide the pet within about 10s; closing all Notion tabs should hide it within about 5s; opening a Notion page again should show it.

## T-009
- Date: 2026-07-13 (Asia/Shanghai)
- Commit:
	- this commit — stream-lifecycle done detection
- Actual root cause:
	- The detector already read `runInferenceTranscript` with `response.clone()`, but it emitted `done` as soon as each observed stream ended, and content/background still allowed idle-style convergence for prior conversations. Long Research/tool phases need completion to be derived from the lifecycle of all active streams plus a quiet grace period, not from short gaps in activity.
- Changes:
	- src/content/interceptor.js: Added explicit stream lifecycle metadata and logs for `stream open` / `stream close`; stream close events now carry `doneReason: "stream-closed"`. The clone-reader path is preserved so page response consumption is not affected. The lastInput-only broadcast no longer sends a fake `idle` state.
	- src/content/content.js: Added per-tab active stream tracking, 5s done grace scheduling, grace cancellation on new requests, and a 180s legacy idle fallback for untracked running events. `done` is now reported only after all streams close and the grace window stays quiet, or via the explicit fallback with `doneReason: "idle-fallback"`.
	- src/background/service-worker.js: Added done-reason logging, including `[NAI-BG] idle-fallback done`; plain `idle` no longer converts an in-progress conversation to `done`, while completed records still remain completed after later idle reports. Notification, badge, WS, and read-on-view paths are unchanged.
- Self test:
	- `node --check src/content/interceptor.js` passed.
	- `node --check src/content/content.js` passed.
	- `node --check src/background/service-worker.js` passed.
	- Simulated content lifecycle verified: a long stream held open for more than 180s did not trigger `done`; stream close did not trigger immediate/early `done`; stream close plus 5s quiet emitted `doneReason: "stream-closed"`; a new request during the grace window canceled completion; legacy untracked running state only fell back after 180s.
	- Simulated interceptor verified: the page could still consume the original response body while the detector read `response.clone()`; stream open/responding/close events were emitted; lastInput metadata no longer emitted `idle`.
	- Simulated background verified: plain idle after running did not notify, `stream-closed` done reason was logged, `idle-fallback` done logged `[NAI-BG] idle-fallback done`, and existing done notifications remained active.
	- Regression simulations for T-007 and T-008 passed: read-on-view dismissal and Notion usage show/hide behavior remained intact.
- Remaining:
	- Manual runtime acceptance still recommended with a real Notion AI Research task: the card should keep spinning throughout tool/search/load phases, then turn ✓ and notify only after the final streamed response closes and the 5s quiet grace elapses.
