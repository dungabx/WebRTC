// === WebRTC MESH GROUP VIDEO CALL ===
// Mỗi User sẽ mở N kết nối P2P tới N người khác trong phòng

const roomId = document.getElementById('room-id').value;
const usrId = document.getElementById('usr-id').value;
const usrNickname = document.getElementById('usr-nickname').value;
const usrAvatar = document.getElementById('usr-avatar').value;
const myProfile = { id: usrId, nickname: usrNickname, avatar: usrAvatar };

const iceConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' }
  ]
};

const socket = io();

// Quản lý Đa Luồng
const peers = {}; // Định dạng: { socketId: { pc, dc, queue } }
let localStream = null;
let isMuted = false;
let isCameraOff = false;
let isChatOpen = false;
let unreadMessages = 0;

// Các DOM elements
const videoGrid = document.getElementById('video-grid');
const localVideo = document.getElementById('local-video');
const statusDot = document.querySelector('.status-dot');
const statusText = document.querySelector('.status-text');

// === Khởi chạy ứng dụng ===
async function init() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
      audio: { echoCancellation: true, noiseSuppression: true }
    });
    localVideo.srcObject = localStream;
    socket.emit('join-room', roomId, myProfile);
    updateStatus('connected', 'Đã tham gia phòng');
  } catch (err) {
    console.error('Lỗi truy cập media:', err);
    showToast('Hãy cấp quyền truy cập Camera/Mic!', 'error');
  }
}

// Xử lý Reconnect
socket.on('connect', () => {
  if (localStream) {
    socket.emit('join-room', roomId, myProfile);
  }
});

// Ngắt kết nối
socket.on('disconnect', () => {
    updateStatus('warning', 'Đang kết nối lại...');
});

// THUẬT TOÁN MESH: Khi có 1 người gia nhập, MỌI NGƯỜI CŨ trong phòng sẽ gửi Offer cho người đó
socket.on('user-joined', async (data) => {
  const { userId, profile } = data;
  showToast(`${profile.nickname} đã tham gia`, 'info');
  
  // Dọn dẹp nếu có kết nối cũ dính lỗi
  if (peers[userId]) cleanUpPeer(userId);

  createPeerConnection(userId, profile);
  createDataChannel(userId);
  try {
    const offer = await peers[userId].pc.createOffer();
    await peers[userId].pc.setLocalDescription(offer);
    socket.emit('offer', { offer, to: userId, profile: myProfile });
  } catch (err) { console.error('Lỗi tạo Offer', err); }
});

// Nguời mới NHẬN OFFER từ mảng những người cũ
socket.on('offer', async (data) => {
  const { offer, from, profile } = data;
  if (!peers[from]) {
    createPeerConnection(from, profile);
    peers[from].pc.ondatachannel = (event) => {
      peers[from].dc = event.channel;
      setupDataChannel(from);
    };
  }
  
  try {
    await peers[from].pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await peers[from].pc.createAnswer();
    await peers[from].pc.setLocalDescription(answer);
    socket.emit('answer', { answer, to: from });
    
    // Nạp queue ICE
    while(peers[from].queue.length) {
       try { await peers[from].pc.addIceCandidate(peers[from].queue.shift()); } catch(e){}
    }
  } catch (err) { console.error('Lỗi Offer', err); }
});

// Chấp nhận ERROR
socket.on('answer', async (data) => {
  try {
    const pc = peers[data.from]?.pc;
    if (pc) {
       await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
       while(peers[data.from].queue.length) {
         try { await pc.addIceCandidate(peers[data.from].queue.shift()); } catch(e){}
       }
    }
  } catch (err) { console.error('Lỗi Answer', err); }
});

// ICE Candidate
socket.on('ice-candidate', async (data) => {
  const pcInfo = peers[data.from];
  if (!pcInfo) {
     // Gói tới quá sớm, lưu bộ đệm
     peers[data.from] = { queue: [new RTCIceCandidate(data.candidate)] };
     return;
  }
  if (!pcInfo.queue) pcInfo.queue = [];
  try {
     if (pcInfo.pc && pcInfo.pc.remoteDescription && pcInfo.pc.remoteDescription.type) {
         await pcInfo.pc.addIceCandidate(new RTCIceCandidate(data.candidate));
     } else {
         pcInfo.queue.push(new RTCIceCandidate(data.candidate));
     }
  } catch(e) {}
});

// Xử lý Người ra
socket.on('user-left', (userId) => {
  cleanUpPeer(userId);
  updateGridLayout();
});

// Khởi tạo Peer Connection
function createPeerConnection(userId, profile) {
  if (!peers[userId]) peers[userId] = { queue: [] };
  const pc = new RTCPeerConnection(iceConfig);
  peers[userId].pc = pc;

  localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

  pc.ontrack = (e) => {
     if (!document.getElementById(`vid-${userId}`)) {
        const stream = e.streams[0];
        const dom = document.createElement('div');
        dom.className = 'grid-video-item';
        dom.id = `vid-${userId}`;
        dom.innerHTML = `
           <video autoplay playsinline></video>
           <div class="grid-video-label">
             <img src="${profile.avatar}">
             <span>${profile.nickname}</span>
           </div>
        `;
        videoGrid.appendChild(dom);
        const vid = dom.querySelector('video');
        vid.srcObject = stream;
        vid.play().catch(()=>{});
        updateGridLayout();
     }
  };

  pc.onicecandidate = (e) => {
     if (e.candidate) socket.emit('ice-candidate', { candidate: e.candidate, to: userId });
  };
}

