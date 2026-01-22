const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const sqlite3 = require("sqlite3").verbose();
const sql = require("msnodesqlv8");
const ExcelJS = require("exceljs");
const { Document, Packer, Paragraph, Table, TableRow, TableCell } = require("docx");
const bcrypt = require("bcryptjs");

// ================================
// DATABASE SETTINGS CONFIG
// ================================


const configPath = path.join(app.getPath("userData"), "config.json");

// Load or create config.json
function loadDBConfig() {
  if (!fs.existsSync(configPath)) {
    const defaultConfig = {
      server: "", // Put your default server here
      database: "", // Put your default database here
      auth: "",
      user: "",
      password: ""
    };
    fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2));
    return defaultConfig;
  }
  return JSON.parse(fs.readFileSync(configPath));
}

function saveDBConfig(newConfig) {
  fs.writeFileSync(configPath, JSON.stringify(newConfig, null, 2));
}

let dbConfig = loadDBConfig();


// Dynamic SQL connection string builder
function getConnectionString() {
  // Escape database name if it has spaces
  const escapedDB = dbConfig.database.includes(' ') 
    ? `[${dbConfig.database}]` 
    : dbConfig.database;

  if (dbConfig.auth === "windows") {
    return `Driver={ODBC Driver 17 for SQL Server};Server=${dbConfig.server};Database=${escapedDB};Trusted_Connection=Yes;`;
  } else {
    return `Driver={ODBC Driver 17 for SQL Server};Server=${dbConfig.server};Database=${escapedDB};UID=${dbConfig.user};PWD=${dbConfig.password};`;
  }
}

// ================================
// SQLITE DATABASE
// ================================
const dbPath = path.join(app.getPath("userData"), "users.db");
let db;

