"use strict";

const petEl = document.getElementById("pet");
const appEl = document.getElementById("app");
const cardsEl = document.getElementById("cards");
const collapseEl = document.getElementById("collapse");
const badgeEl = document.getElementById("badge");
const petSpriteEl = document.getElementById("pet-sprite");

const DRAG_THRESHOLD_PX = 4;
const PET_SIZE = 56;
const LAYOUT_MARGIN = 8;
const HIT_ALPHA_THRESHOLD = 16;
const SPRITE_WHITE_THRESHOLD = 235;
const SPRITE_BACKGROUND_DELTA = 20;
const FLOATING_SPECK_MAX_AREA = 400;
const FLOATING_SPECK_MAX_HEIGHT = 20;
const TOP_GLYPH_BAND_UPWARD_PADDING = 10;
const TOP_GLYPH_BAND_BODY_FRACTION = 0.40;
const TOP_GLYPH_OPENING_RADIUS = 2;

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
const thrownKeys = new Set();
const spriteFrameDataUrls = new Map();
const spriteFrameLoads = new Map();
const spriteFrameMasks = new Map();
let spriteFrameRequest = 0;
let currentSpriteMask = null;
let petMouseIgnored = null;
let lastPointer = null;
let layoutState = { below: false, horizontal: "end" };
let layoutFrame = 0;
let layoutRequest = 0;
let cardLayoutSignature = "";
let pendingCardReveal = null;
let cardRevealTimer = 0;
const CARD_REVEAL_TIMEOUT_MS = 300;
const CARD_REVEAL_TOLERANCE = 2;

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

function sampledBackground(data, width, height) {
	const corners = [0, width - 1, (height - 1) * width, width * height - 1];
	return [0, 1, 2].map((channel) => {
		const values = corners.map((pixel) => data[pixel * 4 + channel]).sort((a, b) => a - b);
		return values[Math.floor(values.length / 2)];
	});
}

function opaqueComponents(data, width, height) {
	const seen = new Uint8Array(width * height);
	const components = [];
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const start = y * width + x;
			if (seen[start] || data[start * 4 + 3] === 0) continue;
			const queue = [start];
			const pixels = [];
			seen[start] = 1;
			let left = x;
			let top = y;
			let right = x;
			let bottom = y;
			for (let head = 0; head < queue.length; head += 1) {
				const pixel = queue[head];
				const pointX = pixel % width;
				const pointY = Math.floor(pixel / width);
				pixels.push(pixel);
				left = Math.min(left, pointX);
				top = Math.min(top, pointY);
				right = Math.max(right, pointX);
				bottom = Math.max(bottom, pointY);
				for (const [offsetX, offsetY] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
					const nextX = pointX + offsetX;
					const nextY = pointY + offsetY;
					if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) continue;
					const next = nextY * width + nextX;
					if (seen[next] || data[next * 4 + 3] === 0) continue;
					seen[next] = 1;
					queue.push(next);
				}
			}
			components.push({ pixels, left, top, right, bottom });
		}
	}
	return components.sort((a, b) => b.pixels.length - a.pixels.length);
}

function stripFloatingSpecks(canvas, context) {
	const { width, height } = canvas;
	const imageData = context.getImageData(0, 0, width, height);
	const { data } = imageData;
	const components = opaqueComponents(data, width, height);
	if (!components.length) return 0;
	const body = components[0];
	const specks = components.slice(1).filter((component) => (
		component.top < body.top
		&& component.pixels.length < FLOATING_SPECK_MAX_AREA
		&& component.bottom - component.top + 1 < FLOATING_SPECK_MAX_HEIGHT
	));
	for (const speck of specks) {
		for (const pixel of speck.pixels) data[pixel * 4 + 3] = 0;
	}
	if (specks.length) context.putImageData(imageData, 0, 0);
	return specks.length;
}

function topGlyphBand(body, height) {
	const bodyHeight = body.bottom - body.top + 1;
	return {
		top: Math.max(0, body.top - TOP_GLYPH_BAND_UPWARD_PADDING),
		bottom: Math.min(height - 1, body.top + Math.ceil(bodyHeight * TOP_GLYPH_BAND_BODY_FRACTION) - 1),
	};
}

