(() => {
	"use strict";

	// ISOLATED world：接收主世界拦截器广播的状态，维护状态机，渲染页面内宠物，
	// 并把状态上报给 background。UI 常驻 content script（不放 service worker，避免休眠丢失）。
	const STATES = { IDLE: "idle", THINKING: "thinking", RESPONDING: "responding", DONE: "done" };
	const FACE = { idle: "🐾", thinking: "🤔", responding: "✍️", done: "✅" };
	const TEXT = { idle: "空闲", thinking: "思考中…", responding: "输出中…", done: "完成" };
	const DONE_RESET_MS = 4000;

	let current = STATES.IDLE;
	let resetTimer = null;

	const pet = document.createElement("div");
	pet.id = "nai-indicator-pet";
	pet.setAttribute("role", "status");
	pet.setAttribute("aria-live", "polite");

	const face = document.createElement("span");
	face.className = "nai-face";
	const label = document.createElement("span");
	label.className = "nai-label";
	pet.appendChild(face);
	pet.appendChild(label);

	function render() {
		pet.dataset.state = current;
		face.textContent = FACE[current] || "🐾";
		label.textContent = TEXT[current] || "";
	}

	function setState(next) {
		if (!next || next === current) return;
		current = next;
		render();
		try {
			chrome.runtime.sendMessage({ type: "NAI_STATE", state: next, url: location.href, at: Date.now() });
		} catch (e) {
			/* service worker 可能在重启，忽略 */
		}
		if (next === STATES.DONE) {
			clearTimeout(resetTimer);
			resetTimer = setTimeout(() => setState(STATES.IDLE), DONE_RESET_MS);
		}
	}

	window.addEventListener("message", (ev) => {
		if (ev.source !== window) return;
		const d = ev.data;
		if (!d || d.__naiIndicator !== true) return;
		setState(d.state);
	});

	// ---- 拖动 + 记忆位置 ----
	function makeDraggable(el) {
		let dragging = false, sx = 0, sy = 0, ox = 0, oy = 0, moved = false;
		el.addEventListener("pointerdown", (e) => {
			dragging = true;
			moved = false;
			sx = e.clientX;
			sy = e.clientY;
			const r = el.getBoundingClientRect();
			ox = r.left;
			oy = r.top;
			try { el.setPointerCapture(e.pointerId); } catch (_) {}
		});
		el.addEventListener("pointermove", (e) => {
			if (!dragging) return;
			const dx = e.clientX - sx, dy = e.clientY - sy;
			if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
			const x = Math.max(0, Math.min(window.innerWidth - el.offsetWidth, ox + dx));
			const y = Math.max(0, Math.min(window.innerHeight - el.offsetHeight, oy + dy));
			el.style.left = x + "px";
			el.style.top = y + "px";
			el.style.right = "auto";
			el.style.bottom = "auto";
		});
		el.addEventListener("pointerup", (e) => {
			dragging = false;
			try { el.releasePointerCapture(e.pointerId); } catch (_) {}
			if (moved) savePosition();
		});
	}

	function savePosition() {
		try {
			chrome.storage.local.set({ petPos: { left: pet.style.left, top: pet.style.top } });
		} catch (e) {}
	}

	function restorePosition() {
		try {
			chrome.storage.local.get("petPos", (res) => {
				const p = res && res.petPos;
				if (p && p.left && p.top) {
					pet.style.left = p.left;
					pet.style.top = p.top;
					pet.style.right = "auto";
					pet.style.bottom = "auto";
				}
			});
		} catch (e) {}
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
	}

	mount();
})();
