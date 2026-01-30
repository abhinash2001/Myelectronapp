const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const sqlite3 = require("sqlite3").verbose();
const sql = require("msnodesqlv8");
const ExcelJS = require("exceljs");
const { Document, Packer, Paragraph, Table, TableRow, TableCell } = require("docx");
const bcrypt = require("bcryptjs");

const configPath = path.join(app.getPath("userData"), "config.json");

function loadDBConfig() {
  if (!fs.existsSync(configPath)) {
    const defaultConfig = {
      server: "",
      database: "",
      auth: "windows",
      user: "",
      password: "",
      tableName: ""
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
let tableSchema = null;

function getConnectionString() {
  const escapedDB = dbConfig.database.includes(' ') 
    ? `[${dbConfig.database}]` 
    : dbConfig.database;

  if (dbConfig.auth === "windows") {
    return `Driver={ODBC Driver 17 for SQL Server};Server=${dbConfig.server};Database=${escapedDB};Trusted_Connection=Yes;`;
  } else {
    return `Driver={ODBC Driver 17 for SQL Server};Server=${dbConfig.server};Database=${escapedDB};UID=${dbConfig.user};PWD=${dbConfig.password};`;
  }
}

async function autoDetectTableSchema() {
  return new Promise((resolve) => {
    if (!dbConfig.server || !dbConfig.database) {
      console.log("Database not configured");
      return resolve(null);
    }

    const connectionString = getConnectionString();
    
    const tablesQuery = `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = 'BASE TABLE' AND TABLE_CATALOG = '${dbConfig.database}' ORDER BY TABLE_NAME`;
    
    sql.query(connectionString, tablesQuery, (err, tables) => {
      if (err || !tables || tables.length === 0) {
        console.error("Error fetching tables:", err);
        return resolve(null);
      }

      const tableName = dbConfig.tableName || tables[0].TABLE_NAME;
      console.log("Using table:", tableName);

      const columnsQuery = `SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${tableName}' ORDER BY ORDINAL_POSITION`;

      sql.query(connectionString, columnsQuery, (err2, columns) => {
        if (err2 || !columns) {
          console.error("Error fetching columns:", err2);
          return resolve(null);
        }

        const columnNames = columns.map(c => c.COLUMN_NAME);
        console.log("Detected columns:", columnNames);

        const datePattern = /date|time|timestamp|created/i;
        const machinePattern = /machine|equipment|device|station/i;
        const resultPattern = /result|status|outcome|pass|fail/i;

        const schema = {
          tableName: tableName,
          dateColumn: columnNames.find(c => datePattern.test(c)) || columnNames[0],
          machineColumn: columnNames.find(c => machinePattern.test(c)),
          resultColumn: columnNames.find(c => resultPattern.test(c)),
          allColumns: columnNames
        };

        console.log("Auto-detected schema:", schema);
        
        if (!dbConfig.tableName) {
          dbConfig.tableName = tableName;
          saveDBConfig(dbConfig);
        }

        resolve(schema);
      });
    });
  });
}

const dbPath = path.join(app.getPath("userData"), "users.db");
let db;

function initializeDatabase() {
  db = new sqlite3.Database(dbPath, (err) => {
    if (err) console.error("Database connection error:", err);
    else console.log("Database connected at:", dbPath);
  });

  db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL, role TEXT DEFAULT 'Operator', name TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`, (err) => {
      if (err) console.error("Table creation error:", err);
      else console.log("Users table ready");
    });
  });
}

let loginWin, signupWin, mainWin, currentUserEmail = null, currentUserData = null;

function createLoginWindow() {
  loginWin = new BrowserWindow({
    width: 420, height: 520, resizable: false, fullscreenable: false,
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false }
  });
  loginWin.loadFile("login.html");
  loginWin.on("closed", () => { loginWin = null; });
}

function createSignupWindow() {
  if (signupWin) { signupWin.focus(); return; }
  signupWin = new BrowserWindow({
    width: 420, height: 620, resizable: false, fullscreenable: false, parent: loginWin, modal: true,
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false }
  });
  signupWin.loadFile("signup.html");
  signupWin.on("closed", () => { signupWin = null; });
}

function createDBSettingsWindow() {
  const win = new BrowserWindow({
    width: 500, height: 650, resizable: false, fullscreenable: false,
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false }
  });
  win.loadFile("db-settings.html");
}

function createMainWindow() {
  mainWin = new BrowserWindow({
    width: 1300, height: 800, fullscreenable: true,
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false }
  });
  mainWin.loadFile("index.html");
  mainWin.on("closed", () => { mainWin = null; });
}

app.whenReady().then(async () => {
  console.log("Electron ready");
  initializeDatabase();
  if (dbConfig.server && dbConfig.database) {
    tableSchema = await autoDetectTableSchema();
  }
  createLoginWindow();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createLoginWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    if (db) db.close();
    app.quit();
  }
});

ipcMain.handle("signup-user", async (event, { email, password, role = 'Operator' }) => {
  return new Promise((resolve) => {
    if (!email || !password) return resolve({ success: false, message: "All fields required" });
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) return resolve({ success: false, message: "Invalid email format" });
    if (password.length < 6) return resolve({ success: false, message: "Password must be at least 6 characters" });

    db.get("SELECT * FROM users WHERE email = ?", [email], async (err, row) => {
      if (err) return resolve({ success: false, message: "Database error occurred" });
      if (row) return resolve({ success: false, message: "Email already exists" });

      try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const name = email.split('@')[0];
        db.run("INSERT INTO users (email, password, role, name) VALUES (?, ?, ?, ?)", [email, hashedPassword, role, name], (err2) => {
          if (err2) return resolve({ success: false, message: "Error creating account" });
          console.log("User created:", email);
          return resolve({ success: true, message: "Account created successfully" });
        });
      } catch (hashError) {
        return resolve({ success: false, message: "Error processing password" });
      }
    });
  });
});

ipcMain.handle("login-user", async (event, { email, password }) => {
  return new Promise((resolve) => {
    if (!email || !password) return resolve({ success: false, message: "All fields required" });
    db.get("SELECT * FROM users WHERE email = ?", [email], async (err, row) => {
      if (err) return resolve({ success: false, message: "Database error occurred" });
      if (!row) return resolve({ success: false, message: "Invalid email or password" });
      try {
        const isMatch = await bcrypt.compare(password, row.password);
        if (isMatch) {
          currentUserEmail = email;
          currentUserData = { email: row.email, name: row.name || email.split('@')[0], role: row.role || 'Operator', id: row.id };
          return resolve({ success: true, message: "Login successful" });
        } else {
          return resolve({ success: false, message: "Invalid email or password" });
        }
      } catch (compareError) {
        return resolve({ success: false, message: "Authentication error" });
      }
    });
  });
});

ipcMain.on("open-signup", () => { createSignupWindow(); });
ipcMain.on("open-login", () => {
  if (signupWin) signupWin.close();
  if (!loginWin) createLoginWindow();
  else loginWin.focus();
});

ipcMain.on("login-success", async () => {
  if (loginWin) loginWin.close();
  if (signupWin) signupWin.close();
  if (dbConfig.server && dbConfig.database && !tableSchema) {
    tableSchema = await autoDetectTableSchema();
  }
  if (!dbConfig.server || !dbConfig.database) {
    dialog.showMessageBox({
      type: 'warning',
      title: 'Database Not Configured',
      message: 'Please configure your database connection in Settings.',
      buttons: ['Open Settings', 'Skip']
    }).then(result => {
      if (result.response === 0) createDBSettingsWindow();
    });
  }
  createMainWindow();
});

ipcMain.on("logout", () => {
  console.log("User logged out");
  currentUserEmail = null;
  currentUserData = null;
  if (mainWin) { mainWin.close(); mainWin = null; }
  createLoginWindow();
});

ipcMain.on("open-db-settings", () => { createDBSettingsWindow(); });
ipcMain.handle("get-db-config", () => dbConfig);
ipcMain.handle("get-current-user", async () => {
  return currentUserData || { email: currentUserEmail, name: currentUserEmail ? currentUserEmail.split('@')[0] : 'User', role: 'Operator' };
});

let connectionString = getConnectionString();

ipcMain.handle("get-tables-list", () => {
  return new Promise((resolve) => {
    if (!dbConfig.server || !dbConfig.database) return resolve([]);
    const query = `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = 'BASE TABLE' AND TABLE_CATALOG = '${dbConfig.database}' ORDER BY TABLE_NAME`;
    sql.query(connectionString, query, (err, rows) => {
      if (err) { console.error("Error fetching tables:", err); resolve([]); }
      else { const tables = rows.map(row => row.TABLE_NAME); console.log("Tables found:", tables); resolve(tables); }
    });
  });
});

ipcMain.handle("get-unique-identifiers", async (event, tableName) => {
  return new Promise(async (resolve) => {
    if (!dbConfig.server || !dbConfig.database) return resolve([]);
    
    // If no table specified, try to auto-detect
    if (!tableName) {
      if (!tableSchema) tableSchema = await autoDetectTableSchema();
      if (!tableSchema) return resolve([]);
      tableName = tableSchema.tableName;
    }

    // Get columns for this specific table
    const columnsQuery = `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${tableName}' ORDER BY ORDINAL_POSITION`;
    
    sql.query(connectionString, columnsQuery, (err, columns) => {
      if (err || !columns) {
        console.error("Error fetching columns:", err);
        return resolve([]);
      }

      const columnNames = columns.map(c => c.COLUMN_NAME);
      
      // Use first non-date column as identifier
      const identifierColumn = columnNames.find(col => {
        const colLower = col.toLowerCase();
        return !colLower.includes('date') && !colLower.includes('time');
      }) || columnNames[0];

      const query = `SELECT DISTINCT TOP 100 ${identifierColumn} as value FROM ${tableName} WHERE ${identifierColumn} IS NOT NULL ORDER BY ${identifierColumn}`;
      
      sql.query(connectionString, query, (err2, rows) => {
        if (err2) {
          console.error("Error fetching unique identifiers:", err2);
          return resolve([]);
        }
        const values = rows.map(row => row.value);
        console.log(`Unique ${identifierColumn} values from ${tableName}:`, values.length);
        resolve([{ columnName: identifierColumn, values: values }]);
      });
    });
  });
});

