const sqlite3 = require("sqlite3").verbose();
const db = new sqlite3.Database("./users.db");

console.log("Cleaning users table...");

db.run("DELETE FROM users WHERE email='' OR email IS NULL", (err) => {
    if (err) console.log(err);
    else console.log("EMPTY EMAILS REMOVED ✔");
});

db.close();
