import { STATES, MSG } from "../shared/protocol.js";

// tabId -> 最近一次上报的状态
const tabStates = new Map();

chrome.runtime.onMessage.addListener((msg, sender) => {
	if (!msg || msg.type !== MSG.STATE) return;
	const tabId = sender.tab && sender.tab.id;
	if (tabId == null) return;

	const prev = tabStates.get(tabId);
	tabStates.set(tabId, msg.state);
	updateBadge();

	// 仅当从「非完成」跳到「完成」时提醒，避免重复
	if (msg.state === STATES.DONE && prev && prev !== STATES.DONE) {
		notifyDone(tabId);
		playSound();
	}
});

chrome.tabs.onRemoved.addListener((tabId) => {
	tabStates.delete(tabId);
	updateBadge();
});

function runningCount() {
	let n = 0;
	for (const s of tabStates.values()) {
		if (s === STATES.THINKING || s === STATES.RESPONDING) n++;
	}
	return n;
}

function updateBadge() {
	const n = runningCount();
	chrome.action.setBadgeText({ text: n ? String(n) : "" });
	chrome.action.setBadgeBackgroundColor({ color: n ? "#2f6fed" : "#16a34a" });
}

function notifyDone(tabId) {
	const others = runningCount();
	// 注意：basic 通知需要 iconUrl，请在 assets/ 放置 icon-128.png（见 assets/README.md）。
	// 缺图标时回调里的 lastError 会被吞掉，不影响其它功能。
	chrome.notifications.create(
		`nai-done-${tabId}-${Date.now()}`,
		{
			type: "basic",
			iconUrl: chrome.runtime.getURL("assets/icon-128.png"),
			title: "Notion AI 任务完成",
			message: others > 0 ? `一个任务已完成，还有 ${others} 个在进行中。` : "AI 已回复完成 ✅",
			priority: 2,
		},
		() => void chrome.runtime.lastError,
	);
}

// ---- offscreen 播放提示音（MV3 service worker 不能直接播放音频）----
let creating = null;
async function ensureOffscreen() {
	const has = await chrome.offscreen.hasDocument();
	if (has) return;
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
