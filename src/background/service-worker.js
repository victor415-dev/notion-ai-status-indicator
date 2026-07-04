import { STATES, MSG } from "../shared/protocol.js";

// tabId -> 最近一次上报的状态
const tabStates = new Map();
const clearTimers = new Map();
const notificationTabs = new Map();

const BADGE_CLEAR_MS = 5000;
const BADGE = {
	RUNNING_TEXT: "•",
	DONE_TEXT: "✓",
	RUNNING_COLOR: "#2f6fed",
	DONE_COLOR: "#16a34a",
};

chrome.runtime.onMessage.addListener((msg, sender) => {
	if (!msg || msg.type !== MSG.STATE) return;
	const tabId = sender.tab && sender.tab.id;
	if (tabId == null) return;
	if (!isKnownState(msg.state)) return;

	const prev = tabStates.get(tabId);
	tabStates.set(tabId, msg.state);
	updateBadge(tabId, msg.state);

	// 仅当从「非完成」跳到「完成」时提醒，避免重复
	if (msg.state === STATES.DONE && prev !== STATES.DONE) {
		notifyDone(tabId, msg.url);
		playSound();
	}
});

chrome.tabs.onRemoved.addListener((tabId) => {
	tabStates.delete(tabId);
	clearBadgeTimer(tabId);
	chrome.action.setBadgeText({ tabId, text: "" });
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

function updateBadge(tabId, state) {
	clearBadgeTimer(tabId);
	if (state === STATES.THINKING || state === STATES.RESPONDING) {
		chrome.action.setBadgeBackgroundColor({ tabId, color: BADGE.RUNNING_COLOR });
		chrome.action.setBadgeText({ tabId, text: BADGE.RUNNING_TEXT });
		return;
	}
	if (state === STATES.DONE) {
		chrome.action.setBadgeBackgroundColor({ tabId, color: BADGE.DONE_COLOR });
		chrome.action.setBadgeText({ tabId, text: BADGE.DONE_TEXT });
		clearTimers.set(tabId, setTimeout(() => {
			if (tabStates.get(tabId) === STATES.DONE) {
				chrome.action.setBadgeText({ tabId, text: "" });
			}
			clearTimers.delete(tabId);
		}, BADGE_CLEAR_MS));
		return;
	}
	chrome.action.setBadgeText({ tabId, text: "" });
}

function clearBadgeTimer(tabId) {
	const timer = clearTimers.get(tabId);
	if (!timer) return;
	clearTimeout(timer);
	clearTimers.delete(tabId);
}

function notifyDone(tabId, url) {
	const notificationId = `nai-done-${tabId}-${Date.now()}`;
	// 注意：basic 通知需要 iconUrl，请在 assets/ 放置 icon-128.png（见 assets/README.md）。
	// 缺图标时回调里的 lastError 会被吞掉，不影响其它功能。
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
			void chrome.runtime.lastError;
			notificationTabs.set(createdId || notificationId, tabId);
		},
	);
}

// ---- offscreen 播放提示音（MV3 service worker 不能直接播放音频）----
let creating = null;
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