ipcMain.handle("get-machines", async () => {
  return new Promise(async (resolve) => {
    if (!dbConfig.server || !dbConfig.database) return resolve([]);
    if (!tableSchema) tableSchema = await autoDetectTableSchema();
    if (!tableSchema || !tableSchema.machineColumn) return resolve([]);
    const query = `SELECT DISTINCT TOP 100 ${tableSchema.machineColumn} as id, ${tableSchema.machineColumn} as name FROM ${tableSchema.tableName} WHERE ${tableSchema.machineColumn} IS NOT NULL ORDER BY ${tableSchema.machineColumn}`;
    sql.query(connectionString, query, (err, rows) => {
      if (err) { console.error("Error fetching machines:", err); return resolve([]); }
      console.log("Machines fetched:", rows.length);
      resolve(rows);
    });
  });
});

ipcMain.handle("get-all-records", async (event, filters = {}) => {
  return new Promise(async (resolve, reject) => {
    console.log('');
    console.log('========================================');
    console.log('GET-ALL-RECORDS CALLED');
    console.log('========================================');
    
    if (!dbConfig.server || !dbConfig.database) {
      console.error('❌ Database not configured');
      return reject(new Error("Database not configured."));
    }

    const { table, date, shift, identifier } = filters;
    
    console.log('Filters received:');
    console.log('  - Table:', table);
    console.log('  - Date:', date);
    console.log('  - Shift:', shift);
    console.log('  - Identifier:', identifier);
    
    if (!table) {
      console.error('❌ No table specified');
      return reject(new Error("No table specified."));
    }

    // Step 1: Get columns for this table
    const columnsQuery = `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${table}' ORDER BY ORDINAL_POSITION`;
    
    sql.query(connectionString, columnsQuery, (err, columns) => {
      if (err || !columns) {
        console.error("❌ Error fetching columns:", err);
        return reject(new Error("Failed to get table structure."));
      }

      const columnNames = columns.map(c => c.COLUMN_NAME);
      console.log('✅ Columns found:', columnNames);
      
      // Detect date column
      const datePattern = /date|time|timestamp|created/i;
      const dateColumn = columnNames.find(c => datePattern.test(c)) || columnNames[0];
      console.log('✅ Date column:', dateColumn);
      
      // Detect result column (for pass/fail)
      const resultPattern = /result|status|outcome/i;
      const resultColumn = columnNames.find(c => resultPattern.test(c));
      console.log('✅ Result column:', resultColumn || 'NOT FOUND');
      
      // Build WHERE clause
      let whereClause = "WHERE 1=1";
      const params = [];
      
      // Date filter
      if (date && dateColumn) {
        whereClause += ` AND CAST(${dateColumn} AS DATE) = ?`;
        params.push(date);
        console.log('  ✓ Date filter added:', date);
      }
      
      // Shift filter - CORRECTED LOGIC
      if (shift && shift !== 'all' && dateColumn) {
        if (shift === 'morning') {
          // Morning: 6 AM to 1:59 PM (hours 6-13)
          whereClause += ` AND DATEPART(HOUR, ${dateColumn}) >= 6 AND DATEPART(HOUR, ${dateColumn}) < 14`;
          console.log('  ✓ Shift filter: Morning (6:00-13:59)');
        } else if (shift === 'afternoon') {
          // Afternoon: 2 PM to 9:59 PM (hours 14-21)
          whereClause += ` AND DATEPART(HOUR, ${dateColumn}) >= 14 AND DATEPART(HOUR, ${dateColumn}) < 22`;
          console.log('  ✓ Shift filter: Afternoon (14:00-21:59)');
        } else if (shift === 'night') {
          // Night: 10 PM to 5:59 AM (hours 22-23 or 0-5)
          whereClause += ` AND (DATEPART(HOUR, ${dateColumn}) >= 22 OR DATEPART(HOUR, ${dateColumn}) < 6)`;
          console.log('  ✓ Shift filter: Night (22:00-05:59)');
        }
      }
      
      // Identifier filter
      if (identifier && identifier !== 'all') {
        const identifierColumn = columnNames.find(col => {
          const colLower = col.toLowerCase();
          return !colLower.includes('date') && !colLower.includes('time');
        }) || columnNames[0];
        
        whereClause += ` AND ${identifierColumn} = ?`;
        params.push(identifier);
        console.log('  ✓ Identifier filter added:', identifierColumn, '=', identifier);
      }

      // Main query to get records
      const recordsQuery = `SELECT TOP 1000 * FROM ${table} ${whereClause} ORDER BY ${dateColumn} DESC`;
      
      console.log('');
      console.log('📊 EXECUTING QUERY:');
      console.log('SQL:', recordsQuery);
      console.log('Params:', params);
      console.log('');
      
      sql.query(connectionString, recordsQuery, params, (err2, rows) => {
        if (err2) {
          console.error("❌ Query failed:", err2.message);
          return reject(new Error("Failed to fetch records: " + err2.message));
        }
        
        console.log('✅ Query successful!');
        console.log('   Records returned:', rows.length);
        
        // Calculate pass/fail stats
        let passCount = 0;
        let failCount = 0;
        
        if (resultColumn && rows.length > 0) {
          rows.forEach(row => {
            const resultValue = row[resultColumn];
            if (resultValue) {
              const resultStr = String(resultValue).toUpperCase();
              if (resultStr.includes('PASS') || resultStr.includes('OK') || resultStr.includes('SUCCESS')) {
                passCount++;
              } else if (resultStr.includes('FAIL') || resultStr.includes('NG') || resultStr.includes('ERROR')) {
                failCount++;
              }
            }
          });
          console.log('   Pass:', passCount, '| Fail:', failCount);
        } else {
          console.log('   No result column - stats not calculated');
        }
        
        console.log('========================================');
        console.log('');
        
        resolve({
          records: rows,
          columns: columnNames,
          stats: {
            total: rows.length,
            pass: passCount,
            fail: failCount
          },
          schema: {
            tableName: table,
            dateColumn: dateColumn,
            resultColumn: resultColumn,
            allColumns: columnNames
          }
        });
      });
    });
  });
});

