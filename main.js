const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const sqlite3 = require("sqlite3").verbose();
const sql = require("msnodesqlv8");
const ExcelJS = require("exceljs");
const { Document, Packer, Paragraph, Table, TableRow, TableCell } = require("docx");
const bcrypt = require("bcryptjs");

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
ipcMain.on("login-success", () => {
  if (loginWin) loginWin.close();
  if (signupWin) signupWin.close();
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

// ================================
// GET CURRENT USER
// ================================
ipcMain.handle("get-current-user", async () => {
  return currentUserEmail;
});

// ================================
// SQL SERVER CONNECTION
// ================================
const connectionString =
  "server=Abhinash\\SQLEXPRESS;Database=MLTesting;Trusted_Connection=Yes;Driver={ODBC Driver 17 for SQL Server}";

// ================================
// GET ALL DATA (FOR DATA TABLE)
// ================================
ipcMain.handle("get-sql-data", () => {
  return new Promise((resolve) => {
    sql.query(connectionString, "SELECT * FROM BathData ORDER BY DateandTime DESC", (err, rows) => {
      if (err) {
        console.error("SQL Server error:", err);
        resolve([]);
      } else {
        console.log("All data fetched:", rows.length, "records");
        resolve(rows);
      }
    });
  });
});

// ================================
// GET LAST 30 DAYS DATA (FOR CHARTS)
// ================================
ipcMain.handle("get-last-month-data", () => {
  return new Promise((resolve) => {
    const query = `
      SELECT * FROM BathData 
      WHERE DateandTime >= DATEADD(day, -30, GETDATE())
      ORDER BY DateandTime DESC
    `;
    
    sql.query(connectionString, query, (err, rows) => {
      if (err) {
        console.error("SQL Server error:", err);
        resolve([]);
      } else {
        console.log("Last 30 days data fetched:", rows.length, "records");
        resolve(rows);
      }
    });
  });
});

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
    const data = await win.webContents.executeJavaScript("allData");

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
    const data = await win.webContents.executeJavaScript("allData");

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