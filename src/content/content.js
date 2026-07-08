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

    const DONE_RESET_MS = 6000;

    // 悬浮窗消息（须与 service-worker.js 一致）
    const MSG_GET_SNAPSHOT = "GET_SNAPSHOT";
    const MSG_SNAPSHOT = "NAI_SNAPSHOT";
    const MSG_FOCUS_TAB = "FOCUS_TAB";

    let current = STATES.IDLE;
    let resetTimer = null;
    let lastInput = "";

    function isKnownState(state) {
        return state === STATES.IDLE ||
            state === STATES.THINKING ||
            state === STATES.RESPONDING ||
            state === STATES.DONE;
    }

    function setState(next) {
        if (!isKnownState(next)) return;
        clearTimeout(resetTimer);
        resetTimer = null;
        if (next === current && next !== STATES.DONE) return;
        current = next;
        reportState(next);
        if (next === STATES.DONE) {
            resetTimer = setTimeout(() => setState(STATES.IDLE), DONE_RESET_MS);
        }
    }

    function reportState(state) {
        try {
            chrome.runtime.sendMessage({
                type: "NAI_STATE",
                state,
                url: location.href,
                title: document.title,
                lastInput: lastInput || "",
                at: Date.now(),
            });
        } catch (e) {
            /* service worker 可能在重启，忽略 */
        }
    }

    window.addEventListener("message", (ev) => {
        if (ev.source !== window) return;
        const d = ev.data;
        if (!d || d.__naiIndicator !== true) return;
        if (typeof d.lastInput === "string") lastInput = d.lastInput;
        setState(d.state);
    });

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
            chrome.runtime.sendMessage({ type: MSG_FOCUS_TAB, tabId: c.tabId, windowId: c.windowId });
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

    // T-001：保留 PiP 代码但不提供页面内入口；因此不再自动挂载任何可见元素。
    // 仍在页面可见/返回前后上报一次状态，供桌面端保持刷新。
    window.addEventListener("pageshow", () => reportState(current));
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") reportState(current);
    });
})();
