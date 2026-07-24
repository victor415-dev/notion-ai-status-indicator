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

## T-010
- Date: 2026-07-13 (Asia/Shanghai)
- Commit:
	- this commit — conversation-id keyed tracking and live title sync
- Actual root cause:
	- Confirmed: records were keyed by `tabId`, while Notion is an SPA where one tab can switch between multiple transcripts via `?t=`. Titles were captured from `document.title` at request time, so new server-generated titles and manual title edits were not reflected later.
- Changes:
	- src/content/interceptor.js: Extracts `transcriptId` from `runInferenceTranscript` request bodies, falls back to the page URL `?t=` value, and logs tab-id compatibility fallback when neither exists. Stream lifecycle events and lastInput metadata now include `conversationId` without changing response consumption.
	- src/content/content.js: Tracks stream state per conversation, forwards `conversationId` in `NAI_STATE`, and reports `NAI_LOCATION` on title/URL changes via title MutationObserver, history hooks, popstate, visibility/pageshow, and a lightweight poll. This keeps delayed Notion titles and manual renames synced.
	- src/background/service-worker.js: Stores conversations keyed by `conversationId`, keeps `lastTabId`/tab-current-conversation mappings for focus and read-on-view, preserves old snapshot fields while adding `conversationId`, updates titles from location reports, and focuses cards by navigating the last tab to `https://app.notion.com/chat?t=<conversationId>` when needed. Tab close still removes records for that tab; SPA navigation no longer deletes running records.
	- desktop/renderer/renderer.js: Uses `conversationId` as the card identity when present and sends a conversation-prefixed focus target while preserving tabId fallback for old snapshots.
- Self test:
	- `node --check src/content/interceptor.js` passed.
	- `node --check src/content/content.js` passed.
	- `node --check src/background/service-worker.js` passed.
	- `node --check desktop/renderer/renderer.js` passed.
	- Simulated T-010 service worker/interceptor behavior verified: one tab can track two `?t=` conversations independently; title sync updates the correct snapshot record; card focus navigates from the wrong `?t=` to the target conversation; navigation does not delete a running record; viewing a completed conversation dismisses only that conversation; done notifications still fire.
	- Regression simulations for T-007, T-008, and T-009 passed.
	- `cd desktop && npm start` launched Electron; with no extension WS client connected it logged `[NAI-PET] pet hidden disconnected` and was stopped with SIGINT after startup.
- Remaining:
	- Manual runtime acceptance still recommended in real Notion: switch between two conversations in one tab, start a new conversation before its title is generated, manually rename an open conversation, click cards after switching away, and confirm read-on-view removes only the visible completed conversation.

## T-011
- Date: 2026-07-13 (Asia/Shanghai)
- Commit:
	- this commit — restore card pipeline broken by T-010
- Actual root cause:
	- Reproduced in an end-to-end simulation: after T-010, a new task can emit the first interceptor `thinking` event before the isolated content script has installed its `window.message` listener. That broadcast was not replayed, so content never sent `NAI_STATE`, the service worker never built a record, and the desktop snapshot contained no card. The SW did not require `NAI_LOCATION` first; fallback tab compatibility worked once a `NAI_STATE` actually arrived.
- Changes:
	- src/content/interceptor.js: Added a bounded replay buffer for recent detector state events and a `__naiIndicatorReady` listener. Broadcast logs now use `[NAI-Indicator] broadcast ...`; replay logs use `[NAI-Indicator] replay ...`.
	- src/content/content.js: Announces readiness several times during startup so the interceptor can replay buffered early events. Added duplicate event suppression by `reqId/state/streamEvent/at` and `[NAI-Indicator] report NAI_STATE ...` logging before sending to the service worker.
	- src/background/service-worker.js: Added explicit `[NAI-BG] 建档/更新记录 ...`, `[NAI-BG] 快照推送 ...`, and `[NAI-BG] 桌面快照推送 ...` logs so future breakpoints can be located from the SW console.
- Self test:
	- `node --check src/content/interceptor.js` passed.
	- `node --check src/content/content.js` passed.
	- `node --check src/background/service-worker.js` passed.
	- T-011 end-to-end simulation verified: interceptor broadcast happened before content loaded; content requested replay; content reported `thinking`; SW built a fallback `tab:<id>` record; desktop snapshot contained the running card.
	- Regression simulations for T-007, T-008, T-009, and T-010 passed.
	- `cd desktop && npm start` launched Electron; with no extension WS client connected it logged `[NAI-PET] pet hidden disconnected` and was stopped with SIGINT after startup.
- Remaining:
	- Manual runtime acceptance still required on real Notion: reload the extension, start a fresh normal or Research task, and confirm a card appears immediately and spins before T-009/T-010 acceptance continues.

## Focus navigation fix
- Date: 2026-07-13 (Asia/Shanghai)
- Commit:
	- this commit — card focus navigates by actual tab URL
- Actual root cause:
	- Confirmed: `focusConversation(conversationId)` used `currentConversationIdForTab(tabId, tab)` to decide whether navigation was needed. When the actual tab URL had no `?t=` (for example Marketplace or a normal Notion page), that helper fell back to stale `tabCurrentConversationIds` memory and falsely treated the tab as already showing the target conversation.
