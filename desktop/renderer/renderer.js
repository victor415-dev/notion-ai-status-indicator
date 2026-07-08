"use strict";

const petEl = document.getElementById("pet");
const cardsEl = document.getElementById("cards");
const collapseEl = document.getElementById("collapse");
const badgeEl = document.getElementById("badge");

const DONE_RESET_MS = 6000;
const DRAG_THRESHOLD_PX = 4;

const RANK = { thinking: 0, responding: 0, done: 1, idle: 2 };

let snapshot = [];
let collapsed = false;

let drag = null; // {x,y,moved}

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
	const pet = { w: 56, h: 56 };
	const arrowH = showArrow ? 20 + 8 : 0; // button + gap
	const badgeH = showBadge ? 18 + 8 : 0;
	const cardH = cardCount > 0 ? cardCount * 54 + (cardCount - 1) * 8 : 0;
	const cardsW = cardCount > 0 ? 280 : 56;
	const w = Math.max(pet.w, cardsW);
	const h = pet.h + Math.max(arrowH + cardH, badgeH);
	return { width: w, height: h };
}

function updateWindowSize() {
	const list = visibleCards(snapshot);
	const showArrow = !collapsed && list.length > 0;
	const showBadge = collapsed && list.length > 0;
	const cardCount = collapsed ? 0 : list.length;
	const size = computeSize(cardCount, showArrow, showBadge);
	window.naiBridge.resize(size);
}

function render() {
	const list = sorted(visibleCards(snapshot));

	const hasCards = list.length > 0;

	// 折叠：仅显示 badge（进行中数量）
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

// 点击宠物：无进行中对话时跳 latest；有对话时保持行为（也跳 latest，符合 spec）
function onPetClick() {
	window.naiBridge.openNotion({ tabId: "latest" });
}

petEl.addEventListener("pointerdown", (e) => {
	drag = { x: e.clientX, y: e.clientY, moved: false };
});

petEl.addEventListener("pointermove", (e) => {
	if (!drag) return;
	const dx = e.clientX - drag.x;
	const dy = e.clientY - drag.y;
	if (Math.abs(dx) + Math.abs(dy) >= DRAG_THRESHOLD_PX) drag.moved = true;
});

petEl.addEventListener("pointerup", () => {
	if (!drag) return;
	const wasClick = !drag.moved;
	drag = null;
	if (wasClick) onPetClick();
});

// 右键菜单：仅退出
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

// 定时刷新 done 回落
setInterval(render, 500);
