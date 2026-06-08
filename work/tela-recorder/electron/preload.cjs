const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("recorder", {
  invoke(command, payload) {
    return ipcRenderer.invoke("recorder:invoke", command, payload);
  },
  onCommand(callback) {
    const listener = (_event, command) => callback(command);
    ipcRenderer.on("recorder-command", listener);
    return () => ipcRenderer.removeListener("recorder-command", listener);
  },
});