ipcMain.handle("get-record-history", async (event, record, tableName) => {
  return new Promise(async (resolve, reject) => {
    if (!dbConfig.server || !dbConfig.database) {
      return reject(new Error("Database not configured."));
    }
    
    if (!tableName) {
      return reject(new Error("No table specified for history."));
    }

    console.log("Fetching history for record from table:", tableName);
    
    // Get columns for this table
    const columnsQuery = `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${tableName}' ORDER BY ORDINAL_POSITION`;
    
    sql.query(connectionString, columnsQuery, (err, columns) => {
      if (err || !columns) {
        console.error("Error fetching columns:", err);
        return reject(new Error("Failed to get table structure."));
      }

      const columnNames = columns.map(c => c.COLUMN_NAME);
      
      // Detect date column
      const datePattern = /date|time|timestamp|created/i;
      const dateColumn = columnNames.find(c => datePattern.test(c)) || columnNames[0];
      
      // Build WHERE clause based on record identifiers
      let whereClause = "WHERE 1=1";
      const params = [];
      
      // Use first non-date column as identifier
      const identifierColumn = columnNames.find(col => {
        const colLower = col.toLowerCase();
        return !colLower.includes('date') && !colLower.includes('time');
      }) || columnNames[0];
      
      if (record[identifierColumn]) {
        whereClause += ` AND ${identifierColumn} = ?`;
        params.push(record[identifierColumn]);
      }

      const query = `SELECT TOP 500 * FROM ${tableName} ${whereClause} ORDER BY ${dateColumn} DESC`;
      
      console.log("History query:", query);
      console.log("Params:", params);
      
      sql.query(connectionString, query, params, (err2, rows) => {
        if (err2) {
          console.error("Error fetching record history:", err2);
          return reject(new Error("Failed to fetch history: " + err2.message));
        }
        
        console.log("History records fetched:", rows.length);
        resolve(rows);
      });
    });
  });
});

