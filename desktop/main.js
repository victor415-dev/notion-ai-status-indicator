"use strict";

const { app, BrowserWindow, ipcMain, screen, Menu, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const { WebSocketServer } = require("ws");

const WS_PORT = 8787;
const HEARTBEAT_MS = 20000;
const HIDE_NO_NOTION_MS = 5000;
const HIDE_DISCONNECTED_MS = 10000;
const DEFAULT_MARGIN = 24;
const DEFAULT_PET_SIZE = 56;
const MIN_PET_SIZE = 40;
const MAX_PET_SIZE = 160;
const WORK_AREA_MARGIN = 8;
let POSITION_FILE = null;
let SETTINGS_FILE = null;
let petSize = DEFAULT_PET_SIZE;

let mainWindow = null;
let wss = null;
let heartbeatTimer = null;
const clients = new Set();
let lastSnapshot = [];
let lastNotionTabs = 0;
let lastBounds = null; // {x,y,width,height}
let dragState = null; // { startScreen, startBounds }
let noNotionHideTimer = null;
let disconnectedHideTimer = null;
let petVisible = true;
let planeWindow = null;
let planeVisible = false;
let planeReady = false;
let planeSeq = 0;
let petMouseIgnored = true;
const activePlanes = new Map(); // planeId -> plane payload/meta
const authoredPlaneCleanupTimers = new Map();
const interactivePlanes = new Set();
const pendingPlaneSpawns = [];

function clamp(n, min, max) {
	return Math.min(max, Math.max(min, n));
}

function getPositionFile() {
	if (!POSITION_FILE) POSITION_FILE = path.join(app.getPath("userData"), "pet-position.json");
	return POSITION_FILE;
}

function getSettingsFile() {
	if (!SETTINGS_FILE) SETTINGS_FILE = path.join(app.getPath("userData"), "pet-settings.json");
	return SETTINGS_FILE;
}

function clampPetSize(value) {
	return clamp(Math.round(Number(value) || DEFAULT_PET_SIZE), MIN_PET_SIZE, MAX_PET_SIZE);
}

function loadSavedPetSize() {
	try {
		const raw = fs.readFileSync(getSettingsFile(), "utf8");
		const data = JSON.parse(raw);
		return clampPetSize(data && data.petSize);
	} catch (e) {
		return DEFAULT_PET_SIZE;
	}
}

function savePetSize() {
	try {
		fs.writeFileSync(getSettingsFile(), JSON.stringify({ petSize }), "utf8");
	} catch (e) {}
}

function getPrimaryWorkArea() {
	return screen.getPrimaryDisplay().workArea;
}

function getPetWorkArea() {
	if (!mainWindow) return getPrimaryWorkArea();
	const display = screen.getDisplayMatching(mainWindow.getBounds());
	return display && display.workArea ? display.workArea : getPrimaryWorkArea();
}

function loadSavedPosition() {
	try {
		const raw = fs.readFileSync(getPositionFile(), "utf8");
		const data = JSON.parse(raw);
		if (!data || typeof data.x !== "number" || typeof data.y !== "number") return null;
		return { x: Math.round(data.x), y: Math.round(data.y) };
	} catch (e) {
		return null;
	}
}

function savePositionFromWindow() {
	if (!mainWindow) return;
	try {
		const b = mainWindow.getBounds();
		fs.writeFileSync(getPositionFile(), JSON.stringify({ x: b.x, y: b.y }), "utf8");
	} catch (e) {}
}

function normalizeLayout(layout) {
	return {
		horizontal: layout && layout.horizontal === "start" ? "start" : "end",
		vertical: layout && layout.vertical === "top" ? "top" : "bottom",
	};
}

function petOffset(width, height, layout, size = petSize) {
	const normalized = normalizeLayout(layout);
	return {
		x: normalized.horizontal === "start" ? 0 : Math.max(0, width - size),
		y: normalized.vertical === "top" ? 0 : Math.max(0, height - size),
	};
}

function workAreaForPet(x, y, size = petSize) {
	const display = screen.getDisplayNearestPoint({ x: x + size / 2, y: y + size / 2 });
	return display && display.workArea ? display.workArea : getPrimaryWorkArea();
}

function clampToVisibleWorkArea(x, y, width, height, layout, size = petSize) {
	const offset = petOffset(width, height, layout, size);
	const wa = workAreaForPet(x + offset.x, y + offset.y, size);
	const maxPetX = Math.max(wa.x + WORK_AREA_MARGIN, wa.x + wa.width - size - WORK_AREA_MARGIN);
	const maxPetY = Math.max(wa.y + WORK_AREA_MARGIN, wa.y + wa.height - size - WORK_AREA_MARGIN);
	const petX = clamp(x + offset.x, wa.x + WORK_AREA_MARGIN, maxPetX);
	const petY = clamp(y + offset.y, wa.y + WORK_AREA_MARGIN, maxPetY);
	let nextX = petX - offset.x;
	let nextY = petY - offset.y;

	// The renderer immediately flips cards around a pet near an edge. Until that
	// rAF update arrives, prioritize the pet click target over temporarily fitting cards.
	return { x: nextX, y: nextY };
}

function defaultBottomRightPosition(width, height) {
	const wa = getPrimaryWorkArea();
	return {
		x: wa.x + wa.width - width - DEFAULT_MARGIN,
		y: wa.y + wa.height - height - DEFAULT_MARGIN,
	};
}

function createWindow() {
	petSize = loadSavedPetSize();
	const width = petSize;
	const height = petSize;

	let pos = loadSavedPosition();
	if (!pos) pos = defaultBottomRightPosition(width, height);
	pos = clampToVisibleWorkArea(pos.x, pos.y, width, height);

	mainWindow = new BrowserWindow({
		width: petSize,
		height: petSize,
		x: pos.x,
		y: pos.y,
		frame: false,
		transparent: true,
		resizable: false,
		skipTaskbar: true,
		alwaysOnTop: true,
		fullscreenable: false,
		hasShadow: false,
		backgroundColor: "#00000000",
		webPreferences: {
			preload: path.join(__dirname, "preload.js"),
			sandbox: false,
			contextIsolation: true,
			nodeIntegration: false,
		},
	});

	// 置顶到可悬浮在全屏应用之上的层级，并在所有桌面/空间可见。
	mainWindow.setAlwaysOnTop(true, "screen-saver");
	mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
	mainWindow.setIgnoreMouseEvents(true, { forward: true });

	mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
	mainWindow.webContents.on("console-message", (_event, _level, message, line, sourceId) => {
		console.log("[NAI-RENDER]", message, `${sourceId || "renderer"}:${line || 0}`);
	});

	mainWindow.webContents.on("did-finish-load", () => {
		mainWindow.webContents.send("nai:snapshot", lastSnapshot);
		mainWindow.webContents.send("nai:connection", { connected: clients.size > 0 });
		broadcastVisibility();
		schedulePetVisibility();
	});

	mainWindow.on("closed", () => {
		mainWindow = null;
	});
}

function setPetMouseIgnored(ignore) {
	if (!mainWindow || petMouseIgnored === ignore) return;
	petMouseIgnored = ignore;
	mainWindow.setIgnoreMouseEvents(ignore, { forward: true });
}

function layoutContext() {
	if (!mainWindow) return null;
	const bounds = mainWindow.getBounds();
	const display = screen.getDisplayMatching(bounds);
	const workArea = display && display.workArea ? display.workArea : getPrimaryWorkArea();
	return { bounds, workArea };
}

function createPlaneWindow() {
	if (planeWindow) return planeWindow;
	const wa = getPrimaryWorkArea();
	planeWindow = new BrowserWindow({
		x: wa.x,
		y: wa.y,
		width: wa.width,
		height: wa.height,
		frame: false,
		transparent: true,
		resizable: false,
		skipTaskbar: true,
		alwaysOnTop: true,
		fullscreenable: false,
		hasShadow: false,
		backgroundColor: "#00000000",
		show: false,
		webPreferences: {
			preload: path.join(__dirname, "preload.js"),
			sandbox: false,
			contextIsolation: true,
			nodeIntegration: false,
		},
	});
	planeWindow.setAlwaysOnTop(true, "screen-saver");
	planeWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
	planeWindow.setIgnoreMouseEvents(true, { forward: true });
	planeWindow.loadFile(path.join(__dirname, "renderer", "planes.html"));
	planeWindow.on("closed", () => {
		planeWindow = null;
		planeVisible = false;
		planeReady = false;
		activePlanes.clear();
	});
	planeWindow.webContents.on("did-finish-load", () => {
		planeReady = true;
		planeWindow.webContents.send("nai:plane-clear");
		planeWindow.webContents.send("nai:plane-ignore", { ignore: true });
		if (petVisible && planeVisible) {
			while (pendingPlaneSpawns.length) {
				const plane = pendingPlaneSpawns.shift();
				planeWindow.webContents.send("nai:plane-spawn", plane);
			}
		} else {
			pendingPlaneSpawns.length = 0;
		}
	});
	return planeWindow;
}

function showPlaneWindow() {
	if (!planeWindow) return;
	const wa = getPetWorkArea();
	planeWindow.setBounds({ x: wa.x, y: wa.y, width: wa.width, height: wa.height }, false);
	if (!planeVisible) {
		planeWindow.showInactive();
		planeVisible = true;
	}
	syncPlaneIgnore();
}

function hidePlaneWindow(reason) {
	if (!planeWindow) return;
	if (planeVisible || planeWindow.isVisible()) {
		planeWindow.hide();
		planeVisible = false;
		console.log("[NAI-PET] plane hidden", reason || "");
	}
	activePlanes.clear();
	interactivePlanes.clear();
	planeWindow.webContents.send("nai:plane-clear");
	planeWindow.webContents.send("nai:plane-ignore", { ignore: true });
}

function broadcastVisibility() {
	if (mainWindow) mainWindow.webContents.send("nai:visibility", { visible: petVisible });
	if (planeWindow) planeWindow.webContents.send("nai:visibility", { visible: petVisible && planeVisible });
}

function syncPlaneIgnore() {
	if (!planeWindow) return;
	const ignore = interactivePlanes.size === 0;
	planeWindow.setIgnoreMouseEvents(ignore, { forward: true });
	planeWindow.webContents.send("nai:plane-ignore", { ignore });
}

function startWsServer() {
	wss = new WebSocketServer({ host: "127.0.0.1", port: WS_PORT });
	startHeartbeat();

	wss.on("connection", (socket) => {
		clients.add(socket);
		sendConnectionStatus();

		socket.on("message", (data) => {
			let msg;
			try {
				msg = JSON.parse(data.toString());
			} catch (e) {
				return;
			}
			if (msg && msg.type === "snapshot") {
				lastSnapshot = Array.isArray(msg.conversations) ? msg.conversations : [];
				lastNotionTabs = Number.isFinite(msg.notionTabs) ? msg.notionTabs : lastNotionTabs;
				console.log("[NAI-PET] snapshot", `n=${lastSnapshot.length}`, `states=${lastSnapshot.map((item) => item && item.state || "unknown").join(",")}`);
				reconcilePlanes(lastSnapshot);
				if (mainWindow) mainWindow.webContents.send("nai:snapshot", lastSnapshot);
				schedulePetVisibility();
			} else if (msg && msg.type === "pong") {
				socket.lastPongAt = Date.now();
			}
		});

		socket.on("close", () => {
			clients.delete(socket);
			sendConnectionStatus();
		});

		socket.on("error", () => {
			clients.delete(socket);
			sendConnectionStatus();
		});
	});

	wss.on("error", (err) => {
		const message = err && err.message ? err.message : String(err);
		if (mainWindow) mainWindow.webContents.send("nai:server-error", message);
	});
}

function startHeartbeat() {
	if (heartbeatTimer) return;
	heartbeatTimer = setInterval(() => {
		sendToExtension({ type: "ping" });
	}, HEARTBEAT_MS);
}

function sendConnectionStatus() {
	if (mainWindow) mainWindow.webContents.send("nai:connection", { connected: clients.size > 0 });
	schedulePetVisibility();
}

function clearPetVisibilityTimers() {
	if (noNotionHideTimer) {
		clearTimeout(noNotionHideTimer);
		noNotionHideTimer = null;
	}
	if (disconnectedHideTimer) {
		clearTimeout(disconnectedHideTimer);
		disconnectedHideTimer = null;
	}
}

function showPet() {
	clearPetVisibilityTimers();
	if (!mainWindow) return;
	if (lastBounds) mainWindow.setBounds(lastBounds, false);
	if (!petVisible || !mainWindow.isVisible()) {
		mainWindow.show();
		petVisible = true;
		console.log("[NAI-PET] pet shown");
	}
	createPlaneWindow();
	showPlaneWindow();
	broadcastVisibility();
}

function hidePet(reason) {
	if (!mainWindow) return;
	if (petVisible || mainWindow.isVisible()) {
		mainWindow.hide();
		petVisible = false;
		console.log("[NAI-PET] pet hidden", reason || "");
	}
	hidePlaneWindow(reason || "pet-hidden");
	interactivePlanes.clear();
	broadcastVisibility();
}

function schedulePetVisibility() {
	if (clients.size > 0 && lastNotionTabs >= 1) {
		showPet();
		return;
	}

	if (noNotionHideTimer) {
		clearTimeout(noNotionHideTimer);
		noNotionHideTimer = null;
	}
	if (disconnectedHideTimer) {
		clearTimeout(disconnectedHideTimer);
		disconnectedHideTimer = null;
	}

	if (clients.size === 0) {
		disconnectedHideTimer = setTimeout(() => {
			disconnectedHideTimer = null;
			if (clients.size === 0) hidePet("disconnected");
		}, HIDE_DISCONNECTED_MS);
		return;
	}

	if (lastNotionTabs < 1) {
		noNotionHideTimer = setTimeout(() => {
			noNotionHideTimer = null;
			if (clients.size > 0 && lastNotionTabs < 1) hidePet("no-notion-tabs");
		}, HIDE_NO_NOTION_MS);
	}
}

function sendToExtension(payload) {
	const data = JSON.stringify(payload);
	let sent = false;
	for (const c of clients) {
		try {
			c.send(data);
			sent = true;
		} catch (e) {}
	}
	return sent;
}

function openNotionFallback() {
	console.log("[NAI-PET] focus fallback openExternal");
	shell.openExternal("https://app.notion.com/chat");
}

function inflateRect(rect, pad) {
	return {
		x: rect.x - pad,
		y: rect.y - pad,
		width: rect.width + pad * 2,
		height: rect.height + pad * 2,
	};
}

function rectContains(rect, x, y) {
	return x >= rect.x && y >= rect.y && x <= rect.x + rect.width && y <= rect.y + rect.height;
}

function distance(a, b) {
	const dx = a.x - b.x;
	const dy = a.y - b.y;
	return Math.sqrt(dx * dx + dy * dy);
}

function pickPlaneTarget() {
	const wa = getPetWorkArea();
	const petBounds = mainWindow ? mainWindow.getBounds() : null;
	const blocked = petBounds ? inflateRect(petBounds, 16) : null;
	const existing = [...activePlanes.values()].map((p) => p.end);
	for (let attempt = 0; attempt < 12; attempt++) {
		const x = Math.round(wa.x + 24 + Math.random() * Math.max(24, wa.width - 48));
		const y = Math.round(wa.y + 24 + Math.random() * Math.max(24, wa.height - 48));
		if (blocked && rectContains(blocked, x, y)) continue;
		if (existing.some((pt) => distance(pt, { x, y }) < 48)) continue;
		return { x, y };
	}
	return {
		x: Math.round(wa.x + wa.width - 48),
		y: Math.round(wa.y + 48),
	};
}

function spawnPlaneFromPet(payload) {
	if (!petVisible || !mainWindow) return null;
	createPlaneWindow();
	if (!planeWindow) return null;
	showPlaneWindow();

	const petBounds = mainWindow.getBounds();
	const wa = getPetWorkArea();
	const petCenterX = petBounds.x + petBounds.width / 2;
	const leftDistance = petCenterX - wa.x;
	const rightDistance = wa.x + wa.width - petCenterX;
	const dirX = leftDistance < 400 && rightDistance >= 400
		? 1
		: rightDistance < 400 && leftDistance >= 400
			? -1
			: leftDistance < 400 || rightDistance < 400
				? (rightDistance >= leftDistance ? 1 : -1)
				: (Math.random() < 0.5 ? 1 : -1);
	const start = {
		x: Math.round(dirX === 1 ? petBounds.x + petBounds.width - 10 : petBounds.x + 10),
		y: Math.round(petBounds.y + Math.max(18, petBounds.height * 0.5) - 2),
	};
	const safetyRadius = 62;
	const directionalSpace = dirX === 1
		? wa.x + wa.width - safetyRadius - start.x
		: start.x - (wa.x + safetyRadius);
	const topSpace = start.y - (wa.y + safetyRadius);
	let authoredType = Math.random() < 0.5 ? "planar-loop-flyout" : "parabolic-land";
	// The authored loop needs its full 990px reference width plus its raised arc.
	if (authoredType === "planar-loop-flyout" && (directionalSpace < 864 || topSpace < 128)) {
		authoredType = "parabolic-land";
	}
	const authoredTrajectory = {
		type: authoredType,
		dirX,
		duration: authoredType === "planar-loop-flyout"
			? 4200 + Math.round(Math.random() * 600)
			: 3000 + Math.round(Math.random() * 800),
		variation: Math.random(),
	};
	const end = pickPlaneTarget();
	const control = {
		x: Math.round((start.x + end.x) / 2 + (Math.random() * 120 - 60)),
		y: Math.round(Math.min(start.y, end.y) - 70 - Math.random() * 70),
	};
	const cx = wa.x + wa.width / 2;
	const cy = wa.y + wa.height / 2;
	const maxRx = Math.max(1, wa.width / 2 - 24);
	const maxRy = Math.max(1, wa.height / 2 - 24);
	const rx = Math.min(maxRx, wa.width * (0.30 + Math.random() * 0.08));
	const ry = Math.min(maxRy, wa.height * (0.28 + Math.random() * 0.08));
	const direction = Math.random() < 0.5 ? 1 : -1;
	const entryAngle = Math.atan2((start.y - cy) / ry, (start.x - cx) / rx);
	const launchMs = 350 + Math.round(Math.random() * 150);
	const loopMs = 1400 + Math.round(Math.random() * 400);
	const landMs = 350 + Math.round(Math.random() * 150);
	const duration = launchMs + loopMs + landMs;
	const loop = { cx, cy, rx, ry, direction, entryAngle, launchMs, loopMs, landMs };
	const theta0 = (25.20088354824111 + Math.random() * 0.75178495957516) * Math.PI / 180;
	const vt = 298.9504947606474 + Math.random() * 14.5757324574512;
	const flight = {
		dirX,
		theta0,
		v0: vt * (2.450929202884436 + Math.random() * 0.149070797115564),
		vt,
		kDrag: 0.054457081109285356 + Math.random() * 0.004744681653798876,
		g: 980.0180427031592 + Math.random() * 46.7171503092862,
		glideMs: 3661 + Math.round(Math.random() * 139),
		maxMs: 8000,
	};
	console.log(
		"[NAI-PET] plane flight",
		`dir=${flight.dirX}`,
		`theta0=${(flight.theta0 * 180 / Math.PI).toFixed(1)}deg`,
		`v0=${Math.round(flight.v0)}`,
		`vt=${Math.round(flight.vt)}`,
		`kDrag=${flight.kDrag.toFixed(2)}`,
	);
	const planeId = `plane-${Date.now()}-${++planeSeq}`;
	const plane = {
		id: planeId,
		conversationId: payload && payload.conversationId ? String(payload.conversationId) : "",
		tabId: payload && payload.tabId ? String(payload.tabId) : "",
		title: payload && payload.title ? String(payload.title) : "",
		start,
		control,
		end,
		duration: authoredTrajectory.duration,
		authoredTrajectory,
		loop,
		flight,
		petBounds: inflateRect(petBounds, 16),
		waOrigin: { x: wa.x, y: wa.y },
		releaseFrame: Number.isFinite(payload && payload.releaseFrame) ? Number(payload.releaseFrame) : 5,
	};
	console.log(
		"[NAI-PET] authored trajectory",
		`type=${authoredTrajectory.type}`,
		`dir=${authoredTrajectory.dirX}`,
		`duration=${authoredTrajectory.duration}`,
	);
	activePlanes.set(planeId, plane);
	if (authoredType === "planar-loop-flyout") {
		const timer = setTimeout(() => removeActivePlane(planeId), authoredTrajectory.duration + 500);
		authoredPlaneCleanupTimers.set(planeId, timer);
	}
	if (planeReady) {
		planeWindow.webContents.send("nai:plane-spawn", plane);
	} else {
		pendingPlaneSpawns.push(plane);
	}
	return planeId;
}

function removeActivePlane(id) {
	const timer = authoredPlaneCleanupTimers.get(id);
	if (timer) clearTimeout(timer);
	authoredPlaneCleanupTimers.delete(id);
	activePlanes.delete(id);
	interactivePlanes.delete(id);
	if (planeWindow) planeWindow.webContents.send("nai:plane-remove", { id });
}

function reconcilePlanes(conversations) {
	const conversationIds = new Set();
	const tabIds = new Set();
	for (const conversation of conversations || []) {
		if (conversation && conversation.conversationId) conversationIds.add(String(conversation.conversationId));
		if (conversation && conversation.tabId != null) tabIds.add(String(conversation.tabId));
	}
	for (const [id, plane] of activePlanes) {
		const present = plane.conversationId
			? conversationIds.has(String(plane.conversationId))
			: tabIds.has(String(plane.tabId));
		if (!present) {
			console.log("[NAI-PET] plane dismissed by snapshot", id, plane.conversationId || plane.tabId || "");
			removeActivePlane(id);
		}
	}
	syncPlaneIgnore();
}

ipcMain.on("pet:open-notion", (_ev, payload) => {
	const tabId = payload && payload.tabId ? payload.tabId : "latest";
	if (tabId === "latest") console.log("[NAI-PET] focus latest sent");
	const sent = sendToExtension({
		type: "focus",
		tabId,
	});
	if (!sent) openNotionFallback();
});

ipcMain.on("pet:spawn-plane", (_ev, payload) => {
	const planeId = spawnPlaneFromPet(payload || {});
	if (!planeId) return;
	console.log("[NAI-PET] spawn plane", planeId, payload && payload.conversationId ? payload.conversationId : payload && payload.tabId ? payload.tabId : "");
});

ipcMain.on("plane:interactive", (_ev, payload) => {
	if (!planeWindow) return;
	const id = payload && payload.id ? String(payload.id) : "";
	const active = Boolean(payload && payload.active);
	if (active) {
		if (id) interactivePlanes.add(id);
	} else {
		if (id) interactivePlanes.delete(id);
	}
	syncPlaneIgnore();
});

ipcMain.on("plane:remove", (_ev, payload) => {
	if (!payload || !payload.id) return;
	const id = String(payload.id);
	removeActivePlane(id);
	syncPlaneIgnore();
});

ipcMain.on("plane:open-notion", (_ev, payload) => {
	const conversationId = payload && payload.conversationId ? String(payload.conversationId) : "";
	const tabId = conversationId ? `conversation:${conversationId}` : payload && payload.tabId ? payload.tabId : "latest";
	const planeId = payload && payload.id ? String(payload.id) : "";
	console.log("[NAI-PET] plane open", planeId, conversationId || tabId);
	if (planeId) removeActivePlane(planeId);
	syncPlaneIgnore();
	ipcMain.emit("pet:open-notion", _ev, { tabId });
});

ipcMain.handle("pet:resize", (_ev, payload) => {
	if (!mainWindow || !payload) return null;
	petSize = clampPetSize(payload.petSize || petSize);
	const w = Math.max(petSize, Math.round(Number(payload.width) || petSize));
	const h = Math.max(petSize, Math.round(Number(payload.height) || petSize));

	const layout = normalizeLayout(payload.layout);
	const current = mainWindow.getBounds();
	const currentOffset = petOffset(current.width, current.height, layout);
	const pet = payload.pet && Number.isFinite(payload.pet.x) && Number.isFinite(payload.pet.y)
		? payload.pet
		: { x: current.x + currentOffset.x, y: current.y + currentOffset.y };
	const offset = petOffset(w, h, layout);
	const clamped = clampToVisibleWorkArea(pet.x - offset.x, pet.y - offset.y, w, h, layout, petSize);
	const x = clamped.x;
	const y = clamped.y;

	console.log("[NAI-PET] resize", `w=${w}`, `h=${h}`, `cards=${Math.max(0, Number(payload.cards) || 0)}`);
	mainWindow.setBounds({ x, y, width: w, height: h }, false);
	lastBounds = { x, y, width: w, height: h };
	savePositionFromWindow();
	return lastBounds;
});

ipcMain.on("pet:drag-start", (_ev, payload) => {
	if (!mainWindow) return;
	setPetMouseIgnored(false);
	dragState = {
		startScreen: {
			x: Number(payload && payload.screenX) || screen.getCursorScreenPoint().x,
			y: Number(payload && payload.screenY) || screen.getCursorScreenPoint().y,
		},
		startBounds: mainWindow.getBounds(),
		layout: normalizeLayout(payload && payload.layout),
	};
});

ipcMain.on("pet:move", (_ev, payload) => {
	if (!mainWindow || !dragState) return;
	const screenX = Number(payload && payload.screenX);
	const screenY = Number(payload && payload.screenY);
	const cursor = Number.isFinite(screenX) && Number.isFinite(screenY)
		? { x: screenX, y: screenY }
		: screen.getCursorScreenPoint();
	const dx = cursor.x - dragState.startScreen.x;
	const dy = cursor.y - dragState.startScreen.y;
	const next = clampToVisibleWorkArea(
		dragState.startBounds.x + dx,
		dragState.startBounds.y + dy,
		dragState.startBounds.width,
		dragState.startBounds.height,
		dragState.layout,
	);
	mainWindow.setPosition(Math.round(next.x), Math.round(next.y), false);
	lastBounds = mainWindow.getBounds();
});

ipcMain.on("pet:drag-end", () => {
	dragState = null;
	savePositionFromWindow();
});

ipcMain.on("pet:set-ignore-mouse", (_ev, payload) => {
	const ignore = !payload || payload.ignore !== false;
	if (ignore && dragState) return;
	setPetMouseIgnored(ignore);
});

ipcMain.handle("pet:get-layout-context", () => layoutContext());

ipcMain.handle("pet:get-size", () => petSize);

ipcMain.handle("pet:set-size", (_ev, value) => {
	petSize = clampPetSize(value);
	savePetSize();
	return petSize;
});

ipcMain.on("pet:show-menu", () => {
	const menu = Menu.buildFromTemplate([
		{ label: "退出", click: () => app.quit() },
	]);
	menu.popup({ window: mainWindow || undefined });
});

ipcMain.on("pet:quit", () => {
	app.quit();
});

app.whenReady().then(() => {
	createWindow();
	startWsServer();
	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) createWindow();
	});
});

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") app.quit();
});