function openAlphaMask(mask, width, height, radius) {
	const eroded = new Uint8Array(mask.length);
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const pixel = y * width + x;
			if (!mask[pixel]) continue;
			let survives = true;
			for (let offsetY = -radius; offsetY <= radius && survives; offsetY += 1) {
				for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
					const nextX = x + offsetX;
					const nextY = y + offsetY;
					if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height || !mask[nextY * width + nextX]) {
						survives = false;
						break;
					}
				}
			}
			if (survives) eroded[pixel] = 1;
		}
	}

	const opened = new Uint8Array(mask.length);
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			if (!eroded[y * width + x]) continue;
			for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
				for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
					const nextX = x + offsetX;
					const nextY = y + offsetY;
					if (nextX >= 0 && nextX < width && nextY >= 0 && nextY < height) opened[nextY * width + nextX] = 1;
				}
			}
		}
	}
	return opened;
}

function stripTopBandGlyphs(canvas, context) {
	const { width, height } = canvas;
	const imageData = context.getImageData(0, 0, width, height);
	const { data } = imageData;
	const components = opaqueComponents(data, width, height);
	if (!components.length) return 0;
	const band = topGlyphBand(components[0], height);
	const mask = new Uint8Array(width * height);
	for (let pixel = 0; pixel < mask.length; pixel += 1) mask[pixel] = data[pixel * 4 + 3] > 0 ? 1 : 0;
	const opened = openAlphaMask(mask, width, height, TOP_GLYPH_OPENING_RADIUS);
	let stripped = 0;
	for (let y = band.top; y <= band.bottom; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const pixel = y * width + x;
			if (!mask[pixel] || opened[pixel]) continue;
			const offset = pixel * 4;
			data[offset] = 0;
			data[offset + 1] = 0;
			data[offset + 2] = 0;
			data[offset + 3] = 0;
			stripped += 1;
		}
	}
	if (stripped) context.putImageData(imageData, 0, 0);
	return stripped;
}

function keySpriteBackground(canvas, context, whiteThreshold = SPRITE_WHITE_THRESHOLD, backgroundDelta = SPRITE_BACKGROUND_DELTA) {
	const { width, height } = canvas;
	const imageData = context.getImageData(0, 0, width, height);
	const { data } = imageData;
	const background = sampledBackground(data, width, height);
	const queued = new Uint8Array(width * height);
	const queue = [];

	const isKeyColor = (pixel) => {
		const offset = pixel * 4;
		const red = data[offset];
		const green = data[offset + 1];
		const blue = data[offset + 2];
		const alpha = data[offset + 3];
		if (alpha === 0) return true;
		const nearWhite = red >= whiteThreshold && green >= whiteThreshold && blue >= whiteThreshold;
		const nearCorner = Math.max(
			Math.abs(red - background[0]),
			Math.abs(green - background[1]),
			Math.abs(blue - background[2]),
		) <= backgroundDelta;
		return nearWhite || nearCorner;
	};

	const enqueue = (pixel) => {
		if (pixel < 0 || pixel >= width * height || queued[pixel] || !isKeyColor(pixel)) return;
		queued[pixel] = 1;
		queue.push(pixel);
	};

	for (let x = 0; x < width; x += 1) {
		enqueue(x);
		enqueue((height - 1) * width + x);
	}
	for (let y = 1; y < height - 1; y += 1) {
		enqueue(y * width);
		enqueue(y * width + width - 1);
	}

	for (let head = 0; head < queue.length; head += 1) {
		const pixel = queue[head];
		const x = pixel % width;
		const y = Math.floor(pixel / width);
		if (x > 0) enqueue(pixel - 1);
		if (x < width - 1) enqueue(pixel + 1);
		if (y > 0) enqueue(pixel - width);
		if (y < height - 1) enqueue(pixel + width);
	}

	for (let pixel = 0; pixel < queued.length; pixel += 1) {
		if (!queued[pixel]) continue;
		const offset = pixel * 4;
		data[offset] = 0;
		data[offset + 1] = 0;
		data[offset + 2] = 0;
		data[offset + 3] = 0;
	}
	context.putImageData(imageData, 0, 0);
}

function hasOpaqueSpriteCorner(canvas, context) {
	const { width, height } = canvas;
	const { data } = context.getImageData(0, 0, width, height);
	const corners = [0, width - 1, (height - 1) * width, width * height - 1];
	return corners.some((pixel) => data[pixel * 4 + 3] > 0);
}

