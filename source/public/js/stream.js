// === WebRTC Video Call - Client Logic ===
// Xử lý kết nối P2P, signaling, media controls, screen sharing, DataChannel chat

// === Cấu hình STUN servers ===
const iceConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' }
  ]
};

// === Kết nối Socket.io ===
const socket = io();

// === Biến toàn cục ===
let localStream = null;       // Luồng media của bản thân
let peerConnection = null;    // Kết nối P2P
let dataChannel = null;       // Kênh dữ liệu cho chat
let remoteUserId = null;      // ID người kia
let isScreenSharing = false;  // Trạng thái chia sẻ màn hình
let isMuted = false;          // Trạng thái mic
let isCameraOff = false;      // Trạng thái camera
let isChatOpen = false;       // Trạng thái chat panel
let unreadMessages = 0;       // Số tin nhắn chưa đọc

// === Lấy DOM elements ===
const localVideo = document.getElementById('local-video');
const remoteVideo = document.getElementById('remote-video');
const roomId = document.getElementById('room-id').value;
const remotePlaceholder = document.getElementById('remote-placeholder');
const remoteLabel = document.getElementById('remote-label');
const chatPanel = document.getElementById('chat-panel');
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const chatBadge = document.getElementById('chat-badge');
const statusDot = document.querySelector('.status-dot');
const statusText = document.querySelector('.status-text');

// === Khởi tạo ứng dụng ===
async function init() {
  try {
    // Yêu cầu quyền truy cập camera và mic
    localStream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    });
    localVideo.srcObject = localStream;
    // Tham gia phòng qua signaling server
    socket.emit('join-room', roomId);
    showToast('Đã vào phòng thành công', 'success');
  } catch (err) {
    console.error('Lỗi truy cập media:', err);
    showToast('Không thể truy cập camera/microphone. Hãy cấp quyền!', 'error');
  }
}

// === Tạo RTCPeerConnection ===
function createPeerConnection(userId) {
  peerConnection = new RTCPeerConnection(iceConfig);
  remoteUserId = userId;

  // Thêm các track media vào kết nối
  localStream.getTracks().forEach(track => {
    peerConnection.addTrack(track, localStream);
  });

  // Nhận track media từ đối phương
  peerConnection.ontrack = (event) => {
    remoteVideo.srcObject = event.streams[0];
    remotePlaceholder.style.display = 'none';
    remoteLabel.style.display = 'block';
    updateStatus('connected', 'Đã kết nối');
    showToast('Cuộc gọi đã được thiết lập!', 'success');
  };

  // Gửi ICE candidate tới đối phương qua signaling
  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('ice-candidate', { candidate: event.candidate, to: userId });
    }
  };

  // Theo dõi trạng thái kết nối
  peerConnection.onconnectionstatechange = () => {
    const state = peerConnection.connectionState;
    if (state === 'connected') updateStatus('connected', 'Đã kết nối');
    else if (state === 'disconnected') updateStatus('warning', 'Mất kết nối...');
    else if (state === 'failed') {
      updateStatus('failed', 'Kết nối thất bại');
      peerConnection.restartIce();
    }
  };

  // Tự động khôi phục khi ICE thất bại
  peerConnection.oniceconnectionstatechange = () => {
    if (peerConnection.iceConnectionState === 'failed') peerConnection.restartIce();
  };

  return peerConnection;
}

// === Tạo DataChannel (chat P2P) ===
function createDataChannel() {
  dataChannel = peerConnection.createDataChannel('chat', { ordered: true });
  setupDataChannel(dataChannel);
}

// Thiết lập sự kiện cho DataChannel
function setupDataChannel(channel) {
  channel.onopen = () => { console.log('DataChannel đã mở'); };
  channel.onclose = () => { console.log('DataChannel đã đóng'); };
  channel.onmessage = (event) => {
    addMessage(event.data, 'remote');
    if (!isChatOpen) {
      unreadMessages++;
      chatBadge.textContent = unreadMessages;
      chatBadge.style.display = 'flex';
    }
  };
}

// === Socket Events (Signaling) ===

// Có người mới vào phòng → tạo offer
socket.on('user-joined', async (userId) => {
  showToast('Có người tham gia phòng', 'info');
  createPeerConnection(userId);
  createDataChannel();
  try {
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    socket.emit('offer', { offer, to: userId });
  } catch (err) {
    console.error('Lỗi tạo offer:', err);
  }
});

