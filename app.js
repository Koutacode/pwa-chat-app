// Client‑side logic for the PWA chat application.
//
// Connects to the Socket.io server, sends/receives chat messages, and
// implements a basic peer‑to‑peer voice call using WebRTC. This example
// focuses on readability rather than production readiness. For a real app
// consider handling multiple peers, ICE negotiation retries, and TURN
// fallback servers.

(() => {
  const socket = io();
  let ROOM = null;
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
  const appContent = document.getElementById('appContent');
  const joinModal = document.getElementById('joinModal');
  const roomNameInput = document.getElementById('roomNameInput');
  const roomOptions = document.getElementById('roomOptions');
  const userNameInput = document.getElementById('userNameInput');
  const passwordInput = document.getElementById('passwordInput');
  const joinBtn = document.getElementById('joinRoom');
  const joinError = document.getElementById('joinError');
  const roomUserListEl = document.getElementById('roomUserList');
  const openAdminBtn = document.getElementById('openAdmin');
  const adminModal = document.getElementById('adminModal');
  const adminCloseBtn = document.getElementById('closeAdmin');
  const adminLoginSection = document.getElementById('adminLoginSection');
  const adminPanel = document.getElementById('adminPanel');
  const adminPasswordInput = document.getElementById('adminPasswordInput');
  const adminLoginBtn = document.getElementById('adminLoginBtn');
  const adminError = document.getElementById('adminError');
  const adminRoomList = document.getElementById('adminRoomList');
  const createRoomForm = document.getElementById('createRoomForm');
  const newRoomNameInput = document.getElementById('newRoomName');
  const newRoomPasswordInput = document.getElementById('newRoomPassword');
  const adminLogoutBtn = document.getElementById('adminLogout');

  const LOCAL_MESSAGES_PREFIX = 'chat-messages:';

  let availableRooms = [];
  let adminToken = null;
  let userName = '';
  
  let userIcon = localStorage.getItem('userIcon') || null;
  let joined = false;
  let inCall = false;
  let localAudioEl = null;
  let remoteAudioEl = null;
  let notificationPermission = typeof Notification !== 'undefined' ? Notification.permission : 'default';

  const LOCAL_MESSAGE_LIMIT = 500;

  function setInteractionEnabled(enabled) {
    inputEl.disabled = !enabled;
    sendBtn.disabled = !enabled;
    shareLocationBtn.disabled = !enabled;
    startCallBtn.disabled = !enabled || inCall;
    if (!enabled) {
      endCallBtn.disabled = true;
    } else if (!inCall) {
      endCallBtn.disabled = true;
    }
  }

  function refreshCallButtons() {
    startCallBtn.disabled = !joined || inCall;
    endCallBtn.disabled = !joined || !inCall;
  }

  setInteractionEnabled(false);

  function getMessagesKey(room) {
    return `${LOCAL_MESSAGES_PREFIX}${room}`;
  }

  function loadLocalMessages(room) {
    if (!room) return [];
    try {
      const raw = localStorage.getItem(getMessagesKey(room));
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      console.warn('Failed to load local messages:', error);
      return [];
    }
  }

  function saveLocalMessages(room, messages) {
    if (!room) return;
    try {
      const trimmed = Array.isArray(messages)
        ? messages.slice(-LOCAL_MESSAGE_LIMIT)
        : [];
      localStorage.setItem(getMessagesKey(room), JSON.stringify(trimmed));
    } catch (error) {
      console.warn('Failed to save messages:', error);
    }
  }

  function appendLocalMessage(room, message) {
    if (!room || !message) return;
    const messages = loadLocalMessages(room);
    messages.push(message);
    saveLocalMessages(room, messages);
  }

  function clearLocalMessages(room) {
    if (!room) return;
    try {
      localStorage.removeItem(getMessagesKey(room));
    } catch (error) {
      console.warn('Failed to clear local messages:', error);
    }
  }

  function mergeMessages(serverMessages = [], localMessages = []) {
    const combined = [];
    if (Array.isArray(serverMessages)) {
      combined.push(...serverMessages);
    }
    if (Array.isArray(localMessages)) {
      combined.push(...localMessages);
    }
    const seen = new Set();
    const unique = [];
    combined.forEach((msg) => {
      if (!msg || typeof msg !== 'object') return;
      const time = typeof msg.time === 'number' ? msg.time : 0;
      const text = typeof msg.text === 'string' ? msg.text : '';
      const location = msg.location && typeof msg.location === 'object'
        ? `${msg.location.latitude ?? ''},${msg.location.longitude ?? ''}`
        : '';
      const key = `${msg.user || ''}|${time}|${text}|${location}`;
      if (seen.has(key)) return;
      seen.add(key);
      unique.push(msg);
    });
    unique.sort((a, b) => {
      const aTime = typeof a.time === 'number' ? a.time : 0;
      const bTime = typeof b.time === 'number' ? b.time : 0;
      return aTime - bTime;
    });
    return unique;
  }

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

  function renderRoomUsers(users) {
    roomUserListEl.innerHTML = '';
    if (!Array.isArray(users) || users.length === 0) {
      const emptyItem = document.createElement('li');
      emptyItem.className = 'empty';
      emptyItem.textContent = 'まだユーザーはいません。';
      roomUserListEl.appendChild(emptyItem);
      return;
    }

    users.forEach(({ id, user }) => {
      const item = document.createElement('li');
      item.textContent = user || 'ゲスト';
      if (id === socket.id) {
        item.classList.add('self');
      }
      roomUserListEl.appendChild(item);
    });
  }

  renderRoomUsers([]);

  function updateCallParticipation(action) {
    if (!joined || !ROOM) return;
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

  const storedUserName = localStorage.getItem('userName');
  if (storedUserName) {
    userNameInput.value = storedUserName;
  }
  const storedRoom = localStorage.getItem('lastRoom');
  if (storedRoom) {
    roomNameInput.value = storedRoom;
  }

  function attemptJoin() {
    if (joinBtn.disabled) return;
    const roomName = roomNameInput.value.trim();
    const name = userNameInput.value.trim();
    const password = passwordInput.value.trim();
    if (!roomName) {
      joinError.textContent = 'ルーム名を入力してください。';
      roomNameInput.focus();
      return;
    }
    if (!name) {
      joinError.textContent = 'ユーザー名を入力してください。';
      userNameInput.focus();
      return;
    }
    if (!password) {
      joinError.textContent = 'パスワードを入力してください。';
      passwordInput.focus();
      return;
    }

    joinError.textContent = '';
    joinBtn.disabled = true;
    socket.emit('join', { room: roomName, user: name, password, icon: userIcon || null }, (response) => {
      joinBtn.disabled = false;
      if (!response || response.ok !== true) {
        joinError.textContent = response && response.error ? response.error : 'ルームに参加できませんでした。';
        passwordInput.focus();
        passwordInput.select();
        return;
      }

      ROOM = response.room || roomName;
      userName = name;
      joined = true;
      localStorage.setItem('userName', userName);
      localStorage.setItem('lastRoom', ROOM);
      const serverMessages = Array.isArray(response.messages) ? response.messages : [];
      const localMessages = loadLocalMessages(ROOM);
      const mergedMessages = mergeMessages(serverMessages, localMessages);
      saveLocalMessages(ROOM, mergedMessages);
      renderMessages(mergedMessages);
      joinModal.classList.add('hidden');
      appContent.classList.remove('hidden');
      passwordInput.value = '';
      setInteractionEnabled(true);
      refreshCallButtons();
      inputEl.focus();
    });
  }

  joinBtn.addEventListener('click', attemptJoin);
  passwordInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      attemptJoin();
    }
  });
  userNameInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      attemptJoin();
    }
  });
  roomNameInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      attemptJoin();
    }
  });

  if (roomNameInput.value) {
    if (userNameInput.value) {
      passwordInput.focus();
    } else {
      userNameInput.focus();
    }
  } else {
    roomNameInput.focus();
  }

  fetchRooms();
  requestNotificationPermission();

  if (openAdminBtn) {
    openAdminBtn.addEventListener('click', () => {
      adminError.textContent = '';
      adminModal.classList.remove('hidden');
      if (adminToken) {
        setAdminView(true);
        loadAdminRooms();
      } else {
        setAdminView(false);
        adminPasswordInput.value = '';
        adminPasswordInput.focus();
      }
    });
  }

  if (adminCloseBtn) {
    adminCloseBtn.addEventListener('click', () => {
      adminModal.classList.add('hidden');
    });
  }

  async function handleAdminLogin() {
    const password = adminPasswordInput.value.trim();
    if (!password) {
      adminError.textContent = '管理者パスワードを入力してください。';
      adminPasswordInput.focus();
      return;
    }
    adminError.textContent = '';
    adminLoginBtn.disabled = true;
    try {
      const response = await fetch('/api/admin/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ password }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) {
        const message = data && data.error ? data.error : 'ログインに失敗しました。';
        adminError.textContent = message;
        adminPasswordInput.focus();
        adminPasswordInput.select();
        return;
      }
      adminToken = data.token;
      adminPasswordInput.value = '';
      setAdminView(true);
      renderAdminRooms(data.rooms || []);
      fetchRooms();
    } catch (error) {
      console.warn('管理者ログインに失敗しました:', error);
      adminError.textContent = 'ログインに失敗しました。時間をおいて再度お試しください。';
    } finally {
      adminLoginBtn.disabled = false;
    }
  }

  if (adminLoginBtn) {
    adminLoginBtn.addEventListener('click', handleAdminLogin);
  }

  if (adminPasswordInput) {
    adminPasswordInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        handleAdminLogin();
      }
    });
  }

  if (createRoomForm) {
    createRoomForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!adminToken) {
        adminError.textContent = '管理者としてログインしてください。';
        return;
      }
      const name = newRoomNameInput.value.trim();
      const password = newRoomPasswordInput.value.trim();
      if (!name) {
        adminError.textContent = 'ルーム名を入力してください。';
        newRoomNameInput.focus();
        return;
      }
      if (!password) {
        adminError.textContent = 'ルームのパスワードを入力してください。';
        newRoomPasswordInput.focus();
        return;
      }
      adminError.textContent = '';
      const submitBtn = createRoomForm.querySelector('button[type="submit"]');
      if (submitBtn) submitBtn.disabled = true;
      try {
        const response = await fetch('/api/admin/rooms', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-admin-token': adminToken,
          },
          body: JSON.stringify({ name, password }),
        });
        const data = await response.json().catch(() => ({}));
        if (response.status === 401) {
          adminToken = null;
          setAdminView(false);
          adminError.textContent = '認証の有効期限が切れました。再度ログインしてください。';
          return;
        }
        if (!response.ok || !data.ok) {
          const message = data && data.error ? data.error : 'ルームの作成に失敗しました。';
          adminError.textContent = message;
          return;
        }
        newRoomNameInput.value = '';
        newRoomPasswordInput.value = '';
        renderAdminRooms(data.rooms || []);
        fetchRooms();
      } catch (error) {
        console.warn('ルームの作成に失敗しました:', error);
        adminError.textContent = 'ルームの作成に失敗しました。';
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  }

  if (adminLogoutBtn) {
    adminLogoutBtn.addEventListener('click', async () => {
      if (!adminToken) {
        adminModal.classList.add('hidden');
        return;
      }
      try {
        await fetch('/api/admin/logout', {
          method: 'POST',
          headers: {
            'x-admin-token': adminToken,
          },
        });
      } catch (error) {
        console.warn('ログアウト処理に失敗しました:', error);
      }
      adminToken = null;
      setAdminView(false);
      adminError.textContent = 'ログアウトしました。';
      adminPasswordInput.value = '';
      adminPasswordInput.focus();
    });
  }

  function addMessage(message, { persist = true } = {}) {
    if (!message || typeof message !== 'object') return;
    const { user, text, time, icon, location } = message;
    const li = document.createElement('li');
    const timestampValue = typeof time === 'number' ? time : Date.now();
    const timestamp = new Date(timestampValue).toLocaleTimeString();
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

    if (persist && ROOM) {
      appendLocalMessage(ROOM, {
        user,
        text,
        time: timestampValue,
        icon,
        location,
      });
    }
  }

  function renderMessages(messages) {
    messagesEl.innerHTML = '';
    if (!Array.isArray(messages)) return;
    messages.forEach((message) => addMessage(message, { persist: false }));
  }

  function renderRoomOptionsList(rooms) {
    availableRooms = Array.isArray(rooms) ? rooms : [];
    roomOptions.innerHTML = '';
    availableRooms.forEach(({ name }) => {
      if (!name) return;
      const option = document.createElement('option');
      option.value = name;
      roomOptions.appendChild(option);
    });
  }

  async function fetchRooms() {
    try {
      const response = await fetch('/api/rooms');
      if (!response.ok) {
        throw new Error(`Failed to load rooms: ${response.status}`);
      }
      const data = await response.json();
      if (data && Array.isArray(data.rooms)) {
        renderRoomOptionsList(data.rooms);
      }
    } catch (error) {
      console.warn('部屋一覧を取得できませんでした:', error);
    }
  }

  async function requestNotificationPermission() {
    if (typeof Notification === 'undefined') {
      return;
    }
    if (notificationPermission === 'default') {
      try {
        notificationPermission = await Notification.requestPermission();
      } catch (error) {
        console.warn('通知の権限リクエストに失敗しました:', error);
      }
    }
  }

  function showNotification(message) {
    if (typeof Notification === 'undefined' || notificationPermission !== 'granted') {
      return;
    }
    const title = message.user ? `${message.user}からの新着メッセージ` : '新着メッセージ';
    let body = '';
    if (message.text) {
      body = message.text;
    } else if (message.location) {
      body = '位置情報が共有されました。';
    }
    const icon = message.icon || 'icon-192.png';
    try {
      if (navigator.serviceWorker && navigator.serviceWorker.ready) {
        navigator.serviceWorker.ready
          .then((registration) => {
            if (registration.showNotification) {
              registration.showNotification(title, {
                body,
                icon,
                data: { room: ROOM },
              });
            } else {
              new Notification(title, { body, icon });
            }
          })
          .catch(() => {
            new Notification(title, { body, icon });
          });
      } else {
        new Notification(title, { body, icon });
      }
    } catch (error) {
      console.warn('通知の表示に失敗しました:', error);
    }
  }

  function setAdminView(loggedIn) {
    if (loggedIn) {
      adminLoginSection.classList.add('hidden');
      adminPanel.classList.remove('hidden');
    } else {
      adminPanel.classList.add('hidden');
      adminLoginSection.classList.remove('hidden');
    }
  }

  function renderAdminRooms(rooms) {
    adminRoomList.innerHTML = '';
    if (!Array.isArray(rooms) || rooms.length === 0) {
      const emptyItem = document.createElement('li');
      emptyItem.className = 'empty';
      emptyItem.textContent = '登録済みのルームはありません。';
      adminRoomList.appendChild(emptyItem);
      return;
    }

    rooms.forEach(({ name, password, createdAt }) => {
      if (!name) return;
      const item = document.createElement('li');
      item.className = 'admin-room-item';

      const info = document.createElement('div');
      info.className = 'info';
      const nameEl = document.createElement('span');
      nameEl.className = 'name';
      nameEl.textContent = name;
      const passwordEl = document.createElement('span');
      passwordEl.className = 'password';
      passwordEl.textContent = `パスワード: ${password || '(未設定)'}`;
      info.appendChild(nameEl);
      info.appendChild(passwordEl);

      if (createdAt) {
        const metaEl = document.createElement('span');
        metaEl.className = 'meta';
        metaEl.textContent = new Date(createdAt).toLocaleString();
        info.appendChild(metaEl);
      }

      const actions = document.createElement('div');
      actions.className = 'actions';
      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'danger';
      deleteBtn.textContent = '削除';
      deleteBtn.addEventListener('click', () => {
        if (!adminToken) return;
        if (!confirm(`ルーム「${name}」を削除しますか？`)) {
          return;
        }
        deleteAdminRoom(name);
      });
      actions.appendChild(deleteBtn);

      item.appendChild(info);
      item.appendChild(actions);
      adminRoomList.appendChild(item);
    });
  }

  async function loadAdminRooms() {
    if (!adminToken) return;
    try {
      const response = await fetch('/api/admin/rooms', {
        headers: {
          'x-admin-token': adminToken,
        },
      });
      if (response.status === 401) {
        adminToken = null;
        setAdminView(false);
        adminError.textContent = '認証の有効期限が切れました。再度ログインしてください。';
        return;
      }
      if (!response.ok) {
        throw new Error(`Failed to load admin rooms: ${response.status}`);
      }
      const data = await response.json();
      renderAdminRooms(data.rooms || []);
    } catch (error) {
      console.warn('管理者用ルーム一覧の取得に失敗しました:', error);
      adminError.textContent = 'ルーム一覧の取得に失敗しました。';
    }
  }

  async function deleteAdminRoom(name) {
    if (!adminToken) return;
    adminError.textContent = '';
    try {
      const response = await fetch(`/api/admin/rooms/${encodeURIComponent(name)}`, {
        method: 'DELETE',
        headers: {
          'x-admin-token': adminToken,
        },
      });
      if (response.status === 401) {
        adminToken = null;
        setAdminView(false);
        adminError.textContent = '認証の有効期限が切れました。再度ログインしてください。';
        return;
      }
      const data = await response.json();
      if (!response.ok || !data.ok) {
        const message = data && data.error ? data.error : 'ルームの削除に失敗しました。';
        adminError.textContent = message;
        return;
      }
      renderAdminRooms(data.rooms || []);
      fetchRooms();
    } catch (error) {
      console.warn('ルームの削除に失敗しました:', error);
      adminError.textContent = 'ルームの削除に失敗しました。';
    }
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
    if (!joined || !ROOM) return;
    const text = inputEl.value.trim();
    if (text) {
      socket.emit('message', { user: userName, text, room: ROOM, icon: userIcon });
      inputEl.value = '';
    }
  });

  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !inputEl.disabled) {
      sendBtn.click();
    }
  });

  // Receive chat message
  socket.on('message', (msg) => {
    addMessage(msg);
    if (document.hidden) {
      showNotification(msg);
    }
  });

  socket.on('system', (msg) => {
    addMessage({ user: 'system', text: msg, time: Date.now() }, { persist: false });
  });

  socket.on('call-participants', (participants) => {
    renderParticipants(participants);
  });

  socket.on('room-users', (users) => {
    renderRoomUsers(users);
  });

  socket.on('clear-history', (payload = {}) => {
    const targetRoom = payload.room || ROOM;
    if (!ROOM || targetRoom !== ROOM) {
      if (payload.room) {
        clearLocalMessages(payload.room);
      }
      return;
    }
    clearLocalMessages(ROOM);
    renderMessages([]);
    addMessage({ user: 'system', text: 'チャット履歴はリセットされました。', time: Date.now() }, { persist: false });
  });

  socket.on('rooms-update', (rooms) => {
    renderRoomOptionsList(rooms);
    if (adminToken) {
      loadAdminRooms();
    }
  });

  socket.on('room-deleted', ({ room } = {}) => {
    if (room) {
      clearLocalMessages(room);
      if (ROOM === room) {
        if (inCall) {
          endCall();
        }
        joined = false;
        ROOM = null;
        setInteractionEnabled(false);
        refreshCallButtons();
        renderMessages([]);
        renderParticipants([]);
        renderRoomUsers([]);
        appContent.classList.add('hidden');
        joinModal.classList.remove('hidden');
        joinError.textContent = '参加中のルームは管理者により削除されました。別のルームを選択してください。';
        roomNameInput.focus();
      }
    }
    fetchRooms();
  });

  shareLocationBtn.addEventListener('click', () => {
    if (!joined || !ROOM) {
      alert('ルームに参加してから位置情報を共有してください。');
      return;
    }
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
    if (!joined) {
      alert('ルームに参加してから通話を開始してください。');
      return;
    }
    startCallBtn.disabled = true;
    endCallBtn.disabled = false;
    // Get local audio stream
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      alert('マイクへのアクセスに失敗しました: ' + err);
      refreshCallButtons();
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
    refreshCallButtons();
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
    refreshCallButtons();
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
    }
    inCall = false;
    refreshCallButtons();
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