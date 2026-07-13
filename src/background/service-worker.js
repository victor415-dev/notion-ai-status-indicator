import { STATES, MSG } from "../shared/protocol.js";

// tabId -> 最近一次上报的状态与元数据
const tabStates = new Map();
const tabUrls = new Map();
const tabTitles = new Map();
const tabWindows = new Map();
const tabLastInputs = new Map();
const lastUpdateAt = new Map();
const conversationTabs = new Set();
const recentDoneAt = new Map();
const tabBadgeTimers = new Map();
const notificationTabs = new Map();
const lastNotificationAt = new Map();
const conversationLastTabIds = new Map();
const tabCurrentConversationIds = new Map();
const tabConversationIds = new Map();
const loggedFallbackTabs = new Set();

const STORE_KEY = "nai_conversations";
const BADGE_CLEAR_MS = 5000;
const RECENT_DONE_MS = 5000;
const DONE_NOTIFY_INTERVAL_MS = 3000;
const BADGE = {
	RUNNING_TEXT: "•",
	DONE_TEXT: "✓",
	RUNNING_COLOR: "#2f6fed",
	DONE_COLOR: "#16a34a",
};

function cleanTitle(t) {
	const s = String(t || "").replace(/\s+-\s+Notion\s*$/i, "").trim();
	return s;
}

function trimText(t, max) {
	const s = String(t || "").trim();
	if (!s) return "";
	return s.length > max ? s.slice(0, max) : s;
}

function conversationIdFromUrl(url) {
	try {
		return new URL(url || "").searchParams.get("t") || "";
	} catch (e) {
		return "";
	}
}

function fallbackConversationId(tabId) {
	return `tab:${tabId}`;
}

function normalizeConversationId(value, tabId) {
	const s = String(value || "").trim();
	if (s) return s;
	if (!loggedFallbackTabs.has(tabId)) {
		loggedFallbackTabs.add(tabId);
		console.log("[NAI-BG] conversation fallback tabId compatibility", "tab", tabId);
	}
	return fallbackConversationId(tabId);
}

function isFallbackConversationId(conversationId) {
	return String(conversationId || "").startsWith("tab:");
}

function trackTabConversation(tabId, conversationId) {
	if (tabId == null || !conversationId) return;
	conversationLastTabIds.set(conversationId, tabId);
	tabCurrentConversationIds.set(tabId, conversationId);
	let set = tabConversationIds.get(tabId);
	if (!set) {
		set = new Set();
		tabConversationIds.set(tabId, set);
	}
	set.add(conversationId);
}

function currentConversationIdForTab(tabId, tab) {
	if (tab && tab.url) {
		const fromUrl = conversationIdFromUrl(tab.url);
		if (fromUrl) return fromUrl;
	}
	return tabCurrentConversationIds.get(tabId) || "";
}

// ================= 桌面伴侣 WebSocket（Codex 式常驻置顶）=================
const DESKTOP_WS_URL = "ws://127.0.0.1:8787";
const DESKTOP_RECONNECT_MS = 5000;
const NOTION_AI_URL = "https://app.notion.com/chat";
const NOTION_TAB_URL_PATTERNS = [
	"*://app.notion.com/*",
	"*://*.notion.so/*",
];
let desktopSocket = null;
let desktopReconnectTimer = null;

function connectDesktop() {
	if (desktopSocket && desktopSocket.readyState === WebSocket.OPEN) return;
	try {
		desktopSocket = new WebSocket(DESKTOP_WS_URL);
	} catch (e) {
		scheduleDesktopReconnect();
		return;
	}
	desktopSocket.onopen = () => {
		console.log("[NAI-BG] 桌面伴侣已连接");
		pushDesktopSnapshot();
	};
	desktopSocket.onmessage = (ev) => {
		try {
			const msg = JSON.parse(ev.data);
			if (msg && msg.type === "ping") {
				sendDesktopPong();
			} else if (msg && msg.type === "focus" && msg.tabId) {
				handleDesktopCommand(msg);
			}
		} catch (e) {}
	};
	desktopSocket.onclose = () => {
		desktopSocket = null;
		scheduleDesktopReconnect();
	};
	desktopSocket.onerror = () => {
		if (desktopSocket) desktopSocket.close();
		desktopSocket = null;
		scheduleDesktopReconnect();
	};
}

