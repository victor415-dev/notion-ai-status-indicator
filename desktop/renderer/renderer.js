"use strict";

const petEl = document.getElementById("pet");
const cardsEl = document.getElementById("cards");
const collapseEl = document.getElementById("collapse");
const badgeEl = document.getElementById("badge");
const petIconEl = petEl.querySelector(".pet-icon");

const DONE_RESET_MS = 6000;
const DRAG_THRESHOLD_PX = 4;

const RANK = { thinking: 0, responding: 0, done: 1, idle: 2 };

let snapshot = [];
let collapsed = false;
let drag = null; // { startScreenX, startScreenY, moved, movingWindow }

function renderPetSvg() {
	petIconEl.innerHTML = `
		<svg viewBox="0 0 56 56" width="56" height="56" role="img" aria-label="Notion AI Pet" xmlns="http://www.w3.org/2000/svg">
			<defs>
				<radialGradient id="pet-hi" cx="30%" cy="20%" r="70%">
					<stop offset="0" stop-color="#8fc0ff"/>
					<stop offset="0.58" stop-color="#6aa8ff" stop-opacity="0"/>
				</radialGradient>
				<linearGradient id="pet-bg" x1="0" y1="0" x2="0" y2="1">
					<stop offset="0" stop-color="#5ea2ff"/>
					<stop offset="0.55" stop-color="#2f6fed"/>
					<stop offset="1" stop-color="#1e4fd8"/>
				</linearGradient>
				<filter id="pet-shadow" x="-20%" y="-20%" width="140%" height="140%">
					<feDropShadow dx="0" dy="1" stdDeviation="0.5" flood-color="#000" flood-opacity="0.18"/>
				</filter>
			</defs>
			<circle cx="28" cy="28" r="28" fill="url(#pet-bg)"/>
			<circle cx="28" cy="28" r="28" fill="url(#pet-hi)"/>
			<g fill="#fff" filter="url(#pet-shadow)">
				<circle cx="22" cy="19" r="4"/>
				<circle cx="34" cy="18" r="4"/>
				<circle cx="19" cy="30" r="4"/>
				<circle cx="37" cy="30" r="4"/>
				<ellipse cx="28" cy="34" rx="7" ry="7.5"/>
			</g>
		</svg>`;
}

function isRunning(state) {
	return state === "thinking" || state === "responding";
}

function truncate(str, n) {
	const s = String(str || "");
	if (s.length <= n) return s;
	return s.slice(0, n) + "…";
}

function normalizeTitle(title) {
	const t = String(title || "").replace(/\s+-\s+Notion\s*$/i, "").trim();
	return t || "Notion";
}

function visibleCards(list) {
	const now = Date.now();
	return (list || []).filter((c) => {
		if (!c) return false;
		if (isRunning(c.state)) return true;
		if (c.state === "done") {
			const at = Number(c.updatedAt || 0);
			return at && now - at <= DONE_RESET_MS;
		}
		return false;
	});
}

function sorted(list) {
	return (list || []).slice().sort((a, b) => {
		const ra = RANK[a.state] != null ? RANK[a.state] : 3;
		const rb = RANK[b.state] != null ? RANK[b.state] : 3;
		if (ra !== rb) return ra - rb;
		return (b.updatedAt || 0) - (a.updatedAt || 0);
	});
}

function computeSize(cardCount, showArrow, showBadge) {
	const petH = 56;
	const petW = 56;
	const gap = 8;
	const arrowH = showArrow ? 20 + gap : 0;
	const badgeH = showBadge ? 20 + gap : 0;
	const cardH = cardCount > 0 ? cardCount * 54 + (cardCount - 1) * gap + gap : 0;
	const w = cardCount > 0 ? 280 : petW;
	const h = petH + arrowH + badgeH + cardH;
	return { width: Math.max(petW, w), height: Math.max(petH, h) };
}

function updateWindowSize() {
	const list = visibleCards(snapshot);
	const showArrow = !collapsed && list.length > 0;
	const showBadge = collapsed && list.length > 0;
	const cardCount = collapsed ? 0 : list.length;
	window.naiBridge.resize(computeSize(cardCount, showArrow, showBadge));
}

function render() {
	const list = sorted(visibleCards(snapshot));
	const hasCards = list.length > 0;

	if (!hasCards) collapsed = false;

	cardsEl.hidden = collapsed || !hasCards;
	collapseEl.hidden = collapsed || !hasCards;
	badgeEl.hidden = !collapsed || !hasCards;
	cardsEl.textContent = "";

	if (!hasCards) {
		updateWindowSize();
		return;
	}

	if (collapsed) {
		const running = list.filter((c) => isRunning(c.state)).length;
		badgeEl.textContent = String(running || list.length);
		updateWindowSize();
		return;
	}

	for (const c of list) {
		const card = document.createElement("div");
		card.className = "card";

		const ind = document.createElement("span");
		ind.className = "ind " + (isRunning(c.state) ? "run spin" : (c.state === "done" ? "done" : ""));
		if (c.state === "done") ind.textContent = "✓";

		const main = document.createElement("div");
		const title = document.createElement("div");
		title.className = "card-title";
		title.textContent = truncate(normalizeTitle(c.title), 16);

		const sub = document.createElement("div");
		sub.className = "card-sub";
		sub.textContent = truncate(c.lastInput || "", 20);

		main.appendChild(title);
		main.appendChild(sub);
		card.appendChild(ind);
		card.appendChild(main);

		card.addEventListener("click", () => {
			window.naiBridge.openNotion({ tabId: c.tabId });
		});

		cardsEl.appendChild(card);
	}

	updateWindowSize();
}

function onPetClick() {
	window.naiBridge.openNotion({ tabId: "latest" });
}

function totalDragDistance(e) {
	if (!drag) return 0;
	return Math.abs(e.screenX - drag.startScreenX) + Math.abs(e.screenY - drag.startScreenY);
}

petEl.addEventListener("mousedown", (e) => {
	if (e.button !== 0) return;
	drag = {
		startScreenX: e.screenX,
		startScreenY: e.screenY,
		moved: false,
		movingWindow: false,
	};
	window.naiBridge.dragStart({ screenX: e.screenX, screenY: e.screenY });
	e.preventDefault();
});

window.addEventListener("mousemove", (e) => {
	if (!drag) return;
	if (totalDragDistance(e) >= DRAG_THRESHOLD_PX) {
		drag.moved = true;
		drag.movingWindow = true;
		petEl.classList.add("is-dragging");
		window.naiBridge.move({ screenX: e.screenX, screenY: e.screenY });
	}
});

window.addEventListener("mouseup", (e) => {
	if (!drag) return;
	const wasClick = totalDragDistance(e) < DRAG_THRESHOLD_PX;
	const movedWindow = drag.movingWindow;
	drag = null;
	petEl.classList.remove("is-dragging");
	window.naiBridge.dragEnd();
	if (wasClick && !movedWindow) onPetClick();
});

petEl.addEventListener("contextmenu", (e) => {
	e.preventDefault();
	window.naiBridge.showMenu();
});

collapseEl.addEventListener("click", () => {
	collapsed = true;
	render();
});

badgeEl.addEventListener("click", () => {
	collapsed = false;
	render();
});

window.naiBridge.onSnapshot((data) => {
	snapshot = Array.isArray(data) ? data : [];
	render();
});

renderPetSvg();
render();

// 每 500ms 刷新 done 的 6 秒回落。
setInterval(render, 500);