ipcMain.handle("get-production-data", async (event, filters = {}) => {
  return new Promise(async (resolve, reject) => {
    if (!dbConfig.server || !dbConfig.database) {
      return reject(new Error("Database not configured. Please configure database in Settings."));
    }

    const { table, date, shift, identifier } = filters;
    
    // If no table specified, use default schema detection
    let workingTable = table;
    let workingSchema = null;
    
    if (!workingTable) {
      if (!tableSchema) tableSchema = await autoDetectTableSchema();
      if (!tableSchema) return reject(new Error("Could not detect database schema."));
      workingTable = tableSchema.tableName;
      workingSchema = tableSchema;
    } else {
      // Get schema for specified table
      const columnsQuery = `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${workingTable}' ORDER BY ORDINAL_POSITION`;
      
      const columnData = await new Promise((res) => {
        sql.query(connectionString, columnsQuery, (err, columns) => {
          if (err || !columns) return res(null);
          
          const columnNames = columns.map(c => c.COLUMN_NAME);
          const datePattern = /date|time|timestamp|created/i;
          const resultPattern = /result|status|outcome|pass|fail/i;
          
          res({
            tableName: workingTable,
            dateColumn: columnNames.find(c => datePattern.test(c)) || columnNames[0],
            resultColumn: columnNames.find(c => resultPattern.test(c)),
            allColumns: columnNames
          });
        });
      });
      
      if (!columnData) return reject(new Error("Could not detect table schema."));
      workingSchema = columnData;
    }

    console.log("Fetching production data from:", workingTable, "with filters:", filters);
    console.log("Using schema:", workingSchema);
    
    let whereClause = "WHERE 1=1";
    const params = [];
    
    if (date && workingSchema.dateColumn) {
      whereClause += ` AND CAST(${workingSchema.dateColumn} AS DATE) = ?`;
      params.push(date);
    }
    
    if (shift && shift !== 'all' && workingSchema.dateColumn) {
      if (shift === 'morning') whereClause += ` AND DATEPART(HOUR, ${workingSchema.dateColumn}) BETWEEN 6 AND 13`;
      else if (shift === 'afternoon') whereClause += ` AND DATEPART(HOUR, ${workingSchema.dateColumn}) BETWEEN 14 AND 21`;
      else if (shift === 'night') whereClause += ` AND (DATEPART(HOUR, ${workingSchema.dateColumn}) >= 22 OR DATEPART(HOUR, ${workingSchema.dateColumn}) < 6)`;
    }
    
    if (identifier && identifier !== 'all') {
      const identifierColumn = workingSchema.allColumns.find(col => {
        const colLower = col.toLowerCase();
        return !colLower.includes('date') && !colLower.includes('time');
      }) || workingSchema.allColumns[0];
      
      whereClause += ` AND ${identifierColumn} = ?`;
      params.push(identifier);
    }

    let statsQuery = workingSchema.resultColumn 
      ? `SELECT COUNT(*) as totalProduction, AVG(CASE WHEN ${workingSchema.resultColumn} LIKE '%PASS%' THEN 100.0 ELSE 0 END) as efficiency, SUM(CASE WHEN ${workingSchema.resultColumn} LIKE '%FAIL%' THEN 1 ELSE 0 END) as failures FROM ${workingSchema.tableName} ${whereClause}`
      : `SELECT COUNT(*) as totalProduction, 100.0 as efficiency, 0 as failures FROM ${workingSchema.tableName} ${whereClause}`;

    sql.query(connectionString, statsQuery, params, (err, statsRows) => {
      if (err) return reject(new Error("Failed to fetch production data: " + err.message));

      const stats = statsRows[0];
      console.log("Stats:", stats);

      if (stats.totalProduction === 0) {
        return resolve({
          production: 0, efficiency: 0, downtime: 0, target: 0,
          productionTrend: 0, efficiencyTrend: 0, downtimeTrend: 0, targetTrend: 0,
          hourlyData: new Array(12).fill(0), machines: [],
          timeline: [{ time: 'No Data', title: 'No Production Data', desc: 'No records found' }]
        });
      }
      
      const hourlyQuery = `SELECT DATEPART(HOUR, ${workingSchema.dateColumn}) as hour, COUNT(*) as count FROM ${workingSchema.tableName} ${whereClause} GROUP BY DATEPART(HOUR, ${workingSchema.dateColumn}) ORDER BY DATEPART(HOUR, ${workingSchema.dateColumn})`;

      sql.query(connectionString, hourlyQuery, params, (err2, hourlyRows) => {
        if (err2) return reject(new Error("Failed to fetch hourly data: " + err2.message));

        if (tableSchema.machineColumn) {
          let machineQuery = tableSchema.resultColumn
            ? `SELECT ${tableSchema.machineColumn} as id, COUNT(*) as production, AVG(CASE WHEN ${tableSchema.resultColumn} LIKE '%PASS%' THEN 100.0 ELSE 0 END) as efficiency, MAX(${tableSchema.dateColumn}) as lastUpdated, CASE WHEN MAX(${tableSchema.dateColumn}) > DATEADD(MINUTE, -5, GETDATE()) THEN 'active' WHEN MAX(${tableSchema.dateColumn}) > DATEADD(HOUR, -1, GETDATE()) THEN 'idle' ELSE 'offline' END as status FROM ${tableSchema.tableName} ${whereClause} GROUP BY ${tableSchema.machineColumn} ORDER BY ${tableSchema.machineColumn}`
            : `SELECT ${tableSchema.machineColumn} as id, COUNT(*) as production, 100.0 as efficiency, MAX(${tableSchema.dateColumn}) as lastUpdated, CASE WHEN MAX(${tableSchema.dateColumn}) > DATEADD(MINUTE, -5, GETDATE()) THEN 'active' WHEN MAX(${tableSchema.dateColumn}) > DATEADD(HOUR, -1, GETDATE()) THEN 'idle' ELSE 'offline' END as status FROM ${tableSchema.tableName} ${whereClause} GROUP BY ${tableSchema.machineColumn} ORDER BY ${tableSchema.machineColumn}`;

          sql.query(connectionString, machineQuery, params, (err3, machineRows) => {
            if (err3) return reject(new Error("Failed to fetch machine data: " + err3.message));

            const hourlyData = new Array(24).fill(0);
            hourlyRows.forEach(row => { hourlyData[row.hour] = row.count; });

            const machines = machineRows.map(m => ({
              id: m.id, status: m.status, production: m.production,
              efficiency: Math.round(m.efficiency), lastUpdated: getRelativeTime(m.lastUpdated)
            }));

            resolve({
              production: stats.totalProduction, efficiency: stats.efficiency || 0,
              downtime: stats.failures > 0 ? parseFloat((stats.failures / stats.totalProduction * 8).toFixed(1)) : 0,
              target: Math.min((stats.totalProduction / 5000) * 100, 100),
              productionTrend: 0, efficiencyTrend: 0, downtimeTrend: 0, targetTrend: 0,
              hourlyData: hourlyData.slice(8, 20), machines: machines,
              timeline: [
                { time: '08:00 AM', title: 'Shift Started', desc: 'Production shift began' },
                { time: formatTime(new Date()), title: 'Current Status', desc: `${stats.totalProduction} units produced` }
              ]
            });
          });
        } else {
          const hourlyData = new Array(24).fill(0);
          hourlyRows.forEach(row => { hourlyData[row.hour] = row.count; });
          resolve({
            production: stats.totalProduction, efficiency: stats.efficiency || 0, downtime: 0,
            target: Math.min((stats.totalProduction / 5000) * 100, 100),
            productionTrend: 0, efficiencyTrend: 0, downtimeTrend: 0, targetTrend: 0,
            hourlyData: hourlyData.slice(8, 20), machines: [],
            timeline: [{ time: formatTime(new Date()), title: 'Current Status', desc: `${stats.totalProduction} records` }]
          });
        }
      });
    });
  });
});

