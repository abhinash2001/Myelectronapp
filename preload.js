const { contextBridge, ipcRenderer } = require("electron");

// ================================
// EXPOSE APIS TO RENDERER
// ================================

contextBridge.exposeInMainWorld("auth", {
  signup: (data) => ipcRenderer.invoke("signup-user", data),
  login: (data) => ipcRenderer.invoke("login-user", data),
  logout: () => ipcRenderer.send("logout"),
  loginSuccess: () => ipcRenderer.send("login-success"),
  openSignup: () => ipcRenderer.send("open-signup"),
  openLogin: () => ipcRenderer.send("open-login")
});

contextBridge.exposeInMainWorld("api", {
  // User management
  getCurrentUser: () => ipcRenderer.invoke("get-current-user"),
  
  // Dashboard data
  getProductionData: (filters) => ipcRenderer.invoke("get-production-data", filters),
  getMachines: () => ipcRenderer.invoke("get-machines"),
  getUniqueIdentifiers: (tableName) => ipcRenderer.invoke("get-unique-identifiers", tableName),
  getAllRecords: (filters) => ipcRenderer.invoke("get-all-records", filters),
  getRecordHistory: (record, tableName) => ipcRenderer.invoke("get-record-history", record, tableName),
  exportData: (data, filters) => ipcRenderer.invoke("export-data", data, filters),
  openSettings: () => ipcRenderer.invoke("open-settings"),
  logout: () => ipcRenderer.send("logout"),
  
  // Database operations
  getTablesList: () => ipcRenderer.invoke("get-tables-list"),
  getPaginatedData: (params) => ipcRenderer.invoke("get-paginated-data", params),
  getStatistics: (params) => ipcRenderer.invoke("get-statistics", params),
  getLastMonthData: (params) => ipcRenderer.invoke("get-last-month-data", params),
  
  // Diagnostic operations
  getTableStructure: (tableName) => ipcRenderer.invoke("get-table-structure", tableName),
  getSampleData: (tableName, limit) => ipcRenderer.invoke("get-sample-data", tableName, limit),
  testProductionQueryDirect: (tableName, filters) => ipcRenderer.invoke("test-production-query-direct", tableName, filters),
  
  // Database settings
  getDBConfig: () => ipcRenderer.invoke("get-db-config"),
  saveDBConfig: (config) => ipcRenderer.invoke("db-save-config", config),
  testConnection: (config) => ipcRenderer.invoke("db-test-connection", config),
  dbLogout: () => ipcRenderer.send("db-logout"),
  
  // Export functions
  exportPDF: () => ipcRenderer.send("export-pdf"),
  exportExcel: () => ipcRenderer.send("export-excel"),
  exportWord: () => ipcRenderer.send("export-word"),
  
  // Settings
  openDBSettings: () => ipcRenderer.send("open-db-settings"),
  
  // Listeners
  onDBConfigUpdated: (callback) => {
    ipcRenderer.on("db-config-updated", callback);
  },
  onDBLoggedOut: (callback) => {
    ipcRenderer.on("db-logged-out", callback);
  },
  onRefreshAfterDBUpdate: (callback) => {
    ipcRenderer.on("refresh-after-db-update", callback);
  }
});