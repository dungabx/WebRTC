// === WebRTC Video Call - Client Logic ===
// Xử lý kết nối P2P, signaling, media controls, screen sharing, DataChannel chat

// Lấy thông tin tài khoản đang thao tác
const usrNickname = document.getElementById('usr-nickname') ? document.getElementById('usr-nickname').value : 'Người dùng hệ thống';
const usrAvatar = document.getElementById('usr-avatar') ? document.getElementById('usr-avatar').value : '';
const myProfile = { nickname: usrNickname, avatar: usrAvatar };

// === Cấu hình STUN/TURN servers ===
const iceConfig = {
  iceServers: [
    // 1. Google STUN (dùng cho Wifi, mạng gia đình)
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    // 2. TURN Server miễn phí bằng dự án OpenRelay (Bắt buộc dùng khi vào mạng 4G/LTE)
    {
      urls: 'turn:openrelay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    },
    {
      urls: 'turn:openrelay.metered.ca:443',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    },
    {
      urls: 'turn:openrelay.metered.ca:443?transport=tcp',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    }
  ]
};

// === Kết nối Socket.io ===
const socket = io();

// Xử lý mất mạng/tái kết nối (Network Hopping)
socket.on('connect', () => {
    console.log(`[Socket] Kết nối thành công với ID: ${socket.id}`);
    // Nếu thiết bị đã từng vào phòng (tức là đã load Camera và WebRTC trước đó)
    // Thì cần nạp lại thông tin phòng để người khác nhận tín hiệu
    if (localStream && typeof roomId !== 'undefined') {
        iceCandidateQueue = []; // Xoá sạch rác IP phiên bản cũ mạng cũ
        socket.emit('join-room', roomId, myProfile);
    }
});

socket.on('disconnect', () => {
    console.warn('[Socket] Mất kết nối tới máy chủ (Có thể do chuyển đổi Wifi/4G)');
    updateStatus('warning', 'Đang kết nối lại máy chủ...');
});

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
let currentRemoteStream = null; // Luồng media của đối phương
let currentLocalStream = null;  // Luồng của bản thân (hoặc mix nền ảo)
let compositeInterval = null;
let screenStream = null;
let isSwapped = false;        // Trạng thái hoán đổi màn hình
let iceCandidateQueue = [];   // Lưu trữ ICE tới khi cấu hình xong Session

// === VAD & Timer Variables ===
let audioContext = null;
let vadAnalyser = null;
let isCurrentlySpeaking = false;
let callDuration = 0;
let callTimerInterval = null;

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

// === Cập nhật giao diện người bên kia ===
function updateRemoteProfileUI(profile) {
  if (profile) {
    const lbl = document.getElementById('remote-nickname');
    const img = document.getElementById('remote-avatar');
    if (lbl) lbl.textContent = profile.nickname;
    if (img) {
      img.src = profile.avatar;
      img.style.display = 'inline-block';
    }
  }
}

// === Thiết lập VAD (Nhận diện giọng nói) ===
function setupVAD(stream) {
  try {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    
    // Trình duyệt chặn AudioContext nếu chưa có tương tác → resume ngay
    if (audioContext.state === 'suspended') {
      const resumeAudio = () => {
        audioContext.resume().then(() => {
          console.log('[VAD] AudioContext đã resume thành công!');
        });
        document.removeEventListener('click', resumeAudio);
        document.removeEventListener('keydown', resumeAudio);
      };
      document.addEventListener('click', resumeAudio);
      document.addEventListener('keydown', resumeAudio);
      // Cũng thử resume ngay (một số trình duyệt cho phép)
      audioContext.resume();
    }
    
    const source = audioContext.createMediaStreamSource(stream);
    vadAnalyser = audioContext.createAnalyser();
    vadAnalyser.fftSize = 512;
    vadAnalyser.smoothingTimeConstant = 0.3;
    source.connect(vadAnalyser);
    
    // Đo biên độ sóng âm (Time Domain) - chính xác hơn Frequency cho giọng nói
    const bufferLength = vadAnalyser.fftSize;
    const dataArray = new Uint8Array(bufferLength);
    const localEl = document.getElementById('local-container');
    
    let speakingTimeout = null; // Debounce chống nhấp nháy
    
    console.log('[VAD] Khởi tạo VAD thành công, bắt đầu lắng nghe...');
    
    function detectVoice() {
      if (!vadAnalyser) { requestAnimationFrame(detectVoice); return; }
      
      // Nếu tắt mic → tắt speaking
      if (isMuted) {
          if (isCurrentlySpeaking) {
             isCurrentlySpeaking = false;
             localEl.classList.remove('speaking');
             if (dataChannel && dataChannel.readyState === 'open') {
                 dataChannel.send(JSON.stringify({ type: 'vad', speaking: false }));
             }
          }
          requestAnimationFrame(detectVoice);
          return;
      }
      
      // Đo biên độ Time Domain → tính RMS (Root Mean Square)
      vadAnalyser.getByteTimeDomainData(dataArray);
      let sumSquares = 0;
      for (let i = 0; i < bufferLength; i++) {
        const normalized = (dataArray[i] - 128) / 128; // chuẩn hóa về [-1, 1]
        sumSquares += normalized * normalized;
      }
      const rms = Math.sqrt(sumSquares / bufferLength);
      const volume = rms * 100; // Đưa về thang 0-100
      
      const speakingNow = volume > 3; // Ngưỡng 3/100 - rất nhạy với giọng nói
      
      if (speakingNow && !isCurrentlySpeaking) {
        // Bắt đầu nói
        if (speakingTimeout) clearTimeout(speakingTimeout);
        isCurrentlySpeaking = true;
        localEl.classList.add('speaking');
        console.log(`[VAD] 🎤 Đang nói! Volume: ${volume.toFixed(1)}`);
        
        if (dataChannel && dataChannel.readyState === 'open') {
            dataChannel.send(JSON.stringify({ type: 'vad', speaking: true }));
        }
      } else if (!speakingNow && isCurrentlySpeaking) {
        // Ngừng nói → debounce 300ms để tránh nhấp nháy
        if (!speakingTimeout) {
          speakingTimeout = setTimeout(() => {
            isCurrentlySpeaking = false;
            localEl.classList.remove('speaking');
            
            if (dataChannel && dataChannel.readyState === 'open') {
                dataChannel.send(JSON.stringify({ type: 'vad', speaking: false }));
            }
            speakingTimeout = null;
          }, 300);
        }
      }
      
      requestAnimationFrame(detectVoice);
    }
    detectVoice();
  } catch (err) {
    console.error('Lỗi khởi tạo VAD:', err);
  }
}

// === Timer & Call History Logic ===
async function startCallTimer() {
  if (callTimerInterval) return; // Đã chạy rồi
  callDuration = 0;
  const timerText = document.getElementById('timer-text');
  const timerDiv = document.getElementById('call-timer');
  if (timerDiv) timerDiv.style.display = 'flex';
  
  callTimerInterval = setInterval(() => {
    callDuration++;
    if (timerText) {
        const min = Math.floor(callDuration / 60).toString().padStart(2, '0');
        const sec = (callDuration % 60).toString().padStart(2, '0');
        timerText.textContent = `${min}:${sec}`;
    }
  }, 1000);
}

async function stopCallTimer() {
  if (callTimerInterval) {
    clearInterval(callTimerInterval);
    callTimerInterval = null;
    
    // Lưu lịch sử nếu gọi > 5 giây
    if (callDuration > 5) { 
       try {
           await fetch('/api/history', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ roomCode: roomId, duration: callDuration })
           });
       } catch (e) { console.error('Lỗi lưu lịch sử', e); }
    }
  }
}

