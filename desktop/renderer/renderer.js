"use strict";

const petEl = document.getElementById("pet");
const cardsEl = document.getElementById("cards");
const collapseEl = document.getElementById("collapse");
const badgeEl = document.getElementById("badge");
const petSpriteEl = document.getElementById("pet-sprite");

const DRAG_THRESHOLD_PX = 4;

const RANK = { thinking: 0, responding: 0, done: 1, idle: 2 };

const SPRITE_FALLBACKS = {
	idle: "idle_00",
	hover: "hover_00",
	waiting: "wait_00",
	throw: "throw_07",
	done: "done_00",
	plane: "plane_00",
	planeLand: "plane_land_00",
};

let snapshot = [];
let collapsed = false;
let drag = null; // { startScreenX, startScreenY, moved, movingWindow }
let spriteMap = null;
let spriteReady = false;
let spriteVisible = true;
let spriteHovered = false;
let spriteDragging = false;
let spriteWaiting = false;
let spriteReducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
let spritePrevStates = new Map();
let spriteInitialized = false;
let spriteCurrentMode = "idle";
let spriteLoopIndex = 0;
let spriteLoopTimer = null;
let spriteThrowRaf = 0;
let spriteThrowTimer = 0;
let spriteDoneTimer = 0;
let spriteDoneUntil = 0;
let activeThrow = null; // { key, conversationId, tabId, title, spawned }
const throwQueue = [];
const queuedThrowKeys = new Set();

function loadSpriteMap() {
	try {
		if (window.naiBridge && typeof window.naiBridge.loadPetSpriteMap === "function") {
			const map = window.naiBridge.loadPetSpriteMap();
			if (map && map.states) return map;
		}
	} catch (e) {}
	return null;
}

function frameRel(name) {
	return `assets/pet/frames/${name}.png`;
}

function spriteFrames(mode) {
	if (!spriteMap || !spriteMap.states) return [];
	const frames = spriteMap.states[mode];
	return Array.isArray(frames) ? frames : [];
}

function spriteFrameMs(mode) {
	if (spriteMap && spriteMap.frameMs && Number.isFinite(spriteMap.frameMs[mode])) return Number(spriteMap.frameMs[mode]);
	return { idle: 140, hover: 120, waiting: 140, done: 120, throw: 80, plane: 90, planeLand: 110 }[mode] || 120;
}

function setSpriteFrame(relPath) {
	if (!petSpriteEl || !relPath) return;
	const next = `./${relPath}`;
	if (petSpriteEl.getAttribute("src") !== next) petSpriteEl.setAttribute("src", next);
}

function clearSpriteTimers() {
	if (spriteLoopTimer) {
		clearTimeout(spriteLoopTimer);
		spriteLoopTimer = null;
	}
	if (spriteThrowRaf) {
		cancelAnimationFrame(spriteThrowRaf);
		spriteThrowRaf = 0;
	}
	if (spriteThrowTimer) {
		clearTimeout(spriteThrowTimer);
		spriteThrowTimer = 0;
	}
	if (spriteDoneTimer) {
		clearTimeout(spriteDoneTimer);
		spriteDoneTimer = 0;
	}
}

function currentSpriteMode() {
	if (!spriteVisible || !spriteReady) return "idle";
	if (activeThrow) return "throw";
	if (Date.now() < spriteDoneUntil) return "done";
	if (spriteHovered && !spriteDragging) return "hover";
	if (spriteWaiting) return "waiting";
	return "idle";
}

function scheduleSpriteLoop(mode, index = 0) {
	clearSpriteTimers();
	spriteCurrentMode = mode;
	const frames = spriteFrames(mode);
	if (!frames.length) return;
	if (spriteReducedMotion) {
		const staticFrame = mode === "throw" ? frames[frames.length - 1] : frames[0];
		setSpriteFrame(staticFrame);
		return;
	}
	const frameMs = spriteFrameMs(mode);
	spriteLoopIndex = Math.max(0, Math.min(index, frames.length - 1));
	const tick = () => {
		if (currentSpriteMode() !== mode) return;
		const nextFrame = frames[Math.min(spriteLoopIndex, frames.length - 1)];
		setSpriteFrame(nextFrame);
		spriteLoopIndex = (spriteLoopIndex + 1) % frames.length;
		spriteLoopTimer = setTimeout(tick, frameMs);
	};
	tick();
}

