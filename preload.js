console.log("PRELOAD LOADED!");

const { contextBridge, ipcRenderer } = require("electron");

// ------------------ DATABASE ------------------
contextBridge.exposeInMainWorld("database", {
  getTablesList: () => ipcRenderer.invoke("get-tables-list"),
  getPaginatedData: (params) => ipcRenderer.invoke("get-paginated-data", params),
  getStatistics: (params) => ipcRenderer.invoke("get-statistics", params),
  getLastMonthData: (params) => ipcRenderer.invoke("get-last-month-data", params),

  // ✅ FIXED — use correct handler name
  getDBConfig: () => ipcRenderer.invoke("get-db-config"),

  // These are correct already
  saveDBConfig: (config) => ipcRenderer.invoke("db-save-config", config),
  testDBConnection: (config) => ipcRenderer.invoke("db-test-connection", config),

  openDBSettings: () => ipcRenderer.send("open-db-settings"),
  logoutDB: () => ipcRenderer.send("db-logout"),
  notifyDBUpdated: () => ipcRenderer.send("db-updated"),



  
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

ipcRenderer.on("db-logged-out", () => {
  console.log("Database logged out signal received.");
});

ipcRenderer.on("refresh-after-db-update", () => {
  window.dispatchEvent(new Event("db-updated"));
});