// === Khởi tạo ứng dụng ===
async function init() {
  try {
    // Yêu cầu quyền truy cập camera và mic
    localStream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    });
    currentLocalStream = localStream;
    localVideo.srcObject = currentLocalStream;
    
    setupVAD(localStream); // Kích hoạt VAD
    
    // Tham gia phòng qua signaling server CÙNG VỚI PROFILE BẢN THÂN
    socket.emit('join-room', roomId, myProfile);
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
    currentRemoteStream = event.streams[0];
    if (isSwapped) {
       localVideo.srcObject = currentRemoteStream;
       // Ép play() trên Mobile Browser (rất quan trọng cho Safari/Chrome Android)
       localVideo.play().catch(e => console.error("Auto-play bị chặn, vui lòng tương tác màn hình:", e));
    } else {
       remoteVideo.srcObject = currentRemoteStream;
       remoteVideo.play().catch(e => console.error("Auto-play bị chặn:", e));
    }
    remotePlaceholder.style.display = 'none';
    remoteLabel.style.display = 'flex';
    updateStatus('connected', 'Đã kết nối');
    showToast('Cuộc gọi đã được thiết lập!', 'success');
  };

  // Gửi ICE candidate tới đối phương qua signaling
  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('ice-candidate', { candidate: event.candidate, to: userId });
    }
  };

  async function handleIceRestart() {
    if (!peerConnection) return;
    try {
      peerConnection.restartIce();
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      socket.emit('offer', { offer, to: remoteUserId, profile: myProfile });
    } catch (err) {
      console.error('Lỗi restart ICE:', err);
    }
  }

  // Theo dõi trạng thái kết nối
  peerConnection.onconnectionstatechange = () => {
    const state = peerConnection.connectionState;
    if (state === 'connected') {
       updateStatus('connected', 'Đã kết nối');
       startCallTimer();
    }
    else if (state === 'disconnected') updateStatus('warning', 'Đang mất mạng...');
    else if (state === 'failed') {
      updateStatus('failed', 'Mạng gián đoạn');
      handleIceRestart();
    }
  };

  // Tự động khôi phục khi ICE thất bại
  peerConnection.oniceconnectionstatechange = () => {
    console.log(`[ICE STATE EVENT]: Trạng thái P2P đổi thành -> ${peerConnection.iceConnectionState}`);
    if (peerConnection.iceConnectionState === 'failed') {
      console.warn('[ICE RESTART] Mạng sập... Đang cố gắng thương lượng lại!');
      handleIceRestart();
    }
  };

  peerConnection.onicegatheringstatechange = () => {
    console.log(`[ICE GATHERING]: Đang thu thập ứng viên -> mạng trạng thái: ${peerConnection.iceGatheringState}`);
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
    try {
      const parsed = JSON.parse(event.data);
      if (parsed.type === 'chat') {
        addMessage(parsed.text, 'remote');
        if (!isChatOpen) {
          unreadMessages++;
          chatBadge.textContent = unreadMessages;
          chatBadge.style.display = 'flex';
        }
      } else if (parsed.type === 'file') {
        const fileHtml = parsed.mimetype.startsWith('image/') 
            ? `<img src="${parsed.url}" class="chat-image" alt="${parsed.filename}" onclick="window.open(this.src)">`
            : `<a href="${parsed.url}" download="${parsed.filename}" class="chat-file-link" target="_blank"><i class="fas fa-file"></i> ${parsed.filename}</a>`;
        addMessage(fileHtml, 'remote');
        if (!isChatOpen) {
          unreadMessages++;
          chatBadge.textContent = unreadMessages;
          chatBadge.style.display = 'flex';
        }
      } else if (parsed.type === 'emoji') {
        createFloatingEmoji(parsed.emoji);
      } else if (parsed.type === 'vad') {
        if (parsed.speaking) {
          remoteVideo.parentElement.classList.add('speaking');
        } else {
          remoteVideo.parentElement.classList.remove('speaking');
        }
      }
    } catch(e) {
      // Fallback cho data text nguyên gốc
      addMessage(event.data, 'remote');
    }
  };
}