function getRelativeTime(date) {
  const now = new Date();
  const then = new Date(date);
  const diffMs = now - then;
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins} min${diffMins > 1 ? 's' : ''} ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
}

function formatTime(date) {
  return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
}

ipcMain.handle("get-table-structure", (event, tableName) => {
  return new Promise((resolve) => {
    if (!dbConfig.server || !dbConfig.database) return resolve([]);
    const query = `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${tableName}' ORDER BY ORDINAL_POSITION`;
    sql.query(connectionString, query, (err, rows) => {
      if (err) { console.error("Error getting table structure:", err); resolve([]); }
      else resolve(rows);
    });
  });
});

ipcMain.handle("get-sample-data", (event, tableName, limit = 10) => {
  return new Promise((resolve) => {
    if (!dbConfig.server || !dbConfig.database) return resolve([]);
    const query = `SELECT TOP ${limit} * FROM ${tableName}`;
    sql.query(connectionString, query, (err, rows) => {
      if (err) { console.error("Error getting sample data:", err); resolve([]); }
      else resolve(rows);
    });
  });
});

ipcMain.handle("test-production-query-direct", async (event, tableName, filters) => {
  return new Promise(async (resolve, reject) => {
    if (!dbConfig.server || !dbConfig.database) return reject(new Error("Database not configured"));

    const testSchema = await new Promise((res) => {
      const columnsQuery = `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${tableName}' ORDER BY ORDINAL_POSITION`;
      sql.query(connectionString, columnsQuery, (err, columns) => {
        if (err || !columns) return res(null);
        const columnNames = columns.map(c => c.COLUMN_NAME);
        const datePattern = /date|time|timestamp|created/i;
        res({
          tableName: tableName,
          dateColumn: columnNames.find(c => datePattern.test(c)) || columnNames[0],
          allColumns: columnNames
        });
      });
    });

    if (!testSchema) return reject(new Error("Could not detect table schema"));

    const { date } = filters;
    let whereClause = "WHERE 1=1";
    const params = [];
    if (date && testSchema.dateColumn) {
      whereClause += ` AND CAST(${testSchema.dateColumn} AS DATE) = ?`;
      params.push(date);
    }

    const query = `SELECT TOP 100 * FROM ${tableName} ${whereClause} ORDER BY ${testSchema.dateColumn} DESC`;
    sql.query(connectionString, query, params, (err, rows) => {
      if (err) reject(err);
      else resolve({ rowCount: rows.length, sampleRows: rows.slice(0, 5), allColumns: rows.length > 0 ? Object.keys(rows[0]) : [], detectedDateColumn: testSchema.dateColumn });
    });
  });
});

