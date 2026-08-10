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

function easeIn(t) {
	return t * t;
}

function easeOut(t) {
	return 1 - (1 - t) * (1 - t);
}

function clampFlightAngle(angle) {
	return Math.max(-35, Math.min(35, angle));
}

function angleFromTangent(vector) {
	return Math.atan2(vector.y, vector.x) * 180 / Math.PI;
}

function shortestAngleDelta(from, to) {
	return ((to - from + 540) % 360) - 180;
}

function smoothSegmentAngle(rec, phase, targetAngle, now) {
	if (rec.rotationPhase !== phase) {
		rec.rotationPhase = phase;
		rec.rotationBlend = { from: Number.isFinite(rec.rotation) ? rec.rotation : targetAngle, startedAt: now };
	}
	const blend = rec.rotationBlend;
	if (blend) {
		const progress = Math.min(1, Math.max(0, (now - blend.startedAt) / 120));
		const angle = blend.from + shortestAngleDelta(blend.from, targetAngle) * progress;
		if (progress >= 1) rec.rotationBlend = null;
		rec.rotation = angle;
		return angle;
	}
	rec.rotation = targetAngle;
	return targetAngle;
}

function setFlightTransform(rec, pos, angle) {
	rec.el.style.transform = `translate3d(${pos.x}px, ${pos.y}px, 0) translate(-50%, -50%) rotate(${angle}deg)`;
}

function finishFlight(rec, now) {
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

function hasLoopTrajectory(loop) {
	return Boolean(loop)
		&& [loop.cx, loop.cy, loop.rx, loop.ry, loop.entryAngle, loop.launchMs, loop.loopMs, loop.landMs]
			.every(Number.isFinite)
		&& loop.rx > 0
		&& loop.ry > 0
		&& loop.launchMs > 0
		&& loop.loopMs > 0
		&& loop.landMs > 0
		&& (loop.direction === 1 || loop.direction === -1);
}

function hasFlightTrajectory(flight) {
	return Boolean(flight)
		&& [flight.theta0, flight.v0, flight.vt, flight.kDrag, flight.g, flight.maxMs].every(Number.isFinite)
		&& (flight.dirX === 1 || flight.dirX === -1)
		&& flight.v0 > 0
		&& flight.vt > 0
		&& flight.kDrag >= 0
		&& flight.g > 0
		&& flight.maxMs > 0;
}

function updateFlyingFrame(rec, elapsed) {
	const frames = spriteMap && spriteMap.states && Array.isArray(spriteMap.states.plane) ? spriteMap.states.plane : [];
	const frameMs = (spriteMap && spriteMap.frameMs && spriteMap.frameMs.plane) || 110;
	if (!frames.length) return;
	const src = frames[Math.floor(elapsed / frameMs) % frames.length] || frames[0];
	if (src) setFrame(rec, src.split("/").pop().replace(/\.png$/, ""));
}

function flightBounds() {
	return {
		left: 24,
		right: Math.max(24, window.innerWidth - 24),
		top: 24,
		bottom: Math.max(24, window.innerHeight - 24),
	};
}

function clamp(value, minimum, maximum) {
	return Math.min(maximum, Math.max(minimum, value));
}

function currentFlightDirection(physics, now) {
	if (!physics.turn) return physics.dirX;
	const progress = Math.min(1, Math.max(0, (now - physics.turn.startedAt) / 350));
	const direction = physics.turn.from * Math.cos(progress * Math.PI);
	if (progress >= 1) {
		physics.dirX = physics.turn.to;
		physics.turn = null;
		return physics.dirX;
	}
	return direction;
}

function beginFlightTurn(physics, now) {
	if (physics.turn) return;
	physics.turnCount += 1;
	physics.turn = { startedAt: now, from: physics.dirX, to: -physics.dirX, id: physics.turnCount };
}

function initialFlightState(rec, now) {
	if (rec.physics) return rec.physics;
	const { flight } = rec;
	rec.physics = {
		x: rec.start.x,
		y: rec.start.y,
		v: flight.v0,
		theta: flight.theta0,
		dirX: flight.dirX,
		lastNow: now,
		turn: null,
		turnCount: 0,
		lastAngle: 0,
		guided: false,
	};
	return rec.physics;
}

function pointOverPet(rec, point) {
	const bounds = rec.petBounds;
	if (!bounds || ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)) return false;
	const planeRadius = 38;
	return point.x >= bounds.x - planeRadius
		&& point.x <= bounds.x + bounds.width + planeRadius
		&& point.y >= bounds.y - planeRadius
		&& point.y <= bounds.y + bounds.height + planeRadius;
}