// === Lắng nghe sự kiện thả tim/Emoji ===
document.getElementById('btn-emoji')?.addEventListener('click', () => {
  createFloatingEmoji('💖'); // Hiển thị trên máy mình
  if (dataChannel && dataChannel.readyState === 'open') {
      dataChannel.send(JSON.stringify({ type: 'emoji', emoji: '💖' })); // Bắn sang máy kia
  } else {
      showToast('Cần kết nối P2P để thả tim', 'warning');
  }
});

// Hiệu ứng hạt EMOJI nổi lên màn hình
function createFloatingEmoji(emojiText) {
  const emoji = document.createElement('div');
  emoji.innerHTML = emojiText;
  emoji.className = 'floating-emoji';
  // Chỉnh vị trí xuất hiện vô định dưới đáy khung remote
  emoji.style.left = Math.random() * 80 + 10 + '%';
  document.getElementById('remote-container').appendChild(emoji);
  
  // Xóa DOM sau 3s (thời gian diễn ra animation)
  setTimeout(() => emoji.remove(), 3000);
}


// === Socket Events (Signaling) ===

// Có người mới vào phòng → tạo offer
socket.on('user-joined', async (data) => {
  const { userId, profile } = data;
  showToast(`${profile ? profile.nickname : 'Ai đó'} đã tham gia lại phòng`, 'info');
  updateRemoteProfileUI(profile);

  // Quan trọng: Nếu phát hiện có kết nối kẹt từ mạng đợt trước, đập đi xây lại
  if (peerConnection) {
      console.warn("Huỷ PeerConnection cũ để thiết lập trạng thái P2P mới...");
      peerConnection.close();
      peerConnection = null;
  }

  createPeerConnection(userId);
  createDataChannel();
  try {
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    socket.emit('offer', { offer, to: userId, profile: myProfile });
  } catch (err) {
    console.error('Lỗi tạo offer:', err);
  }
});

