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
