// === Import thư viện cần thiết ===
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

// === Khởi tạo ứng dụng ===
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

// === Cấu hình template engine và thư mục tĩnh ===
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

// === Lưu trữ thông tin các phòng ===
const rooms = new Map();

// === Routes ===

// Trang chủ
app.get('/', (req, res) => {
  res.render('index');
});

// Tạo phòng mới với ID ngẫu nhiên
app.get('/create', (req, res) => {
  const roomId = uuidv4().substring(0, 8);
  res.redirect(`/room/${roomId}`);
});

// Vào phòng họp
app.get('/room/:room', (req, res) => {
  const roomId = req.params.room;
  const room = rooms.get(roomId);
  // Giới hạn 2 người cho cuộc gọi 1-1
  if (room && room.size >= 2) {
    return res.redirect('/?error=full');
  }
  res.render('room', { roomId });
});

// === Xử lý Socket.io - Signaling Server ===
io.on('connection', (socket) => {
  console.log(`[+] Kết nối mới: ${socket.id}`);

  // Người dùng tham gia phòng
  socket.on('join-room', (roomId) => {
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
    // Thông báo cho người trong phòng
    socket.to(roomId).emit('user-joined', socket.id);
    io.to(roomId).emit('room-users', room.size);
    console.log(`[→] ${socket.id} vào phòng ${roomId} (${room.size}/2)`);
  });

  // Chuyển tiếp SDP Offer
  socket.on('offer', (data) => {
    socket.to(data.to).emit('offer', {
      offer: data.offer,
      from: socket.id
    });
  });

  // Chuyển tiếp SDP Answer
  socket.on('answer', (data) => {
    socket.to(data.to).emit('answer', {
      answer: data.answer,
      from: socket.id
    });
  });

  // Chuyển tiếp ICE Candidate
  socket.on('ice-candidate', (data) => {
    socket.to(data.to).emit('ice-candidate', {
      candidate: data.candidate,
      from: socket.id
    });
  });

  // Người dùng ngắt kết nối
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