// Nhận offer → tạo answer
socket.on('offer', async (data) => {
  updateRemoteProfileUI(data.profile);

  if (!peerConnection) {
    createPeerConnection(data.from);
    peerConnection.ondatachannel = (event) => {
      dataChannel = event.channel;
      setupDataChannel(dataChannel);
    };
  }
  
  try {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    socket.emit('answer', { answer, to: data.from });
    
    // Nạp lại các gói ICE Candidate bị lag/tới sớm (Bọc Try catch an toàn)
    while (iceCandidateQueue.length) {
       let cand = iceCandidateQueue.shift();
       try { await peerConnection.addIceCandidate(cand); } 
       catch(e) { console.warn("Lỗi nạp ICE phụ kiện", e); }
    }
  } catch (err) {
    console.error('Lỗi xử lý offer:', err);
  }
});

// Nhận answer
socket.on('answer', async (data) => {
  try {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
    
    // Nạp lại các gói ICE Candidate (Bọc Try catch an toàn)
    while (iceCandidateQueue.length) {
       let cand = iceCandidateQueue.shift();
       try { await peerConnection.addIceCandidate(cand); } 
       catch(e) { console.warn("Lỗi nạp ICE phụ kiện", e); }
    }
  } catch (err) {
    console.error('Lỗi xử lý answer:', err);
  }
});

// Nhận ICE candidate
socket.on('ice-candidate', async (data) => {
  try {
    // Kể cả peerConnection chưa tạo (bị Null), vẫn phải đưa vào hàng đợi
    if (peerConnection && peerConnection.remoteDescription && peerConnection.remoteDescription.type) {
      await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
    } else {
      // Gói Network tới sớm hơn cả Video Request -> Xếp hàng đợi
      iceCandidateQueue.push(new RTCIceCandidate(data.candidate));
    }
  } catch (err) {
    console.error('Lỗi ICE candidate:', err);
  }
});

// Người dùng rời phòng
socket.on('user-left', () => {
  showToast('Đối phương đã rời phòng', 'warning');
  stopCallTimer();
  if (peerConnection) { peerConnection.close(); peerConnection = null; }
  dataChannel = null;
  remoteVideo.srcObject = null;
  currentRemoteStream = null;
  
  if(isSwapped) {
     isSwapped = false;
     localVideo.srcObject = currentLocalStream;
     remoteVideo.srcObject = null;
     localVideo.muted = true;
     localVideo.style.transform = isScreenSharing ? 'none' : 'scaleX(-1)';
     remoteVideo.style.transform = 'none';
     
     const localLabel = document.querySelector('.local-container .video-label');
     const remoteLabel = document.querySelector('.remote-container .video-label');
     const tempHTML = localLabel.innerHTML;
     localLabel.innerHTML = remoteLabel.innerHTML;
     remoteLabel.innerHTML = tempHTML;
  }
  
  remotePlaceholder.style.display = 'flex';
  remoteLabel.style.display = 'none';
  // Reset thông tin đối phương trên UI
  const lbl = document.getElementById('remote-nickname');
  if(lbl) lbl.textContent = 'Khách ẩn danh';
  updateStatus('waiting', 'Đang chờ...');
});

// Phòng đầy
socket.on('room-full', () => {
  showToast('Phòng đã đầy (tối đa 2 người)', 'error');
  setTimeout(() => window.location.href = '/', 3000);
});

// === Điều khiển Media ===

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