- Changes:
	- src/background/service-worker.js: `focusConversation` now decides navigation for real conversation IDs only from the actual `chrome.tabs.get(...).url` `?t=` value. If the real URL has no `?t=` or has a different `?t=`, it navigates to `https://app.notion.com/chat?t=<conversationId>`; only an exact actual URL match activates without navigation. Fallback `tab:<id>` records still only focus the tab. Added `[NAI-BG] focus conversation ...` logging with target conversation, tabId, actual URL, actual `?t=`, and navigation decision.
- Self test:
	- A: Simulated `tab.url = https://app.notion.com/marketplace` with stale cached current conversation equal to the target; card focus still issued `chrome.tabs.update(..., { active: true, url: "https://app.notion.com/chat?t=target" })`.
	- B: Simulated a normal Notion page with no `?t=`; card focus navigated to the target conversation URL.
	- C: Simulated `/chat?t=other`; card focus navigated to the target conversation URL.
	- D: Simulated `/chat?t=target`; card focus only activated the tab without redundant navigation.
	- E: Simulated done card focus still removed the completed record; running card focus kept the record.
	- F: T-009 stream lifecycle and T-011 first-card pipeline regression simulations passed.
- Remaining:
	- Manual runtime acceptance recommended: from a completed card whose last tab is currently on Marketplace or another Notion page, click the card and confirm Chrome navigates back to the exact AI conversation.

## Title contamination fix
- Date: 2026-07-13 (Asia/Shanghai)
- Commit:
	- this commit — prevent non-chat pages from overwriting conversation titles
- Actual root cause:
	- Confirmed: state events still carry the original `conversationId` after the tab navigates away, but `msg.title` / `msg.url` reflect the current non-chat page. `handleStateMessage` wrote those fields directly into the conversation record without checking whether the current tab URL actually belonged to that conversation.
- Changes:
	- src/background/service-worker.js: Title and URL updates from `NAI_STATE` are now accepted only when the actual `sender.tab.url` (falling back to `msg.url`) has `?t=` exactly equal to the target `conversationId`. Non-chat pages, pages without `?t=`, and other conversations no longer overwrite stored title/url. Existing chat URL is preserved, or `https://app.notion.com/chat?t=<conversationId>` is used as a stable URL fallback. Added `[NAI-BG] title sync skipped ...` logging with conversationId, actual URL, actual `?t=`, candidate title, and skip reason.
- Self test:
	- A: Target conversation title `目标对话` stayed unchanged when a later done event arrived from `/marketplace` with title `Marketplace`; URL stayed `https://app.notion.com/chat?t=target`.
	- B: A normal Notion page with no `?t=` did not overwrite the conversation title or chat URL.
	- C: `/chat?t=other` did not overwrite the target conversation title.
	- D: `/chat?t=target` allowed a rename/title update.
	- E: Previous non-chat-page card focus navigation simulation still passed: done card click removed the completed record, running card click kept it, and navigation returned to the target conversation.
	- F: T-009 stream lifecycle and T-011 first-card pipeline regression simulations passed.
- Remaining:
	- Manual runtime acceptance recommended: start a task, leave its tab on Marketplace before completion, and confirm the finished card keeps the AI conversation title while still clicking back to the conversation.

## T-012
- Date: 2026-07-14 (Asia/Shanghai)
- Commit:
	- this commit — redesign conversation card rendering
- Changes:
	- desktop/renderer/renderer.js: Card subtitles now render `lastReply` instead of `lastInput`. Running cards with no reply show `正在生成回复…`; completed cards with no reply show `回复内容不可用`. Window sizing no longer allocates vertical space for the collapse arrow, while keeping the 56px pet body unchanged.
	- desktop/renderer/styles.css: Reworked cards into independent opaque white cards with a thin border, 16px radius, stable two-line height, and slight hover fill. Removed card/pet/collapse/badge shadows and backdrop filters. Moved the collapse control to an absolute pet top-right overlay; collapsed badge remains above the pet. Dark mode now uses solid colors.
	- src/content/interceptor.js: Added incremental clone-stream decoding with TextDecoder, SSE/JSON-line parsing, display-text whitelisting, and per-request `lastReply` accumulation capped at 240 characters. Unparseable chunks are skipped silently, raw protocol/JSON text is never displayed, and the original response stream remains untouched.
	- src/content/content.js: Tracks `lastReply` per conversationId, clears it only when a new request starts, forwards non-empty reply updates through `NAI_STATE`, and preserves replay-buffer behavior without mixing conversations.
	- src/background/service-worker.js: Stores, hydrates, clears, and snapshots `lastReply` per conversationId while keeping `lastInput`, state, read, focus, notification, and badge semantics unchanged.
- Reply parsing strategy:
	- The detector only reads `response.clone().body`, buffers split lines, parses SSE `data:` JSON or JSON chunks, and extracts strings from known AI text fields such as `text`, `plainText`, `content`, `markdown`, `delta`, `answer`, and `message`. IDs, URLs, status/type/role metadata, and unparseable protocol text are ignored.
