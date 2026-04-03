# WebRTC Video Call - Gọi Video P2P

Ứng dụng gọi video thời gian thực sử dụng WebRTC, cho phép giao tiếp audio/video P2P trực tiếp giữa hai trình duyệt.

## Tính năng

-  **Gọi video 1-1** - Kết nối P2P trực tiếp qua WebRTC
-  **Điều khiển media** - Bật/tắt mic, camera
-  **Chia sẻ màn hình** - Share screen trực tiếp thông qua replaceTrack
-  **Chat P2P** - Nhắn tin qua RTCDataChannel (không qua server)
-  **Bảo mật** - Mã hóa E2E bởi WebRTC
-  **Responsive** - Hỗ trợ cả desktop và mobile

## Công nghệ

| Thành phần | Công nghệ |
|------------|-----------|
| Backend | Node.js + Express.js |
| Template | EJS |
| Signaling | Socket.io |
| Frontend | Vanilla JS + CSS |
| P2P | WebRTC (RTCPeerConnection, DataChannel) |
| NAT Traversal | Google STUN Servers |

## Cài đặt

### Yêu cầu hệ thống
- Node.js >= 18.0.0
- npm >= 8.0.0
- Trình duyệt hỗ trợ WebRTC (Chrome, Firefox, Edge, Safari)
- Camera và microphone

### Các bước cài đặt

```bash
# 1. Clone repository
git clone https://github.com/dungabx/WebRTC.git
cd source

# 2. Cài đặt dependencies
npm install

# 3. Chạy server
npm start

# 4. Mở trình duyệt
# Truy cập http://localhost:3000
```

### Chạy ở chế độ development
```bash
npm run dev
```

## Cách sử dụng

1. **Tạo phòng**: Nhấn "Tạo Phòng" trên trang chủ
2. **Chia sẻ mã phòng**: Gửi mã phòng hoặc liên kết cho đối phương
3. **Tham gia phòng**: Đối phương nhập mã phòng và nhấn tham gia
4. **Bắt đầu gọi**: Cuộc gọi tự động thiết lập khi cả 2 người vào phòng
5. **Sử dụng tính năng**: Bật/tắt mic, camera, chia sẻ màn hình, chat

## Cấu trúc thư mục

```
source/
├── index.js              # Khởi tạo Server Express & thiết lập Socket.io
├── package.json          # Danh sách quản lý các thư viện (dependencies)
├── package-lock.json     # Khóa phiên bản thư viện (Tự động sinh bởi npm)
├── pubspec.yaml          
├── stream.js             
├── public/
│   ├── css/
│   │   └── style.css     # Stylesheet (dark theme)
│   └── js/
│       └── stream.js     # Chứa logic WebRTC ở phía Client
└── views/
    ├── index.ejs         # Thiết kế trang chủ
    └── room.ejs          # Thiết kế trang phòng gọi
```

## Kiến trúc hệ thống

```
Client A ←→ Signaling Server (Socket.io) ←→ Client B
   ↕              ↕                           ↕
   └──── STUN Server ────────────────────────┘
   └──────── P2P Media Stream (trực tiếp) ───┘
```

1. **Signaling**: Trao đổi SDP Offer/Answer và ICE Candidates qua Socket.io
2. **STUN**: Google STUN servers giúp tìm địa chỉ IP public
3. **P2P**: Sau khi thiết lập, media truyền trực tiếp giữa 2 peer

## Deploy

Ứng dụng đã được deploy và khởi chạy thành công trên nền tảng đám mây **Render**:
- **Link (Gọi video thực tế)**: [https://webrtc-0onu.onrender.com/](https://webrtc-0onu.onrender.com/)
- **Link (Demo gg drive)**: [https://drive.google.com/file/d/1j2e0PzFYkCUC-N4WFD5bO6u1L7zCS96R/view?usp=sharing](https://drive.google.com/file/d/1j2e0PzFYkCUC-N4WFD5bO6u1L7zCS96R/view?usp=sharing)

## Thành viên nhóm

| STT | Họ tên | MSSV |
|-----|--------|------|
| 1   |Huỳnh Văn Dũng| 52300190 |

## Giảng viên hướng dẫn
- **Phạm Ngọc Nam**

## Môn học
- Lập trình Web & Ứng dụng (503073)
- Học kỳ 2 - 2025-2026
