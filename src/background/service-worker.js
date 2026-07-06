import { STATES, MSG } from "../shared/protocol.js";

// tabId -> 最近一次上报的状态
const tabStates = new Map();
const tabUrls = new Map();
const recentDoneAt = new Map();
const tabBadgeTimers = new Map();
const notificationTabs = new Map();
const lastNotificationAt = new Map();

const BADGE_CLEAR_MS = 5000;
const RECENT_DONE_MS = 5000;
const DONE_NOTIFY_INTERVAL_MS = 3000;
const BADGE = {
    RUNNING_TEXT: "•",
    DONE_TEXT: "✓",
    RUNNING_COLOR: "#2f6fed",
    DONE_COLOR: "#16a34a",
};

let globalBadgeTimer = null;
let creating = null;

// chrome.action.* 在标签已关闭时会抛 "No tab with id"，统一吞掉，避免未处理的 promise 报错污染错误列表。
function safeAction(run) {
    try {
        const p = run();
        if (p && typeof p.catch === "function") p.catch(() => {});
    } catch (e) {
        /* 标签已关闭或 action 暂不可用，忽略 */
    }
}

chrome.runtime.onMessage.addListener((msg, sender) => {
    if (!msg || msg.type !== MSG.STATE) return;
    const tabId = sender.tab && sender.tab.id;
    if (tabId == null) return;
    if (!isKnownState(msg.state)) return;

    console.log("[NAI-BG] 收到状态", msg.state, "tab", tabId);

    const at = normalizeTime(msg.at);
    const prev = tabStates.get(tabId);
    tabStates.set(tabId, msg.state);
    if (msg.url) tabUrls.set(tabId, msg.url);

    updateTabBadge(tabId, msg.state, at);

    if (msg.state === STATES.DONE) {
        recentDoneAt.set(tabId, at);
        if (prev !== STATES.DONE && shouldNotifyDone(tabId, at)) {
            notifyDone(tabId, msg.url || tabUrls.get(tabId));
            playSound();
        }
    }

    updateGlobalBadge();
});

chrome.tabs.onRemoved.addListener((tabId) => {
    clearTabState(tabId, { clearNotificationThrottle: true });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    // 只在真正的整页导航/刷新(status:loading)时清空。Notion 是单页应用，发消息时常用
    // pushState 改 URL(只有 changeInfo.url、没有 status)，那种情况不能清，否则角标会被瞬间抹掉。
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
    recentDoneAt.delete(tabId);
    clearTabBadgeTimer(tabId);
    if (options.clearNotificationThrottle) {
        lastNotificationAt.delete(tabId);
    }
    safeAction(() => chrome.action.setBadgeText({ tabId, text: "" }));
    updateGlobalBadge();
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
    // 若通知没弹，多半是系统层面未授权：请到 系统设置 > 通知 > Google Chrome 打开"允许通知"。
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