ipcMain.handle("export-data", async (event, data, filters) => {
  return new Promise((resolve) => {
    const win = BrowserWindow.getFocusedWindow();
    if (!win) return resolve({ success: false, message: "No active window" });
    const filePath = dialog.showSaveDialogSync(win, { defaultPath: `production_report_${filters.date}.xlsx`, filters: [{ name: "Excel", extensions: ["xlsx"] }] });
    if (!filePath) return resolve({ success: false, message: "Export cancelled" });
    try {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("Production Report");
      sheet.columns = [
        { header: 'Machine ID', key: 'id', width: 15 },
        { header: 'Status', key: 'status', width: 12 },
        { header: 'Production', key: 'production', width: 15 },
        { header: 'Efficiency', key: 'efficiency', width: 12 },
        { header: 'Last Updated', key: 'lastUpdated', width: 20 }
      ];
      data.machines.forEach((machine) => sheet.addRow(machine));
      workbook.xlsx.writeFile(filePath).then(() => resolve({ success: true }));
    } catch (error) {
      resolve({ success: false, message: error.message });
    }
  });
});

ipcMain.handle("open-settings", () => { createDBSettingsWindow(); return { success: true }; });

ipcMain.handle("db-save-config", async (event, newConfig) => {
  dbConfig = newConfig;
  saveDBConfig(newConfig);
  connectionString = getConnectionString();
  tableSchema = await autoDetectTableSchema();
  if (mainWin) mainWin.webContents.send("db-config-updated");
  return { success: true };
});