function finishThrow() {
	const key = activeThrow && activeThrow.key;
	activeThrow = null;
	if (key) {
		queuedThrowKeys.delete(key);
	}
	spriteDoneUntil = Date.now() + 520;
	scheduleSpriteLoop("done");
	spriteDoneTimer = setTimeout(() => {
		spriteDoneTimer = 0;
		spriteDoneUntil = 0;
		updateSpriteState();
		pumpThrowQueue();
	}, 520);
}

function spawnPlaneForThrow(throwMeta) {
	if (!window.naiBridge || typeof window.naiBridge.spawnPlane !== "function") return;
	window.naiBridge.spawnPlane({
		conversationId: throwMeta.conversationId || "",
		tabId: throwMeta.tabId || "",
		title: throwMeta.title || "",
		releaseFrame: Number.isFinite(spriteMap && spriteMap.releaseFrame) ? spriteMap.releaseFrame : 5,
	});
}

function startThrow(throwMeta) {
	if (!throwMeta || !spriteReady || !spriteVisible) return;
	activeThrow = Object.assign({ spawned: false }, throwMeta);
	if (spriteReducedMotion) {
		setSpriteFrame(spriteFrames("throw").slice(-1)[0] || frameRel(SPRITE_FALLBACKS.throw));
		spawnPlaneForThrow(activeThrow);
		finishThrow();
		return;
	}
	const frames = spriteFrames("throw");
	if (!frames.length) return;
	spriteCurrentMode = "throw";
	clearSpriteTimers();
	const total = Math.max(1, frames.length);
	const frameMs = spriteFrameMs("throw");
	const duration = frameMs * total;
	const startedAt = performance.now();
	const releaseFrame = Number.isFinite(spriteMap && spriteMap.releaseFrame) ? Number(spriteMap.releaseFrame) : 5;
	const tick = (now) => {
		if (activeThrow !== throwMeta && (!activeThrow || activeThrow.key !== throwMeta.key)) return;
		const elapsed = now - startedAt;
		const progress = Math.min(1, elapsed / duration);
		const index = Math.min(frames.length - 1, Math.floor(progress * frames.length));
		spriteLoopIndex = index;
		setSpriteFrame(frames[index]);
		if (!throwMeta.spawned && index >= releaseFrame) {
			throwMeta.spawned = true;
			spawnPlaneForThrow(throwMeta);
		}
		if (progress >= 1) {
			finishThrow();
			return;
		}
		spriteThrowRaf = requestAnimationFrame(tick);
	};
	spriteThrowRaf = requestAnimationFrame(tick);
}

function pumpThrowQueue() {
	if (activeThrow || !throwQueue.length || !spriteReady || !spriteVisible) {
		updateSpriteState();
		return;
	}
	const next = throwQueue.shift();
	if (next) startThrow(next);
	else updateSpriteState();
}

function queueThrow(throwMeta) {
	if (!spriteVisible) return;
	if (!throwMeta || !throwMeta.key || queuedThrowKeys.has(throwMeta.key)) return;
	if (activeThrow && activeThrow.key === throwMeta.key) return;
	if (throwQueue.length >= 3) return;
	queuedThrowKeys.add(throwMeta.key);
	throwQueue.push(throwMeta);
	pumpThrowQueue();
}

function updateSpriteState(force = false) {
	if (!spriteReady || !spriteVisible) return;
	const nextMode = currentSpriteMode();
	if (!force && nextMode === spriteCurrentMode && (nextMode === "throw" || spriteLoopTimer)) {
		return;
	}
	if (nextMode === "done") {
		scheduleSpriteLoop("done");
		return;
	}
	if (nextMode === "throw") {
		return;
	}
	if (nextMode === "hover") {
		scheduleSpriteLoop("hover");
		return;
	}
	if (nextMode === "waiting") {
		scheduleSpriteLoop("waiting");
		return;
	}
	scheduleSpriteLoop("idle");
}

