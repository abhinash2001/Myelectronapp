console.log("PRELOAD LOADED!");

const { contextBridge, ipcRenderer } = require("electron");

// ------------------ DATABASE ------------------
contextBridge.exposeInMainWorld("database", {
  getData: () => ipcRenderer.invoke("get-sql-data"),
  getLastMonthData: () => ipcRenderer.invoke("get-last-month-data")
});

// ------------------ EXPORT ------------------
contextBridge.exposeInMainWorld("converter", {
  exportPDF: () => ipcRenderer.send("export-pdf"),
  exportExcel: () => ipcRenderer.send("export-excel"),
  exportWord: () => ipcRenderer.send("export-word")
});

// ------------------ AUTH ------------------
contextBridge.exposeInMainWorld("auth", {
  signup: (data) => ipcRenderer.invoke("signup-user", data),
  login: (data) => ipcRenderer.invoke("login-user", data),
  loginSuccess: () => ipcRenderer.send("login-success"),
  openSignup: () => ipcRenderer.send("open-signup"),
  openLogin: () => ipcRenderer.send("open-login"),
  logout: () => ipcRenderer.send("logout"),
  getCurrentUser: () => ipcRenderer.invoke("get-current-user")
});

console.log("All APIs exposed successfully!");