function createDataChannel(userId) {
  const dc = peers[userId].pc.createDataChannel('chat', { ordered: true });
  peers[userId].dc = dc;
  setupDataChannel(userId);
}

function setupDataChannel(userId) {
  peers[userId].dc.onmessage = (event) => {
    try {
      const parsed = JSON.parse(event.data);
      if (parsed.type === 'chat') {
         addMessage(parsed.text, 'remote');
      } else if (parsed.type === 'file') {
         const fileHtml = parsed.mimetype.startsWith('image/') 
            ? `<img src="${parsed.url}" class="chat-image" onclick="window.open(this.src)">`
            : `<a href="${parsed.url}" class="chat-file-link" target="_blank"><i class="fas fa-file"></i> ${parsed.filename}</a>`;
         addMessage(fileHtml, 'remote');
      }
      if (!isChatOpen) {
          unreadMessages++;
          document.getElementById('chat-badge').textContent = unreadMessages;
          document.getElementById('chat-badge').style.display = 'flex';
      }
    } catch(e) { }
  };
}

function cleanUpPeer(userId) {
  if (peers[userId]) {
    if (peers[userId].pc) peers[userId].pc.close();
    delete peers[userId];
  }
  const dom = document.getElementById(`vid-${userId}`);
  if (dom) dom.remove();
}

function updateGridLayout() {
  const total = document.querySelectorAll('.grid-video-item').length;
  videoGrid.setAttribute('data-users', total);
}

// === Các lệnh Button và Controls (giữ nguyên logic gốc) ===
function toggleMic() {
  const track = localStream.getAudioTracks()[0];
  if(track) {
     isMuted = !isMuted; track.enabled = !isMuted;
     const btn = document.getElementById('btn-mic');
     btn.classList.toggle('active', isMuted);
     btn.innerHTML = isMuted ? '<i class="fas fa-microphone-slash"></i>' : '<i class="fas fa-microphone"></i>';
  }
}

function toggleCamera() {
  const track = localStream.getVideoTracks()[0];
  if(track) {
     isCameraOff = !isCameraOff; track.enabled = !isCameraOff;
     const btn = document.getElementById('btn-camera');
     btn.classList.toggle('active', isCameraOff);
     btn.innerHTML = isCameraOff ? '<i class="fas fa-video-slash"></i>' : '<i class="fas fa-video"></i>';
  }
}

function toggleChat() {
  isChatOpen = !isChatOpen;
  document.getElementById('chat-panel').classList.toggle('open', isChatOpen);
  document.getElementById('btn-chat').classList.toggle('active', isChatOpen);
  if (isChatOpen) {
    unreadMessages = 0; document.getElementById('chat-badge').style.display = 'none';
  }
}

// Gửi tin nhắn Broadcast toàn phòng
function broadcastData(jsonData) {
  const str = JSON.stringify(jsonData);
  Object.values(peers).forEach(p => {
     if (p.dc && p.dc.readyState === 'open') p.dc.send(str);
  });
}

const chatInput = document.getElementById('chat-input');
document.getElementById('chat-send-btn').addEventListener('click', () => {
  const text = chatInput.value.trim();
  if(!text) return;
  broadcastData({ type: 'chat', text: text });
  addMessage(text, 'local');
  chatInput.value = '';
});

// Upload Multi-peer
const fileInput = document.getElementById('chat-file-input');
const attachBtn = document.getElementById('chat-attach-btn');
attachBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if(!file) return;
  const formData = new FormData(); formData.append('file', file);
  try {
    attachBtn.querySelector('i').className = 'fas fa-spinner fa-spin';
    const res = await fetch('/api/chat-upload', { method: 'POST', body: formData });
    const data = await res.json();
    attachBtn.querySelector('i').className = 'fas fa-paperclip';
    
    if (data.error) return showToast(data.error, 'error');
    const fileHtml = data.mimetype.startsWith('image/') 
          ? `<img src="${data.url}" class="chat-image" onclick="window.open(this.src)">`
          : `<a href="${data.url}" class="chat-file-link" target="_blank"><i class="fas fa-file"></i> ${data.filename}</a>`;
    addMessage(fileHtml, 'local');
    broadcastData({ type: 'file', url: data.url, filename: data.filename, mimetype: data.mimetype });
  } catch(err) {}
});

function addMessage(text, type) {
  const chatMessages = document.getElementById('chat-messages');
  const empty = chatMessages.querySelector('.chat-empty');
  if(empty) empty.remove();
  const div = document.createElement('div');
  div.className = `msg msg-${type}`;
  div.innerHTML = text;
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

document.getElementById('btn-mic').addEventListener('click', toggleMic);
document.getElementById('btn-camera').addEventListener('click', toggleCamera);
document.getElementById('btn-chat').addEventListener('click', toggleChat);
document.getElementById('chat-close-btn').addEventListener('click', toggleChat);
document.getElementById('btn-leave').addEventListener('click', () => window.location.href='/');
document.getElementById('copy-btn').addEventListener('click', () => {
  navigator.clipboard.writeText(window.location.href);
  showToast('Đã sao chép link Nhóm!', 'success');
});

function showToast(msg, type='info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span>${msg}</span>`;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}
function updateStatus(state, text) {
  statusDot.className = 'status-dot';
  if (state === 'connected') statusDot.classList.add('connected');
  else if (state === 'failed') statusDot.classList.add('failed');
  statusText.textContent = text;
}

init();