async function toggleScreenShare() {
  if (!peerConnection) {
    showToast('Chưa có kết nối P2P', 'warning');
    return;
  }
  if (!isScreenSharing) {
    try {
      screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: 'always' }, audio: false
      });
      const screenTrack = screenStream.getVideoTracks()[0];
      
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      canvas.width = 1280; canvas.height = 720;
      
      const hiddenScreenVideo = document.createElement('video');
      hiddenScreenVideo.muted = true; hiddenScreenVideo.playsInline = true; hiddenScreenVideo.autoplay = true;
      hiddenScreenVideo.srcObject = screenStream;
      hiddenScreenVideo.onloadedmetadata = () => hiddenScreenVideo.play();
      
      const hiddenCameraVideo = document.createElement('video');
      hiddenCameraVideo.muted = true; hiddenCameraVideo.playsInline = true; hiddenCameraVideo.autoplay = true;
      hiddenCameraVideo.srcObject = localStream; 
      hiddenCameraVideo.onloadedmetadata = () => hiddenCameraVideo.play();

      compositeInterval = setInterval(() => {
         if (hiddenScreenVideo.videoWidth) {
            canvas.width = hiddenScreenVideo.videoWidth;
            canvas.height = hiddenScreenVideo.videoHeight;
         }
         ctx.drawImage(hiddenScreenVideo, 0, 0, canvas.width, canvas.height);
         
         if (hiddenCameraVideo.videoWidth && !isCameraOff) {
             const pipW = canvas.width * 0.2; 
             const pipH = (hiddenCameraVideo.videoHeight / hiddenCameraVideo.videoWidth) * pipW || (canvas.height * 0.2);
             const margin = 20;
             const pipX = canvas.width - pipW - margin;
             const pipY = canvas.height - pipH - margin;
             
             ctx.lineWidth = 4; ctx.strokeStyle = '#7c6aef';
             ctx.strokeRect(pipX, pipY, pipW, pipH);
             
             ctx.save();
             ctx.translate(pipX + pipW, pipY);
             ctx.scale(-1, 1);
             ctx.drawImage(hiddenCameraVideo, 0, 0, pipW, pipH);
             ctx.restore();
         }
      }, 1000 / 30);

      const compositeStream = canvas.captureStream(30);
      const compositeTrack = compositeStream.getVideoTracks()[0];
      
      const sender = peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
      if (sender) await sender.replaceTrack(compositeTrack);
      
      currentLocalStream = compositeStream;
      
      if (isSwapped) {
         remoteVideo.srcObject = currentLocalStream;
         remoteVideo.style.transform = 'none';
      } else {
         localVideo.srcObject = currentLocalStream;
         localVideo.style.transform = 'none';
      }
      
      isScreenSharing = true;
      document.getElementById('btn-screen').classList.add('active');
      showToast('Đang chia sẻ màn hình + Camera', 'success');
      
      screenTrack.onended = () => stopScreenShare();
    } catch (err) {
      console.error('Lỗi chia sẻ màn hình:', err);
    }
  } else {
    stopScreenShare();
  }
}

async function stopScreenShare() {
  if (compositeInterval) clearInterval(compositeInterval);
  if (screenStream) {
      screenStream.getTracks().forEach(t => t.stop());
      screenStream = null;
  }
  
  const videoTrack = localStream.getVideoTracks()[0]; 
  const sender = peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
  if (sender && videoTrack) {
      await sender.replaceTrack(videoTrack);
  }
  
  currentLocalStream = localStream;
  
  if (isSwapped) {
      remoteVideo.srcObject = currentLocalStream;
      remoteVideo.style.transform = 'scaleX(-1)';
  } else {
      localVideo.srcObject = currentLocalStream;
      localVideo.style.transform = 'scaleX(-1)';
  }
  
  isScreenSharing = false;
  document.getElementById('btn-screen').classList.remove('active');
  showToast('Đã dừng chia sẻ màn hình', 'info');
}

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

function sendMessage() {
  const text = chatInput.value.trim();
  if (!text) return;
  if (dataChannel && dataChannel.readyState === 'open') {
    dataChannel.send(JSON.stringify({ type: 'chat', text: text }));
    addMessage(text, 'local');
    chatInput.value = '';
  } else {
    showToast('Chưa kết nối chat. Đợi đối phương kết nối P2P.', 'warning');
  }
}