function syncSnapshotTransitions(list) {
	const nextStates = new Map();
	let waiting = false;
	for (const c of list || []) {
		if (!c) continue;
		const key = c.conversationId || String(c.tabId || "");
		nextStates.set(key, c.state);
		if (isRunning(c.state)) waiting = true;
		if (spriteInitialized) {
			const prev = spritePrevStates.get(key);
			if (prev !== "done" && c.state === "done") {
				queueThrow({
					key,
					conversationId: c.conversationId || "",
					tabId: c.tabId || "",
					title: c.title || "",
				});
			}
		}
	}
	spriteWaiting = waiting;
	spritePrevStates = nextStates;
	spriteInitialized = true;
	updateSpriteState();
}

function setSpriteVisible(visible) {
	spriteVisible = Boolean(visible);
	if (!spriteVisible) {
		clearSpriteTimers();
		activeThrow = null;
		spriteDoneUntil = 0;
		throwQueue.length = 0;
		queuedThrowKeys.clear();
		setSpriteFrame((spriteFrames("idle")[0]) || frameRel(SPRITE_FALLBACKS.idle));
		return;
	}
	pumpThrowQueue();
	updateSpriteState(true);
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
	return (list || []).filter((c) => {
		if (!c) return false;
		if (isRunning(c.state)) return true;
		if (c.state === "done") return true;
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
	const badgeH = showBadge ? 20 + gap : 0;
	const arrowH = showArrow ? 24 + gap : 0;
	const cardH = cardCount > 0 ? cardCount * 64 + (cardCount - 1) * gap + gap : 0;
	const w = cardCount > 0 ? 280 : petW;
	const h = petH + badgeH + arrowH + cardH;
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
		badgeEl.textContent = String(list.length);
		updateWindowSize();
		return;
	}

	for (const c of list) {
		const card = document.createElement("div");
		card.className = "card";
		card.dataset.key = c.conversationId || String(c.tabId || "");

		const ind = document.createElement("span");
		ind.className = "ind " + (isRunning(c.state) ? "run spin" : (c.state === "done" ? "done" : ""));
		if (c.state === "done") ind.textContent = "✓";

		const main = document.createElement("div");
		const title = document.createElement("div");
		title.className = "card-title";
		title.textContent = truncate(normalizeTitle(c.title), 16);

		const sub = document.createElement("div");
		sub.className = "card-sub";
		sub.textContent = truncate(replyPreview(c), 42);

		main.appendChild(title);
		main.appendChild(sub);
		card.appendChild(ind);
		card.appendChild(main);

		card.addEventListener("click", () => {
			window.naiBridge.openNotion({ tabId: c.conversationId ? `conversation:${c.conversationId}` : c.tabId });
		});

		cardsEl.appendChild(card);
	}

	updateWindowSize();
}

function replyPreview(c) {
	const reply = String(c && c.lastReply ? c.lastReply : "").trim();
	if (reply) return reply;
	if (c && isRunning(c.state)) return "正在生成回复…";
	return "回复内容不可用";
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

petEl.addEventListener("mouseenter", () => {
	spriteHovered = true;
	updateSpriteState();
});

petEl.addEventListener("mouseleave", () => {
	spriteHovered = false;
	updateSpriteState();
});

window.addEventListener("mousemove", (e) => {
	if (!drag) return;
	if (totalDragDistance(e) >= DRAG_THRESHOLD_PX) {
		drag.moved = true;
		drag.movingWindow = true;
		spriteDragging = true;
		petEl.classList.add("is-dragging");
		window.naiBridge.move({ screenX: e.screenX, screenY: e.screenY });
	}
});

window.addEventListener("mouseup", (e) => {
	if (!drag) return;
	const wasClick = totalDragDistance(e) < DRAG_THRESHOLD_PX;
	const movedWindow = drag.movingWindow;
	drag = null;
	spriteDragging = false;
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
	syncSnapshotTransitions(snapshot);
	updateWindowSize();
});

window.naiBridge.onVisibility((data) => {
	setSpriteVisible(Boolean(data && data.visible));
});

if (petSpriteEl) {
	petSpriteEl.onerror = () => console.warn("[NAI-PET] sprite frame failed", petSpriteEl.currentSrc || petSpriteEl.src);
}

spriteMap = loadSpriteMap();
spriteReady = Boolean(spriteMap && spriteMap.states);
if (spriteReady) {
	setSpriteFrame(spriteFrames("idle")[0] || frameRel(SPRITE_FALLBACKS.idle));
	pumpThrowQueue();
	updateSpriteState(true);
} else {
	console.warn("[NAI-PET] sprite map missing");
}
render();
