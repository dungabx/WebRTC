// === Import thư viện cần thiết ===
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const db = require('./db');

// === Khởi tạo ứng dụng ===
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

// === Cấu hình Multer upload ===
const storage = multer.diskStorage({
  destination: function (req, file, cb) { cb(null, path.join(__dirname, 'public/uploads')); },
  filename: function (req, file, cb) { cb(null, Date.now() + path.extname(file.originalname)); }
});
const upload = multer({ storage: storage });

// === Cấu hình template engine và thư mục tĩnh ===
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// === Cấu hình Session ===
app.use(session({
  secret: 'webrtc-secret-key-123',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 } // 1 day
}));

// Middleware bắt buộc đăng nhập
function requireLogin(req, res, next) {
  if (req.session.userId) return next();
  res.redirect('/login');
}

// === Lưu trữ thông tin các phòng ===
const rooms = new Map();

// === Routes Authentication ===

// Mặc định Trang Chủ
app.get('/', (req, res) => {
  if (req.session.userId) {
    res.render('index', { user: req.session.user });
  } else {
    res.redirect('/login');
  }
});

// Trang Đăng nhập
app.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/');
  res.render('login', { error: null });
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  db.get('SELECT * FROM users WHERE username = ?', [username], (err, user) => {
    if (err) return res.render('login', { error: 'Lỗi server' });
    if (!user || !bcrypt.compareSync(password, user.password)) {
      return res.render('login', { error: 'Sai tài khoản hoặc mật khẩu' });
    }
    req.session.userId = user.id;
    req.session.user = user;
    res.redirect('/');
  });
});

// Trang Đăng ký
app.get('/register', (req, res) => {
  res.render('register', { error: null });
});

app.post('/register', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.render('register', { error: 'Vui lòng nhập đủ thông tin' });

  const hash = bcrypt.hashSync(password, 10);
  const nickname = 'User ' + Math.floor(Math.random() * 1000);
  
  db.run('INSERT INTO users (username, password, nickname, avatar) VALUES (?, ?, ?, ?)', 
    [username, hash, nickname, 'https://cdn-icons-png.flaticon.com/512/149/149071.png'], function(err) {
      if (err) return res.render('register', { error: 'Tài khoản đã tồn tại' });
      res.redirect('/login');
  });
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

// === Routes Hồ sơ (Profile) ===
app.get('/profile', requireLogin, (req, res) => {
  db.get('SELECT * FROM users WHERE id = ?', [req.session.userId], (err, user) => {
    db.all('SELECT * FROM call_history WHERE user_id = ? ORDER BY created_at DESC', [req.session.userId], (err, history) => {
      res.render('profile', { user, history: history || [] });
    });
  });
});

// API Lưu lịch sử cuộc gọi
app.post('/api/history', requireLogin, (req, res) => {
  const { roomCode, duration } = req.body;
  if (!roomCode || !duration) return res.status(400).json({ error: 'Missing data' });
  
  db.run('INSERT INTO call_history (user_id, room_code, duration_seconds) VALUES (?, ?, ?)',
    [req.session.userId, roomCode, duration], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, id: this.lastID });
  });
});

app.post('/profile', requireLogin, upload.single('avatar'), (req, res) => {
  const nickname = req.body.nickname;
  let avatar = req.session.user.avatar;
  
  if (req.file) {
    avatar = '/uploads/' + req.file.filename;
  }
  
  db.run('UPDATE users SET nickname = ?, avatar = ? WHERE id = ?', [nickname, avatar, req.session.userId], (err) => {
    if (!err) {
      req.session.user.nickname = nickname;
      req.session.user.avatar = avatar;
    }
    res.redirect('/profile');
  });
});

// === Routes Bấm Phòng ===

// Tạo phòng mới 
app.get('/create', requireLogin, (req, res) => {
  const roomId = uuidv4().substring(0, 8);
  res.redirect(`/room/${roomId}`);
});

// Vào phòng họp
app.get('/room/:room', requireLogin, (req, res) => {
  const roomId = req.params.room;
  const room = rooms.get(roomId);
  
  if (room && room.size >= 2) {
    return res.redirect('/?error=full');
  }
  
  // Nạp lại thông tin mới nhất từ CSDL 
  db.get('SELECT * FROM users WHERE id = ?', [req.session.userId], (err, user) => {
    res.render('room', { roomId, user });
  });
});

// === Xử lý Socket.io - Signaling Server ===
io.on('connection', (socket) => {
  console.log(`[+] Kết nối mới: ${socket.id}`);

  // Chứa thêm thông tin session user 
  socket.on('join-room', (roomId, userProfile) => {
    if (!rooms.has(roomId)) {
      rooms.set(roomId, new Set());
    }
    const room = rooms.get(roomId);
    if (room.size >= 2) {
      socket.emit('room-full');
      return;
    }
    room.add(socket.id);
    socket.join(roomId);
    socket.roomId = roomId;

    // Lưu Profile vào socket của người này để dễ gửi chéo
    socket.userProfile = userProfile;

    // Thông báo cho người trong phòng kèm Profile
    socket.to(roomId).emit('user-joined', { userId: socket.id, profile: userProfile });
    io.to(roomId).emit('room-users', room.size);
    console.log(`[→] ${socket.id} vào phòng ${roomId} (${room.size}/2)`);
  });

  socket.on('offer', (data) => {
    socket.to(data.to).emit('offer', { offer: data.offer, from: socket.id, profile: socket.userProfile });
  });

  socket.on('answer', (data) => {
    socket.to(data.to).emit('answer', { answer: data.answer, from: socket.id });
  });

  socket.on('ice-candidate', (data) => {
    socket.to(data.to).emit('ice-candidate', { candidate: data.candidate, from: socket.id });
  });

  socket.on('disconnect', () => {
    if (socket.roomId) {
      const room = rooms.get(socket.roomId);
      if (room) {
        room.delete(socket.id);
        if (room.size === 0) {
          rooms.delete(socket.roomId);
        } else {
          io.to(socket.roomId).emit('room-users', room.size);
        }
      }
      socket.to(socket.roomId).emit('user-left', socket.id);
      console.log(`[←] ${socket.id} rời phòng ${socket.roomId}`);
    }
  });
});

// === Khởi động server ===
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server chạy tại: http://localhost:${PORT}`);
  console.log(`📡 Signaling server sẵn sàng`);
});