function outlineSprite(canvas, context) {
	const { width, height } = canvas;
	const imageData = context.getImageData(0, 0, width, height);
	const { data } = imageData;
	const entity = new Uint8Array(width * height);
	let opaquePixels = 0;
	let outlinePixels = 0;

	for (let pixel = 0; pixel < entity.length; pixel += 1) {
		if (data[pixel * 4 + 3] <= 16) continue;
		entity[pixel] = 1;
		opaquePixels += 1;
	}

	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const pixel = y * width + x;
			if (entity[pixel]) continue;
			let touchesEntity = false;
			for (let offsetY = -2; offsetY <= 2 && !touchesEntity; offsetY += 1) {
				for (let offsetX = -2; offsetX <= 2; offsetX += 1) {
					if (offsetX === 0 && offsetY === 0) continue;
					const neighborX = x + offsetX;
					const neighborY = y + offsetY;
					if (neighborX < 0 || neighborX >= width || neighborY < 0 || neighborY >= height) continue;
					if (entity[neighborY * width + neighborX]) {
						touchesEntity = true;
						break;
					}
				}
			}
			if (!touchesEntity) continue;
			const pixelOffset = pixel * 4;
			data[pixelOffset] = 20;
			data[pixelOffset + 1] = 24;
			data[pixelOffset + 2] = 32;
			data[pixelOffset + 3] = 235;
			outlinePixels += 1;
		}
	}

	context.putImageData(imageData, 0, 0);
	return { opaquePixels, outlinePixels };
}

function captureSpriteMask(canvas, context) {
	const { width, height } = canvas;
	const { data } = context.getImageData(0, 0, width, height);
	const alpha = new Uint8Array(width * height);
	for (let pixel = 0; pixel < alpha.length; pixel += 1) alpha[pixel] = data[pixel * 4 + 3];
	return { width, height, alpha };
}

function loadKeyedSprite(relPath) {
	if (spriteFrameDataUrls.has(relPath)) return Promise.resolve(spriteFrameDataUrls.get(relPath));
	if (spriteFrameLoads.has(relPath)) return spriteFrameLoads.get(relPath);

	let source;
	try {
		if (!window.naiBridge || typeof window.naiBridge.readFrameDataUrl !== "function") {
			throw new Error("sprite frame data bridge unavailable");
		}
		source = window.naiBridge.readFrameDataUrl(relPath);
	} catch (error) {
		return Promise.reject(error);
	}
	const load = new Promise((resolve, reject) => {
		const image = new Image();
		image.onload = () => {
			try {
				const canvas = document.createElement("canvas");
				canvas.width = image.naturalWidth || 192;
				canvas.height = image.naturalHeight || 192;
				const context = canvas.getContext("2d", { willReadFrequently: true });
				if (!context) throw new Error("2d canvas unavailable");
				context.drawImage(image, 0, 0, canvas.width, canvas.height);
				const strippedSpecks = stripFloatingSpecks(canvas, context);
				if (strippedSpecks) console.info("[NAI-PET] stripped", strippedSpecks, "specks", relPath);
				const strippedGlyphBand = stripTopBandGlyphs(canvas, context);
				if (strippedGlyphBand) console.info("[NAI-PET] stripped glyph band", `px=${strippedGlyphBand}`, relPath);
				keySpriteBackground(canvas, context);
				if (hasOpaqueSpriteCorner(canvas, context)) {
					console.warn("[NAI-PET] sprite plate residual", relPath);
					keySpriteBackground(canvas, context, 220, 32);
				}
				const { opaquePixels, outlinePixels } = outlineSprite(canvas, context);
				console.info("[NAI-PET] sprite keyed", relPath, `opaque=${opaquePixels}`, `outlinePx=${outlinePixels}`);
				spriteFrameMasks.set(relPath, captureSpriteMask(canvas, context));
				const dataUrl = canvas.toDataURL("image/png");
				spriteFrameDataUrls.set(relPath, dataUrl);
				resolve(dataUrl);
			} catch (error) {
				reject(error);
			}
		};
		image.onerror = () => reject(new Error("image load failed"));
		image.src = source;
	});

	spriteFrameLoads.set(relPath, load);
	return load.finally(() => spriteFrameLoads.delete(relPath));
}

function setSpriteFrame(relPath) {
	if (!petSpriteEl || !relPath) return;
	const request = ++spriteFrameRequest;
	loadKeyedSprite(relPath)
		.then((dataUrl) => {
			if (request !== spriteFrameRequest || petSpriteEl.getAttribute("src") === dataUrl) return;
			currentSpriteMask = spriteFrameMasks.get(relPath) || null;
			petSpriteEl.setAttribute("src", dataUrl);
			updatePointerInteractivity(lastPointer);
		})
		.catch((error) => {
			if (request !== spriteFrameRequest) return;
			console.warn("[NAI-PET] sprite pipeline failed", relPath, error && (error.stack || error.message || String(error)));
			currentSpriteMask = null;
			const fallback = `./${relPath}`;
			if (petSpriteEl.getAttribute("src") !== fallback) petSpriteEl.setAttribute("src", fallback);
			updatePointerInteractivity(lastPointer);
		});
}