// Nhận offer → tạo answer
socket.on('offer', async (data) => {
  createPeerConnection(data.from);
  // Lắng nghe DataChannel từ người gửi offer
  peerConnection.ondatachannel = (event) => {
    dataChannel = event.channel;
    setupDataChannel(dataChannel);
  };
  try {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    socket.emit('answer', { answer, to: data.from });
  } catch (err) {
    console.error('Lỗi xử lý offer:', err);
  }
});

// Nhận answer
socket.on('answer', async (data) => {
  try {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
  } catch (err) {
    console.error('Lỗi xử lý answer:', err);
  }
});

// Nhận ICE candidate
socket.on('ice-candidate', async (data) => {
  try {
    if (peerConnection) {
      await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
    }
  } catch (err) {
    console.error('Lỗi ICE candidate:', err);
  }
});

// Người dùng rời phòng
socket.on('user-left', () => {
  showToast('Đối phương đã rời phòng', 'warning');
  if (peerConnection) { peerConnection.close(); peerConnection = null; }
  dataChannel = null;
  remoteVideo.srcObject = null;
  remotePlaceholder.style.display = 'flex';
  remoteLabel.style.display = 'none';
  updateStatus('waiting', 'Đang chờ...');
});

// Phòng đầy
socket.on('room-full', () => {
  showToast('Phòng đã đầy (tối đa 2 người)', 'error');
  setTimeout(() => window.location.href = '/', 3000);
});

// === Điều khiển Media ===

// Tắt/Bật mic
function toggleMic() {
  const track = localStream.getAudioTracks()[0];
  if (!track) return;
  isMuted = !isMuted;
  track.enabled = !isMuted;
  const btn = document.getElementById('btn-mic');
  btn.classList.toggle('active', isMuted);
  btn.innerHTML = isMuted ? '<i class="fas fa-microphone-slash"></i>' : '<i class="fas fa-microphone"></i>';
  showToast(isMuted ? 'Đã tắt mic' : 'Đã bật mic', 'info');
}

// Tắt/Bật camera
function toggleCamera() {
  const track = localStream.getVideoTracks()[0];
  if (!track) return;
  isCameraOff = !isCameraOff;
  track.enabled = !isCameraOff;
  const btn = document.getElementById('btn-camera');
  btn.classList.toggle('active', isCameraOff);
  btn.innerHTML = isCameraOff ? '<i class="fas fa-video-slash"></i>' : '<i class="fas fa-video"></i>';
  showToast(isCameraOff ? 'Đã tắt camera' : 'Đã bật camera', 'info');
}

// Chia sẻ màn hình
async function toggleScreenShare() {
  if (!peerConnection) {
    showToast('Chưa có kết nối P2P', 'warning');
    return;
  }
  if (!isScreenSharing) {
    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: 'always' }, audio: false
      });
      const screenTrack = screenStream.getVideoTracks()[0];
      const sender = peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
      if (sender) await sender.replaceTrack(screenTrack);
      localVideo.srcObject = screenStream;
      isScreenSharing = true;
      document.getElementById('btn-screen').classList.add('active');
      showToast('Đang chia sẻ màn hình', 'success');
      // Khi người dùng dừng chia sẻ qua nút hệ thống
      screenTrack.onended = () => stopScreenShare();
    } catch (err) {
      console.error('Lỗi chia sẻ màn hình:', err);
    }
  } else {
    stopScreenShare();
  }
}

async function stopScreenShare() {
  const videoTrack = localStream.getVideoTracks()[0];
  const sender = peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
  if (sender && videoTrack) await sender.replaceTrack(videoTrack);
  localVideo.srcObject = localStream;
  isScreenSharing = false;
  document.getElementById('btn-screen').classList.remove('active');
  showToast('Đã dừng chia sẻ màn hình', 'info');
}

// Toggle chat panel
function toggleChat() {
  isChatOpen = !isChatOpen;
  chatPanel.classList.toggle('open', isChatOpen);
  document.getElementById('btn-chat').classList.toggle('active', isChatOpen);
  if (isChatOpen) {
    unreadMessages = 0;
    chatBadge.style.display = 'none';
    chatInput.focus();
  }
}

// Gửi tin nhắn qua DataChannel
function sendMessage() {
  const text = chatInput.value.trim();
  if (!text) return;
  if (dataChannel && dataChannel.readyState === 'open') {
    dataChannel.send(text);
    addMessage(text, 'local');
    chatInput.value = '';
  } else {
    showToast('Chưa kết nối chat. Hãy đợi kết nối P2P.', 'warning');
  }
}