ipcMain.handle("db-test-connection", async (event, testConfig) => {
  return new Promise((resolve) => {
    let testConn = testConfig.auth === "windows"
      ? `server=${testConfig.server};Database=${testConfig.database};Trusted_Connection=Yes;Driver={ODBC Driver 17 for SQL Server}`
      : `server=${testConfig.server};Database=${testConfig.database};UID=${testConfig.user};PWD=${testConfig.password};Driver={ODBC Driver 17 for SQL Server}`;
    sql.query(testConn, "SELECT 1 AS ok", (err, rows) => {
      if (err) resolve({ success: false, message: err.message });
      else resolve({ success: true });
    });
  });
});

ipcMain.on("db-logout", () => {
  try {
    const emptyConfig = { server: "", database: "", auth: "windows", user: "", password: "", tableName: "" };
    dbConfig = emptyConfig;
    saveDBConfig(emptyConfig);
    connectionString = "";
    tableSchema = null;
    if (BrowserWindow.getFocusedWindow()) BrowserWindow.getFocusedWindow().close();
    if (mainWin) { mainWin.webContents.send("db-logged-out"); mainWin.reload(); }
  } catch (err) {
    console.error("Logout error:", err);
  }
});

ipcMain.handle("get-paginated-data", async (event, { page = 1, limit = 20, filters = {}, tableName }) => {
  return new Promise(async (resolve) => {
    if (!tableSchema && dbConfig.server && dbConfig.database) tableSchema = await autoDetectTableSchema();
    const table = tableName || (tableSchema ? tableSchema.tableName : 'BathData');
    const offset = (page - 1) * limit;
    let query = `SELECT * FROM ${table} WHERE 1=1 ORDER BY 1 DESC OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`;
    let countQuery = `SELECT COUNT(*) as total FROM ${table} WHERE 1=1`;
    sql.query(connectionString, countQuery, [], (err, countResult) => {
      if (err) return resolve({ data: [], total: 0 });
      const total = countResult[0].total;
      sql.query(connectionString, query, [], (err2, rows) => {
        if (err2) return resolve({ data: [], total: 0 });
        resolve({ data: rows, total: total });
      });
    });
  });
});