function scheduleDesktopReconnect() {
	if (desktopReconnectTimer) return;
	desktopReconnectTimer = setTimeout(() => {
		desktopReconnectTimer = null;
		connectDesktop();
	}, DESKTOP_RECONNECT_MS);
}

function pushDesktopSnapshot() {
	if (!desktopSocket || desktopSocket.readyState !== WebSocket.OPEN) return;
	queryNotionTabsCount((notionTabs) => {
		if (!desktopSocket || desktopSocket.readyState !== WebSocket.OPEN) return;
		try {
			const snapshot = buildSnapshot();
			console.log("[NAI-BG] 桌面快照推送", snapshot.length, "notionTabs", notionTabs);
			desktopSocket.send(JSON.stringify({ type: "snapshot", conversations: snapshot, notionTabs }));
		} catch (e) {}
	});
}

function sendDesktopPong() {
	if (!desktopSocket || desktopSocket.readyState !== WebSocket.OPEN) return;
	try {
		desktopSocket.send(JSON.stringify({ type: "pong" }));
	} catch (e) {}
}

function handleDesktopCommand(msg) {
	const tabId = msg.tabId;
	if (tabId === "latest") {
		console.log("[NAI-PET] focus latest received");
		focusLatestNotionTab();
		return;
	}
	if (typeof tabId === "string" && tabId.startsWith("conversation:")) {
		focusConversation(tabId.slice("conversation:".length), { dismissDone: true });
		return;
	}

	const id = Number(tabId);
	if (Number.isFinite(id)) {
		focusTab(id, null, { dismissDone: true });
		return;
	}
	if (tabId) focusConversation(String(tabId), { dismissDone: true });
}

function isNotionUrl(url) {
	try {
		const u = new URL(url);
		return u.hostname.endsWith("notion.so") || u.hostname.endsWith("notion.site") || u.hostname.endsWith("notion.com");
	} catch (e) {
		return false;
	}
}

function focusLatestNotionTab() {
	// 1) 有记录：聚焦 lastUpdateAt 最新
	let bestConversationId = null;
	let bestTs = -1;
	for (const [conversationId, ts] of lastUpdateAt.entries()) {
		if (!tabUrls.has(conversationId)) continue;
		const url = tabUrls.get(conversationId);
		if (!url || !isNotionUrl(url)) continue;
		if (ts > bestTs) {
			bestTs = ts;
			bestConversationId = conversationId;
		}
	}
	if (bestConversationId != null) {
		focusConversation(bestConversationId, { dismissDone: true });
		return;
	}

	// 2) 无记录：聚焦任一已打开 Notion 标签
	chrome.tabs.query({}, (tabs) => {
		if (chrome.runtime.lastError || !Array.isArray(tabs)) return;
		const t = tabs.find((x) => x && x.url && isNotionUrl(x.url));
		if (!t) {
			chrome.tabs.create({ url: NOTION_AI_URL });
			return;
		}
		if (t.windowId != null) chrome.windows.update(t.windowId, { focused: true });
		if (t.id != null) {
			chrome.tabs.update(t.id, { active: true });
			markReadIfViewed(t.id, t);
		}
	});
}
// ============================================================================

// content ↔ background 的悬浮窗（画中画）消息。字符串须与 content.js 保持一致。
const MSG_GET_SNAPSHOT = "GET_SNAPSHOT"; // content -> bg：拉取当前所有对话
const MSG_SNAPSHOT = "NAI_SNAPSHOT";     // bg -> content：推送最新对话列表
const MSG_FOCUS_TAB = "FOCUS_TAB";       // content -> bg：聚焦并跳转到某个对话标签

let globalBadgeTimer = null;
let creating = null;