function isOpaqueSpritePoint(mask, point, rect) {
	if (!mask || !rect || !rect.width || !rect.height) return true;
	const x = Math.floor((point.clientX - rect.left) * mask.width / rect.width);
	const y = Math.floor((point.clientY - rect.top) * mask.height / rect.height);
	if (x < 0 || x >= mask.width || y < 0 || y >= mask.height) return false;
	return mask.alpha[y * mask.width + x] >= HIT_ALPHA_THRESHOLD;
}

function setPetMouseIgnore(ignore) {
	if (petMouseIgnored === ignore || !window.naiBridge || typeof window.naiBridge.setIgnoreMouseEvents !== "function") return;
	petMouseIgnored = ignore;
	window.naiBridge.setIgnoreMouseEvents({ ignore });
}

function updatePointerInteractivity(point) {
	try {
		if (!point) return;
		lastPointer = { clientX: point.clientX, clientY: point.clientY };
		const target = document.elementFromPoint(point.clientX, point.clientY);
		const control = target && target.closest && target.closest(".card, #collapse, #badge");
		const inPet = target && target.closest && target.closest("#pet");
		const interactive = Boolean(control) || (Boolean(inPet) && isOpaqueSpritePoint(currentSpriteMask, point, petSpriteEl.getBoundingClientRect()));
		if (drag) {
			setPetMouseIgnore(false);
			return;
		}
		setPetMouseIgnore(!interactive);
	} catch (error) {
		console.warn("[NAI-PET] pointer hit test failed", error && (error.stack || error.message || String(error)));
	}
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
	const keys = activeThrow && activeThrow.keys;
	activeThrow = null;
	for (const key of keys || []) queuedThrowKeys.delete(key);
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
	if (!throwMeta || !throwMeta.key) return;
	const keys = throwMeta.keys || [throwMeta.key];
	if (keys.some((key) => thrownKeys.has(key))) {
		console.info("[NAI-PET] throw deduped", throwMeta.key);
		return;
	}
	if (keys.some((key) => queuedThrowKeys.has(key))) return;
	if (activeThrow && keys.some((key) => activeThrow.keys && activeThrow.keys.includes(key))) return;
	if (throwQueue.length >= 3) return;
	for (const key of keys) {
		queuedThrowKeys.add(key);
		thrownKeys.add(key);
	}
	throwQueue.push(throwMeta);
	console.info("[NAI-PET] throw queued", throwMeta.key);
	pumpThrowQueue();
}

function snapshotKeys(conversation) {
	const tabKey = conversation && conversation.tabId != null && conversation.tabId !== "" ? String(conversation.tabId) : "";
	const conversationKey = conversation && conversation.conversationId ? String(conversation.conversationId) : "";
	const keys = Array.from(new Set([conversationKey, tabKey].filter(Boolean)));
	return { key: conversationKey || tabKey, keys };
}

