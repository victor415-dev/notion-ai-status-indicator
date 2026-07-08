"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("naiBridge", {
	onSnapshot: (cb) => ipcRenderer.on("nai:snapshot", (_e, data) => cb(data)),
	onConnection: (cb) => ipcRenderer.on("nai:connection", (_e, data) => cb(data)),
	onServerError: (cb) => ipcRenderer.on("nai:server-error", (_e, data) => cb(data)),
	openNotion: (payload) => ipcRenderer.send("pet:open-notion", payload),
	resize: (payload) => ipcRenderer.send("pet:resize", payload),
	quit: () => ipcRenderer.send("pet:quit"),
	showMenu: () => ipcRenderer.send("pet:show-menu"),
});