// SW 可能休眠后重启，导致内存里的对话表清空。启动时先从 session 存储回填，避免悬浮窗/面板/角标丢历史。
(async function hydrate() {
	try {
		const data = await chrome.storage.session.get(STORE_KEY);
		const list = data && data[STORE_KEY];
		if (!list) return;
		for (const key of Object.keys(list)) {
			const c = list[key];
			const tabId = Number(c && c.tabId);
			if (!Number.isFinite(tabId)) continue;
			const conversationId = c.conversationId ? normalizeConversationId(c.conversationId, tabId) : fallbackConversationId(tabId);
			conversationTabs.add(conversationId);
			trackTabConversation(tabId, conversationId);
			if (c.state) tabStates.set(conversationId, c.state);
			if (c.url) tabUrls.set(conversationId, c.url);
			if (c.title) tabTitles.set(conversationId, c.title);
			if (c.lastInput) tabLastInputs.set(conversationId, c.lastInput);
			if (c.windowId != null) tabWindows.set(conversationId, c.windowId);
			if (c.updatedAt) lastUpdateAt.set(conversationId, c.updatedAt);
			if (c.state === STATES.DONE && c.updatedAt) recentDoneAt.set(conversationId, c.updatedAt);
		}
	} catch (e) {
		/* 无历史或 session 不可用，忽略 */
	}
})();

// chrome.action.* 在标签已关闭时会抛 "No tab with id"，统一吞掉，避免未处理的 promise 报错污染错误列表。
function safeAction(run) {
	try {
		const p = run();
		if (p && typeof p.catch === "function") p.catch(() => {});
	} catch (e) {
		/* 标签已关闭或 action 暂不可用，忽略 */
	}
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
	if (!msg) return;
	if (msg.type === MSG.STATE || msg.type === "NAI_STATE") {
		handleStateMessage(msg, sender);
		return;
	}
	if (msg.type === "NAI_LOCATION") {
		handleLocationMessage(msg, sender);
		return;
	}
	if (msg.type === MSG_GET_SNAPSHOT) {
		queryNotionTabsCount((notionTabs) => {
			sendResponse({ conversations: buildSnapshot(), notionTabs });
		});
		return true;
	}
	if (msg.type === MSG_FOCUS_TAB) {
		if (msg.conversationId) {
			focusConversation(msg.conversationId, { dismissDone: true });
		} else {
			focusTab(msg.tabId, msg.windowId, { dismissDone: true });
		}
		return;
	}
});

function handleLocationMessage(msg, sender) {
	const tabId = sender.tab && sender.tab.id;
	if (tabId == null) return;
	const fromUrl = msg.conversationId || conversationIdFromUrl(msg.url || (sender.tab && sender.tab.url) || "");
	if (!fromUrl) return;
	const conversationId = normalizeConversationId(fromUrl, tabId);
	trackTabConversation(tabId, conversationId);

	const titleFromSender = sender.tab && sender.tab.title ? sender.tab.title : "";
	const title = cleanTitle(msg.title || titleFromSender);
	let changed = false;
	if (msg.url && tabUrls.get(conversationId) !== msg.url) {
		tabUrls.set(conversationId, msg.url);
		changed = true;
	}
	if (title && tabTitles.get(conversationId) !== title) {
		tabTitles.set(conversationId, title);
		changed = true;
	}
	if (sender.tab && sender.tab.windowId != null) tabWindows.set(conversationId, sender.tab.windowId);
	if (conversationTabs.has(conversationId)) {
		markReadIfViewed(tabId, sender.tab, changed ? finishStateMessage : null);
		if (changed) return;
	}
	if (changed) {
		syncStore();
		pushDesktopSnapshot();
	}
}