function armThrowKeys(keys, label) {
	let armed = false;
	for (const key of keys) {
		if (!thrownKeys.delete(key)) continue;
		queuedThrowKeys.delete(key);
		armed = true;
	}
	if (armed) console.info("[NAI-PET] throw armed", label);
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
		const identity = snapshotKeys(c);
		if (!identity.key) continue;
		for (const key of identity.keys) nextStates.set(key, c.state);
		if (isRunning(c.state)) waiting = true;
		if (isRunning(c.state)) armThrowKeys(identity.keys, identity.key);
		if (spriteInitialized) {
			const wasDone = identity.keys.some((key) => spritePrevStates.get(key) === "done");
			if (!wasDone && c.state === "done") {
				queueThrow({
					key: identity.key,
					keys: identity.keys,
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
		setPetMouseIgnore(true);
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
	const petH = PET_SIZE;
	const petW = PET_SIZE;
	const gap = 8;
	const badgeH = showBadge ? 20 + gap : 0;
	const arrowH = showArrow ? 24 + gap : 0;
	const cardH = cardCount > 0 ? cardCount * 64 + (cardCount - 1) * gap + gap : 0;
	const w = cardCount > 0 ? 280 : petW;
	const h = petH + badgeH + arrowH + cardH;
	return { width: Math.max(petW, w), height: Math.max(petH, h) };
}

function layoutPayload() {
	return {
		horizontal: layoutState.horizontal,
		vertical: layoutState.below ? "top" : "bottom",
	};
}

function petBoundsForContext(context, layout = layoutState) {
	const { bounds } = context;
	return {
		x: bounds.x + (layout.horizontal === "start" ? 0 : Math.max(0, bounds.width - PET_SIZE)),
		y: bounds.y + (layout.below ? 0 : Math.max(0, bounds.height - PET_SIZE)),
	};
}

function nextLayout(context, size) {
	if (!context || !context.bounds || !context.workArea) return layoutState;
	const pet = petBoundsForContext(context);
	const wa = context.workArea;
	const right = wa.x + wa.width;
	const bottom = wa.y + wa.height;
	let horizontal = layoutState.horizontal;
	let below = layoutState.below;

	if (pet.x - (size.width - PET_SIZE) < wa.x + LAYOUT_MARGIN) horizontal = "start";
	else if (pet.x + size.width > right - LAYOUT_MARGIN) horizontal = "end";

	if (pet.y - (size.height - PET_SIZE) < wa.y + LAYOUT_MARGIN) below = true;
	else if (pet.y + size.height > bottom - LAYOUT_MARGIN) below = false;

	return { below, horizontal };
}

function applyLayout(next) {
	layoutState = next;
	appEl.classList.toggle("layout-cards-below", next.below);
	appEl.classList.toggle("layout-align-start", next.horizontal === "start");
	appEl.classList.toggle("layout-align-end", next.horizontal === "end");
}

function setCardsLayoutPending(pending) {
	cardsEl.classList.toggle("is-layout-pending", pending);
	collapseEl.classList.toggle("is-layout-pending", pending);
	badgeEl.classList.toggle("is-layout-pending", pending);
}

function targetSizeReached(size) {
	return window.innerWidth >= size.width - CARD_REVEAL_TOLERANCE
		&& window.innerHeight >= size.height - CARD_REVEAL_TOLERANCE;
}

function clearPendingCardReveal() {
	if (cardRevealTimer) clearTimeout(cardRevealTimer);
	cardRevealTimer = 0;
	pendingCardReveal = null;
}

function revealCardsWhenBoundsApplied() {
	if (!pendingCardReveal || collapsed || !visibleCards(snapshot).length) return;
	if (!targetSizeReached(pendingCardReveal.size)) return;
	clearPendingCardReveal();
	setCardsLayoutPending(false);
}

function waitForCardBounds(size) {
	if (targetSizeReached(size)) {
		clearPendingCardReveal();
		setCardsLayoutPending(false);
		return;
	}
	clearPendingCardReveal();
	pendingCardReveal = { size };
	setCardsLayoutPending(true);
	cardRevealTimer = setTimeout(() => {
		if (!pendingCardReveal) return;
		console.warn("[NAI-PET] reveal timeout", `w=${pendingCardReveal.size.width}`, `h=${pendingCardReveal.size.height}`);
		clearPendingCardReveal();
		setCardsLayoutPending(false);
	}, CARD_REVEAL_TIMEOUT_MS);
}

function resizePetForLayout(payload) {
	return Promise.resolve(window.naiBridge.resize(payload))
		.catch((error) => console.warn("[NAI-PET] resize failed", error && (error.stack || error.message || String(error))));
}

function scheduleLayoutResize() {
	if (layoutFrame) return;
	layoutFrame = requestAnimationFrame(() => {
		layoutFrame = 0;
		const list = visibleCards(snapshot);
		const size = computeSize(collapsed ? 0 : list.length, !collapsed && list.length > 0, collapsed && list.length > 0);
		const request = ++layoutRequest;
		if (!window.naiBridge || typeof window.naiBridge.getLayoutContext !== "function") {
			resizePetForLayout({ ...size, cards: list.length, layout: layoutPayload() });
			return;
		}
		window.naiBridge.getLayoutContext()
			.then((context) => {
				if (request !== layoutRequest) return;
				const pet = context ? petBoundsForContext(context) : null;
				applyLayout(nextLayout(context, size));
				return resizePetForLayout({ ...size, cards: list.length, layout: layoutPayload(), pet });
			})
			.catch(() => resizePetForLayout({ ...size, cards: list.length, layout: layoutPayload() }));
	});
}

function updateWindowSize() {
	scheduleLayoutResize();
}

function cardKey(conversation) {
	return conversation && (conversation.conversationId || String(conversation.tabId || ""));
}

function createCard() {
	const card = document.createElement("div");
	card.className = "card";
	card.addEventListener("click", () => {
		window.naiBridge.openNotion({ tabId: card.dataset.focusTarget || "latest" });
	});

	const ind = document.createElement("span");
	ind.className = "ind";
	const main = document.createElement("div");
	const title = document.createElement("div");
	title.className = "card-title";
	const sub = document.createElement("div");
	sub.className = "card-sub";
	main.appendChild(title);
	main.appendChild(sub);
	card.appendChild(ind);
	card.appendChild(main);
	return card;
}

function updateCard(card, conversation, key) {
	card.dataset.key = key;
	card.dataset.focusTarget = conversation.conversationId ? `conversation:${conversation.conversationId}` : String(conversation.tabId || "");
	const ind = card.querySelector(".ind");
	const title = card.querySelector(".card-title");
	const sub = card.querySelector(".card-sub");
	ind.className = "ind " + (isRunning(conversation.state) ? "run spin" : (conversation.state === "done" ? "done" : ""));
	ind.textContent = conversation.state === "done" ? "✓" : "";
	title.textContent = truncate(normalizeTitle(conversation.title), 16);
	sub.textContent = truncate(replyPreview(conversation), 42);
}

function reconcileCards(list) {
	const existing = new Map(Array.from(cardsEl.children).map((card) => [card.dataset.key, card]));
	for (const conversation of list) {
		const key = cardKey(conversation);
		let card = existing.get(key);
		if (card) existing.delete(key);
		else card = createCard();
		updateCard(card, conversation, key);
		cardsEl.appendChild(card);
	}
	for (const card of existing.values()) card.remove();
}

function render() {
	const list = sorted(visibleCards(snapshot));
	const hasCards = list.length > 0;
	if (!hasCards) collapsed = false;
	const isExpanded = hasCards && !collapsed;
	const size = computeSize(collapsed ? 0 : list.length, isExpanded, collapsed && hasCards);
	const layoutSignature = `${isExpanded ? "expanded" : collapsed ? "collapsed" : "empty"}:${list.length}:${size.width}x${size.height}`;
	const layoutChanged = layoutSignature !== cardLayoutSignature;
	cardLayoutSignature = layoutSignature;

	cardsEl.hidden = collapsed || !hasCards;
	collapseEl.hidden = collapsed || !hasCards;
	badgeEl.hidden = !collapsed || !hasCards;

	if (!hasCards) {
		clearPendingCardReveal();
		setCardsLayoutPending(false);
		updateWindowSize();
		return;
	}

	if (collapsed) {
		clearPendingCardReveal();
		setCardsLayoutPending(false);
		badgeEl.textContent = String(list.length);
		updateWindowSize();
		return;
	}

	if (layoutChanged) waitForCardBounds(size);
	reconcileCards(list);

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
	window.naiBridge.dragStart({ screenX: e.screenX, screenY: e.screenY, layout: layoutPayload() });
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
	updatePointerInteractivity(e);
	if (!drag) return;
	if (totalDragDistance(e) >= DRAG_THRESHOLD_PX) {
		drag.moved = true;
		drag.movingWindow = true;
		spriteDragging = true;
		petEl.classList.add("is-dragging");
		window.naiBridge.move({ screenX: e.screenX, screenY: e.screenY });
		scheduleLayoutResize();
	}
});

window.addEventListener("mouseout", (e) => {
	if (!e.relatedTarget && !drag) setPetMouseIgnore(true);
});

window.addEventListener("resize", () => {
	revealCardsWhenBoundsApplied();
});

window.addEventListener("mouseup", (e) => {
	if (!drag) return;
	const wasClick = totalDragDistance(e) < DRAG_THRESHOLD_PX;
	const movedWindow = drag.movingWindow;
	drag = null;
	spriteDragging = false;
	petEl.classList.remove("is-dragging");
	window.naiBridge.dragEnd();
	scheduleLayoutResize();
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
	console.info("[NAI-PET] snapshot", `n=${snapshot.length}`, `states=${snapshot.map((item) => item && item.state || "unknown").join(",")}`);
	try {
		render();
		syncSnapshotTransitions(snapshot);
		updateWindowSize();
	} catch (error) {
		console.error("[NAI-PET] snapshot render failed", error && (error.stack || error.message || String(error)));
	}
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
