"use strict";

const { app, BrowserWindow, ipcMain, screen } = require("electron");
const path = require("path");
const fs = require("fs");
const { WebSocketServer } = require("ws");

const WS_PORT = 8787;
const POSITION_FILE = path.join(app.getPath("userData"), "pet-position.json");
const DEFAULT_MARGIN = 24;

let mainWindow = null;
let wss = null;
const clients = new Set();
let lastSnapshot = [];
let lastBounds = null; // {x,y,width,height}

function clamp(n, min, max) {
	return Math.min(max, Math.max(min, n));
}

function getPrimaryWorkArea() {
	return screen.getPrimaryDisplay().workArea;
}

function loadSavedPosition() {
	try {
		const raw = fs.readFileSync(POSITION_FILE, "utf8");
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
		fs.writeFileSync(POSITION_FILE, JSON.stringify({ x: b.x, y: b.y }), "utf8");
	} catch (e) {}
}

function clampToVisibleWorkArea(x, y, width, height) {
	// 只要求至少露出一部分，避免完全跑出屏幕
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
	});

	mainWindow.on("move", () => savePositionFromWindow());

	mainWindow.on("closed", () => {
		mainWindow = null;
	});
}

function startWsServer() {
	wss = new WebSocketServer({ host: "127.0.0.1", port: WS_PORT });

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
				if (mainWindow) mainWindow.webContents.send("nai:snapshot", lastSnapshot);
			}
		});

		socket.on("close", () => {
			clients.delete(socket);
			sendConnectionStatus();
		});

		socket.on("error", () => {
			clients.delete(socket);
		});
	});

	wss.on("error", (err) => {
		const message = err && err.message ? err.message : String(err);
		if (mainWindow) mainWindow.webContents.send("nai:server-error", message);
	});
}

function sendConnectionStatus() {
	if (mainWindow) mainWindow.webContents.send("nai:connection", { connected: clients.size > 0 });
}

function sendToExtension(payload) {
	const data = JSON.stringify(payload);
	for (const c of clients) {
		try {
			c.send(data);
		} catch (e) {}
	}
}

ipcMain.on("pet:open-notion", (_ev, payload) => {
	sendToExtension({
		type: "focus",
		tabId: payload && payload.tabId ? payload.tabId : "latest",
	});
});

ipcMain.on("pet:resize", (_ev, payload) => {
	if (!mainWindow || !payload) return;
	const w = Math.max(56, Math.round(Number(payload.width) || 56));
	const h = Math.max(56, Math.round(Number(payload.height) || 56));

	const b = mainWindow.getBounds();
	const anchor = lastBounds || b;

	// 右下角锚定：右下角不动，向上向左扩展
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