function handleStateMessage(msg, sender) {
	const tabId = sender.tab && sender.tab.id;
	if (tabId == null) return;
	if (!isKnownState(msg.state)) return;

	console.log("[NAI-BG] 收到状态", msg.state, "tab", tabId);

	const at = normalizeTime(msg.at);
	const conversationId = normalizeConversationId(msg.conversationId || msg.pageConversationId || conversationIdFromUrl(msg.url || (sender.tab && sender.tab.url) || ""), tabId);
	trackTabConversation(tabId, conversationId);
	const prev = tabStates.get(conversationId);
	const hasConversation = conversationTabs.has(conversationId);
	const shouldRecordConversation = msg.state !== STATES.IDLE || hasConversation;
	const doneReason = typeof msg.doneReason === "string" ? msg.doneReason : "";
	let snapshotState = msg.state;
	if (msg.state === STATES.IDLE && hasConversation) {
		snapshotState = prev === STATES.DONE ? STATES.DONE : STATES.IDLE;
		if (doneReason === "idle-fallback") {
			snapshotState = STATES.DONE;
			console.log("[NAI-BG] idle-fallback done", "tab", tabId, "conversation", conversationId);
		}
	}
	tabStates.set(conversationId, snapshotState);
	console.log("[NAI-BG] 状态流", tabId, conversationId, `${prev || "none"}→${snapshotState}`);
	if (msg.state === STATES.DONE && doneReason) {
		if (doneReason === "idle-fallback") {
			console.log("[NAI-BG] idle-fallback done", "tab", tabId, "conversation", conversationId);
		} else {
			console.log("[NAI-BG] done reason", doneReason, "tab", tabId, "conversation", conversationId);
		}
	}

	const titleFromSender = sender.tab && sender.tab.title ? sender.tab.title : "";
	const titleFromMsg = msg.title ? msg.title : "";
	const title = cleanTitle(titleFromMsg || titleFromSender);

	const lastInput = trimText(msg.lastInput || "", 80);

	if (shouldRecordConversation) {
		const isNewConversation = !conversationTabs.has(conversationId);
		conversationTabs.add(conversationId);
		lastUpdateAt.set(conversationId, at);
		if (msg.url) tabUrls.set(conversationId, msg.url);
		if (title) tabTitles.set(conversationId, title);
		if (lastInput) tabLastInputs.set(conversationId, lastInput);
		if (sender.tab && sender.tab.windowId != null) tabWindows.set(conversationId, sender.tab.windowId);
		console.log("[NAI-BG] 建档/更新记录", isNewConversation ? "new" : "update", "tab", tabId, "conversation", conversationId, "state", snapshotState);
	}

	updateTabBadge(tabId, msg.state, at);

	if (msg.state === STATES.DONE) {
		recentDoneAt.set(conversationId, at);
		if (prev !== STATES.DONE && shouldNotifyDone(conversationId, at)) {
			notifyDone(conversationId, msg.url || tabUrls.get(conversationId));
			playSound();
		}
	}

	if (msg.state === STATES.DONE) {
		markReadIfViewed(tabId, sender.tab, finishStateMessage, conversationId);
		return;
	}

	finishStateMessage();
}

chrome.tabs.onRemoved.addListener((tabId) => {
	clearTabState(tabId, { clearNotificationThrottle: true });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
	if (changeInfo.url) {
		const conversationId = conversationIdFromUrl(changeInfo.url);
		if (conversationId) {
			trackTabConversation(tabId, conversationId);
			if (conversationTabs.has(conversationId)) {
				tabUrls.set(conversationId, changeInfo.url);
			}
		}
	}
	if (changeInfo.url || changeInfo.status === "complete") {
		pushDesktopSnapshot();
	}
});

chrome.tabs.onActivated.addListener((activeInfo) => {
	chrome.tabs.get(activeInfo.tabId, (tab) => {
		if (chrome.runtime.lastError || !tab) return;
		markReadIfViewed(activeInfo.tabId, tab);
	});
});

chrome.windows.onFocusChanged.addListener((windowId) => {
	if (windowId === chrome.windows.WINDOW_ID_NONE) return;
	chrome.tabs.query({ active: true, windowId }, (tabs) => {
		if (chrome.runtime.lastError || !Array.isArray(tabs) || !tabs.length) return;
		const tab = tabs[0];
		if (!tab || tab.id == null) return;
		markReadIfViewed(tab.id, tab);
	});
});

chrome.notifications.onClicked.addListener((notificationId) => {
	const conversationId = notificationTabs.get(notificationId);
	if (conversationId == null) return;
	const tabId = conversationLastTabIds.get(conversationId);
	if (tabId == null) {
		notificationTabs.delete(notificationId);
		return;
	}
	chrome.tabs.get(tabId, (tab) => {
		if (chrome.runtime.lastError || !tab) {
			notificationTabs.delete(notificationId);
			return;
		}
		if (tab.windowId != null) {
			chrome.windows.update(tab.windowId, { focused: true });
		}
		focusConversation(conversationId, { dismissDone: true });
		chrome.notifications.clear(notificationId);
		notificationTabs.delete(notificationId);
	});
});