function pointOverLandedPlane(rec, point) {
	for (const other of planes.values()) {
		if (other === rec || !other.landed || !other.end) continue;
		if (Math.hypot(point.x - other.end.x, point.y - other.end.y) < 48) return true;
	}
	return false;
}

function pickGlideTarget(rec, physics) {
	const bounds = flightBounds();
	let candidate = { x: physics.x, y: physics.y };
	for (let attempt = 0; attempt < 5; attempt += 1) {
		candidate = {
			x: clamp(physics.x + physics.dirX * (300 + Math.random() * 600), bounds.left, bounds.right),
			y: clamp(physics.y + 150 + Math.random() * 300, bounds.top, bounds.bottom),
		};
		if (!pointOverPet(rec, candidate) && !pointOverLandedPlane(rec, candidate)) return candidate;
	}
	return candidate;
}

function updatePhysicsPlane(rec, now) {
	const physics = initialFlightState(rec, now);
	const elapsed = Math.max(0, now - rec.startedAt);
	if (elapsed >= rec.flight.maxMs) {
		if (!physics.guided) {
			rec.end = pickGlideTarget(rec, physics);
			physics.guided = true;
		}
		setFlightTransform(rec, rec.end, 0);
		finishFlight(rec, now);
		return;
	}

	const bounds = flightBounds();
	let dt = Math.min(0.032, Math.max(0, (now - physics.lastNow) / 1000));
	physics.lastNow = now;
	if (physics.y < 60 && physics.theta > -0.08) physics.theta = Math.max(-0.18, physics.theta - Math.PI / 2 * dt);
	const horizontalDirection = currentFlightDirection(physics, now);
	const horizontalVelocity = horizontalDirection * physics.v * Math.cos(physics.theta);
	if (!physics.turn && ((physics.x - bounds.left < 150 && horizontalVelocity < 0) || (bounds.right - physics.x < 150 && horizontalVelocity > 0))) {
		beginFlightTurn(physics, now);
	}
	const direction = currentFlightDirection(physics, now);
	const flight = rec.flight;
	const speed = Math.max(40, physics.v);
	const dragRatio = speed / flight.vt;
	physics.v = Math.max(40, speed + (-flight.g * Math.sin(physics.theta) - flight.g * flight.kDrag * dragRatio * dragRatio) * dt);
	physics.theta += flight.g / speed * (dragRatio * dragRatio - Math.cos(physics.theta)) * dt;
	const previous = { x: physics.x, y: physics.y };
	physics.x += direction * physics.v * Math.cos(physics.theta) * dt;
	physics.y -= physics.v * Math.sin(physics.theta) * dt;
	if (!physics.guided && elapsed >= (Number(flight.glideMs) || 2400) * 0.5) {
		rec.end = pickGlideTarget(rec, physics);
		physics.guided = true;
		console.debug("[NAI-PET] glide target", rec.end.x, rec.end.y, "from", Math.round(physics.x), Math.round(physics.y));
	}
	if (physics.guided) {
		const desired = Math.atan2(-(rec.end.y - physics.y), physics.dirX * (rec.end.x - physics.x));
		physics.theta += clamp(desired - physics.theta, -0.9 * dt, 0.9 * dt);
	} else {
		physics.theta += (-0.15 - physics.theta) * Math.min(1, 0.25 * dt);
	}
	const velocityAngle = angleFromTangent({ x: physics.x - previous.x, y: physics.y - previous.y });
	physics.lastAngle = Number.isFinite(velocityAngle) ? velocityAngle : physics.lastAngle;
	const phase = physics.turn ? `physics-turn-${physics.turn.id}` : "physics";
	setFlightTransform(rec, physics, smoothSegmentAngle(rec, phase, physics.lastAngle, now));
	updateFlyingFrame(rec, elapsed);
	if (physics.guided && (Math.hypot(physics.x - rec.end.x, physics.y - rec.end.y) < 24 || physics.v < 60)) {
		setFlightTransform(rec, rec.end, 0);
		finishFlight(rec, now);
	}
}