ipcMain.handle("get-statistics", async (event, { filters = {}, tableName }) => {
  return new Promise(async (resolve) => {
    if (!tableSchema && dbConfig.server && dbConfig.database) tableSchema = await autoDetectTableSchema();
    const table = tableName || (tableSchema ? tableSchema.tableName : 'BathData');
    let query = `SELECT COUNT(*) as totalTests, 0 as passCount, 0 as failCount FROM ${table} WHERE 1=1`;
    sql.query(connectionString, query, [], (err, rows) => {
      if (err) resolve({ totalTests: 0, passCount: 0, failCount: 0 });
      else resolve(rows[0]);
    });
  });
});

ipcMain.handle("get-last-month-data", async (event, { tableName } = {}) => {
  return new Promise(async (resolve) => {
    if (!tableSchema && dbConfig.server && dbConfig.database) tableSchema = await autoDetectTableSchema();
    const table = tableName || (tableSchema ? tableSchema.tableName : 'BathData');
    const dateCol = tableSchema ? tableSchema.dateColumn : 'DateandTime';
    const query = `SELECT TOP 1000 * FROM ${table} WHERE ${dateCol} >= DATEADD(day, -30, GETDATE()) ORDER BY ${dateCol} DESC`;
    sql.query(connectionString, query, (err, rows) => {
      if (err) resolve([]);
      else resolve(rows);
    });
  });
});

ipcMain.on("export-pdf", async () => {
  const win = BrowserWindow.getFocusedWindow();
  if (!win) return;
  const filePath = dialog.showSaveDialogSync(win, { defaultPath: "Report.pdf", filters: [{ name: "PDF", extensions: ["pdf"] }] });
  if (!filePath) return;
  try {
    const pdfData = await win.webContents.printToPDF({ printBackground: true });
    fs.writeFileSync(filePath, pdfData);
  } catch (error) {
    console.error("PDF export error:", error);
  }
});

ipcMain.on("db-updated", () => { if (mainWin) mainWin.webContents.send("refresh-after-db-update"); });

ipcMain.on("export-excel", async () => {
  const win = BrowserWindow.getFocusedWindow();
  if (!win) return;
  try {
    const data = await win.webContents.executeJavaScript("pageData");
    const filePath = dialog.showSaveDialogSync(win, { defaultPath: "Report.xlsx", filters: [{ name: "Excel", extensions: ["xlsx"] }] });
    if (!filePath) return;
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Report");
    sheet.columns = Object.keys(data[0]).map((key) => ({ header: key, key: key, width: 20 }));
    data.forEach((row) => sheet.addRow(row));
    await workbook.xlsx.writeFile(filePath);
  } catch (error) {
    console.error("Excel export error:", error);
  }
});

ipcMain.on("export-word", async () => {
  const win = BrowserWindow.getFocusedWindow();
  if (!win) return;
  try {
    const data = await win.webContents.executeJavaScript("pageData");
    const filePath = dialog.showSaveDialogSync(win, { defaultPath: "Report.docx", filters: [{ name: "Word", extensions: ["docx"] }] });
    if (!filePath) return;
    const rows = [
      new TableRow({ children: Object.keys(data[0]).map((key) => new TableCell({ children: [new Paragraph(key)] })) }),
      ...data.map((row) => new TableRow({ children: Object.values(row).map((v) => new TableCell({ children: [new Paragraph(String(v))] })) }))
    ];
    const doc = new Document({ sections: [{ children: [new Table({ rows })] }] });
    const buffer = await Packer.toBuffer(doc);
    fs.writeFileSync(filePath, buffer);
  } catch (error) {
    console.error("Word export error:", error);
  }
});