chrome.notifications.onClosed.addListener((notificationId) => {
	notificationTabs.delete(notificationId);
});

function isKnownState(state) {
	return state === STATES.IDLE ||
		state === STATES.THINKING ||
		state === STATES.RESPONDING ||
		state === STATES.DONE;
}

function normalizeTime(at) {
	return Number.isFinite(at) ? at : Date.now();
}

function isRunningState(state) {
	return state === STATES.THINKING || state === STATES.RESPONDING;
}

function finishStateMessage() {
	updateGlobalBadge();
	syncStore();
	pushDesktopSnapshot(); // 状态变化时推给桌面伴侣
}

function tabShowsConversation(tabId, tab, conversationId) {
	if (!conversationId) return false;
	if (isFallbackConversationId(conversationId)) return conversationLastTabIds.get(conversationId) === tabId;
	const current = currentConversationIdForTab(tabId, tab);
	return current === conversationId;
}

function markReadIfViewed(tabId, tab, after = null, conversationId = null) {
	if (!tab || !tab.active || tab.windowId == null) {
		if (after) after();
		return;
	}
	chrome.windows.get(tab.windowId, (win) => {
		if (!chrome.runtime.lastError && win && win.focused) {
			const targetConversationId = conversationId || currentConversationIdForTab(tabId, tab);
			if (tabShowsConversation(tabId, tab, targetConversationId)) {
				markConversationRead(targetConversationId, { deferSync: Boolean(after) });
			}
		}
		if (after) after();
	});
}

// 把当前所有对话镜像到 session 存储，供弹出面板读取（面板不必唤醒 SW 即可拿到最新列表）；同时广播给所有悬浮窗。
function syncStore() {
	const list = {};
	for (const conversationId of conversationTabs) {
		const tabId = conversationLastTabIds.get(conversationId);
		if (tabId == null) continue;
		const state = tabStates.get(conversationId) || STATES.DONE;
		const updatedAt = lastUpdateAt.get(conversationId) || Date.now();
		list[conversationId] = {
			conversationId,
			tabId,
			state,
			url: tabUrls.get(conversationId) || "",
			title: tabTitles.get(conversationId) || "",
			lastInput: tabLastInputs.get(conversationId) || "",
			windowId: tabWindows.has(conversationId) ? tabWindows.get(conversationId) : null,
			updatedAt,
			lastUpdateAt: updatedAt,
		};
	}
	try {
		chrome.storage.session.set({ [STORE_KEY]: list });
	} catch (e) {
		/* session 不可用，忽略 */
	}
	broadcastSnapshot();
}

function updateTabBadge(tabId, state, at) {
	clearTabBadgeTimer(tabId);
	if (isRunningState(state)) {
		safeAction(() => chrome.action.setBadgeBackgroundColor({ tabId, color: BADGE.RUNNING_COLOR }));
		safeAction(() => chrome.action.setBadgeText({ tabId, text: BADGE.RUNNING_TEXT }));
		return;
	}
	if (state === STATES.DONE) {
		safeAction(() => chrome.action.setBadgeBackgroundColor({ tabId, color: BADGE.DONE_COLOR }));
		safeAction(() => chrome.action.setBadgeText({ tabId, text: BADGE.DONE_TEXT }));
		tabBadgeTimers.set(tabId, setTimeout(() => {
			safeAction(() => chrome.action.setBadgeText({ tabId, text: "" }));
			tabBadgeTimers.delete(tabId);
		}, BADGE_CLEAR_MS));
		return;
	}
	safeAction(() => chrome.action.setBadgeText({ tabId, text: "" }));
}

function updateGlobalBadge() {
	clearGlobalBadgeTimer();
	purgeExpiredDone();

	const running = runningCount();
	if (running > 0) {
		safeAction(() => chrome.action.setBadgeBackgroundColor({ color: BADGE.RUNNING_COLOR }));
		safeAction(() => chrome.action.setBadgeText({ text: running > 1 ? String(running) : BADGE.RUNNING_TEXT }));
		return;
	}

	const nextDoneExpiry = earliestRecentDoneExpiry();
	if (nextDoneExpiry != null) {
		safeAction(() => chrome.action.setBadgeBackgroundColor({ color: BADGE.DONE_COLOR }));
		safeAction(() => chrome.action.setBadgeText({ text: BADGE.DONE_TEXT }));
		globalBadgeTimer = setTimeout(updateGlobalBadge, Math.max(0, nextDoneExpiry - Date.now()) + 50);
		return;
	}

	safeAction(() => chrome.action.setBadgeText({ text: "" }));
}