// Thêm tin nhắn vào giao diện
function addMessage(text, type) {
  // Xóa placeholder "chưa có tin nhắn"
  const empty = chatMessages.querySelector('.chat-empty');
  if (empty) empty.remove();

  const now = new Date();
  const time = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
  const div = document.createElement('div');
  div.className = `msg msg-${type}`;
  div.innerHTML = `${text}<span class="msg-time">${time}</span>`;
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Rời phòng
function leaveRoom() {
  if (localStream) localStream.getTracks().forEach(t => t.stop());
  if (peerConnection) peerConnection.close();
  socket.disconnect();
  window.location.href = '/';
}

// === UI Helpers ===

// Cập nhật trạng thái kết nối
function updateStatus(state, text) {
  statusDot.className = 'status-dot';
  if (state === 'connected') statusDot.classList.add('connected');
  else if (state === 'failed') statusDot.classList.add('failed');
  statusText.textContent = text;
}

// Hiển thị thông báo toast
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const icons = { success: 'fa-check-circle', warning: 'fa-exclamation-triangle',
    error: 'fa-times-circle', info: 'fa-info-circle' };
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<i class="fas ${icons[type]}"></i><span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

// Sao chép mã phòng
function copyRoomCode() {
  const url = window.location.href;
  navigator.clipboard.writeText(url).then(() => {
    showToast('Đã sao chép liên kết phòng!', 'success');
  }).catch(() => {
    // Fallback cho trình duyệt không hỗ trợ clipboard API
    const input = document.createElement('input');
    input.value = url;
    document.body.appendChild(input);
    input.select();
    document.execCommand('copy');
    document.body.removeChild(input);
    showToast('Đã sao chép liên kết phòng!', 'success');
  });
}

// === Gắn sự kiện ===
document.getElementById('btn-mic').addEventListener('click', toggleMic);
document.getElementById('btn-camera').addEventListener('click', toggleCamera);
document.getElementById('btn-screen').addEventListener('click', toggleScreenShare);
document.getElementById('btn-chat').addEventListener('click', toggleChat);
document.getElementById('btn-leave').addEventListener('click', leaveRoom);
document.getElementById('copy-btn').addEventListener('click', copyRoomCode);
document.getElementById('chat-close-btn').addEventListener('click', toggleChat);
document.getElementById('chat-send-btn').addEventListener('click', sendMessage);

// Gửi tin nhắn bằng Enter
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendMessage();
});

// Sao chép liên kết từ placeholder
const shareLinkBtn = document.getElementById('share-link-btn');
if (shareLinkBtn) shareLinkBtn.addEventListener('click', copyRoomCode);

// === Kéo thả local video (PIP) ===
const localContainer = document.getElementById('local-container');
let isDragging = false, dragOffsetX = 0, dragOffsetY = 0;
localContainer.addEventListener('mousedown', (e) => {
  isDragging = true;
  dragOffsetX = e.clientX - localContainer.offsetLeft;
  dragOffsetY = e.clientY - localContainer.offsetTop;
  localContainer.style.cursor = 'grabbing';
  localContainer.style.transition = 'none';
});
document.addEventListener('mousemove', (e) => {
  if (!isDragging) return;
  const x = Math.max(0, Math.min(window.innerWidth - localContainer.offsetWidth, e.clientX - dragOffsetX));
  const y = Math.max(56, Math.min(window.innerHeight - 80 - localContainer.offsetHeight, e.clientY - dragOffsetY));
  localContainer.style.left = x + 'px';
  localContainer.style.top = y + 'px';
  localContainer.style.right = 'auto';
  localContainer.style.bottom = 'auto';
});
document.addEventListener('mouseup', () => {
  isDragging = false;
  localContainer.style.cursor = 'move';
  localContainer.style.transition = 'all .3s var(--ease, ease)';
});

// === Fullscreen remote video khi double-click ===
const remoteContainer = document.getElementById('remote-container');
remoteContainer.addEventListener('dblclick', () => {
  if (document.fullscreenElement) {
    document.exitFullscreen();
  } else {
    remoteContainer.requestFullscreen().catch(() => {});
  }
});

// === Phím tắt ===
document.addEventListener('keydown', (e) => {
  // Không xử lý khi đang gõ chat
  if (e.target === chatInput) return;
  switch(e.key.toLowerCase()) {
    case 'm': toggleMic(); break;       // M = toggle mic
    case 'v': toggleCamera(); break;    // V = toggle camera
    case 's': toggleScreenShare(); break; // S = screen share
    case 'c': toggleChat(); break;      // C = toggle chat
    case 'escape': 
      if (isChatOpen) toggleChat();
      break;
  }
});

// === Khởi chạy ===
init();