function updateLoopPlane(rec, now) {
	const elapsed = Math.max(0, now - rec.startedAt);
	const { loop } = rec;
	const entry = {
		x: loop.cx + loop.rx * Math.cos(loop.entryAngle),
		y: loop.cy + loop.ry * Math.sin(loop.entryAngle),
	};
	const entryTangent = {
		x: -loop.direction * loop.rx * Math.sin(loop.entryAngle),
		y: loop.direction * loop.ry * Math.cos(loop.entryAngle),
	};
	const tangentLength = Math.hypot(entryTangent.x, entryTangent.y) || 1;
	const totalDuration = loop.launchMs + loop.loopMs + loop.landMs;
	let pos;
	let angle;
	let phase;

	if (elapsed < loop.launchMs) {
		const progress = easeIn(elapsed / loop.launchMs);
		const control = {
			x: (rec.start.x + entry.x) / 2,
			y: (rec.start.y + entry.y) / 2 - 60,
		};
		pos = bezier(rec.start, control, entry, progress);
		angle = clampFlightAngle(angleFromTangent(tangent(rec.start, control, entry, progress)));
		phase = "launch";
	} else if (elapsed < loop.launchMs + loop.loopMs) {
		const progress = (elapsed - loop.launchMs) / loop.loopMs;
		const angleRadians = loop.entryAngle + loop.direction * Math.PI * 2 * progress;
		pos = {
			x: loop.cx + loop.rx * Math.cos(angleRadians),
			y: loop.cy + loop.ry * Math.sin(angleRadians),
		};
		const entryAngle = angleFromTangent(entryTangent);
		angle = entryAngle + loop.direction * 360 * progress;
		phase = "loop";
	} else {
		const progress = Math.min(1, (elapsed - loop.launchMs - loop.loopMs) / loop.landMs);
		const easedProgress = easeOut(progress);
		const control = {
			x: entry.x + entryTangent.x / tangentLength * 84,
			y: entry.y + entryTangent.y / tangentLength * 84,
		};
		pos = bezier(entry, control, rec.end, easedProgress);
		angle = clampFlightAngle(angleFromTangent(tangent(entry, control, rec.end, easedProgress))) * (1 - easedProgress);
		phase = "land";
	}

	setFlightTransform(rec, pos, smoothSegmentAngle(rec, phase, angle, now));
	const frames = spriteMap && spriteMap.states && Array.isArray(spriteMap.states.plane) ? spriteMap.states.plane : [];
	const frameMs = (spriteMap && spriteMap.frameMs && spriteMap.frameMs.plane) || 110;
	if (frames.length) {
		const src = frames[Math.floor(elapsed / frameMs) % frames.length] || frames[0];
		if (src) setFrame(rec, src.split("/").pop().replace(/\.png$/, ""));
	}
	if (elapsed >= totalDuration) {
		setFlightTransform(rec, rec.end, 0);
		finishFlight(rec, now);
	}
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
	if (!rec.landed && hasFlightTrajectory(rec.flight)) {
		updatePhysicsPlane(rec, now);
		return;
	}
	if (!rec.landed && hasLoopTrajectory(rec.loop)) {
		updateLoopPlane(rec, now);
		return;
	}
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

	const waOrigin = payload.waOrigin && Number.isFinite(payload.waOrigin.x) && Number.isFinite(payload.waOrigin.y)
		? { x: payload.waOrigin.x, y: payload.waOrigin.y }
		: { x: 0, y: 0 };
	const toLocalPoint = (point) => ({
		x: Number(point && point.x || 0) - waOrigin.x,
		y: Number(point && point.y || 0) - waOrigin.y,
	});
	const toLocalBounds = (bounds) => bounds && {
		x: Number(bounds.x || 0) - waOrigin.x,
		y: Number(bounds.y || 0) - waOrigin.y,
		width: Number(bounds.width || 0),
		height: Number(bounds.height || 0),
	};
	const localLoop = payload.loop && Object.assign({}, payload.loop, {
		cx: Number(payload.loop.cx || 0) - waOrigin.x,
		cy: Number(payload.loop.cy || 0) - waOrigin.y,
	});
	const rec = {
		id,
		el,
		img,
		conversationId: payload.conversationId || "",
		tabId: payload.tabId || "",
		title: payload.title || "",
		start: toLocalPoint(payload.start),
		control: toLocalPoint(payload.control),
		end: toLocalPoint(payload.end),
		duration: Number(payload.duration) || 550,
		loop: localLoop || null,
		flight: payload.flight || null,
		petBounds: toLocalBounds(payload.petBounds),
		physics: null,
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
			conversationId: rec.conversationId || "",
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