- Self test:
	- `node --check desktop/renderer/renderer.js` passed.
	- `node --check src/content/interceptor.js` passed.
	- `node --check src/content/content.js` passed.
	- `node --check src/background/service-worker.js` passed.
	- `/tmp/t012-test.mjs` passed: reply increment parsing/accumulation, split chunk buffering, per-conversation isolation, new request reply clearing, unparseable chunk fallback copy, renderer no-`lastInput` subtitle path, conversation card click target, and collapse overlay/no-shadow CSS assertions all passed.
	- T-009 stream lifecycle simulation passed after the content changes.
	- T-010 conversation identity/title sync simulation passed.
	- T-011 first-card pipeline simulation passed.
	- Focus navigation and title-contamination regression simulations passed.
	- `cd desktop && npm start` launched Electron successfully; with no extension WS client it logged `[NAI-PET] pet hidden disconnected` and was stopped with SIGINT after startup.
- Remaining:
	- Manual runtime acceptance still recommended in real Notion/Electron: verify live reply preview updates during generation, completed cards retain the final preview, collapse control sits on the pet top-right, and multiple concurrent conversations do not mix reply text.

## T-012b
- Date: 2026-07-15 (Asia/Shanghai)
- Commit:
	- this commit — Codex-style collapse chevron
- Changes:
	- desktop/renderer/index.html: Replaced the text `˅` collapse glyph with the locked inline SVG chevron path using rounded stroke caps and joins.
	- desktop/renderer/styles.css: Changed `.collapse` to a 24px solid gray circle with no border, centered SVG layout, light hover fill, and an independent dark-mode rule. The pet top-right absolute positioning remains unchanged, and `.badge` dark-mode styling remains unchanged.
- Self test:
	- `/tmp/t012b-test.mjs` passed: collapse SVG replacement, no text glyph, solid no-border light/dark collapse colors, SVG centering, unchanged pet overlay positioning, unchanged dark badge rule, T-012 white cards/no shadow/no backdrop, reply preview path, and collapse/badge click handlers were all asserted.
	- `cd desktop && npm start` launched Electron successfully; with no extension WS client it logged `[NAI-PET] pet hidden disconnected` and was stopped with SIGINT after startup.
- Remaining:
	- Manual runtime acceptance recommended for final visual comparison against Codex: expanded card list should show the shallow gray circular chevron at the pet top-right, and collapsed badge/expand interaction should remain unchanged.

## T-012c
- Date: 2026-07-15 (Asia/Shanghai)
- Commit:
	- this commit — collapse chevron visibility and placement
- Actual root cause:
	- Confirmed: T-012b added `display: flex` to `.collapse`, which overrode the browser default `[hidden] { display: none; }`, so the collapse button stayed visible with no cards. The absolute placement `bottom: 40px` also made the 24px button overlap the 56px pet area.
- Changes:
	- desktop/renderer/styles.css: Added `.collapse[hidden] { display: none !important; }`, removed absolute positioning from `.collapse`, and restored it to normal vertical flex flow with `align-self: flex-end`. The 24px solid gray circle, colors, hover, and dark-mode rules are unchanged.
	- desktop/renderer/renderer.js: `computeSize()` now reserves 32px of height for the expanded-state arrow instead of extra width, matching the flex-flow placement between cards and the pet.
- Self test:
	- `node --check desktop/renderer/renderer.js` passed.
	- `/tmp/t012c-test.mjs` passed: hidden collapse override, no absolute/right/bottom positioning, flex-end placement, arrow height reservation, no arrow width reservation, unchanged visibility conditions, collapse/badge handlers, T-012 reply preview, T-012 no-shadow/no-backdrop cards, and T-012b SVG/gray-circle styling were all asserted.
	- `cd desktop && npm start` launched Electron successfully; with no extension WS client it logged `[NAI-PET] pet hidden disconnected` and was stopped with SIGINT after startup.
- Remaining:
	- Manual runtime acceptance recommended: with no conversations only the pet should show; with expanded cards the chevron should sit between the card list and pet, right-aligned, without covering the pet.

## T-012d
- Date: 2026-07-15 (Asia/Shanghai)
- Commit:
	- this commit — lighten collapse chevron background
- Changes:
	- desktop/renderer/styles.css: Light mode collapse circle background changed from `#e4e4e7` to `#f0f0f2`, with hover at `#e4e4e7`. Dark mode collapse background changed from `#3f3f46` to `#52525b`, with hover at `#606060`. All other collapse sizing, flex placement, centering, and hidden behavior remain unchanged.
- Self test:
	- Visual diff confirmed only the collapse circle tint changed; the T-012c hidden/placement fix remains intact.
	- T-012/T-012b card rendering, SVG chevron, and T-012c expand/collapse occupancy rules remain unchanged by inspection.
- Remaining:
	- Manual runtime acceptance still recommended if you want final on-screen comparison against the lighter Codex reference circle tint.

## T-013
- Date: 2026-07-21 (Asia/Shanghai)
- Commit:
	- 7cdfa2a14eca77a5a06b5ffc90acc4e2829720e9
- Unblocked:
	- Fetched `desktop/renderer/assets/pet-spritesheet.png` directly from the Notion task page section `T-013 素材源（分镜总图 · Codex 下载此图）` using the existing Notion REST token flow.
