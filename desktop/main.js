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
let POSITION_FILE = null;

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
const activePlanes = new Map(); // planeId -> plane payload/meta
const interactivePlanes = new Set();
const pendingPlaneSpawns = [];

function clamp(n, min, max) {
	return Math.min(max, Math.max(min, n));
}

function getPositionFile() {
	if (!POSITION_FILE) POSITION_FILE = path.join(app.getPath("userData"), "pet-position.json");
	return POSITION_FILE;
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

function clampToVisibleWorkArea(x, y, width, height) {
	// 至少保留一部分窗口在主显示器工作区内，避免完全跑出屏幕。
	const wa = getPrimaryWorkArea();
	const minX = wa.x - width + 40;
	const maxX = wa.x + wa.width - 40;
	const minY = wa.y - height + 40;
	const maxY = wa.y + wa.height - 40;
	return {
		x: clamp(x, minX, maxX),
		y: clamp(y, minY, maxY),
	};
}

function defaultBottomRightPosition(width, height) {
	const wa = getPrimaryWorkArea();
	return {
		x: wa.x + wa.width - width - DEFAULT_MARGIN,
		y: wa.y + wa.height - height - DEFAULT_MARGIN,
	};
}

function createWindow() {
	const width = 56;
	const height = 56;

	let pos = loadSavedPosition();
	if (!pos) pos = defaultBottomRightPosition(width, height);
	pos = clampToVisibleWorkArea(pos.x, pos.y, width, height);

	mainWindow = new BrowserWindow({
		width,
		height,
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
			contextIsolation: true,
			nodeIntegration: false,
		},
	});

	// 置顶到可悬浮在全屏应用之上的层级，并在所有桌面/空间可见。
	mainWindow.setAlwaysOnTop(true, "screen-saver");
	mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

	mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));

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
	const start = {
		x: Math.round(petBounds.x + petBounds.width - 10),
		y: Math.round(petBounds.y + Math.max(18, petBounds.height * 0.5) - 2),
	};
	const end = pickPlaneTarget();
	const control = {
		x: Math.round((start.x + end.x) / 2 + (Math.random() * 120 - 60)),
		y: Math.round(Math.min(start.y, end.y) - 70 - Math.random() * 70),
	};
	const duration = 450 + Math.round(Math.random() * 250);
	const planeId = `plane-${Date.now()}-${++planeSeq}`;
	const plane = {
		id: planeId,
		conversationId: payload && payload.conversationId ? String(payload.conversationId) : "",
		tabId: payload && payload.tabId ? String(payload.tabId) : "",
		title: payload && payload.title ? String(payload.title) : "",
		start,
		control,
		end,
		duration,
		releaseFrame: Number.isFinite(payload && payload.releaseFrame) ? Number(payload.releaseFrame) : 5,
	};
	activePlanes.set(planeId, plane);
	if (planeReady) {
		planeWindow.webContents.send("nai:plane-spawn", plane);
	} else {
		pendingPlaneSpawns.push(plane);
	}
	return planeId;
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
	activePlanes.delete(id);
	interactivePlanes.delete(id);
	if (planeWindow) {
		planeWindow.webContents.send("nai:plane-remove", { id });
		syncPlaneIgnore();
	}
});

ipcMain.on("plane:open-notion", (_ev, payload) => {
	const tabId = payload && payload.tabId ? payload.tabId : "latest";
	const planeId = payload && payload.id ? String(payload.id) : "";
	if (planeId) activePlanes.delete(planeId);
	if (planeId) interactivePlanes.delete(planeId);
	if (planeWindow) {
		planeWindow.webContents.send("nai:plane-remove", { id: planeId });
		syncPlaneIgnore();
	}
	ipcMain.emit("pet:open-notion", _ev, { tabId });
});

ipcMain.on("pet:resize", (_ev, payload) => {
	if (!mainWindow || !payload) return;
	const w = Math.max(56, Math.round(Number(payload.width) || 56));
	const h = Math.max(56, Math.round(Number(payload.height) || 56));

	const b = mainWindow.getBounds();
	const anchor = lastBounds || b;

	// 右下角锚定：右下角不动，向上向左扩展。
	const right = anchor.x + anchor.width;
	const bottom = anchor.y + anchor.height;
	let x = right - w;
	let y = bottom - h;

	const clamped = clampToVisibleWorkArea(x, y, w, h);
	x = clamped.x;
	y = clamped.y;

	mainWindow.setBounds({ x, y, width: w, height: h }, false);
	lastBounds = { x, y, width: w, height: h };
	savePositionFromWindow();
});

ipcMain.on("pet:drag-start", (_ev, payload) => {
	if (!mainWindow) return;
	dragState = {
		startScreen: {
			x: Number(payload && payload.screenX) || screen.getCursorScreenPoint().x,
			y: Number(payload && payload.screenY) || screen.getCursorScreenPoint().y,
		},
		startBounds: mainWindow.getBounds(),
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
	);
	mainWindow.setPosition(Math.round(next.x), Math.round(next.y), false);
	lastBounds = mainWindow.getBounds();
});

ipcMain.on("pet:drag-end", () => {
	dragState = null;
	savePositionFromWindow();
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
