(() => {
    "use strict";

    // ISOLATED world：接收主世界拦截器广播的状态，维护状态机，渲染页面内宠物，
    // 并把状态上报给 background。UI 常驻 content script（不放 service worker，避免休眠丢失）。
    if (document.getElementById("nai-indicator-pet")) return;

    const STATES = {
        IDLE: "idle",
        THINKING: "thinking",
        RESPONDING: "responding",
        DONE: "done",
    };
    const STATE_META = {
        idle: { face: "🐾", label: "空闲" },
        thinking: { face: "🤔", label: "思考中" },
        responding: { face: "✍️", label: "输出中" },
        done: { face: "✅", label: "完成" },
    };
    const DONE_RESET_MS = 6000;
    const STORAGE_KEY = "petPos";

    let current = STATES.IDLE;
    let resetTimer = null;
    let dragging = null;

    const pet = document.createElement("div");
    pet.id = "nai-indicator-pet";
    pet.setAttribute("role", "status");
    pet.setAttribute("aria-live", "polite");
    pet.dataset.state = current;

    const face = document.createElement("span");
    face.className = "nai-face";
    const label = document.createElement("span");
    label.className = "nai-label";
    const pulse = document.createElement("span");
    pulse.className = "nai-pulse";
    pulse.setAttribute("aria-hidden", "true");
    pet.appendChild(pulse);
    pet.appendChild(face);
    pet.appendChild(label);

    function render() {
        const meta = STATE_META[current] || STATE_META.idle;
        pet.dataset.state = current;
        face.textContent = meta.face;
        label.textContent = meta.label;
    }

    function setState(next) {
        if (!isKnownState(next)) return;
        clearTimeout(resetTimer);
        resetTimer = null;
        if (next === current && next !== STATES.DONE) return;
        current = next;
        render();
        reportState(next);
        if (next === STATES.DONE) {
            resetTimer = setTimeout(() => setState(STATES.IDLE), DONE_RESET_MS);
        }
    }

    function reportState(state) {
        try {
            console.debug("[NAI] 上报状态", state);
            chrome.runtime.sendMessage({ type: "NAI_STATE", state, url: location.href, at: Date.now() });
        } catch (e) {
            /* service worker 可能在重启，忽略 */
        }
    }

    function isKnownState(state) {
        return state === STATES.IDLE ||
            state === STATES.THINKING ||
            state === STATES.RESPONDING ||
            state === STATES.DONE;
    }

    window.addEventListener("message", (ev) => {
        if (ev.source !== window) return;
        const d = ev.data;
        if (!d || d.__naiIndicator !== true) return;
        setState(d.state);
    });

    // ---- 拖动 + 记忆位置 ----
    function makeDraggable(el) {
        el.addEventListener("pointerdown", (e) => {
            const r = el.getBoundingClientRect();
            dragging = {
                pointerId: e.pointerId,
                startX: e.clientX,
                startY: e.clientY,
                originX: r.left,
                originY: r.top,
                moved: false,
            };
            el.classList.add("is-dragging");
            try { el.setPointerCapture(e.pointerId); } catch (_) {}
        });
        el.addEventListener("pointermove", (e) => {
            if (!dragging) return;
            const dx = e.clientX - dragging.startX;
            const dy = e.clientY - dragging.startY;
            if (Math.abs(dx) + Math.abs(dy) > 3) dragging.moved = true;
            placePet(dragging.originX + dx, dragging.originY + dy);
        });
        el.addEventListener("pointerup", (e) => {
            if (!dragging) return;
            const shouldSave = dragging.moved;
            dragging = null;
            el.classList.remove("is-dragging");
            try { el.releasePointerCapture(e.pointerId); } catch (_) {}
            if (shouldSave) savePosition();
        });
        el.addEventListener("pointercancel", (e) => {
            dragging = null;
            el.classList.remove("is-dragging");
            try { el.releasePointerCapture(e.pointerId); } catch (_) {}
        });
    }

    function savePosition() {
        const r = pet.getBoundingClientRect();
        const petPos = { x: Math.round(r.left), y: Math.round(r.top) };
        try {
            chrome.storage.local.set({ [STORAGE_KEY]: petPos });
        } catch (e) {
            try { localStorage.setItem(STORAGE_KEY, JSON.stringify(petPos)); } catch (_) {}
        }
    }

    function restorePosition() {
        try {
            chrome.storage.local.get(STORAGE_KEY, (res) => {
                applyStoredPosition(res && res[STORAGE_KEY]);
            });
        } catch (e) {
            try {
                applyStoredPosition(JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"));
            } catch (_) {}
        }
    }

    function applyStoredPosition(pos) {
        if (!pos || typeof pos.x !== "number" || typeof pos.y !== "number") return;
        placePet(pos.x, pos.y);
    }

    function placePet(x, y) {
        const maxX = Math.max(0, window.innerWidth - pet.offsetWidth);
        const maxY = Math.max(0, window.innerHeight - pet.offsetHeight);
        pet.style.left = Math.round(Math.max(0, Math.min(maxX, x))) + "px";
        pet.style.top = Math.round(Math.max(0, Math.min(maxY, y))) + "px";
        pet.style.right = "auto";
        pet.style.bottom = "auto";
    }

    function mount() {
        if (!document.body) {
            requestAnimationFrame(mount);
            return;
        }
        document.body.appendChild(pet);
        render();
        restorePosition();
        makeDraggable(pet);
        reportState(current);
    }

    window.addEventListener("resize", () => {
        const r = pet.getBoundingClientRect();
        placePet(r.left, r.top);
    });
    window.addEventListener("pageshow", () => reportState(current));
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") reportState(current);
    });

    mount();
})();