function runningCount() {
	let count = 0;
	for (const state of tabStates.values()) {
		if (isRunningState(state)) count++;
	}
	return count;
}

function purgeExpiredDone() {
	const now = Date.now();
	for (const [tabId, doneAt] of recentDoneAt) {
		if (now - doneAt > RECENT_DONE_MS) {
			recentDoneAt.delete(tabId);
		}
	}
}

function earliestRecentDoneExpiry() {
	const now = Date.now();
	let earliest = null;
	for (const doneAt of recentDoneAt.values()) {
		if (now - doneAt > RECENT_DONE_MS) continue;
		const expiresAt = doneAt + RECENT_DONE_MS;
		if (earliest == null || expiresAt < earliest) earliest = expiresAt;
	}
	return earliest;
}

function shouldNotifyDone(tabId, at) {
	const last = lastNotificationAt.get(tabId);
	if (last != null && at - last < DONE_NOTIFY_INTERVAL_MS) return false;
	lastNotificationAt.set(tabId, at);
	return true;
}

function clearTabState(tabId, options = {}) {
	const ids = new Set(tabConversationIds.get(tabId) || []);
	for (const [conversationId, lastTabId] of conversationLastTabIds) {
		if (lastTabId === tabId) ids.add(conversationId);
	}
	for (const conversationId of ids) {
		tabStates.delete(conversationId);
		tabUrls.delete(conversationId);
		tabTitles.delete(conversationId);
		tabWindows.delete(conversationId);
		tabLastInputs.delete(conversationId);
		lastUpdateAt.delete(conversationId);
		conversationTabs.delete(conversationId);
		recentDoneAt.delete(conversationId);
		lastNotificationAt.delete(conversationId);
		conversationLastTabIds.delete(conversationId);
	}
	tabConversationIds.delete(tabId);
	tabCurrentConversationIds.delete(tabId);
	clearTabBadgeTimer(tabId);
	if (options.clearNotificationThrottle) {
		for (const conversationId of ids) lastNotificationAt.delete(conversationId);
	}
	safeAction(() => chrome.action.setBadgeText({ tabId, text: "" }));
	updateGlobalBadge();
	syncStore();
	pushDesktopSnapshot();
}

function clearTabBadgeTimer(tabId) {
	const timer = tabBadgeTimers.get(tabId);
	if (!timer) return;
	clearTimeout(timer);
	tabBadgeTimers.delete(tabId);
}

function clearGlobalBadgeTimer() {
	if (!globalBadgeTimer) return;
	clearTimeout(globalBadgeTimer);
	globalBadgeTimer = null;
}

function notifyDone(conversationId, url) {
	const notificationId = `nai-done-${conversationId}-${Date.now()}`;
	console.log("[NAI-BG] 触发完成通知", notificationId);
	chrome.notifications.create(
		notificationId,
		{
			type: "basic",
			iconUrl: chrome.runtime.getURL("assets/icon-128.png"),
			title: "Notion AI 任务完成",
			message: url ? "Notion AI 已回复完成，点击返回对应页面。" : "Notion AI 已回复完成。",
			priority: 2,
		},
		(createdId) => {
			if (chrome.runtime.lastError) {
				console.warn("[NAI-BG] 通知创建失败：", chrome.runtime.lastError.message);
			}
			notificationTabs.set(createdId || notificationId, conversationId);
		},
	);
}

// ---- offscreen 播放提示音（MV3 service worker 不能直接播放音频）----
async function ensureOffscreen() {
	if (await chrome.offscreen.hasDocument()) return;
	if (!creating) {
		creating = chrome.offscreen.createDocument({
			url: "src/offscreen/offscreen.html",
			reasons: ["AUDIO_PLAYBACK"],
			justification: "播放 AI 任务完成提示音",
		});
	}
	await creating;
	creating = null;
}

