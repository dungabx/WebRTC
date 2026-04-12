const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Kết nối tới CSDL SQLite (Lưu trên file vật lý)
const dbPath = path.resolve(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error("Lỗi kết nối SQLite:", err.message);
    } else {
        console.log("🗄️ Kết nối tới SQLite thành công.");
        
        // Khởi tạo bảng users nếu chưa có
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            nickname TEXT,
            avatar TEXT
        )`, (err) => {
            if (err) console.error("Lỗi khi tạo Table users:", err.message);
            else {
                console.log("✅ Bảng users sẵn sàng.");
                
                // Khởi tạo bảng lịch sử cuộc gọi sau khi có bảng users
                db.run(`CREATE TABLE IF NOT EXISTS call_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    room_code TEXT NOT NULL,
                    duration_seconds INTEGER NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (user_id) REFERENCES users (id)
                )`, (err) => {
                    if (err) console.error("Lỗi khi tạo Table call_history:", err.message);
                    else console.log("✅ Bảng call_history sẵn sàng.");
                });
            }
        });
    }
});

module.exports = db;
