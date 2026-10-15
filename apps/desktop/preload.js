"use strict";
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("keir", { connect: value => ipcRenderer.invoke("connect", value) });