function initializeDatabase() {
  db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
      console.error("Database connection error:", err);
    } else {
      console.log("Database connected at:", dbPath);
    }
  });

  db.serialize(() => {
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `, (err) => {
      if (err) console.error("Table creation error:", err);
      else console.log("Users table ready");
    });
  });
}

// ================================
// WINDOWS
// ================================
let loginWin;
let signupWin;
let mainWin;
let currentUserEmail = null;

function createLoginWindow() {
  loginWin = new BrowserWindow({
    width: 420,
    height: 520,
    resizable: false,
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  loginWin.loadFile("login.html");

  loginWin.on("closed", () => {
    loginWin = null;
  });
}

function createSignupWindow() {
  if (signupWin) {
    signupWin.focus();
    return;
  }

  signupWin = new BrowserWindow({
    width: 420,
    height: 620,
    resizable: false,
    fullscreenable: false,
    parent: loginWin,
    modal: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  signupWin.loadFile("signup.html");

  signupWin.on("closed", () => {
    signupWin = null;
  });
}

function createDBSettingsWindow() {
  const win = new BrowserWindow({
    width: 500,
    height: 650,
    resizable: false,
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.loadFile("db-settings.html");
}


function createMainWindow() {
  mainWin = new BrowserWindow({
    width: 1300,
    height: 800,
    fullscreenable: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWin.loadFile("index.html");

  mainWin.on("closed", () => {
    mainWin = null;
  });
}

// ================================
// APP START
// ================================
app.whenReady().then(() => {
  initializeDatabase();
  createLoginWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createLoginWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    if (db) db.close();
    app.quit();
  }
});

// ================================
// SIGNUP HANDLER
// ================================
ipcMain.handle("signup-user", async (event, { email, password }) => {
  return new Promise((resolve) => {
    if (!email || !password) {
      return resolve({ success: false, message: "All fields required" });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return resolve({ success: false, message: "Invalid email format" });
    }

    if (password.length < 6) {
      return resolve({ success: false, message: "Password must be at least 6 characters" });
    }

    db.get("SELECT * FROM users WHERE email = ?", [email], async (err, row) => {
      if (err) {
        console.error("Database error:", err);
        return resolve({ success: false, message: "Database error occurred" });
      }

      if (row) {
        return resolve({ success: false, message: "Email already exists" });
      }

      try {
        const hashedPassword = await bcrypt.hash(password, 10);

        db.run(
          "INSERT INTO users (email, password) VALUES (?, ?)",
          [email, hashedPassword],
          (err2) => {
            if (err2) {
              console.error("Insert error:", err2);
              return resolve({ success: false, message: "Error creating account" });
            }

            console.log("User created:", email);
            return resolve({ success: true, message: "Account created successfully" });
          }
        );
      } catch (hashError) {
        console.error("Hashing error:", hashError);
        return resolve({ success: false, message: "Error processing password" });
      }
    });
  });
});

// ================================
// LOGIN HANDLER
// ================================
ipcMain.handle("login-user", async (event, { email, password }) => {
  return new Promise((resolve) => {
    if (!email || !password) {
      return resolve({ success: false, message: "All fields required" });
    }

    db.get(
      "SELECT * FROM users WHERE email = ?",
      [email],
      async (err, row) => {
        if (err) {
          console.error("Database error:", err);
          return resolve({ success: false, message: "Database error occurred" });
        }

        if (!row) {
          return resolve({ success: false, message: "Invalid email or password" });
        }

        try {
          const isMatch = await bcrypt.compare(password, row.password);
          
          if (isMatch) {
            console.log("Login successful:", email);
            currentUserEmail = email;
            return resolve({ success: true, message: "Login successful" });
          } else {
            return resolve({ success: false, message: "Invalid email or password" });
          }
        } catch (compareError) {
          console.error("Password comparison error:", compareError);
          return resolve({ success: false, message: "Authentication error" });
        }
      }
    );
  });
});

// ================================
// OPEN SIGNUP / LOGIN WINDOW
// ================================
ipcMain.on("open-signup", () => {
  createSignupWindow();
});

ipcMain.on("open-login", () => {
  if (signupWin) {
    signupWin.close();
  }
  if (!loginWin) {
    createLoginWindow();
  } else {
    loginWin.focus();
  }
});

// ================================
// AFTER LOGIN SUCCESS
// ================================
// ================================
// AFTER LOGIN SUCCESS
// ================================
ipcMain.on("login-success", () => {
  if (loginWin) loginWin.close();
  if (signupWin) signupWin.close();
  
  // Check if database is configured
  if (!dbConfig.server || !dbConfig.database) {
    dialog.showMessageBox({
      type: 'warning',
      title: 'Database Not Configured',
      message: 'Please configure your database connection in Settings.',
      buttons: ['Open Settings', 'Skip']
    }).then(result => {
      if (result.response === 0) {
        createDBSettingsWindow();
      }
    });
  }
  
  createMainWindow();
});
// ================================
// LOGOUT HANDLER
// ================================
ipcMain.on("logout", () => {
  console.log("User logged out:", currentUserEmail);
  currentUserEmail = null;
  
  if (mainWin) {
    mainWin.close();
    mainWin = null;
  }
  
  createLoginWindow();
});

ipcMain.on("open-db-settings", () => {
  createDBSettingsWindow();
});





ipcMain.handle("get-db-config", () => dbConfig);



// ================================
// GET CURRENT USER
// ================================
ipcMain.handle("get-current-user", async () => {
  return currentUserEmail;
});

// ⭐⭐⭐ START: NEW CODE - ADD FROM HERE ⭐⭐⭐
// ================================
// SQL SERVER CONNECTION
// ================================
let connectionString = getConnectionString();


// ================================
// GET LIST OF TABLES
// ================================
// ================================
// GET LIST OF TABLES
// ================================
ipcMain.handle("get-tables-list", () => {
  return new Promise((resolve) => {
    // Check if database is configured
    if (!dbConfig.server || !dbConfig.database) {
      console.error("Database not configured");
      return resolve([]);
    }

    const query = `
      SELECT TABLE_NAME 
      FROM INFORMATION_SCHEMA.TABLES 
      WHERE TABLE_TYPE = 'BASE TABLE' 
      AND TABLE_CATALOG = '${dbConfig.database}'
      ORDER BY TABLE_NAME
    `;
    
    sql.query(connectionString, query, (err, rows) => {
      if (err) {
        console.error("Error fetching tables:", err);
        resolve([]);
      } else {
        const tables = rows.map(row => row.TABLE_NAME);
        console.log("Tables found:", tables);
        resolve(tables);
      }
    });
  });
});

// ================================
// DB SETTINGS IPC HANDLERS
// ================================

// Get current DB configuration
ipcMain.handle("db-get-config", () => {
  return dbConfig;
});

// Save new DB configuration
ipcMain.handle("db-save-config", (event, newConfig) => {
  dbConfig = newConfig;
  saveDBConfig(newConfig);
  connectionString = getConnectionString();
  return { success: true };
});

// Test connection before saving
ipcMain.handle("db-test-connection", async (event, testConfig) => {
  return new Promise((resolve) => {
    let testConn;

    if (testConfig.auth === "windows") {
      testConn = `server=${testConfig.server};Database=${testConfig.database};Trusted_Connection=Yes;Driver={ODBC Driver 17 for SQL Server}`;
    } else {
      testConn = `server=${testConfig.server};Database=${testConfig.database};UID=${testConfig.user};PWD=${testConfig.password};Driver={ODBC Driver 17 for SQL Server}`;
    }

    sql.query(testConn, "SELECT 1 AS ok", (err, rows) => {
      if (err) {
        resolve({ success: false, message: err.message });
      } else {
        resolve({ success: true });
      }
    });
  });
});
// DELETE THE CONNECTION ON LOGOUT


ipcMain.on("db-logout", () => {
  try {
    const emptyConfig = {
      server: "",
      database: "",
      auth: "windows",
      user: "",
      password: ""
    };

    // Save empty config to file
    fs.writeFileSync(
      path.join(app.getPath("userData"), "dbConfig.json"),
      JSON.stringify(emptyConfig, null, 2)
    );

    // ❗ IMPORTANT: RESET IN-MEMORY CONFIG TOO
    dbConfig = emptyConfig;

    console.log("Logged out: DB config cleared.");

    // Close DB settings window
    if (BrowserWindow.getFocusedWindow()) {
      BrowserWindow.getFocusedWindow().close();
    }

    // Reload main window so it does NOT load old data
    if (mainWin) {
      mainWin.webContents.send("db-logged-out");
      mainWin.reload();
    }

  } catch (err) {
    console.error("Logout error:", err);
  }
});


// ================================
// GET PAGINATED DATA FROM SELECTED TABLE
// ================================
ipcMain.handle("get-paginated-data", (event, { page = 1, limit = 20, filters = {}, tableName = 'BathData' }) => {
  return new Promise((resolve) => {
    const offset = (page - 1) * limit;
    let query = `SELECT * FROM ${tableName} WHERE 1=1`;
    let countQuery = `SELECT COUNT(*) as total FROM ${tableName} WHERE 1=1`;
    const params = [];

    // Apply date filter
    if (filters.dateFrom) {
      query += " AND DateandTime >= ?";
      countQuery += " AND DateandTime >= ?";
      params.push(filters.dateFrom);
    }

    // Apply mode filter
    if (filters.mode) {
      query += " AND Mode LIKE ?";
      countQuery += " AND Mode LIKE ?";
      params.push(`%${filters.mode}%`);
    }

    query += ` ORDER BY DateandTime DESC OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`;

    // Get total count first
    sql.query(connectionString, countQuery, params, (err, countResult) => {
      if (err) {
        console.error("Count error:", err);
        return resolve({ data: [], total: 0 });
      }

      const total = countResult[0].total;

      // Get paginated data
      sql.query(connectionString, query, params, (err2, rows) => {
        if (err2) {
          console.error("Data error:", err2);
          return resolve({ data: [], total: 0 });
        }

        console.log(`Table: ${tableName}, Page ${page} fetched: ${rows.length} records of ${total} total`);
        resolve({ data: rows, total: total });
      });
    });
  });
});

// ================================
// GET STATISTICS
// ================================
ipcMain.handle("get-statistics", (event, { filters = {}, tableName = 'BathData' }) => {
  return new Promise((resolve) => {
    let query = `
      SELECT 
        COUNT(*) as totalTests,
        SUM(CASE WHEN Result LIKE '%PASS%' THEN 1 ELSE 0 END) as passCount,
        SUM(CASE WHEN Result LIKE '%FAIL%' THEN 1 ELSE 0 END) as failCount
      FROM ${tableName} WHERE 1=1
    `;
    const params = [];

    if (filters.dateFrom) {
      query += " AND DateandTime >= ?";
      params.push(filters.dateFrom);
    }

    if (filters.mode) {
      query += " AND Mode LIKE ?";
      params.push(`%${filters.mode}%`);
    }

    sql.query(connectionString, query, params, (err, rows) => {
      if (err) {
        console.error("Statistics error:", err);
        resolve({ totalTests: 0, passCount: 0, failCount: 0 });
      } else {
        const stats = rows[0];
        console.log("Statistics:", stats);
        resolve(stats);
      }
    });
  });
});

// ================================
// GET LAST 30 DAYS (FOR CHARTS)
// ================================
ipcMain.handle("get-last-month-data", (event, { tableName = 'BathData' } = {}) => {
  return new Promise((resolve) => {
    const query = `
      SELECT *   FROM ${tableName}
      WHERE DateandTime >= DATEADD(day, -30, GETDATE())
      ORDER BY DateandTime DESC
    `;
    
    sql.query(connectionString, query, (err, rows) => {
      if (err) {
        console.error("SQL Server error:", err);
        resolve([]);
      } else {
        console.log(`Last 30 days data from ${tableName}:`, rows.length, "records");
        resolve(rows);
      }
    });
  });
});
// ⭐⭐⭐ END: NEW CODE - STOPS HERE ⭐⭐⭐

// ================================
// EXPORT PDF
// ================================
ipcMain.on("export-pdf", async () => {
  const win = BrowserWindow.getFocusedWindow();
  if (!win) return;

  const filePath = dialog.showSaveDialogSync(win, {
    defaultPath: "Report.pdf",
    filters: [{ name: "PDF", extensions: ["pdf"] }]
  });

  if (!filePath) return;

  try {
    const pdfData = await win.webContents.printToPDF({ printBackground: true });
    fs.writeFileSync(filePath, pdfData);
    console.log("PDF exported successfully");
  } catch (error) {
    console.error("PDF export error:", error);
  }
});

// ================================
// EXPORT EXCEL
// ================================
ipcMain.on("export-excel", async () => {
  const win = BrowserWindow.getFocusedWindow();
  if (!win) return;

  try {
    const data = await win.webContents.executeJavaScript("pageData");

    const filePath = dialog.showSaveDialogSync(win, {
      defaultPath: "Report.xlsx",
      filters: [{ name: "Excel", extensions: ["xlsx"] }]
    });

    if (!filePath) return;

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Report");

    sheet.columns = Object.keys(data[0]).map((key) => ({
      header: key,
      key: key,
      width: 20
    }));

    data.forEach((row) => sheet.addRow(row));
    await workbook.xlsx.writeFile(filePath);
    console.log("Excel exported successfully");
  } catch (error) {
    console.error("Excel export error:", error);
  }
});

// ================================
// EXPORT WORD
// ================================
ipcMain.on("export-word", async () => {
  const win = BrowserWindow.getFocusedWindow();
  if (!win) return;

  try {
    const data = await win.webContents.executeJavaScript("pageData");

    const filePath = dialog.showSaveDialogSync(win, {
      defaultPath: "Report.docx",
      filters: [{ name: "Word", extensions: ["docx"] }]
    });

    if (!filePath) return;

    const rows = [
      new TableRow({
        children: Object.keys(data[0]).map(
          (key) => new TableCell({ children: [new Paragraph(key)] })
        )
      }),
      ...data.map((row) =>
        new TableRow({
          children: Object.values(row).map(
            (v) => new TableCell({ children: [new Paragraph(String(v))] })
          )
        })
      )
    ];

    const doc = new Document({
      sections: [{ children: [new Table({ rows })] }]
    });

    const buffer = await Packer.toBuffer(doc);
    fs.writeFileSync(filePath, buffer);
    console.log("Word document exported successfully");
  } catch (error) {
    console.error("Word export error:", error);
  }
});

