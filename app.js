// Client‑side logic for the PWA chat application.
//
// Connects to the Socket.io server, sends/receives chat messages, and
// implements a basic peer‑to‑peer voice call using WebRTC. This example
// focuses on readability rather than production readiness. For a real app
// consider handling multiple peers, ICE negotiation retries, and TURN
// fallback servers.

(() => {
  const socket = io();
  const ROOM = 'global';
  const messagesEl = document.getElementById('messages');
  const inputEl = document.getElementById('input');
  const sendBtn = document.getElementById('send');
  const shareLocationBtn = document.getElementById('shareLocation');
  const startCallBtn = document.getElementById('startCall');
  const endCallBtn = document.getElementById('endCall');
  const participantListEl = document.getElementById('participantList');
  const audioContainer = document.getElementById('audioElements');
  const iconInput = document.getElementById('iconInput');
  const iconPreview = document.getElementById('iconPreview');

  const userName = prompt('ユーザー名を入力してください', 'ユーザー' + Math.floor(Math.random() * 1000));
  let userIcon = localStorage.getItem('userIcon') || null;
  let inCall = false;
  let localAudioEl = null;
  let remoteAudioEl = null;

  function renderParticipants(participants) {
    participantListEl.innerHTML = '';
    if (!Array.isArray(participants) || participants.length === 0) {
      const emptyItem = document.createElement('li');
      emptyItem.className = 'empty';
      emptyItem.textContent = '現在、通話に参加しているユーザーはいません。';
      participantListEl.appendChild(emptyItem);
      return;
    }

    participants.forEach(({ id, user, icon }) => {
      const item = document.createElement('li');
      const avatar = document.createElement('img');
      avatar.src = icon || 'icon-192.png';
      avatar.alt = `${user || 'ユーザー'}のアイコン`;
      item.appendChild(avatar);
      const name = document.createElement('span');
      if (id === socket.id) {
        name.textContent = `${user || 'ゲスト'} (自分)`;
        name.className = 'self';
      } else {
        name.textContent = user || 'ゲスト';
      }
      item.appendChild(name);
      participantListEl.appendChild(item);
    });
  }

  renderParticipants([]);

  function updateCallParticipation(action) {
    socket.emit('call-participation', {
      room: ROOM,
      action,
      user: userName,
      icon: userIcon || null,
    });
  }

  function attachAudioElement(stream, { muted } = {}) {
    const audioEl = document.createElement('audio');
    audioEl.autoplay = true;
    audioEl.muted = Boolean(muted);
    audioEl.srcObject = stream;
    audioContainer.appendChild(audioEl);
    const playPromise = audioEl.play();
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch(() => {
        // Autoplay might fail due to browser policies; ignore silently.
      });
    }
    return audioEl;
  }

  function cleanupAudioElement(el) {
    if (!el) return;
    el.pause();
    el.srcObject = null;
    if (el.parentElement) {
      el.parentElement.removeChild(el);
    }
  }

  if (userIcon) {
    iconPreview.src = userIcon;
  }

  // Join the default room
  socket.emit('join', { room: ROOM, user: userName, icon: userIcon || null });

  function addMessage({ user, text, time, icon, location }) {
    const li = document.createElement('li');
    const timestamp = new Date(time).toLocaleTimeString();
    if (user === 'system') {
      li.classList.add('system');
      const content = document.createElement('div');
      content.className = 'content';
      const meta = document.createElement('div');
      meta.className = 'meta';
      meta.textContent = `[${timestamp}] system`;
      const textEl = document.createElement('p');
      textEl.className = 'text';
      textEl.textContent = text;
      content.appendChild(meta);
      content.appendChild(textEl);
      li.appendChild(content);
    } else {
      const avatar = document.createElement('div');
      avatar.className = 'avatar';
      const img = document.createElement('img');
      img.alt = `${user}のアイコン`;
      img.src = icon || 'icon-192.png';
      avatar.appendChild(img);
      const content = document.createElement('div');
      content.className = 'content';
      const meta = document.createElement('div');
      meta.className = 'meta';
      meta.textContent = `${user} ・ ${timestamp}`;
      content.appendChild(meta);
      if (text) {
        const textEl = document.createElement('p');
        textEl.className = 'text';
        textEl.textContent = text;
        content.appendChild(textEl);
      }
      if (location && typeof location.latitude === 'number' && typeof location.longitude === 'number') {
        const link = document.createElement('a');
        link.className = 'location-link';
        link.href = `https://www.google.com/maps?q=${location.latitude},${location.longitude}`;
        link.target = '_blank';
        link.rel = 'noopener';
        link.textContent = '共有された位置情報を表示';
        content.appendChild(link);
      }
      li.appendChild(avatar);
      li.appendChild(content);
    }
    messagesEl.appendChild(li);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  iconInput.addEventListener('change', (event) => {
    const [file] = event.target.files;
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      userIcon = reader.result;
      iconPreview.src = userIcon;
      try {
        localStorage.setItem('userIcon', userIcon);
      } catch (err) {
        console.warn('Failed to persist user icon to localStorage:', err);
      }
      if (inCall) {
        updateCallParticipation('update');
      }
    };
    reader.readAsDataURL(file);
  });

  // Send chat message
  sendBtn.addEventListener('click', () => {
    const text = inputEl.value.trim();
    if (text) {
      socket.emit('message', { user: userName, text, room: ROOM, icon: userIcon });
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

  socket.on('call-participants', (participants) => {
    renderParticipants(participants);
  });

  shareLocationBtn.addEventListener('click', () => {
    if (!navigator.geolocation) {
      alert('お使いのブラウザでは位置情報を利用できません。');
      return;
    }
    shareLocationBtn.disabled = true;
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        socket.emit('message', {
          user: userName,
          room: ROOM,
          icon: userIcon,
          text: '位置情報を共有しました。',
          location: { latitude, longitude },
        });
        shareLocationBtn.disabled = false;
      },
      (error) => {
        alert('位置情報を取得できませんでした: ' + error.message);
        shareLocationBtn.disabled = false;
      },
      {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 10000,
      }
    );
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
    cleanupAudioElement(localAudioEl);
    localAudioEl = attachAudioElement(localStream, { muted: true });
    // Create peer connection
    peerConnection = new RTCPeerConnection(iceServers);
    localStream.getTracks().forEach((track) => peerConnection.addTrack(track, localStream));
    // When remote track arrives, play it
    peerConnection.addEventListener('track', (event) => {
      const [remoteStream] = event.streams;
      if (!remoteStream) return;
      cleanupAudioElement(remoteAudioEl);
      remoteAudioEl = attachAudioElement(remoteStream);
    });
    // ICE candidates
    peerConnection.addEventListener('icecandidate', (event) => {
      if (event.candidate) {
        socket.emit('webrtc', { room: ROOM, data: { type: 'candidate', candidate: event.candidate } });
      }
    });
    // Create and send offer
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    socket.emit('webrtc', { room: ROOM, data: { type: 'offer', sdp: offer } });
    const action = inCall ? 'update' : 'join';
    inCall = true;
    updateCallParticipation(action);
  }

  async function handleOffer(sdp) {
    if (!peerConnection) {
      peerConnection = new RTCPeerConnection(iceServers);
      // When remote track arrives
      peerConnection.addEventListener('track', (event) => {
        const [remoteStream] = event.streams;
        if (!remoteStream) return;
        cleanupAudioElement(remoteAudioEl);
        remoteAudioEl = attachAudioElement(remoteStream);
      });
      peerConnection.addEventListener('icecandidate', (event) => {
        if (event.candidate) {
          socket.emit('webrtc', { room: ROOM, data: { type: 'candidate', candidate: event.candidate } });
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
      cleanupAudioElement(localAudioEl);
      localAudioEl = attachAudioElement(localStream, { muted: true });
    }
    await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    socket.emit('webrtc', { room: ROOM, data: { type: 'answer', sdp: answer } });
    startCallBtn.disabled = true;
    endCallBtn.disabled = false;
    const action = inCall ? 'update' : 'join';
    inCall = true;
    updateCallParticipation(action);
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
    cleanupAudioElement(localAudioEl);
    cleanupAudioElement(remoteAudioEl);
    localAudioEl = null;
    remoteAudioEl = null;
    if (inCall) {
      updateCallParticipation('leave');
      inCall = false;
    }
    startCallBtn.disabled = false;
    endCallBtn.disabled = true;
  }

  startCallBtn.addEventListener('click', () => {
    startCall();
  });
  endCallBtn.addEventListener('click', () => {
    endCall();
    // Notify others to end call (not strictly necessary here)
    socket.emit('webrtc', { room: ROOM, data: { type: 'hangup' } });
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