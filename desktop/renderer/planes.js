"use strict";

const stage = document.getElementById("stage");

const planes = new Map();
let raf = 0;
let visible = true;
let spriteMap = null;

function loadSpriteMap() {
	try {
		return window.naiBridge.loadPetSpriteMap ? window.naiBridge.loadPetSpriteMap() : null;
	} catch (e) {
		return null;
	}
}

function framePath(name) {
	return `assets/pet/frames/${name}.png`;
}

function setFrame(rec, name) {
	const src = framePath(name);
	if (rec.img.getAttribute("src") !== src) rec.img.setAttribute("src", src);
}

function bezier(p0, p1, p2, t) {
	const u = 1 - t;
	return {
		x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
		y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
	};
}

function tangent(p0, p1, p2, t) {
	const u = 1 - t;
	return {
		x: 2 * u * (p1.x - p0.x) + 2 * t * (p2.x - p1.x),
		y: 2 * u * (p1.y - p0.y) + 2 * t * (p2.y - p1.y),
	};
}

function removePlane(id) {
	const rec = planes.get(id);
	if (!rec) return;
	rec.hovered = false;
	try {
		window.naiBridge.planeInteractive({ id, active: false });
	} catch (e) {}
	rec.el.remove();
	planes.delete(id);
	if (!planes.size && raf) {
		cancelAnimationFrame(raf);
		raf = 0;
	}
}

function clearPlanes() {
	for (const id of [...planes.keys()]) removePlane(id);
}

function updatePlane(rec, now) {
	const elapsed = now - rec.startedAt;
	const progress = Math.min(1, Math.max(0, elapsed / rec.duration));
	if (!rec.landed) {
		const pos = bezier(rec.start, rec.control, rec.end, progress);
		const tan = tangent(rec.start, rec.control, rec.end, progress);
		const angle = Math.max(-22, Math.min(22, Math.atan2(tan.y, tan.x) * 180 / Math.PI / 4));
		rec.el.style.transform = `translate3d(${pos.x}px, ${pos.y}px, 0) translate(-50%, -50%) rotate(${angle}deg)`;
		const frames = spriteMap && spriteMap.states && Array.isArray(spriteMap.states.plane) ? spriteMap.states.plane : [];
		const idx = frames.length ? Math.min(frames.length - 1, Math.floor(progress * frames.length)) : 0;
		if (frames[idx]) setFrame(rec, frames[idx].split("/").pop().replace(/\.png$/, ""));
		if (progress >= 1) {
			rec.landed = true;
			rec.landedAt = now;
			rec.el.classList.add("is-landed");
			rec.el.style.pointerEvents = "auto";
			rec.el.style.cursor = "pointer";
			if (rec.el.matches(":hover")) {
				rec.hovered = true;
				window.naiBridge.planeInteractive({ id: rec.id, active: true });
			}
		}
		return;
	}

	rec.el.style.transform = `translate3d(${rec.end.x}px, ${rec.end.y}px, 0) translate(-50%, -50%)`;
	const landFrames = spriteMap && spriteMap.states && Array.isArray(spriteMap.states.planeLand) ? spriteMap.states.planeLand : [];
	const landMs = (spriteMap && spriteMap.frameMs && spriteMap.frameMs.planeLand) || 110;
	if (landFrames.length) {
		const landProgress = Math.min(1, (now - rec.landedAt) / (landMs * landFrames.length));
		const idx = Math.min(landFrames.length - 1, Math.floor(landProgress * landFrames.length));
		const src = landFrames[idx] || landFrames[0];
		if (src) setFrame(rec, src.split("/").pop().replace(/\.png$/, ""));
	}
}

function tick(now) {
	if (!visible) {
		raf = 0;
		return;
	}
	for (const rec of planes.values()) updatePlane(rec, now);
	raf = planes.size ? requestAnimationFrame(tick) : 0;
}

function ensureTick() {
	if (!raf && planes.size && visible) raf = requestAnimationFrame(tick);
}

function addPlane(payload) {
	if (!payload || !payload.id) return;
	const id = String(payload.id);
	if (planes.has(id)) return;

	const el = document.createElement("button");
	el.type = "button";
	el.className = "plane";
	el.setAttribute("aria-label", payload.title || "Notion AI plane");
	const img = document.createElement("img");
	img.alt = "";
	img.setAttribute("aria-hidden", "true");
	el.appendChild(img);
	stage.appendChild(el);

	const rec = {
		id,
		el,
		img,
		conversationId: payload.conversationId || "",
		tabId: payload.tabId || "",
		title: payload.title || "",
		start: payload.start || { x: 0, y: 0 },
		control: payload.control || { x: 0, y: 0 },
		end: payload.end || { x: 0, y: 0 },
		duration: Number(payload.duration) || 550,
		startedAt: performance.now(),
		landed: false,
		landedAt: 0,
		hovered: false,
	};
	planes.set(id, rec);
	setFrame(rec, "plane_00");

	el.addEventListener("mouseenter", () => {
		if (!rec.landed || rec.hovered) return;
		rec.hovered = true;
		window.naiBridge.planeInteractive({ id: rec.id, active: true });
	});
	el.addEventListener("mouseleave", () => {
		if (!rec.landed || !rec.hovered) return;
		rec.hovered = false;
		window.naiBridge.planeInteractive({ id: rec.id, active: false });
	});
	el.addEventListener("click", (e) => {
		e.preventDefault();
		e.stopPropagation();
		window.naiBridge.planeOpenNotion({
			id: rec.id,
			tabId: rec.conversationId ? `conversation:${rec.conversationId}` : (rec.tabId || "latest"),
		});
		removePlane(rec.id);
	});

	ensureTick();
}

spriteMap = loadSpriteMap();

window.naiBridge.onPlaneSpawn((payload) => addPlane(payload));
window.naiBridge.onPlaneRemove((payload) => {
	if (payload && payload.id) removePlane(String(payload.id));
});
window.naiBridge.onPlaneClear(() => clearPlanes());
window.naiBridge.onPlaneIgnore(() => {});
window.naiBridge.onVisibility((data) => {
	visible = Boolean(data && data.visible);
	if (!visible) clearPlanes();
});

if (!spriteMap) {
	console.debug("[NAI-PET] plane sprite map unavailable");
}