function addMessage(text, type) {
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

async function leaveRoom() {
  await stopCallTimer();
  if (localStream) localStream.getTracks().forEach(t => t.stop());
  if (peerConnection) peerConnection.close();
  socket.disconnect();
  window.location.href = '/';
}

// === UI Helpers ===
function updateStatus(state, text) {
  statusDot.className = 'status-dot';
  if (state === 'connected') statusDot.classList.add('connected');
  else if (state === 'failed') statusDot.classList.add('failed');
  statusText.textContent = text;
}

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

function copyRoomCode() {
  const url = window.location.href;
  navigator.clipboard.writeText(url).then(() => {
    showToast('Đã sao chép liên kết phòng!', 'success');
  }).catch(() => {
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

chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendMessage();
});

// === Đính kèm File/Ảnh ===
const fileInput = document.getElementById('chat-file-input');
const attachBtn = document.getElementById('chat-attach-btn');

if (attachBtn) {
  attachBtn.addEventListener('click', () => fileInput.click());
}

if (fileInput) {
  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      fileInput.value = '';
      return showToast('File quá lớn (Tối đa 10MB)', 'error');
    }

    const formData = new FormData();
    formData.append('file', file);

    try {
      const btnIcon = attachBtn.querySelector('i');
      btnIcon.className = 'fas fa-spinner fa-spin'; // Xoay icon loading

      const res = await fetch('/api/chat-upload', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      btnIcon.className = 'fas fa-paperclip'; // Trả lại icon cũ
      fileInput.value = '';
      
      if (data.error) throw new Error(data.error);

      // Render nội dung lên máy mình
      const fileHtml = data.mimetype.startsWith('image/') 
          ? `<img src="${data.url}" class="chat-image" alt="${data.filename}" onclick="window.open(this.src)">`
          : `<a href="${data.url}" download="${data.filename}" class="chat-file-link" target="_blank"><i class="fas fa-file"></i> ${data.filename}</a>`;
      addMessage(fileHtml, 'local');

      // Gửi sang ngườid dùng bên kia qua P2P
      if (dataChannel && dataChannel.readyState === 'open') {
          dataChannel.send(JSON.stringify({ 
              type: 'file', 
              url: data.url, 
              filename: data.filename, 
              mimetype: data.mimetype 
          }));
      } else {
          showToast('Chưa gửi cho đối phương vì chưa kết nối mạng', 'warning');
      }
      
    } catch (err) {
      showToast('Lỗi Upload file', 'error');
      attachBtn.querySelector('i').className = 'fas fa-paperclip';
    }
  });
}

const shareLinkBtn = document.getElementById('share-link-btn');
if (shareLinkBtn) shareLinkBtn.addEventListener('click', copyRoomCode);

// === Kéo thả & Swap local video (PIP) ===
const localContainer = document.getElementById('local-container');
let isDragging = false, dragOffsetX = 0, dragOffsetY = 0;
let hasMoved = false;

localContainer.addEventListener('mousedown', (e) => {
  isDragging = true;
  hasMoved = false;
  dragOffsetX = e.clientX - localContainer.offsetLeft;
  dragOffsetY = e.clientY - localContainer.offsetTop;
  localContainer.style.cursor = 'grabbing';
  localContainer.style.transition = 'none';
});
document.addEventListener('mousemove', (e) => {
  if (!isDragging) return;
  hasMoved = true;
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

// Click để Swap kích thước màn hình
localContainer.addEventListener('click', (e) => {
  if (hasMoved || !currentRemoteStream) return;
  isSwapped = !isSwapped;
  
  if (isSwapped) {
    localVideo.srcObject = currentRemoteStream;    // Khung nhỏ thành bạn kia
    remoteVideo.srcObject = currentLocalStream;           // Khung to thành mình
    localVideo.muted = false; 
    remoteVideo.muted = true;
    localVideo.style.transform = 'none';           // Xem họ không cần lật
    remoteVideo.style.transform = isScreenSharing ? 'none' : 'scaleX(-1)';    // Màn to của mình thì lật gương
  } else {
    localVideo.srcObject = currentLocalStream;            // Khung nhỏ lại làm mình
    remoteVideo.srcObject = currentRemoteStream;   // Khung to làm bạn kia
    localVideo.muted = true; 
    remoteVideo.muted = false;
    localVideo.style.transform = isScreenSharing ? 'none' : 'scaleX(-1)';     // Mặc định lật hình bản thân
    remoteVideo.style.transform = 'none';
  }
  
  // Đổi Name tag cho nhau
  const localLabel = document.querySelector('.local-container .video-label');
  const remoteLabel = document.querySelector('.remote-container .video-label');
  const tempHTML = localLabel.innerHTML;
  localLabel.innerHTML = remoteLabel.innerHTML;
  remoteLabel.innerHTML = tempHTML;
});

// === Fullscreen khi double-click ===
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
  if (e.target === chatInput) return;
  switch(e.key.toLowerCase()) {
    case 'm': toggleMic(); break;
    case 'v': toggleCamera(); break;
    case 's': toggleScreenShare(); break;
    case 'c': toggleChat(); break;
    case 'escape': 
      if (isChatOpen) toggleChat();
      break;
  }
});

// === Khởi chạy ===
init();
