(() => {
    "use strict";

    // ISOLATED world：接收主世界拦截器广播的状态，维护状态机，并把状态上报给 background。
    // T-001：移除页面内全部可见 UI（不再创建 #nai-indicator-pet 等元素）。

    const STATES = {
        IDLE: "idle",
        THINKING: "thinking",
        RESPONDING: "responding",
        DONE: "done",
    };

    const TAG = "[NAI-Indicator]";
    const DONE_GRACE_MS = 5000;
    const IDLE_FALLBACK_MS = 180000;
    const DONE_RESET_MS = 180000;
    const FALLBACK_CONVERSATION_KEY = "__tab__";

    // 悬浮窗消息（须与 service-worker.js 一致）
    const MSG_GET_SNAPSHOT = "GET_SNAPSHOT";
    const MSG_SNAPSHOT = "NAI_SNAPSHOT";
    const MSG_FOCUS_TAB = "FOCUS_TAB";

    const conversations = new Map();
    const seenDetectorEvents = new Set();
    let lastLocationKey = "";

    function isKnownState(state) {
        return state === STATES.IDLE ||
            state === STATES.THINKING ||
            state === STATES.RESPONDING ||
            state === STATES.DONE;
    }

    function conversationIdFromUrl(url) {
        try {
            return new URL(url || location.href, location.href).searchParams.get("t") || "";
        } catch (e) {
            return "";
        }
    }

    function normalizeConversationId(value) {
        const s = String(value || "").trim();
        return s || "";
    }

    function conversationKey(conversationId) {
        return normalizeConversationId(conversationId) || FALLBACK_CONVERSATION_KEY;
    }

    function publicConversationId(key) {
        return key === FALLBACK_CONVERSATION_KEY ? "" : key;
    }

    function ensureConversation(key) {
        let c = conversations.get(key);
        if (!c) {
            c = {
                current: STATES.IDLE,
                resetTimer: null,
                doneGraceTimer: null,
                idleFallbackTimer: null,
                lastInput: "",
                activeStreams: new Set(),
            };
            conversations.set(key, c);
        }
        return c;
    }

    function clearResetTimer(c) {
        if (!c.resetTimer) return;
        clearTimeout(c.resetTimer);
        c.resetTimer = null;
    }

    function setState(key, next, extra) {
        if (!isKnownState(next)) return;
        const c = ensureConversation(key);
        clearResetTimer(c);
        const meta = extra || {};
        if (next === c.current && next !== STATES.DONE && !meta.forceReport) return;
        c.current = next;
        reportState(key, next, meta);
        if (next === STATES.DONE) {
            c.resetTimer = setTimeout(() => setState(key, STATES.IDLE), DONE_RESET_MS);
        }
    }

    function reportState(key, state, extra) {
        const meta = Object.assign({}, extra || {});
        delete meta.forceReport;
        const conversationId = publicConversationId(key);
        try {
            console.debug(TAG, "report NAI_STATE", state, { conversationId, pageConversationId: conversationIdFromUrl(), at: Date.now() });
            chrome.runtime.sendMessage(Object.assign({
                type: "NAI_STATE",
                state,
                url: location.href,
                title: document.title,
                conversationId,
                pageConversationId: conversationIdFromUrl(),
                lastInput: ensureConversation(key).lastInput || "",
                at: Date.now(),
            }, meta));
        } catch (e) {
            /* service worker 可能在重启，忽略 */
        }
    }

    function announceReadyForReplay() {
        try {
            window.postMessage({ __naiIndicatorReady: true, source: "content", at: Date.now() }, "*");
            console.debug(TAG, "content ready replay requested", { at: Date.now() });
        } catch (e) {}
    }

    function cancelDoneGrace(c, reason) {
        if (!c.doneGraceTimer) return;
        clearTimeout(c.doneGraceTimer);
        c.doneGraceTimer = null;
        console.debug(TAG, "done grace cancel", { reason, activeStreams: c.activeStreams.size, at: Date.now() });
    }

    function clearIdleFallback(c) {
        if (!c.idleFallbackTimer) return;
        clearTimeout(c.idleFallbackTimer);
        c.idleFallbackTimer = null;
    }

    function scheduleIdleFallback(key) {
        const c = ensureConversation(key);
        clearIdleFallback(c);
        c.idleFallbackTimer = setTimeout(() => {
            c.idleFallbackTimer = null;
            if (c.activeStreams.size > 0) return;
            console.debug(TAG, "done reason idle-fallback", { at: Date.now() });
            setState(key, STATES.DONE, { doneReason: "idle-fallback", forceReport: true });
        }, IDLE_FALLBACK_MS);
    }

    function scheduleDoneGrace(key) {
        const c = ensureConversation(key);
        clearIdleFallback(c);
        if (c.doneGraceTimer) clearTimeout(c.doneGraceTimer);
        console.debug(TAG, "done grace start", { activeStreams: c.activeStreams.size, at: Date.now() });
        c.doneGraceTimer = setTimeout(() => {
            c.doneGraceTimer = null;
            if (c.activeStreams.size > 0) return;
            console.debug(TAG, "done reason stream-closed", { at: Date.now() });
            setState(key, STATES.DONE, { doneReason: "stream-closed", forceReport: true });
        }, DONE_GRACE_MS);
    }

    function onStreamOpen(key, reqId) {
        const c = ensureConversation(key);
        c.activeStreams.add(reqId);
        cancelDoneGrace(c, "new-stream");
        clearIdleFallback(c);
        setState(key, STATES.THINKING, { reqId, forceReport: true });
    }

    function onStreamResponding(key, reqId) {
        const c = ensureConversation(key);
        if (reqId && !c.activeStreams.has(reqId)) c.activeStreams.add(reqId);
        cancelDoneGrace(c, "stream-responding");
        clearIdleFallback(c);
        setState(key, STATES.RESPONDING, { reqId, forceReport: true });
    }

    function onStreamClose(key, reqId) {
        const c = ensureConversation(key);
        if (reqId) c.activeStreams.delete(reqId);
        console.debug(TAG, "stream close observed", { reqId, activeStreams: c.activeStreams.size, at: Date.now() });
        if (c.activeStreams.size === 0) scheduleDoneGrace(key);
    }

    function applyDetectorState(d) {
        const reqId = d && d.reqId ? String(d.reqId) : "";
        const key = conversationKey(d.conversationId || d.pageConversationId || conversationIdFromUrl());
        const c = ensureConversation(key);
        if (typeof d.lastInput === "string") c.lastInput = d.lastInput;
        if (reqId && d.state === STATES.THINKING) {
            onStreamOpen(key, reqId);
            return;
        }
        if (reqId && d.state === STATES.RESPONDING) {
            onStreamResponding(key, reqId);
            return;
        }
        if (reqId && d.state === STATES.DONE) {
            onStreamClose(key, reqId);
            return;
        }

        if (d.state === STATES.THINKING || d.state === STATES.RESPONDING) {
            cancelDoneGrace(c, "legacy-running");
            setState(key, d.state, { forceReport: true });
            if (c.activeStreams.size === 0) scheduleIdleFallback(key);
            return;
        }
        if (d.state === STATES.DONE) {
            if (c.activeStreams.size === 0) scheduleDoneGrace(key);
            return;
        }
        if (d.state === STATES.IDLE && c.activeStreams.size === 0 && !c.doneGraceTimer) {
            setState(key, STATES.IDLE);
        }
    }

    function reportLocation(reason) {
        const conversationId = conversationIdFromUrl();
        const key = `${conversationId}|${location.href}|${document.title}`;
        if (key === lastLocationKey && reason !== "force") return;
        lastLocationKey = key;
        try {
            chrome.runtime.sendMessage({
                type: "NAI_LOCATION",
                conversationId,
                url: location.href,
                title: document.title,
                at: Date.now(),
            });
        } catch (e) {}
    }

    function checkLocationSync(reason) {
        reportLocation(reason || "change");
    }

    function installLocationHooks() {
        try {
            const origPushState = history.pushState;
            history.pushState = function () {
                const ret = origPushState.apply(this, arguments);
                setTimeout(() => checkLocationSync("pushState"), 0);
                return ret;
            };
            const origReplaceState = history.replaceState;
            history.replaceState = function () {
                const ret = origReplaceState.apply(this, arguments);
                setTimeout(() => checkLocationSync("replaceState"), 0);
                return ret;
            };
        } catch (e) {}
        window.addEventListener("popstate", () => setTimeout(() => checkLocationSync("popstate"), 0));
        try {
            const titleEl = document.querySelector("title");
            if (titleEl && typeof MutationObserver !== "undefined") {
                new MutationObserver(() => checkLocationSync("title")).observe(titleEl, { childList: true, characterData: true, subtree: true });
            }
        } catch (e) {}
        setInterval(() => checkLocationSync("poll"), 1000);
        reportLocation("force");
    }

    window.addEventListener("message", (ev) => {
        if (ev.source !== window) return;
        const d = ev.data;
        if (!d || d.__naiIndicator !== true) return;
        if (typeof d.lastInput === "string") {
            const key = conversationKey(d.conversationId || d.pageConversationId || conversationIdFromUrl());
            ensureConversation(key).lastInput = d.lastInput;
        }
        if (!isKnownState(d.state)) return;
        if (d.reqId) {
            const eventKey = `${d.reqId}|${d.state}|${d.streamEvent || ""}|${d.at || ""}`;
            if (seenDetectorEvents.has(eventKey)) return;
            seenDetectorEvents.add(eventKey);
            if (seenDetectorEvents.size > 200) seenDetectorEvents.clear();
        }
        applyDetectorState(d);
    });
    announceReadyForReplay();
    setTimeout(announceReadyForReplay, 0);
    setTimeout(announceReadyForReplay, 250);
    setTimeout(announceReadyForReplay, 1000);

    // ================= 画中画悬浮窗（Document Picture-in-Picture）=================
    // 纯扩展实现的系统级置顶小窗，浮于所有应用之上，实时显示所有 Notion AI 对话。
    const PIP_STATE_META = {
        idle: { cls: "idle", label: "空闲", glyph: "" },
        thinking: { cls: "run", label: "思考中", glyph: "" },
        responding: { cls: "run", label: "输出中", glyph: "" },
        done: { cls: "done", label: "完成", glyph: "✓" },
    };
    const PIP_RANK = { thinking: 0, responding: 0, done: 1, idle: 2 };
    const PIP_CSS = "*{box-sizing:border-box}html,body{margin:0;padding:0;height:100%;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'PingFang SC','Microsoft YaHei',sans-serif;background:#fff;color:#1f2328}body.nai-pip{display:flex;flex-direction:column}.nai-pip-header{display:flex;align-items:baseline;justify-content:space-between;padding:12px 14px 8px;border-bottom:1px solid #eceef1}.nai-pip-title{font-size:14px;font-weight:600}.nai-pip-count{font-size:12px;color:#6a737d}.nai-pip-list{list-style:none;margin:0;padding:6px;flex:1 1 auto;overflow-y:auto}.nai-item{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:8px;cursor:pointer;outline:none}.nai-item:hover,.nai-item:focus{background:#f5f6f8}.nai-ind{flex:0 0 auto;width:16px;height:16px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:11px;line-height:1}.nai-ind.idle{background:#c9ced4}.nai-ind.done{background:#16a34a;color:#fff}.nai-ind.run{background:transparent;border:2px solid #cdd8f5;border-top-color:#2f6fed}.nai-ind.nai-spin{animation:nai-rot .8s linear infinite}@keyframes nai-rot{to{transform:rotate(360deg)}}.nai-main{flex:1 1 auto;min-width:0}.nai-title{font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.nai-sub{font-size:11px;color:#6a737d;margin-top:2px}.nai-go{flex:0 0 auto;color:#b3bac1;font-size:13px}.nai-item:hover .nai-go{color:#2f6fed}.nai-pip-empty{padding:26px 16px;text-align:center;color:#6a737d;font-size:12px;line-height:1.6}.nai-pip-foot{padding:8px 14px;border-top:1px solid #eceef1;color:#9aa2ab;font-size:11px;text-align:center}@media (prefers-color-scheme:dark){html,body{background:#1f1f1f;color:#e6e6e6}.nai-pip-header,.nai-pip-foot{border-color:#333}.nai-item:hover,.nai-item:focus{background:#2a2a2a}.nai-pip-count,.nai-sub,.nai-pip-foot,.nai-pip-empty{color:#9aa2ab}.nai-ind.run{border-color:#35507f;border-top-color:#6f9bff}}";

    let pipWin = null;
    let pipListEl = null;
    let pipCountEl = null;
    let pipEmptyEl = null;
    let pipTickTimer = null;
    let lastSnapshot = [];

    function pipSupported() {
        return "documentPictureInPicture" in window;
    }

    async function togglePip() {
        if (pipWin) {
            try { pipWin.close(); } catch (_) {}
            return;
        }
        if (!pipSupported()) {
            alert("当前浏览器不支持悬浮窗（需 Chrome 116+）。");
            return;
        }
        try {
            pipWin = await window.documentPictureInPicture.requestWindow({ width: 320, height: 440 });
        } catch (e) {
            pipWin = null;
            return;
        }
        buildPipDom(pipWin.document);
        pipWin.addEventListener("pagehide", onPipClosed);
        requestSnapshot();
        startPipTick();
    }

    function onPipClosed() {
        stopPipTick();
        pipWin = null;
        pipListEl = null;
        pipCountEl = null;
        pipEmptyEl = null;
    }

    function buildPipDom(doc) {
        const style = doc.createElement("style");
        style.textContent = PIP_CSS;
        doc.head.appendChild(style);
        doc.body.className = "nai-pip";

        const header = doc.createElement("div");
        header.className = "nai-pip-header";
        const h = doc.createElement("span");
        h.className = "nai-pip-title";
        h.textContent = "Notion AI 对话";
        pipCountEl = doc.createElement("span");
        pipCountEl.className = "nai-pip-count";
        header.appendChild(h);
        header.appendChild(pipCountEl);

        pipListEl = doc.createElement("ul");
        pipListEl.className = "nai-pip-list";

        pipEmptyEl = doc.createElement("div");
        pipEmptyEl.className = "nai-pip-empty";
        pipEmptyEl.textContent = "暂无对话。在 Notion 里发一条消息试试吧。";

        const foot = doc.createElement("div");
        foot.className = "nai-pip-foot";
        foot.textContent = "悬浮窗浮于所有应用之上 · 点击对话跳转";

        doc.body.appendChild(header);
        doc.body.appendChild(pipListEl);
        doc.body.appendChild(pipEmptyEl);
        doc.body.appendChild(foot);
    }

    function requestSnapshot() {
        try {
            chrome.runtime.sendMessage({ type: MSG_GET_SNAPSHOT }, (res) => {
                if (chrome.runtime.lastError) return;
                if (res && Array.isArray(res.conversations)) {
                    lastSnapshot = res.conversations;
                    renderPip(lastSnapshot);
                }
            });
        } catch (e) {}
    }

    function renderPip(convs) {
        if (!pipWin || !pipListEl) return;
        const doc = pipWin.document;
        const list = (convs || []).slice().sort((a, b) => {
            const ra = PIP_RANK[a.state] != null ? PIP_RANK[a.state] : 3;
            const rb = PIP_RANK[b.state] != null ? PIP_RANK[b.state] : 3;
            if (ra !== rb) return ra - rb;
            return (b.updatedAt || 0) - (a.updatedAt || 0);
        });
        const running = list.filter((c) => c.state === "thinking" || c.state === "responding").length;
        pipCountEl.textContent = running > 0 ? (running + " 个进行中") : (list.length + " 个对话");
        pipListEl.textContent = "";
        if (!list.length) {
            pipEmptyEl.style.display = "block";
            return;
        }
        pipEmptyEl.style.display = "none";
        for (const c of list) {
            const meta = PIP_STATE_META[c.state] || PIP_STATE_META.idle;
            const li = doc.createElement("li");
            li.className = "nai-item";
            li.tabIndex = 0;

            const ind = doc.createElement("span");
            ind.className = "nai-ind " + meta.cls + (meta.cls === "run" ? " nai-spin" : "");
            if (meta.glyph) ind.textContent = meta.glyph;

            const main = doc.createElement("span");
            main.className = "nai-main";
            const title = doc.createElement("div");
            title.className = "nai-title";
            title.textContent = c.title || "Notion AI 对话";
            const sub = doc.createElement("div");
            sub.className = "nai-sub";
            sub.textContent = meta.label + " · " + relTime(c.updatedAt);
            main.appendChild(title);
            main.appendChild(sub);

            const go = doc.createElement("span");
            go.className = "nai-go";
            go.textContent = "↗";

            li.appendChild(ind);
            li.appendChild(main);
            li.appendChild(go);
            li.addEventListener("click", () => focusConversation(c));
            li.addEventListener("keydown", (e) => { if (e.key === "Enter") focusConversation(c); });
            pipListEl.appendChild(li);
        }
    }

    function focusConversation(c) {
        try {
            chrome.runtime.sendMessage({ type: MSG_FOCUS_TAB, conversationId: c.conversationId, tabId: c.tabId, windowId: c.windowId });
        } catch (e) {}
    }

    function relTime(ts) {
        if (!ts) return "";
        const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
        if (s < 5) return "刚刚";
        if (s < 60) return s + " 秒前";
        const m = Math.floor(s / 60);
        if (m < 60) return m + " 分钟前";
        const h = Math.floor(m / 60);
        if (h < 24) return h + " 小时前";
        return Math.floor(h / 24) + " 天前";
    }

    function startPipTick() {
        stopPipTick();
        pipTickTimer = setInterval(() => renderPip(lastSnapshot), 1000);
    }

    function stopPipTick() {
        if (pipTickTimer) { clearInterval(pipTickTimer); pipTickTimer = null; }
    }

    // background 推送的最新快照
chrome.runtime.onMessage.addListener((msg) => {
        if (msg && msg.type === MSG_SNAPSHOT && Array.isArray(msg.conversations)) {
            lastSnapshot = msg.conversations;
            renderPip(lastSnapshot);
        }
    });
    // ============================================================================

    function reportCurrentVisibleState() {
        reportLocation("force");
        const key = conversationKey(conversationIdFromUrl());
        const c = conversations.get(key);
        if (c) reportState(key, c.current, { forceReport: true });
    }

    installLocationHooks();

    // T-001：保留 PiP 代码但不提供页面内入口；因此不再自动挂载任何可见元素。
    // 仍在页面可见/返回前后上报一次状态，供桌面端保持刷新。
    window.addEventListener("pageshow", reportCurrentVisibleState);
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") reportCurrentVisibleState();
    });
})();
