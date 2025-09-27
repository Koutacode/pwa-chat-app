// Client‑side logic for the PWA chat application.
//
// Connects to the Socket.io server, sends/receives chat messages, and
// implements a basic peer‑to‑peer voice call using WebRTC. This example
// focuses on readability rather than production readiness. For a real app
// consider handling multiple peers, ICE negotiation retries, and TURN
// fallback servers.

(() => {
  const socket = io();
  const messagesEl = document.getElementById('messages');
  const inputEl = document.getElementById('input');
  const sendBtn = document.getElementById('send');
  const startCallBtn = document.getElementById('startCall');
  const endCallBtn = document.getElementById('endCall');
  const localVideoContainer = document.getElementById('localVideo');
  const remoteVideoContainer = document.getElementById('remoteVideo');

  const userName = prompt('ユーザー名を入力してください', 'ユーザー' + Math.floor(Math.random() * 1000));

  // Join the default room
  socket.emit('join', 'global');

  function addMessage({ user, text, time }) {
    const li = document.createElement('li');
    const timestamp = new Date(time).toLocaleTimeString();
    li.textContent = `[${timestamp}] ${user}: ${text}`;
    messagesEl.appendChild(li);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  // Send chat message
  sendBtn.addEventListener('click', () => {
    const text = inputEl.value.trim();
    if (text) {
      socket.emit('message', { user: userName, text, room: 'global' });
      inputEl.value = '';
    }
  });

  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      sendBtn.click();
    }
  });

  // Receive chat message
  socket.on('message', (msg) => {
    addMessage(msg);
  });

  socket.on('system', (msg) => {
    addMessage({ user: 'system', text: msg, time: Date.now() });
  });

  // ---------- WebRTC VOICE CALL -----------
  let localStream = null;
  let peerConnection = null;
  const iceServers = { iceServers: [ { urls: 'stun:stun.l.google.com:19302' } ] };

  async function startCall() {
    startCallBtn.disabled = true;
    endCallBtn.disabled = false;
    // Get local audio stream
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      alert('マイクへのアクセスに失敗しました: ' + err);
      startCallBtn.disabled = false;
      endCallBtn.disabled = true;
      return;
    }
    // Show local stream (audio only; we display but no video)
    const localAudio = document.createElement('audio');
    localAudio.srcObject = localStream;
    localAudio.muted = true;
    localAudio.autoplay = true;
    localVideoContainer.innerHTML = '';
    localVideoContainer.appendChild(localAudio);
    // Create peer connection
    peerConnection = new RTCPeerConnection(iceServers);
    localStream.getTracks().forEach((track) => peerConnection.addTrack(track, localStream));
    // When remote track arrives, play it
    peerConnection.addEventListener('track', (event) => {
      const [remoteStream] = event.streams;
      const remoteAudio = document.createElement('audio');
      remoteAudio.srcObject = remoteStream;
      remoteAudio.autoplay = true;
      remoteVideoContainer.innerHTML = '';
      remoteVideoContainer.appendChild(remoteAudio);
    });
    // ICE candidates
    peerConnection.addEventListener('icecandidate', (event) => {
      if (event.candidate) {
        socket.emit('webrtc', { room: 'global', data: { type: 'candidate', candidate: event.candidate } });
      }
    });
    // Create and send offer
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    socket.emit('webrtc', { room: 'global', data: { type: 'offer', sdp: offer } });
  }

  async function handleOffer(sdp) {
    if (!peerConnection) {
      peerConnection = new RTCPeerConnection(iceServers);
      // When remote track arrives
      peerConnection.addEventListener('track', (event) => {
        const [remoteStream] = event.streams;
        const remoteAudio = document.createElement('audio');
        remoteAudio.srcObject = remoteStream;
        remoteAudio.autoplay = true;
        remoteVideoContainer.innerHTML = '';
        remoteVideoContainer.appendChild(remoteAudio);
      });
      peerConnection.addEventListener('icecandidate', (event) => {
        if (event.candidate) {
          socket.emit('webrtc', { room: 'global', data: { type: 'candidate', candidate: event.candidate } });
        }
      });
      // Get local audio stream when answering
      try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (err) {
        alert('マイクへのアクセスに失敗しました: ' + err);
        return;
      }
      localStream.getTracks().forEach((track) => peerConnection.addTrack(track, localStream));
      const localAudio = document.createElement('audio');
      localAudio.srcObject = localStream;
      localAudio.muted = true;
      localAudio.autoplay = true;
      localVideoContainer.innerHTML = '';
      localVideoContainer.appendChild(localAudio);
    }
    await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    socket.emit('webrtc', { room: 'global', data: { type: 'answer', sdp: answer } });
    startCallBtn.disabled = true;
    endCallBtn.disabled = false;
  }

  async function handleAnswer(sdp) {
    if (!peerConnection) return;
    await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
  }

  function handleCandidate(candidate) {
    if (peerConnection) {
      peerConnection.addIceCandidate(new RTCIceCandidate(candidate)).catch(console.error);
    }
  }

  function endCall() {
    if (peerConnection) {
      peerConnection.getSenders().forEach((sender) => sender.track && sender.track.stop());
      peerConnection.close();
      peerConnection = null;
    }
    if (localStream) {
      localStream.getTracks().forEach((track) => track.stop());
      localStream = null;
    }
    localVideoContainer.innerHTML = '';
    remoteVideoContainer.innerHTML = '';
    startCallBtn.disabled = false;
    endCallBtn.disabled = true;
  }

  startCallBtn.addEventListener('click', () => {
    startCall();
  });
  endCallBtn.addEventListener('click', () => {
    endCall();
    // Notify others to end call (not strictly necessary here)
    socket.emit('webrtc', { room: 'global', data: { type: 'hangup' } });
  });

  // Handle incoming WebRTC signaling
  socket.on('webrtc', ({ sender, data }) => {
    switch (data.type) {
      case 'offer':
        handleOffer(data.sdp);
        break;
      case 'answer':
        handleAnswer(data.sdp);
        break;
      case 'candidate':
        handleCandidate(data.candidate);
        break;
      case 'hangup':
        endCall();
        break;
    }
  });

  // Register service worker for PWA offline support and push notifications
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/service-worker.js').catch((err) => {
        console.error('Service Worker registration failed:', err);
      });
    });
  }
})();