"use strict";

const { contextBridge, ipcRenderer } = require("electron");
const fs = require("fs");
const path = require("path");
const RENDERER_ROOT = path.resolve(__dirname, "renderer");
const PET_FRAMES_ROOT = fs.realpathSync(path.join(RENDERER_ROOT, "assets", "pet", "frames"));

function loadPetSpriteMap() {
	try {
		const file = path.join(__dirname, "renderer", "assets", "pet", "sprite-map.json");
		return JSON.parse(fs.readFileSync(file, "utf8"));
	} catch (e) {
		return null;
	}
}

function readFrameDataUrl(relPath) {
	if (typeof relPath !== "string" || !relPath || relPath.includes("\0") || path.isAbsolute(relPath)) {
		throw new Error("Invalid sprite frame path");
	}
	const candidate = path.resolve(RENDERER_ROOT, relPath);
	const target = fs.realpathSync(candidate);
	const relative = path.relative(PET_FRAMES_ROOT, target);
	if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || path.extname(target).toLowerCase() !== ".png") {
		throw new Error("Sprite frame path is outside the allowed PNG directory");
	}
	return `data:image/png;base64,${fs.readFileSync(target).toString("base64")}`;
}

contextBridge.exposeInMainWorld("naiBridge", {
	onSnapshot: (cb) => ipcRenderer.on("nai:snapshot", (_e, data) => cb(data)),
	onConnection: (cb) => ipcRenderer.on("nai:connection", (_e, data) => cb(data)),
	onServerError: (cb) => ipcRenderer.on("nai:server-error", (_e, data) => cb(data)),
	onVisibility: (cb) => ipcRenderer.on("nai:visibility", (_e, data) => cb(data)),
	onPlaneSpawn: (cb) => ipcRenderer.on("nai:plane-spawn", (_e, data) => cb(data)),
	onPlaneRemove: (cb) => ipcRenderer.on("nai:plane-remove", (_e, data) => cb(data)),
	onPlaneClear: (cb) => ipcRenderer.on("nai:plane-clear", () => cb()),
	onPlaneIgnore: (cb) => ipcRenderer.on("nai:plane-ignore", (_e, data) => cb(data)),
	loadPetSpriteMap,
	readFrameDataUrl,
	getLayoutContext: () => ipcRenderer.invoke("pet:get-layout-context"),
	getPetSize: () => ipcRenderer.invoke("pet:get-size"),
	setPetSize: (value) => ipcRenderer.invoke("pet:set-size", value),
	openNotion: (payload) => ipcRenderer.send("pet:open-notion", payload),
	resize: (payload) => ipcRenderer.invoke("pet:resize", payload),
	dragStart: (payload) => ipcRenderer.send("pet:drag-start", payload),
	move: (payload) => ipcRenderer.send("pet:move", payload),
	dragEnd: () => ipcRenderer.send("pet:drag-end"),
	setIgnoreMouseEvents: (payload) => ipcRenderer.send("pet:set-ignore-mouse", payload),
	quit: () => ipcRenderer.send("pet:quit"),
	showMenu: () => ipcRenderer.send("pet:show-menu"),
	spawnPlane: (payload) => ipcRenderer.send("pet:spawn-plane", payload),
	planeInteractive: (payload) => ipcRenderer.send("plane:interactive", payload),
	planeOpenNotion: (payload) => ipcRenderer.send("plane:open-notion", payload),
	removePlane: (payload) => ipcRenderer.send("plane:remove", payload),
});