async function playSound() {
	try {
		await ensureOffscreen();
		chrome.runtime.sendMessage({ type: MSG.PLAY_SOUND });
	} catch (e) {
		/* 提示音为可选增强，失败忽略 */
	}
}

// ---- 悬浮窗（画中画）数据通道 ----
function buildSnapshot() {
	const list = [];
	for (const conversationId of conversationTabs) {
		const tabId = conversationLastTabIds.get(conversationId);
		if (tabId == null) continue;
		const state = tabStates.get(conversationId) || STATES.DONE;
		const updatedAt = lastUpdateAt.get(conversationId) || Date.now();
		list.push({
			conversationId,
			tabId,
			state,
			url: tabUrls.get(conversationId) || "",
			title: tabTitles.get(conversationId) || "",
			lastInput: tabLastInputs.get(conversationId) || "",
			windowId: tabWindows.has(conversationId) ? tabWindows.get(conversationId) : null,
			updatedAt,
			lastUpdateAt: updatedAt,
		});
	}
	return list;
}

function broadcastSnapshot() {
	const conversations = buildSnapshot();
	console.log("[NAI-BG] 快照推送", conversations.length);
	queryNotionTabsCount((notionTabs) => {
		const tabIds = new Set();
		for (const tabId of conversationLastTabIds.values()) {
			if (tabId != null) tabIds.add(tabId);
		}
		for (const tabId of tabIds) {
			safeAction(() => chrome.tabs.sendMessage(tabId, { type: MSG_SNAPSHOT, conversations, notionTabs }));
		}
	});
}

function queryNotionTabsCount(callback) {
	try {
		chrome.tabs.query({ url: NOTION_TAB_URL_PATTERNS }, (tabs) => {
			if (chrome.runtime.lastError || !Array.isArray(tabs)) {
				callback(0);
				return;
			}
			callback(tabs.length);
		});
	} catch (e) {
		callback(0);
	}
}

function focusTab(tabId, windowId, options = {}) {
	if (typeof tabId === "string" && tabId.startsWith("conversation:")) {
		focusConversation(tabId.slice("conversation:".length), options);
		return;
	}
	const id = Number(tabId);
	if (!Number.isFinite(id)) return;
	chrome.tabs.get(id, (tab) => {
		if (chrome.runtime.lastError || !tab) return;
		if (tab.windowId != null) chrome.windows.update(tab.windowId, { focused: true });
		chrome.tabs.update(id, { active: true });
		if (options.dismissDone) {
			markReadIfViewed(id, tab);
		}
	});
}

function conversationUrl(conversationId) {
	return `${NOTION_AI_URL}?t=${encodeURIComponent(conversationId)}`;
}

function focusConversation(conversationId, options = {}) {
	if (!conversationId) return;
	const tabId = conversationLastTabIds.get(conversationId);
	if (tabId == null) return;
	chrome.tabs.get(tabId, (tab) => {
		if (chrome.runtime.lastError || !tab) return;
		if (tab.windowId != null) chrome.windows.update(tab.windowId, { focused: true });
		const current = currentConversationIdForTab(tabId, tab);
		const details = { active: true };
		if (!isFallbackConversationId(conversationId) && current !== conversationId) {
			details.url = conversationUrl(conversationId);
		}
		chrome.tabs.update(tabId, details);
		if (options.dismissDone) {
			markConversationRead(conversationId);
		}
	});
}

function markConversationRead(conversationId, options = {}) {
	if (!conversationTabs.has(conversationId) || tabStates.get(conversationId) !== STATES.DONE) return false;
	tabUrls.delete(conversationId);
	tabTitles.delete(conversationId);
	tabWindows.delete(conversationId);
	tabLastInputs.delete(conversationId);
	lastUpdateAt.delete(conversationId);
	conversationTabs.delete(conversationId);
	recentDoneAt.delete(conversationId);
	lastNotificationAt.delete(conversationId);
	const tabId = conversationLastTabIds.get(conversationId);
	if (tabId != null && tabConversationIds.has(tabId)) {
		tabConversationIds.get(tabId).delete(conversationId);
	}
	conversationLastTabIds.delete(conversationId);
	if (!options.deferSync) {
		syncStore();
		pushDesktopSnapshot();
	}
	return true;
}

// 启动时尝试连接桌面伴侣
connectDesktop();
