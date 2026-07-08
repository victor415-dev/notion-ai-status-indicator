import { STATES, MSG } from "../shared/protocol.js";

// tabId -> 最近一次上报的状态与元数据
const tabStates = new Map();
const tabUrls = new Map();
const tabTitles = new Map();
const tabWindows = new Map();
const tabLastInputs = new Map();
const lastUpdateAt = new Map();
const recentDoneAt = new Map();
const tabBadgeTimers = new Map();
const notificationTabs = new Map();
const lastNotificationAt = new Map();

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

// ================= 桌面伴侣 WebSocket（Codex 式常驻置顶）=================
const DESKTOP_WS_URL = "ws://127.0.0.1:8787";
const DESKTOP_RECONNECT_MS = 5000;
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
			if (msg && msg.type === "focus" && msg.tabId) {
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
	try {
		const snapshot = buildSnapshot();
		desktopSocket.send(JSON.stringify({ type: "snapshot", conversations: snapshot }));
	} catch (e) {}
}

function handleDesktopCommand(msg) {
	const tabId = msg.tabId;
	if (tabId === "latest") {
		focusLatestNotionTab();
		return;
	}

	const id = Number(tabId);
	if (!Number.isFinite(id)) return;
	chrome.tabs.get(id, (tab) => {
		if (chrome.runtime.lastError || !tab) return;
		if (tab.windowId != null) chrome.windows.update(tab.windowId, { focused: true });
		chrome.tabs.update(id, { active: true });
	});
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
	let bestTabId = null;
	let bestTs = -1;
	for (const [tabId, ts] of lastUpdateAt.entries()) {
		if (!tabUrls.has(tabId)) continue;
		const url = tabUrls.get(tabId);
		if (!url || !isNotionUrl(url)) continue;
		if (ts > bestTs) {
			bestTs = ts;
			bestTabId = tabId;
		}
	}
	if (bestTabId != null) {
		chrome.tabs.get(bestTabId, (tab) => {
			if (chrome.runtime.lastError || !tab) return;
			if (tab.windowId != null) chrome.windows.update(tab.windowId, { focused: true });
			chrome.tabs.update(bestTabId, { active: true });
		});
		return;
	}

	// 2) 无记录：聚焦任一已打开 Notion 标签
	chrome.tabs.query({}, (tabs) => {
		if (chrome.runtime.lastError || !Array.isArray(tabs)) return;
		const t = tabs.find((x) => x && x.url && isNotionUrl(x.url));
		if (!t) return;
		if (t.windowId != null) chrome.windows.update(t.windowId, { focused: true });
		if (t.id != null) chrome.tabs.update(t.id, { active: true });
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
			if (c.state) tabStates.set(tabId, c.state);
			if (c.url) tabUrls.set(tabId, c.url);
			if (c.title) tabTitles.set(tabId, c.title);
			if (c.lastInput) tabLastInputs.set(tabId, c.lastInput);
			if (c.windowId != null) tabWindows.set(tabId, c.windowId);
			if (c.updatedAt) lastUpdateAt.set(tabId, c.updatedAt);
			if (c.state === STATES.DONE && c.updatedAt) recentDoneAt.set(tabId, c.updatedAt);
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
	if (msg.type === MSG_GET_SNAPSHOT) {
		sendResponse({ conversations: buildSnapshot() });
		return true;
	}
	if (msg.type === MSG_FOCUS_TAB) {
		focusTab(msg.tabId, msg.windowId);
		return;
	}
});

function handleStateMessage(msg, sender) {
	const tabId = sender.tab && sender.tab.id;
	if (tabId == null) return;
	if (!isKnownState(msg.state)) return;

	console.log("[NAI-BG] 收到状态", msg.state, "tab", tabId);

	const at = normalizeTime(msg.at);
	const prev = tabStates.get(tabId);
	tabStates.set(tabId, msg.state);
	lastUpdateAt.set(tabId, at);
	if (msg.url) tabUrls.set(tabId, msg.url);

	const titleFromSender = sender.tab && sender.tab.title ? sender.tab.title : "";
	const titleFromMsg = msg.title ? msg.title : "";
	const title = cleanTitle(titleFromMsg || titleFromSender);
	if (title) tabTitles.set(tabId, title);

	const lastInput = trimText(msg.lastInput || "", 80);
	if (lastInput) tabLastInputs.set(tabId, lastInput);

	if (sender.tab && sender.tab.windowId != null) tabWindows.set(tabId, sender.tab.windowId);

	updateTabBadge(tabId, msg.state, at);

	if (msg.state === STATES.DONE) {
		recentDoneAt.set(tabId, at);
		if (prev !== STATES.DONE && shouldNotifyDone(tabId, at)) {
			notifyDone(tabId, msg.url || tabUrls.get(tabId));
			playSound();
		}
	}

	updateGlobalBadge();
	syncStore();
	pushDesktopSnapshot(); // 状态变化时推给桌面伴侣
}

chrome.tabs.onRemoved.addListener((tabId) => {
	clearTabState(tabId, { clearNotificationThrottle: true });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
	if (changeInfo.status === "loading") {
		clearTabState(tabId);
	}
});

chrome.notifications.onClicked.addListener((notificationId) => {
	const tabId = notificationTabs.get(notificationId);
	if (tabId == null) return;
	chrome.tabs.get(tabId, (tab) => {
		if (chrome.runtime.lastError || !tab) {
			notificationTabs.delete(notificationId);
			return;
		}
		if (tab.windowId != null) {
			chrome.windows.update(tab.windowId, { focused: true });
		}
		chrome.tabs.update(tabId, { active: true });
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

// 把当前所有对话镜像到 session 存储，供弹出面板读取（面板不必唤醒 SW 即可拿到最新列表）；同时广播给所有悬浮窗。
function syncStore() {
	const list = {};
	for (const [tabId, state] of tabStates) {
		list[tabId] = {
			tabId,
			state,
			url: tabUrls.get(tabId) || "",
			title: tabTitles.get(tabId) || "",
			lastInput: tabLastInputs.get(tabId) || "",
			windowId: tabWindows.has(tabId) ? tabWindows.get(tabId) : null,
			updatedAt: lastUpdateAt.get(tabId) || Date.now(),
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
			if (tabStates.get(tabId) === STATES.DONE && recentDoneAt.get(tabId) === at) {
				safeAction(() => chrome.action.setBadgeText({ tabId, text: "" }));
			}
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
	tabStates.delete(tabId);
	tabUrls.delete(tabId);
	tabTitles.delete(tabId);
	tabWindows.delete(tabId);
	tabLastInputs.delete(tabId);
	lastUpdateAt.delete(tabId);
	recentDoneAt.delete(tabId);
	clearTabBadgeTimer(tabId);
	if (options.clearNotificationThrottle) {
		lastNotificationAt.delete(tabId);
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

function notifyDone(tabId, url) {
	const notificationId = `nai-done-${tabId}-${Date.now()}`;
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
			notificationTabs.set(createdId || notificationId, tabId);
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
	for (const [tabId, state] of tabStates) {
		list.push({
			tabId,
			state,
			url: tabUrls.get(tabId) || "",
			title: tabTitles.get(tabId) || "",
			lastInput: tabLastInputs.get(tabId) || "",
			windowId: tabWindows.has(tabId) ? tabWindows.get(tabId) : null,
			updatedAt: lastUpdateAt.get(tabId) || Date.now(),
		});
	}
	return list;
}

function broadcastSnapshot() {
	const conversations = buildSnapshot();
	for (const tabId of tabStates.keys()) {
		safeAction(() => chrome.tabs.sendMessage(tabId, { type: MSG_SNAPSHOT, conversations }));
	}
}

function focusTab(tabId, windowId) {
	const id = Number(tabId);
	if (!Number.isFinite(id)) return;
	chrome.tabs.get(id, (tab) => {
		if (chrome.runtime.lastError || !tab) return;
		if (tab.windowId != null) chrome.windows.update(tab.windowId, { focused: true });
		chrome.tabs.update(id, { active: true });
	});
}

// 启动时尝试连接桌面伴侣
connectDesktop();
