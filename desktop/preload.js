"use strict";

const { contextBridge, ipcRenderer } = require("electron");
const fs = require("fs");
const path = require("path");

function loadPetSpriteMap() {
	try {
		const file = path.join(__dirname, "renderer", "assets", "pet", "sprite-map.json");
		return JSON.parse(fs.readFileSync(file, "utf8"));
	} catch (e) {
		return null;
	}
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
	openNotion: (payload) => ipcRenderer.send("pet:open-notion", payload),
	resize: (payload) => ipcRenderer.send("pet:resize", payload),
	dragStart: (payload) => ipcRenderer.send("pet:drag-start", payload),
	move: (payload) => ipcRenderer.send("pet:move", payload),
	dragEnd: () => ipcRenderer.send("pet:drag-end"),
	quit: () => ipcRenderer.send("pet:quit"),
	showMenu: () => ipcRenderer.send("pet:show-menu"),
	spawnPlane: (payload) => ipcRenderer.send("pet:spawn-plane", payload),
	planeInteractive: (payload) => ipcRenderer.send("plane:interactive", payload),
	planeOpenNotion: (payload) => ipcRenderer.send("plane:open-notion", payload),
	removePlane: (payload) => ipcRenderer.send("plane:remove", payload),
});