- Changes:
	- desktop/renderer/assets/pet-spritesheet.png: downloaded the contact sheet asset from Notion.
	- desktop/renderer/assets/pet/frames/*: cut the sprite frames for idle/hover/wait/throw/plane/plane_land/done and kept the required nearest-neighbor reuse entries.
	- desktop/renderer/assets/pet/sprite-map.json: recorded frame timing, `releaseFrame: 5`, extracted frame provenance, and reuse metadata.
	- desktop/main.js: added the plane window, plane spawn/focus plumbing, visibility coordination, and the pet-position lazy path; also fixed the stale `planeIgnoreCount` reference.
	- desktop/preload.js: exposed sprite-map loading and plane IPC bridges.
	- desktop/renderer/index.html, renderer.js, styles.css: wired the sprite image pet, reply preview cards, and throw-triggered plane spawn behavior while keeping the T-012 card layout intact.
	- desktop/renderer/planes.html, planes.css, planes.js: added the transparent plane layer and landing/click behavior.
- Self test:
	- `node --check desktop/main.js`, `desktop/preload.js`, `desktop/renderer/renderer.js`, and `desktop/renderer/planes.js` passed.
	- Visual QA on `pet-spritesheet.png` and representative frames passed after frame extraction; `done_03` was normalized by nearest-neighbor reuse from `done_02` to remove the source blemish.
	- `npm start` in `desktop/` still aborts with `SIGABRT` in this sandbox before any app log appears, so full GUI smoke testing remains limited by the environment here.
- Remaining:
	- Final commit SHA and push result still pending.

## T-013b
- Date: 2026-07-22 (Asia/Shanghai)
- Commit:
	- this commit — key out white sprite backgrounds
- Actual root cause:
	- Confirmed: all extracted `desktop/renderer/assets/pet/frames/*.png` files retained the opaque near-white contact-sheet background. Because the Electron pet window is transparent, that background appeared as a white block. `.pet-icon` also applied `border-radius: 999px`, turning the block into a more prominent white circle.
- Changes:
	- desktop/scripts/rekey-pet-frames.py: Added repeatable Pillow-based frame rekeying. It samples all four corners, identifies near-white pixels (all RGB channels >=245) or pixels within RGB delta 12 of the sampled corner background, and flood-fills only the edge-connected matching region before clearing it to transparent. This preserves isolated pale suit fills and helmet highlights. The script verifies each input remains 192x192 and processes pet and plane frames alike.
	- desktop/renderer/assets/pet/frames/*.png: Rekeyed all 36 frames to transparent backgrounds. `sprite-map.json` remains unchanged with `releaseFrame: 5`.
	- desktop/renderer/styles.css: Removed the image-level circular crop and explicitly keeps the sprite image background transparent with `object-fit: contain` unchanged.
	- desktop/renderer/renderer.js: Added `[NAI-PET] sprite frame failed` image-load logging and `[NAI-PET] sprite map missing` startup logging only; sprite behavior is unchanged.
- Transparency verification (`alpha=0` ratio):
	- done_00 72.17%, done_01 71.25%, done_02 71.26%, done_03 71.26%
	- hover_00 71.17%, hover_01 70.91%, hover_02 70.12%, hover_03 70.32%
	- idle_00 68.48%, idle_01 68.52%, idle_02 68.52%, idle_03 68.39%, idle_04 68.48%, idle_05 68.36%
	- plane_00 90.46%, plane_01 90.65%, plane_02 90.69%, plane_03 91.00%, plane_04 90.86%, plane_05 89.07%
	- plane_land_00 89.32%, plane_land_01 91.98%
	- throw_00 69.38%, throw_01 69.31%, throw_02 67.64%, throw_03 67.64%, throw_04 68.27%, throw_05 70.36%, throw_06 73.40%, throw_07 73.40%
	- wait_00 69.14%, wait_01 69.29%, wait_02 69.15%, wait_03 69.28%, wait_04 68.92%, wait_05 68.72%
- Self test:
	- All 36 frames passed the required alpha-zero assertion (>5%); minimum observed ratio was 67.64%.
	- Visual QA composited `idle_00`, `throw_04`, and `plane_00` on a dark background: astronaut cat and paper plane silhouettes remained visible with no white rectangular or circular background.
	- `node --check desktop/renderer/renderer.js`, `python -m py_compile desktop/scripts/rekey-pet-frames.py`, and `git diff --check` passed.
	- Card/collapse/drag regression assertions passed: the 4px drag threshold, pet click path, collapse/badge handlers, and collapse hidden CSS rule remain present.
	- `cd desktop && npm start` launched Electron through `electron .` without an application startup error.
- Remaining:
	- Manual whole-machine acceptance remains for the user: confirm the live pet is visible on the desktop rather than a white block, then exercise idle, waiting, throw, and plane interactions.

## T-013c
- Date: 2026-07-22 (Asia/Shanghai)
- Commit:
	- this commit — runtime chroma-key pet sprites
- Actual root cause:
	- T-013b only changed the extracted frame files. The renderer still assigned frame PNGs directly to the image element, so any remaining opaque near-white source pixels could appear as a white block in the transparent Electron window. The `.pet` wrapper also still applied a circular clip, and the pale astronaut cat had no contrast treatment on a light desktop background.
- Changes:
	- desktop/renderer/renderer.js: `setSpriteFrame` now loads each PNG into an offscreen canvas, samples all four corners, and flood-fills only edge-connected key-color pixels before assigning `canvas.toDataURL("image/png")` to `#pet-sprite`. The runtime key accepts RGB >=240 or max channel distance <=18 from the sampled corner color. It clears RGBA only after edge-connected traversal, so isolated light helmet/suit details are preserved. Processed data URLs and concurrent loads are cached by frame path; a request sequence prevents a late frame load from replacing the current animation frame. Existing state, throw, queue, and failure/map-missing logs remain unchanged.
	- desktop/renderer/styles.css: Removed the remaining `.pet` `border-radius: 999px` and added `drop-shadow(0 1px 2px rgba(0, 0, 0, .35))` to `.pet-icon`. Transparent background and `object-fit: contain` remain unchanged.
- Self test:
	- `node --check desktop/renderer/renderer.js` and `git diff --check` passed.
	- Runtime flood-fill simulation passed: edge-connected white became transparent, while a light pixel isolated inside a dark sprite outline remained opaque.
	- Cache/implementation assertions passed: `Image` loading, data-URL conversion, per-path caches, thresholds 240/18, existing failure log, no `.pet` circular clip, and the required outline shadow are all present.
	- `npm start` could not run in this environment: the desktop execution approval service rejected the GUI launch with HTTP 403 before Electron started. No workaround was attempted.
- Remaining:
	- Manual whole-machine acceptance is required: launch the desktop companion and verify idle/drag/card behavior while confirming the astronaut cat is visible without a white rectangular or circular background.

## T-013d
- Date: 2026-07-22 (Asia/Shanghai)
- Commit:
	- this commit — outline white cat silhouette
- Actual root cause:
	- Confirmed from the already-keyed frames: a large white/near-white astronaut-cat silhouette remains after background transparency. At 56px, the previous single weak shadow does not reliably distinguish the silhouette on a light desktop. This is a contrast/readability issue, not a further background-key threshold issue.
- Changes:
	- desktop/renderer/renderer.js: Retained the T-013c edge-connected runtime keying and added `outlineSprite` immediately afterward. Pixels with alpha >16 are the immutable sprite entity. Only transparent pixels within a two-pixel 8-neighborhood of that entity receive `rgba(20,24,32,.92)` (RGBA `20,24,32,235`); light helmet and suit pixels inside the entity are not chroma-keyed or overwritten. The existing data-URL cache remains in use. Added `[NAI-PET] sprite keyed` logging with frame path, source opaque count, and generated outline count.
	- desktop/renderer/styles.css: Replaced the weak single shadow with the locked three-layer dark drop-shadow stack. `.pet` and `.pet-icon` remain uncropped; transparent background and `object-fit: contain` remain unchanged.
- QA:
	- Generated the required processed `idle_00` composites: `/tmp/t013d-qa-dark.png` (`#1a1a1a`), `/tmp/t013d-qa-light.png` (`#f0f0f0`), and `/tmp/t013d-qa-blue.png` (`#2f6fed`).
	- Runtime-equivalent outline pass measured `opaque=11592` and `outlinePx=1443` for `idle_00`.
	- Visual inspection of all three QA images confirmed a continuous dark silhouette edge around the astronaut cat; on the light background the head, helmet, and orange suit details remain distinguishable instead of reading as an unbounded white block.
- Self test:
	- `node --check desktop/renderer/renderer.js` and `git diff --check` passed.
	- In-memory flood-fill/outline test passed: edge-connected white was keyed, isolated internal white remained opaque, the two-pixel outline was generated with the locked dark RGBA color, and the outline did not overwrite interior pixels.
	- Static assertions passed for cache retention, `[NAI-PET] sprite keyed` counts, no pet circular clip, and the required three-layer shadow filter.
	- `npm start` could not run: the desktop execution approval service rejected GUI launch with HTTP 403 before Electron started. No workaround was attempted.
- Remaining:
	- Manual whole-machine acceptance remains for idle animation, dragging, and cards because the local GUI launch is blocked by environment approval.

## T-013e
- Date: 2026-07-22 (Asia/Shanghai)
- Commit:
	- this commit — untaint sprite pipeline and console forwarding
- Actual root cause:
	- The runtime evidence did not support the originally suspected `file://` canvas-taint path. `npm start` exposed the real earlier failure: Electron's sandboxed preload could not load Node's `fs` module (`Unable to load preload script` / `module not found: fs`). As a result `naiBridge` was never created and renderer startup then failed at `onSnapshot`, so the sprite key/outline pipeline could not run at all.
- Changes:
	- desktop/main.js: For both transparent windows that use the existing Node-backed preload, set `sandbox: false` while retaining `contextIsolation: true` and `nodeIntegration: false`. Added permanent `webContents` `console-message` forwarding to stdout with the `[NAI-RENDER]` prefix.
	- desktop/preload.js: Added `readFrameDataUrl(relPath)`. It resolves requested frames from the renderer root, verifies the real path remains within `assets/pet/frames`, permits only PNG files, rejects traversal/absolute paths, and returns `data:image/png;base64,...` from `fs`.
	- desktop/renderer/renderer.js: `loadKeyedSprite` now loads the preload-supplied data URL into `Image` before Canvas keying/outline processing, removing `file://` pixel-read risk. The entire `setSpriteFrame` chain now logs `[NAI-PET] sprite pipeline failed` with details and falls back to the raw frame path rather than silently leaving a stale frame. Existing frame/map error logs and animation state logic remain unchanged.
- Sprite alpha inspection:
	- `desktop/renderer/assets/pet/frames/idle_00.png`: 192x192; alpha=0 ratio 68.5547%; corner alpha values `[0, 0, 0, 0]`. Frames are already keyed, so the rekey script was not rerun and no PNG assets changed.
- Runtime evidence (`cd desktop && npm start`):
	- `[NAI-RENDER] [NAI-PET] sprite keyed assets/pet/frames/idle_00.png opaque=11572 outlinePx=1416`
	- `[NAI-RENDER] [NAI-PET] sprite keyed assets/pet/frames/idle_01.png opaque=11575 outlinePx=1418`
	- `[NAI-RENDER] [NAI-PET] sprite keyed assets/pet/frames/idle_02.png opaque=11560 outlinePx=1429`
	- The renderer no longer emitted preload `fs` or missing `naiBridge` errors. The only remaining terminal line was Electron's existing CSP development warning, which is unrelated to the sprite pipeline.
- Self test:
	- Preload whitelist test passed: an allowed frame returned a PNG data URL; traversal and non-frame requests were rejected.
	- `node --check` passed for `desktop/main.js`, `desktop/preload.js`, and `desktop/renderer/renderer.js`; `git diff --check` passed.
	- Electron smoke test passed to idle animation frame processing, with permanent console forwarding proving Canvas keying and 2px outline generation execute at runtime.
- Remaining:
	- Manual whole-machine verification is still appropriate for pet visibility, dragging, cards, and plane interactions with a real extension client connected.

## T-014
- Date: 2026-07-22 (Asia/Shanghai)
- Commit:
	- this commit — edge-aware card layout clamp
- Changes:
	- desktop/main.js: Added pet-anchor-aware bounds clamping. The 56px pet target is always clamped within the selected display work area with an 8px margin, including during drag. Resize now receives the renderer's current pet anchor and target card layout, preserves the pet position while changing window size, and prioritizes the pet when a card list temporarily cannot fit. Added read-only `pet:get-layout-context` IPC with the current window bounds and work area.
	- desktop/preload.js: Exposed the read-only `getLayoutContext` bridge.
	- desktop/renderer/renderer.js: Added rAF-coalesced edge layout recalculation on card resize, snapshot updates, drag moves, and drag end. It selects cards below the pet when above would cross the top edge, and chooses start/end alignment based on available horizontal card space. Resizes now include the current pet screen anchor and layout intent.
	- desktop/renderer/styles.css: Added `layout-cards-below`, `layout-align-start`, and `layout-align-end` classes. Reversed vertical flex order moves cards/arrow/badge below the pet; alignment rules move the controls with the selected card edge without covering the pet.
- Self test:
	- Main-process work-area clamp simulation passed for left, right, top, and bottom edges. Each case retained the full 56px pet within the 8px work-area margin.
	- Renderer layout simulation passed: left edge switches to start alignment, right edge switches to end alignment, top edge switches cards below, and bottom edge switches cards above.
	- CSS/IPC assertions passed for the three layout classes and `getLayoutContext` bridge.
	- `node --check` passed for `desktop/main.js`, `desktop/preload.js`, and `desktop/renderer/renderer.js`; `git diff --check` passed.
	- `cd desktop && npm start` passed. Renderer emitted normal keyed idle/wait frame logs and no preload, IPC, layout, or renderer errors; the test process was stopped afterward.
- Remaining:
	- Manual whole-machine acceptance is still appropriate: drag the pet to all four corners with both expanded and collapsed cards, confirming titles stay visible and the pet remains clickable.

## T-015
- Date: 2026-07-23 (Asia/Shanghai)
- Commit:
	- this commit — sync plane and card dismissal
- Changes:
	- desktop/renderer/planes.js: Plane clicks now pass the stable `conversationId` alongside the same `conversation:<id>` or tab-id focus target used by card clicks.
	- desktop/main.js: Plane open logs `[NAI-PET] plane open`, removes the clicked plane locally before focus dispatch, and forwards the conversation identity to the normal focus route. On every extension snapshot, reconciles all local `activePlanes` against conversation IDs (or tab IDs for fallback records); all planes for a conversation absent from the snapshot are removed. This covers card clicks, notifications, manual read-on-view, and multiple planes without per-entry-point handling.
	- src/background/service-worker.js: Added `[NAI-BG] mark read` logging to the existing T-007 done-conversation deletion path. Focus arguments already route `conversation:<id>` through `focusConversation(..., { dismissDone: true })`, so no behavior change was required there.
- Self test:
	- Snapshot reconciliation simulation passed: when conversation `one` disappeared, both of its planes were removed while conversation `two` remained; interactive-plane state was cleaned too.
	- Static assertions passed: plane clicks include stable conversation identity and the same focus target as cards; main runs reconciliation per snapshot; service worker logs mark-read events.
	- `node --check` passed for `desktop/main.js`, `desktop/renderer/planes.js`, and `src/background/service-worker.js`; `git diff --check` passed.
	- `cd desktop && npm start` passed with normal keyed sprite logs and no new desktop errors; the test process was stopped afterward.
- Remaining:
	- Manual integrated acceptance remains: complete a conversation, click a landed plane, then separately click a card and test notification/manual read paths with multiple conversations.

## T-016
- Date: 2026-07-23 (Asia/Shanghai)
- Commit:
	- this commit — silhouette-only hit and occlusion
- Changes:
	- desktop/main.js: The transparent pet window now starts with `setIgnoreMouseEvents(true, { forward: true })`. Added a narrowly scoped `pet:set-ignore-mouse` IPC handler and drag-start override so transparent sprite pixels pass clicks through to the desktop while a cat-outline drag remains reliable.
	- desktop/preload.js: Exposed `setIgnoreMouseEvents` for the renderer's alpha-hit decision.
	- desktop/renderer/renderer.js: Captures the keyed-and-outlined frame alpha mask alongside the existing data-URL cache. Pointer hit testing uses alpha >=16 only inside the actual sprite bounds; transparent/out-of-bounds pixels request pass-through. Cards, the collapse button, and the count badge are explicit interactive exceptions. Pointer evaluation now runs for ordinary movement as well as drag movement, and hidden pets return to pass-through.
- Self test:
	- `node --check desktop/main.js`, `node --check desktop/preload.js`, and `node --check desktop/renderer/renderer.js` passed; `git diff --check` passed.
	- Reproducible alpha-hit simulation passed: alpha 0 and 15 pass through; alpha 16 and 255 remain hit-testable. Static checks confirmed the transparent-window default, IPC bridge/handler, card/control exception selector, and non-drag pointer evaluation.
	- `cd desktop && npm start` passed. Terminal output included `[NAI-RENDER] [NAI-PET] sprite keyed ... opaque=... outlinePx=...` for idle frames and no new renderer or IPC errors; Electron's existing development CSP warning remains unrelated.
- Remaining:
	- Manual whole-machine acceptance is required to verify OS-level pass-through over desktop text, opaque-cat dragging/clicking, and card/collapse/badge clickability on the user's display.

## T-017
- Date: 2026-07-23 (Asia/Shanghai)
- Commit:
	- this commit — restore conversation cards and throw
- Actual breakpoint:
	- The reproducible desktop-side WS simulation did not reproduce a render, resize, or throw failure. A `thinking` snapshot entered the desktop process (`n=1`), reached the renderer, resized the pet window from `56x56` to `280x160`, and rendered the waiting state; the following `done` snapshot queued one throw and produced a plane at the configured release frame. The reported live evidence had only the extension connection line and no desktop snapshot/state logs, so the observed no-card state is an empty/missing snapshot at the desktop ingress rather than a renderer card filter or a 56px resize failure. The permanent logs below make that distinction explicit in the next live run.
- Changes:
	- desktop/main.js: Logs every received extension snapshot with conversation count and states, and logs each pet resize with target width, height, and visible-card count.
	- desktop/renderer/renderer.js: Logs each received snapshot and queued throw. Propagates visible-card count to the existing resize IPC. Wrapped only the T-016 pointer/mask hit test in a local `try/catch`, so a pointer failure cannot interrupt snapshot rendering; the snapshot callback now also logs an explicit render failure rather than failing silently.
- Self test:
	- `node --check desktop/main.js` and `node --check desktop/renderer/renderer.js` passed; `git diff --check` passed.
	- Launched `cd desktop && npm start` and connected a local WebSocket client to port 8787. Sent one `thinking` then one `done` conversation snapshot. Terminal evidence: `[NAI-PET] snapshot n=1 states=thinking`, `[NAI-PET] resize w=280 h=160 cards=1`, `[NAI-PET] snapshot n=1 states=done`, `[NAI-PET] throw queued t017-sim`, and `[NAI-PET] spawn plane ... t017-sim`.
	- This also confirms a running conversation is retained for the card, and the done transition produces exactly one throw. T-015 reconciliation remains unchanged.
- Remaining:
	- User whole-machine acceptance must reload the extension and desktop companion, then confirm the new `snapshot n=...` log is nonzero while a real Notion task runs. A persistent `n=0` will identify the extension-side snapshot source as the remaining failure surface without changing the protocol speculatively.

## T-016b
- Date: 2026-07-23 (Asia/Shanghai)
- Commit:
	- this commit — remove square shadow plate occlusion
- Changes:
	- desktop/renderer/styles.css: Removed the complete `.pet-icon` multi-layer `filter: drop-shadow(...)` stack. The pet surface remains transparent and uncropped; contrast comes only from the existing runtime `outlineSprite` pixels. T-016 alpha-mask click-through remains unchanged.
- Self test:
	- `node --check desktop/renderer/renderer.js` and `git diff --check` passed.
	- PIL inspection of `desktop/renderer/assets/pet/frames/idle_00.png` found `25272/36864` alpha-zero pixels (68.55%); all four corner alpha values are `0`. Static checks confirmed transparent `html/body`, `#app`, `.pet`, and `.pet-icon` surfaces, retained `object-fit: contain`, no remaining `.pet-icon` filter, the T-016 alpha threshold, and the runtime outline pipeline.
	- `cd desktop && npm start` passed. The terminal showed normal `[NAI-PET] sprite keyed ... opaque=... outlinePx=...` logs with no new startup or renderer errors. Electron's existing development CSP warning is unrelated.
- Remaining:
	- Manual whole-machine acceptance is required over desktop text: verify that no rectangular or rounded shadow plate remains, while the outlined cat, drag/click behavior, and card controls remain readable and interactive.

## T-016c
- Date: 2026-07-23 (Asia/Shanghai)
- Commit:
	- this commit — remove white plate from sprite frames
- Root cause:
	- The extracted sprite PNGs still retained an edge-connected near-white rounded backing plate. Removing CSS shadows in T-016b could not remove those opaque source pixels.
- Changes:
	- desktop/scripts/rekey-pet-frames.py: Tightened the deterministic edge-connected background key to RGB >=235 or max corner-color delta <=20.
	- desktop/renderer/assets/pet/frames/*.png: Re-keyed all 36 pet and plane frames with the matching offline algorithm.
	- desktop/renderer/renderer.js: Matched the runtime key to `235/20`. After keying, it verifies all frame corners; a residual corner emits `[NAI-PET] sprite plate residual` and gets one more aggressive edge-connected pass (`220/32`) before `outlineSprite` operates. Thus the outline can only follow the cleaned sprite entity, never a backing plate.
- Alpha and visual QA:
	- `idle_00.png` has four corner alpha values `[0, 0, 0, 0]` and `68.68%` alpha-zero pixels after re-keying. Every one of the 36 frames is 192x192 and has all four corners fully transparent.
	- Composited the processed `idle_00` over `/tmp/t016c-dark.png` (`#1a1a1a`) and `/tmp/t016c-light.png` (`#f0f0f0`). Visual inspection shows only the cat silhouette and its dark pixel outline, with no white rectangular or rounded backing plate.
- Self test:
	- `node --check desktop/renderer/renderer.js`, `python3 -m py_compile desktop/scripts/rekey-pet-frames.py`, and `git diff --check` passed.
	- `cd desktop && npm start` passed. Runtime emitted normal `[NAI-PET] sprite keyed ... opaque=... outlinePx=...` idle-frame logs and no residual-plate or pipeline errors. The existing Electron development CSP warning remains unrelated.
- Remaining:
	- Manual whole-machine acceptance is required on the affected desktop/Discord backgrounds, including card and throw interactions.

## T-018
- Date: 2026-07-23 (Asia/Shanghai)
- Commit:
	- this commit — stop black line flash above pet
- Root cause:
	- The card DOM was populated in the renderer before the asynchronous main-process `setBounds` resize completed. During a high-frequency snapshot update, the still-56px transparent window could clip the dark title glyphs into a thin line above the pet.
- Changes:
	- desktop/main.js and desktop/preload.js: Changed the internal `pet:resize` route from fire-and-forget send/on to invoke/handle. The main handler returns after it has applied the new bounds.
	- desktop/renderer/renderer.js: With visible cards, marks cards and their controls layout-pending before rebuilding their DOM. It awaits the resize IPC and reveals them on the next animation frame. A monotonically increasing layout request discards delayed reveals from stale snapshots. No-card paths remove the pending class while retaining real `hidden` semantics for cards, collapse, and badge.
	- desktop/renderer/styles.css: Layout-pending cards/collapse/badge use `visibility: hidden`, preserving measured layout without exposing clipped title or control pixels.
- Self test:
	- `node --check desktop/main.js`, `node --check desktop/preload.js`, and `node --check desktop/renderer/renderer.js` passed; `git diff --check` passed.
	- Started Electron and injected `thinking -> responding -> thinking -> done` snapshots at 150ms intervals through the local WS server. Every visible-card update logged `[NAI-PET] resize w=280 h=160 cards=1` before reveal; no `resize failed`, snapshot-render, renderer, or IPC error appeared. The done transition still logged `throw queued t018-sim` and `spawn plane ... t018-sim`.
	- Existing Electron development CSP warning is unrelated.
- Remaining:
	- Manual 30-second whole-machine acceptance is required with a real active conversation and frequent reply updates, verifying no black title-line/fragment flashes above the pet.

## T-016d
- Date: 2026-07-24 (Asia/Shanghai)
- Commit:
	- this commit — strip sticker plate ring from frames
- Required A-step evidence and conclusion:
	- PIL inspection of `desktop/renderer/assets/pet/frames/idle_00.png` found corner alpha `[0, 0, 0, 0]`. The horizontal middle scan (`y=96`) is transparent `x=0..57`, opaque `x=58..156`, transparent `x=157..191`; the vertical middle scan (`x=96`) is transparent `y=0..55`, opaque `y=56..183`, transparent `y=184..191`.
	- From each edge midpoint inward, the first two opaque RGBA samples are: top `(96,56)=(126,129,136,255)`, then `(96,57)=(26,30,41,255)`; bottom `(96,183)=(188,186,197,255)`, then `(96,182)=(176,175,183,255)`; left `(58,96)=(196,197,199,255)`, then `(59,96)=(7,11,14,255)`; right `(156,96)=(202,191,185,255)`, then `(155,96)=(48,28,19,255)`.
	- These samples are cat silhouette features (ear/headset/helmet/tail edge), not a separate rounded backing-ring color. Treating either sampled color as a plate key would erase real cat pixels. Therefore the locked backing-ring hypothesis is refuted by current frame data.
- Actual visual verification:
	- Started the current Electron source with a real incoming `responding` snapshot and captured `/tmp/t016d-desktop.png`. The rendered pet visibly contains only the cat silhouette and dark outline; no white rectangular or rounded plate is present. The card above it and waiting animation rendered normally.
- Changes:
	- No frame, runtime-key, CSS, or extension behavior was changed. T-016c's all-frame transparency and T-016b's no-shadow surface remain the correct implementation for the inspected current assets. This record-only commit avoids destructively keying cat-edge colors based on a disproven premise.
- Remaining:
	- If a white plate is still observed on another machine, capture the running commit SHA and screenshot from that machine; the current checked-out and rendered `main` asset path does not reproduce it.
