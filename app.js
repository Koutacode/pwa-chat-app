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
  const chatScrollRegion = document.getElementById('chatScrollRegion');
  const inputEl = document.getElementById('input');
  const sendBtn = document.getElementById('send');
  const shareLocationBtn = document.getElementById('shareLocation');
  const toggleLocationShareBtn = document.getElementById('toggleLocationShare');
  const toggleLocationShareLabel = (() => {
    if (!toggleLocationShareBtn) return null;
    const spans = toggleLocationShareBtn.querySelectorAll('span');
    return spans.length > 1 ? spans[1] : null;
  })();
  const startCallBtn = document.getElementById('startCall');
  const endCallBtn = document.getElementById('endCall');
  const participantListEl = document.getElementById('participantList');
  const audioContainer = document.getElementById('audioElements');
  const iconInput = document.getElementById('iconInput');
  const iconPreview = document.getElementById('iconPreview');
  const iconStatus = document.getElementById('iconStatus');
  const appContent = document.getElementById('appContent');
  const joinModal = document.getElementById('joinModal');
  const roomNameInput = document.getElementById('roomNameInput');
  const roomOptions = document.getElementById('roomOptions');
  const userNameInput = document.getElementById('userNameInput');
  const passwordInput = document.getElementById('passwordInput');
  const joinBtn = document.getElementById('joinRoom');
  const joinError = document.getElementById('joinError');
  const createRoomBtn = document.getElementById('createRoomButton');
  const createRoomMessage = document.getElementById('createRoomMessage');
  const roomUsersPanel = document.getElementById('roomUsers');
  const roomUserListEl = document.getElementById('roomUserList');
  const openAdminBtn = document.getElementById('openAdmin');
  const refreshAppBtn = document.getElementById('refreshApp');
  const themeToggleBtn = document.getElementById('themeToggle');
  const sidebarToggleBtn = document.getElementById('sidebarToggle');
  const closeSidebarBtn = document.getElementById('closeSidebar');
  const moreActionsBtn = document.getElementById('moreActions');
  const quickActionsMenu = document.getElementById('quickActionsMenu');
  const newMessagesButton = document.getElementById('newMessagesButton');
  const typingIndicatorEl = document.getElementById('typingIndicator');
  const connectionBanner = document.getElementById('connectionBanner');
  const liveMapPanel = document.getElementById('liveMapPanel');
  const liveMapContainer = document.getElementById('liveMap');
  const liveMapStatusEl = document.getElementById('liveMapStatus');
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
  const leaveRoomBtn = document.getElementById('leaveRoomBtn');

  const LOCAL_MESSAGES_PREFIX = 'chat-messages:';
  const THEME_STORAGE_KEY = 'chat-theme';
  const prefersDarkMedia = window.matchMedia('(prefers-color-scheme: dark)');

  let availableRooms = [];
  let adminToken = null;
  let userName = '';
  
  const ACTIVE_SESSION_KEY = 'activeSession';

  let userIcon = localStorage.getItem('userIcon') || null;
  const DEFAULT_ICON_SRC = iconPreview ? iconPreview.getAttribute('src') || 'icon-192.png' : 'icon-192.png';
  let joined = false;
  let inCall = false;
  let localAudioEl = null;
  const remoteAudioElements = new Map();
  const peerConnections = new Map();
  const pendingIceCandidates = new Map();
  let acquiringLocalStream = null;
  let notificationPermission = typeof Notification !== 'undefined' ? Notification.permission : 'default';

  const LOCAL_MESSAGE_LIMIT = 500;
  let pendingScrollToBottom = false;
  let iconStatusTimer = null;
  let currentRoomUsers = [];
  let latestCallParticipants = [];
  const SCROLL_ANCHOR_THRESHOLD = 48;
  let shouldAutoScroll = true;
  let actionsMenuOpen = false;
  let typingUsers = new Map();
  let typingIndicatorTimeout = null;
  let typingEmitTimer = null;
  let typingEmitCooldown = false;
  let themePreference = 'system';
  let locationWatchId = null;
  let isContinuousLocationSharing = false;
  let lastContinuousLocationUpdate = 0;
  let hasSentInitialContinuousLocationMessage = false;
  const CONTINUOUS_LOCATION_MIN_INTERVAL = 15000;
  const DEFAULT_MAP_CENTER = [35.681236, 139.767125];
  const DEFAULT_MAP_ZOOM = 5;
  let liveMap = null;
  let liveMapMarkersLayer = null;
  const liveMapMarkers = new Map();
  let pendingLiveMapMessages = null;

  function setLiveMapStatus(message) {
    if (!liveMapStatusEl) return;
    liveMapStatusEl.textContent = message || '';
  }

  function loadLeafletScript() {
    return new Promise((resolve, reject) => {
      if (typeof window.L !== 'undefined') {
        resolve();
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://unpkg.com/leaflet@1.9.3/dist/leaflet.js';
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  async function ensureLiveMapReady() {
    if (!liveMapContainer) {
      return false;
    }

    if (typeof window.L === 'undefined') {
      // Try to load Leaflet from CDN if it wasn't loaded.
      setLiveMapStatus('マップを読み込んでいます...');
      try {
        await loadLeafletScript();
        // Retry initialization after script loads.
        return ensureLiveMapReady();
      } catch (e) {
        setLiveMapStatus(
          'マップを読み込めませんでした。ネットワーク接続を確認してページを再読込してください。',
        );
        return false;
      }
    }

    let initialised = false;
    if (!liveMap) {
      try {
        liveMap = window.L.map(liveMapContainer, {
          center: DEFAULT_MAP_CENTER,
          zoom: DEFAULT_MAP_ZOOM,
          zoomControl: true,
        });
        liveMapMarkersLayer = window.L.layerGroup().addTo(liveMap);
        window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
          maxZoom: 19,
        }).addTo(liveMap);
        refreshLiveMapSize();
        setLiveMapStatus(
          joined
            ? '位置情報が共有されるとここに表示されます。'
            : 'ルームに参加すると位置情報が表示されます。',
        );
        initialised = true;
      } catch (error) {
        console.warn('Failed to initialise live map:', error);
        setLiveMapStatus('ライブマップを初期化できませんでした。ネットワーク接続を確認してください。');
        liveMap = null;
        liveMapMarkersLayer = null;
        return false;
      }
    }

    if (
      initialised &&
      Array.isArray(pendingLiveMapMessages) &&
      pendingLiveMapMessages.length > 0
    ) {
      const messagesToReplay = pendingLiveMapMessages.slice();
      pendingLiveMapMessages = null;
      rebuildLiveMapFromMessages(messagesToReplay);
    }

    return Boolean(liveMap);
  }

  function refreshLiveMapSize() {
    if (!liveMap) return;
    requestAnimationFrame(() => {
      if (liveMap) {
        liveMap.invalidateSize();
      }
    });
  }

  function resetLiveMapView() {
    if (!liveMap) return;
    liveMap.setView(DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM);
  }

  function updateLiveMapVisibility() {
    if (!liveMapPanel) return;
    liveMapPanel.classList.toggle('is-empty', liveMapMarkers.size === 0);
  }

  function clearLiveMapMarkers({ announce = true } = {}) {
    if (liveMapMarkersLayer) {
      liveMapMarkersLayer.clearLayers();
    }
    liveMapMarkers.clear();
    updateLiveMapVisibility();
    if (announce) {
      setLiveMapStatus(joined ? '位置情報が共有されるとここに表示されます。' : 'ルームに参加すると位置情報が表示されます。');
    }
    resetLiveMapView();
  }

  function focusLiveMapOnMarkers() {
    if (!liveMap || liveMapMarkers.size === 0) {
      resetLiveMapView();
      return;
    }
    const latLngs = [];
    liveMapMarkers.forEach((marker) => {
      if (!marker) return;
      const latLng = marker.getLatLng();
      if (latLng) {
        latLngs.push(latLng);
      }
    });
    if (latLngs.length === 0) {
      resetLiveMapView();
      return;
    }
    if (latLngs.length === 1) {
      liveMap.setView(latLngs[0], Math.max(liveMap.getZoom(), 15));
      return;
    }
    const bounds = window.L.latLngBounds(latLngs);
    liveMap.fitBounds(bounds, { padding: [32, 32], maxZoom: 16 });
  }

  function upsertLiveMapMarker({ user, location } = {}, { focus = true, announce = true } = {}) {
    if (!location || typeof location.latitude !== 'number' || typeof location.longitude !== 'number') {
      return false;
    }
    if (!ensureLiveMapReady()) {
      return false;
    }
    const latLng = [location.latitude, location.longitude];
    const key = user || 'anonymous';
    let marker = liveMapMarkers.get(key);
    if (!marker) {
      marker = window.L.marker(latLng, {
        title: user ? `${user}の現在地` : '共有された現在地',
      });
      marker.addTo(liveMapMarkersLayer);
      liveMapMarkers.set(key, marker);
    } else {
      marker.setLatLng(latLng);
    }
    if (user) {
      marker.bindPopup(`${user}の最新の位置`);
    } else {
      marker.bindPopup('共有された位置情報');
    }
    if (announce) {
      const displayUser = user || 'ユーザー';
      setLiveMapStatus(`${displayUser}が位置情報を共有しました。`);
    }
    updateLiveMapVisibility();
    if (focus) {
      focusLiveMapOnMarkers();
    }
    return true;
  }

  function rebuildLiveMapFromMessages(messages) {
    if (!Array.isArray(messages) || messages.length === 0) {
      pendingLiveMapMessages = null;
      if (liveMap) {
        clearLiveMapMarkers();
      } else {
        setLiveMapStatus(joined ? '位置情報が共有されるとここに表示されます。' : 'ルームに参加すると位置情報が表示されます。');
      }
      return;
    }
    pendingLiveMapMessages = messages;
    if (!ensureLiveMapReady()) {
      return;
    }
    pendingLiveMapMessages = null;
    clearLiveMapMarkers({ announce: false });
    let applied = 0;
    messages.forEach((message) => {
      if (!message || typeof message !== 'object') return;
      const user = typeof message.user === 'string' ? message.user : '';
      const rawLocation = message.location && typeof message.location === 'object' ? message.location : null;
      const latitude = rawLocation && typeof rawLocation.latitude === 'number' ? rawLocation.latitude : null;
      const longitude = rawLocation && typeof rawLocation.longitude === 'number' ? rawLocation.longitude : null;
      if (latitude === null || longitude === null) {
        return;
      }
      const updated = upsertLiveMapMarker({ user, location: { latitude, longitude } }, { focus: false, announce: false });
      if (updated) {
        applied += 1;
      }
    });
    updateLiveMapVisibility();
    if (applied > 0) {
      setLiveMapStatus('最新の位置情報を表示しています。');
      focusLiveMapOnMarkers();
    } else if (joined) {
      setLiveMapStatus('まだ位置情報は共有されていません。');
    } else {
      setLiveMapStatus('ルームに参加すると位置情報が表示されます。');
    }
  }

  window.addEventListener('resize', refreshLiveMapSize);

  function updateContinuousLocationUI(active) {
    if (!toggleLocationShareBtn) return;
    toggleLocationShareBtn.setAttribute('aria-pressed', active ? 'true' : 'false');
    if (toggleLocationShareLabel) {
      toggleLocationShareLabel.textContent = active ? '位置共有を停止' : '位置共有を開始';
    }
  }

  function updateLocationButtonsState() {
    const canShare = joined && ROOM;
    if (shareLocationBtn) {
      shareLocationBtn.disabled = !canShare || isContinuousLocationSharing;
    }
    if (toggleLocationShareBtn) {
      toggleLocationShareBtn.disabled = !canShare;
    }
  }

  function stopContinuousLocationShare({ notify = true } = {}) {
    const hadWatch = locationWatchId !== null;
    if (hadWatch && navigator.geolocation && typeof navigator.geolocation.clearWatch === 'function') {
      try {
        navigator.geolocation.clearWatch(locationWatchId);
      } catch (error) {
        console.warn('Failed to clear geolocation watch:', error);
      }
    }
    locationWatchId = null;
    const wasSharing = isContinuousLocationSharing;
    isContinuousLocationSharing = false;
    lastContinuousLocationUpdate = 0;
    const shouldNotify = notify && wasSharing && joined && ROOM && hasSentInitialContinuousLocationMessage;
    hasSentInitialContinuousLocationMessage = false;
    updateContinuousLocationUI(false);
    updateLocationButtonsState();
    if (joined) {
      inputEl.disabled = false;
      sendBtn.disabled = false;
    }
    if (shouldNotify) {
      socket.emit('message', {
        user: userName,
        room: ROOM,
        icon: userIcon || null,
        text: '常時位置情報の共有を停止しました。',
      });
    }
  }

  function startContinuousLocationShare() {
    if (!joined || !ROOM) {
      alert('ルームに参加してから常時位置情報を共有してください。');
      return;
    }
    if (!navigator.geolocation || typeof navigator.geolocation.watchPosition !== 'function') {
      alert('お使いのブラウザでは常時位置情報を利用できません。');
      return;
    }

    hasSentInitialContinuousLocationMessage = false;
    lastContinuousLocationUpdate = 0;
    isContinuousLocationSharing = true;
    updateContinuousLocationUI(true);
    updateLocationButtonsState();
    inputEl.disabled = false;
    sendBtn.disabled = false;
    inputEl.focus();

    const handlePosition = (position) => {
      if (!joined || !ROOM) {
        const shouldNotify = hasSentInitialContinuousLocationMessage;
        stopContinuousLocationShare({ notify: shouldNotify });
        return;
      }
      const { coords } = position || {};
      const latitude = coords && typeof coords.latitude === 'number' ? coords.latitude : null;
      const longitude = coords && typeof coords.longitude === 'number' ? coords.longitude : null;
      if (latitude === null || longitude === null) {
        return;
      }
      const now = Date.now();
      if (hasSentInitialContinuousLocationMessage && now - lastContinuousLocationUpdate < CONTINUOUS_LOCATION_MIN_INTERVAL) {
        return;
      }
      lastContinuousLocationUpdate = now;
      const messageText = hasSentInitialContinuousLocationMessage
        ? '常時位置情報を更新しました。'
        : '常時位置情報の共有を開始しました。';
      socket.emit('message', {
        user: userName,
        room: ROOM,
        icon: userIcon || null,
        text: messageText,
        location: { latitude, longitude },
      });
      hasSentInitialContinuousLocationMessage = true;
    };

    const handleError = (error) => {
      alert('常時位置情報を取得できませんでした: ' + (error && error.message ? error.message : '不明なエラー'));
      const shouldNotify = hasSentInitialContinuousLocationMessage;
      stopContinuousLocationShare({ notify: shouldNotify });
    };

    try {
      locationWatchId = navigator.geolocation.watchPosition(handlePosition, handleError, {
        enableHighAccuracy: true,
        maximumAge: 10000,
        timeout: 20000,
      });
    } catch (error) {
      alert('常時位置情報の共有を開始できませんでした: ' + (error && error.message ? error.message : '不明なエラー'));
      stopContinuousLocationShare({ notify: false });
    }
  }

  function persistUserIcon(icon) {
    try {
      if (icon) {
        localStorage.setItem('userIcon', icon);
      } else {
        localStorage.removeItem('userIcon');
      }
    } catch (err) {
      console.warn('Failed to persist user icon to localStorage:', err);
    }
  }

  function setSidebarVisibility(visible) {
    if (!roomUsersPanel) return;
    const next = Boolean(visible);
    roomUsersPanel.setAttribute('data-visible', next ? 'true' : 'false');
    if (sidebarToggleBtn) {
      sidebarToggleBtn.setAttribute('aria-expanded', String(next));
    }
  }

  function toggleActionsMenu(open) {
    const next = typeof open === 'boolean' ? open : !actionsMenuOpen;
    actionsMenuOpen = next;
    if (quickActionsMenu) {
      quickActionsMenu.setAttribute('aria-hidden', next ? 'false' : 'true');
    }
    if (moreActionsBtn) {
      moreActionsBtn.setAttribute('aria-expanded', String(next));
    }
  }

  function handleGlobalClick(event) {
    if (!actionsMenuOpen) return;
    if (!quickActionsMenu || !moreActionsBtn) return;
    if (quickActionsMenu.contains(event.target) || moreActionsBtn.contains(event.target)) {
      return;
    }
    toggleActionsMenu(false);
  }

  function handleGlobalKeydown(event) {
    if (event.key === 'Escape' && actionsMenuOpen) {
      toggleActionsMenu(false);
    }
  }

  function setConnectionStatus(status) {
    if (!connectionBanner) return;
    connectionBanner.classList.remove('is-offline', 'is-reconnecting');
    let message = '';
    switch (status) {
      case 'online':
        message = 'オンライン';
        break;
      case 'reconnecting':
        message = '再接続中…';
        connectionBanner.classList.add('is-reconnecting');
        break;
      case 'offline':
        message = 'オフライン - 接続を確認してください';
        connectionBanner.classList.add('is-offline');
        break;
      default:
        message = '';
    }
    connectionBanner.textContent = message;
  }

  function isNearBottom() {
    if (!chatScrollRegion) return true;
    return (chatScrollRegion.scrollTop + chatScrollRegion.clientHeight) >= (chatScrollRegion.scrollHeight - SCROLL_ANCHOR_THRESHOLD);
  }

  function hideNewMessagesButton() {
    if (newMessagesButton) {
      newMessagesButton.classList.remove('visible');
    }
  }

  function showNewMessagesButton() {
    if (newMessagesButton) {
      newMessagesButton.classList.add('visible');
    }
  }

  function registerTypingUser(user) {
    if (!user || user === userName) {
      return;
    }
    typingUsers.set(user, { name: user, expires: Date.now() + 6000 });
    updateTypingIndicator();
    if (typingIndicatorTimeout) {
      clearTimeout(typingIndicatorTimeout);
    }
    typingIndicatorTimeout = setTimeout(() => {
      pruneTypingUsers();
      updateTypingIndicator();
    }, 6500);
  }

  function pruneTypingUsers() {
    const now = Date.now();
    let changed = false;
    typingUsers.forEach((value, key) => {
      if (!value || value.expires < now) {
        typingUsers.delete(key);
        changed = true;
      }
    });
    return changed;
  }

  function updateTypingIndicator() {
    if (!typingIndicatorEl) return;
    pruneTypingUsers();
    const names = Array.from(typingUsers.values()).map((entry) => entry.name).filter(Boolean);
    if (names.length === 0) {
      typingIndicatorEl.textContent = '';
      return;
    }
    if (names.length === 1) {
      typingIndicatorEl.textContent = `${names[0]}さんが入力中…`;
      return;
    }
    const preview = names.slice(0, 2).join('、');
    const suffix = names.length > 2 ? `ほか${names.length - 2}人` : '';
    typingIndicatorEl.textContent = suffix ? `${preview}、${suffix}が入力中…` : `${preview}が入力中…`;
  }

  function emitTyping() {
    if (!joined || !ROOM || typingEmitCooldown) {
      return;
    }
    typingEmitCooldown = true;
    socket.emit('typing', { room: ROOM });
    if (typingEmitTimer) {
      clearTimeout(typingEmitTimer);
    }
    typingEmitTimer = setTimeout(() => {
      typingEmitCooldown = false;
    }, 2000);
  }

  function resolveThemeValue(preference) {
    if (preference === 'dark' || preference === 'light') {
      return preference;
    }
    return prefersDarkMedia.matches ? 'dark' : 'light';
  }

  function updateThemeToggleButton(preference) {
    if (!themeToggleBtn) return;
    const effective = resolveThemeValue(preference);
    const label = preference === 'system' ? 'システム' : effective === 'dark' ? 'ダーク' : 'ライト';
    const icon = effective === 'dark' ? '🌙' : '🌞';
    themeToggleBtn.setAttribute('data-mode', preference);
    themeToggleBtn.setAttribute('aria-pressed', effective === 'dark' ? 'true' : 'false');
    themeToggleBtn.setAttribute('aria-label', `テーマ: ${label} (クリックで切り替え / Shift+クリックでシステム)`);
    themeToggleBtn.title = 'クリックでライト/ダークを切り替え・Shift+クリックでシステム設定に戻す';
    themeToggleBtn.innerHTML = `<span aria-hidden="true">${icon}</span><span class="label">${label}</span>`;
  }

  function applyTheme(preference, { persist = true } = {}) {
    themePreference = preference;
    const effective = resolveThemeValue(preference);
    document.documentElement.setAttribute('data-theme', effective);
    updateThemeToggleButton(preference);
    if (!persist) {
      return;
    }
    if (preference === 'system') {
      localStorage.removeItem(THEME_STORAGE_KEY);
    } else {
      localStorage.setItem(THEME_STORAGE_KEY, preference);
    }
  }

  function setUserIcon(icon, { persist = true } = {}) {
    userIcon = icon || null;
    if (iconPreview) {
      iconPreview.src = userIcon || DEFAULT_ICON_SRC;
    }
    if (persist) {
      persistUserIcon(userIcon);
    }
  }

  function setIconStatus(message, { isError = false, autoClear = !isError } = {}) {
    if (!iconStatus) return;
    iconStatus.textContent = message || '';
    iconStatus.classList.toggle('error', Boolean(isError));
    if (iconStatusTimer) {
      clearTimeout(iconStatusTimer);
      iconStatusTimer = null;
    }
    if (message && autoClear) {
      iconStatusTimer = setTimeout(() => {
        iconStatus.textContent = '';
        iconStatus.classList.remove('error');
        iconStatusTimer = null;
      }, 4000);
    }
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error('Failed to read blob as data URL.'));
      reader.readAsDataURL(blob);
    });
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error('Failed to read file.'));
      reader.readAsDataURL(file);
    });
  }

  async function createOptimizedIconDataUrl(file) {
    if (!file) return null;
    const MAX_SIZE = 128;
    if (typeof createImageBitmap === 'function') {
      try {
        const bitmap = await createImageBitmap(file);
        const scale = Math.min(1, MAX_SIZE / Math.max(bitmap.width, bitmap.height || 1));
        const width = Math.max(1, Math.round(bitmap.width * scale));
        const height = Math.max(1, Math.round(bitmap.height * scale));
        let dataUrl;
        if (typeof OffscreenCanvas !== 'undefined') {
          const canvas = new OffscreenCanvas(width, height);
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            throw new Error('Failed to obtain OffscreenCanvas context.');
          }
          ctx.drawImage(bitmap, 0, 0, width, height);
          const blob = await canvas.convertToBlob({ type: 'image/png', quality: 0.92 });
          dataUrl = await blobToDataUrl(blob);
        } else {
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            throw new Error('Failed to obtain CanvasRenderingContext2D.');
          }
          ctx.drawImage(bitmap, 0, 0, width, height);
          dataUrl = canvas.toDataURL('image/png', 0.92);
        }
        if (typeof bitmap.close === 'function') {
          bitmap.close();
        }
        return dataUrl;
      } catch (error) {
        console.warn('Failed to optimise icon with createImageBitmap:', error);
      }
    }
    try {
      return await readFileAsDataUrl(file);
    } catch (error) {
      console.warn('Failed to read icon file:', error);
      return null;
    }
  }

  function emitProfileUpdate(update) {
    return new Promise((resolve) => {
      let settled = false;
      const timeoutId = setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve({ ok: false, error: 'サーバーへの接続を確認できませんでした。' });
      }, 5000);
      socket.emit('profile-update', update, (response = {}) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        resolve(response);
      });
    });
  }

  async function applyUserIconChange(iconDataUrl) {
    const previousIcon = userIcon;
    setUserIcon(iconDataUrl);
    if (!joined || !ROOM) {
      if (inCall) {
        updateCallParticipation('update');
      }
      return { ok: true };
    }
    const response = await emitProfileUpdate({ icon: iconDataUrl });
    if (!response || response.ok !== true) {
      setUserIcon(previousIcon);
      return {
        ok: false,
        error: response && response.error ? response.error : 'アイコンの更新に失敗しました。',
      };
    }
    if (inCall) {
      updateCallParticipation('update');
    }
    return { ok: true };
  }

  function upsertRoomUser(update = {}) {
    if (!update || !update.id) return;
    const next = [];
    let found = false;
    currentRoomUsers.forEach((entry) => {
      if (entry.id === update.id) {
        found = true;
        next.push({
          id: entry.id,
          user: typeof update.user === 'string' ? update.user : entry.user,
          icon: Object.prototype.hasOwnProperty.call(update, 'icon') ? update.icon ?? null : entry.icon,
        });
      } else {
        next.push(entry);
      }
    });
    if (!found) {
      next.push({
        id: update.id,
        user: typeof update.user === 'string' ? update.user : '',
        icon: Object.prototype.hasOwnProperty.call(update, 'icon') ? update.icon ?? null : null,
      });
    }
    currentRoomUsers = next;
    renderRoomUsers();
  }

  function setInteractionEnabled(enabled) {
    inputEl.disabled = !enabled;
    sendBtn.disabled = !enabled;
    if (!enabled) {
      if (shareLocationBtn) {
        shareLocationBtn.disabled = true;
      }
      if (toggleLocationShareBtn) {
        toggleLocationShareBtn.disabled = true;
      }
    } else {
      updateLocationButtonsState();
    }
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
    latestCallParticipants = Array.isArray(participants) ? participants : [];
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
      avatar.src = icon || DEFAULT_ICON_SRC;
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
    if (Array.isArray(users)) {
      currentRoomUsers = users.map(({ id, user, icon }) => ({
        id,
        user: typeof user === 'string' ? user : '',
        icon: typeof icon === 'string' && icon ? icon : null,
      }));
    }
    const list = currentRoomUsers;
    roomUserListEl.innerHTML = '';
    if (!Array.isArray(list) || list.length === 0) {
      const emptyItem = document.createElement('li');
      emptyItem.className = 'empty';
      emptyItem.textContent = 'まだユーザーはいません。';
      roomUserListEl.appendChild(emptyItem);
      return;
    }

    list.forEach(({ id, user, icon }) => {
      const item = document.createElement('li');
      const avatar = document.createElement('img');
      avatar.src = icon || DEFAULT_ICON_SRC;
      avatar.alt = `${user || 'ユーザー'}のアイコン`;
      item.appendChild(avatar);
      const name = document.createElement('span');
      name.textContent = id === socket.id ? `${user || 'ゲスト'} (自分)` : user || 'ゲスト';
      item.appendChild(name);
      if (id === socket.id) {
        item.classList.add('self');
      }
      roomUserListEl.appendChild(item);
    });
  }

  renderRoomUsers([]);

  function updateLeaveRoomButton() {
    if (!leaveRoomBtn) return;
    const isInRoom = joined && ROOM;
    const isAdminLoggedIn = Boolean(adminToken);
    if (isInRoom) {
      leaveRoomBtn.disabled = false;
      leaveRoomBtn.textContent = `「${ROOM}」から退出`;
    } else if (isAdminLoggedIn) {
      leaveRoomBtn.disabled = false;
      leaveRoomBtn.textContent = 'ログアウト';
    } else {
      leaveRoomBtn.disabled = true;
      leaveRoomBtn.textContent = '参加中のルームはありません';
    }
  }

  updateLeaveRoomButton();

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

  setUserIcon(userIcon, { persist: false });

  function loadActiveSession() {
    try {
      const raw = sessionStorage.getItem(ACTIVE_SESSION_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      const { room, user, password } = parsed;
      if (!room || !user || !password) return null;
      return { room, user, password };
    } catch (error) {
      console.warn('Failed to load active session:', error);
      return null;
    }
  }

  function saveActiveSession({ room, user, password }) {
    try {
      const payload = JSON.stringify({ room, user, password });
      sessionStorage.setItem(ACTIVE_SESSION_KEY, payload);
    } catch (error) {
      console.warn('Failed to persist active session:', error);
    }
  }

  function clearActiveSession() {
    try {
      sessionStorage.removeItem(ACTIVE_SESSION_KEY);
    } catch (error) {
      console.warn('Failed to clear active session:', error);
    }
  }

  const storedUserName = localStorage.getItem('userName');
  if (storedUserName) {
    userNameInput.value = storedUserName;
  }
  const storedRoom = localStorage.getItem('lastRoom');
  if (storedRoom) {
    roomNameInput.value = storedRoom;
  }

  const activeSession = loadActiveSession();
  if (activeSession) {
    roomNameInput.value = activeSession.room;
    userNameInput.value = activeSession.user;
    passwordInput.value = activeSession.password;
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
        clearActiveSession();
        return;
      }

      ROOM = response.room || roomName;
      userName = name;
      joined = true;
      localStorage.setItem('userName', userName);
      localStorage.setItem('lastRoom', ROOM);
      saveActiveSession({ room: ROOM, user: userName, password });
      const serverMessages = Array.isArray(response.messages) ? response.messages : [];
      const localMessages = loadLocalMessages(ROOM);
      const mergedMessages = mergeMessages(serverMessages, localMessages);
      saveLocalMessages(ROOM, mergedMessages);
      renderMessages(mergedMessages);
      joinModal.classList.add('hidden');
      appContent.classList.remove('hidden');
      ensureLiveMapReady();
      refreshLiveMapSize();
      rebuildLiveMapFromMessages(mergedMessages);
      passwordInput.value = '';
      setInteractionEnabled(true);
      refreshCallButtons();
      updateLeaveRoomButton();
      inputEl.focus();
    });
  }

  function exitCurrentRoom(message, { clearLocal = false } = {}) {
    const previousRoom = ROOM;
    if (inCall) {
      endCall();
    }
    if (isContinuousLocationSharing || locationWatchId !== null) {
      const shouldNotify = hasSentInitialContinuousLocationMessage;
      stopContinuousLocationShare({ notify: shouldNotify });
    }
    joined = false;
    clearLiveMapMarkers();
    setInteractionEnabled(false);
    refreshCallButtons();
    renderMessages([]);
    renderParticipants([]);
    renderRoomUsers([]);
    typingUsers.clear();
    updateTypingIndicator();
    hideNewMessagesButton();
    shouldAutoScroll = true;
    setIconStatus('');
    appContent.classList.add('hidden');
    joinModal.classList.remove('hidden');
    if (message) {
      joinError.textContent = message;
    } else {
      joinError.textContent = '';
    }
    if (clearLocal && previousRoom) {
      clearLocalMessages(previousRoom);
    }
    ROOM = null;
    clearActiveSession();
    updateLeaveRoomButton();
    if (adminModal) {
      adminModal.classList.add('hidden');
    }
    roomNameInput.focus();
  }

  function handleCreateRoom() {
    if (!createRoomBtn) {
      return;
    }

    const roomName = roomNameInput.value.trim();
    const password = passwordInput.value.trim();
    const name = userNameInput.value.trim();

    if (createRoomMessage) {
      createRoomMessage.textContent = '';
    }
    joinError.textContent = '';

    if (!roomName) {
      joinError.textContent = 'ルーム名を入力してください。';
      roomNameInput.focus();
      return;
    }

    if (!password) {
      joinError.textContent = 'パスワードを入力してください。';
      passwordInput.focus();
      return;
    }

    const originalLabel = createRoomBtn.textContent;
    createRoomBtn.disabled = true;
    createRoomBtn.textContent = '作成中…';

    socket.emit('create-room', { name: roomName, password }, (data) => {
      const restoreButtonState = () => {
        createRoomBtn.disabled = false;
        createRoomBtn.textContent = originalLabel;
      };

      if (!data || data.ok !== true) {
        const message = data && data.error ? data.error : 'ルームの作成に失敗しました。';
        joinError.textContent = message;
        restoreButtonState();
        return;
      }

      renderRoomOptionsList(Array.isArray(data.rooms) ? data.rooms : []);

      if (!name) {
        if (createRoomMessage) {
          createRoomMessage.textContent = 'ルームを作成しました。ユーザー名を入力して参加してください。';
        }
        userNameInput.focus();
        restoreButtonState();
        return;
      }

      if (createRoomMessage) {
        createRoomMessage.textContent = 'ルームを作成しました。参加しています…';
      }
      attemptJoin();
      restoreButtonState();
    });
  }

  joinBtn.addEventListener('click', attemptJoin);
  if (createRoomBtn) {
    createRoomBtn.addEventListener('click', handleCreateRoom);
  }
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

  if (!activeSession) {
    if (roomNameInput.value) {
      if (userNameInput.value) {
        passwordInput.focus();
      } else {
        userNameInput.focus();
      }
    } else {
      roomNameInput.focus();
    }
  }

  fetchRooms();
  requestNotificationPermission();

  const storedTheme = localStorage.getItem(THEME_STORAGE_KEY);
  const initialTheme = storedTheme === 'dark' || storedTheme === 'light' ? storedTheme : 'system';
  applyTheme(initialTheme, { persist: false });

  if (prefersDarkMedia) {
    const handleThemeMediaChange = () => {
      if (themePreference === 'system') {
        applyTheme('system', { persist: false });
      }
    };
    if (typeof prefersDarkMedia.addEventListener === 'function') {
      prefersDarkMedia.addEventListener('change', handleThemeMediaChange);
    } else if (typeof prefersDarkMedia.addListener === 'function') {
      prefersDarkMedia.addListener(handleThemeMediaChange);
    }
  }

  if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', (event) => {
      if (event.shiftKey) {
        applyTheme('system');
        return;
      }
      const effective = resolveThemeValue(themePreference);
      const next = effective === 'dark' ? 'light' : 'dark';
      applyTheme(next);
    });
  }

  setSidebarVisibility(window.innerWidth > 1024);

  window.addEventListener('resize', () => {
    if (window.innerWidth > 1024) {
      setSidebarVisibility(true);
    } else {
      setSidebarVisibility(false);
    }
  });

  if (sidebarToggleBtn) {
    sidebarToggleBtn.addEventListener('click', () => {
      const nextVisible = roomUsersPanel && roomUsersPanel.getAttribute('data-visible') !== 'true';
      setSidebarVisibility(nextVisible);
    });
  }

  if (closeSidebarBtn) {
    closeSidebarBtn.addEventListener('click', () => {
      setSidebarVisibility(false);
    });
  }

  if (chatScrollRegion) {
    chatScrollRegion.addEventListener('scroll', () => {
      shouldAutoScroll = isNearBottom();
      if (shouldAutoScroll) {
        hideNewMessagesButton();
      }
    });
  }

  if (newMessagesButton) {
    newMessagesButton.addEventListener('click', () => {
      shouldAutoScroll = true;
      scheduleMessagesScrollToBottom({ force: true });
    });
  }

  if (moreActionsBtn) {
    moreActionsBtn.addEventListener('click', () => {
      toggleActionsMenu();
    });
  }

  document.addEventListener('click', handleGlobalClick);
  document.addEventListener('keydown', handleGlobalKeydown);

  if (activeSession) {
    setTimeout(() => {
      if (!joined) {
        attemptJoin();
      }
    }, 0);
  }

  if (refreshAppBtn) {
    refreshAppBtn.addEventListener('click', () => {
      refreshAppBtn.disabled = true;
      window.location.reload();
    });
  }

  if (openAdminBtn) {
    openAdminBtn.addEventListener('click', () => {
      adminError.textContent = '';
      adminModal.classList.remove('hidden');
      updateLeaveRoomButton();
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

  if (leaveRoomBtn) {
    leaveRoomBtn.addEventListener('click', async () => {
      adminError.textContent = '';
      const wasInRoom = joined && ROOM;
      const wasAdminLoggedIn = Boolean(adminToken);

      if (!wasInRoom && !wasAdminLoggedIn) {
        adminError.textContent = '現在参加中のルームはありません。';
        updateLeaveRoomButton();
        return;
      }

      leaveRoomBtn.disabled = true;

      try {
        if (wasInRoom) {
          await new Promise((resolve, reject) => {
            socket.emit('leave-room', (response = {}) => {
              if (!response || response.ok !== true) {
                const message = response && response.error ? response.error : 'ルームから退出できませんでした。';
                reject(message);
                return;
              }
              resolve();
            });
          });
          adminError.textContent = 'ルームから退出しました。';
          exitCurrentRoom('ルームから退出しました。');
          fetchRooms();
          return;
        }

        if (wasAdminLoggedIn) {
          if (adminToken) {
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
          }

          adminToken = null;
          setAdminView(false);
          adminPasswordInput.value = '';
          adminError.textContent = 'ログアウトしました。';
          exitCurrentRoom('ログアウトしました。再度ルームを選択してください。');
          fetchRooms();
        }
      } catch (error) {
        adminError.textContent = typeof error === 'string' ? error : '操作に失敗しました。';
      } finally {
        leaveRoomBtn.disabled = false;
        updateLeaveRoomButton();
      }
    });
  }

  function scheduleMessagesScrollToBottom({ force = false } = {}) {
    if (!chatScrollRegion) return;
    if (!force && !shouldAutoScroll) {
      return;
    }
    if (pendingScrollToBottom) return;
    pendingScrollToBottom = true;
    requestAnimationFrame(() => {
      chatScrollRegion.scrollTop = chatScrollRegion.scrollHeight;
      pendingScrollToBottom = false;
      shouldAutoScroll = true;
      hideNewMessagesButton();
    });
  }

  function createMessageElement(message, { previousUser } = {}) {
    if (!message || typeof message !== 'object') return null;
    const rawUser = typeof message.user === 'string' ? message.user : '';
    const sanitizedText = typeof message.text === 'string' ? message.text : '';
    const icon = typeof message.icon === 'string' && message.icon ? message.icon : null;
    const hasLocation = message.location && typeof message.location === 'object';
    const latitude = hasLocation && typeof message.location.latitude === 'number'
      ? message.location.latitude
      : null;
    const longitude = hasLocation && typeof message.location.longitude === 'number'
      ? message.location.longitude
      : null;
    const location = latitude !== null && longitude !== null ? { latitude, longitude } : null;
    const timestampValue = typeof message.time === 'number' ? message.time : Date.now();
    const timestampDate = new Date(timestampValue);
    const timestamp = timestampDate.toLocaleTimeString();

    const li = document.createElement('li');
    li.classList.add('message');
    li.dataset.user = rawUser;
    li.dataset.time = String(timestampValue);

    if (rawUser === 'system') {
      li.classList.add('message--system');
      const bubble = document.createElement('div');
      bubble.className = 'message-bubble';
      const meta = document.createElement('div');
      meta.className = 'meta';
      const timeEl = document.createElement('time');
      timeEl.dateTime = timestampDate.toISOString();
      timeEl.textContent = timestamp;
      meta.appendChild(timeEl);
      bubble.appendChild(meta);
      if (sanitizedText) {
        const textEl = document.createElement('p');
        textEl.className = 'text';
        textEl.textContent = sanitizedText;
        bubble.appendChild(textEl);
      }
      li.appendChild(bubble);
    } else {
      const displayUser = rawUser || 'ゲスト';
      const isSelf = rawUser && rawUser === userName;
      li.classList.add(isSelf ? 'message--self' : 'message--other');

      if (previousUser && previousUser === rawUser) {
        li.classList.add('message--continued', 'message--condensed');
      }

      const avatar = document.createElement('div');
      avatar.className = 'avatar';
      const img = document.createElement('img');
      img.alt = `${displayUser}のアイコン`;
      img.src = icon || DEFAULT_ICON_SRC;
      avatar.appendChild(img);

      const bubble = document.createElement('div');
      bubble.className = 'message-bubble';

      const meta = document.createElement('div');
      meta.className = 'meta';
      const author = document.createElement('span');
      author.className = 'author';
      author.textContent = displayUser;
      const separator = document.createElement('span');
      separator.className = 'separator';
      separator.textContent = '・';
      const timeEl = document.createElement('time');
      timeEl.dateTime = timestampDate.toISOString();
      timeEl.textContent = timestamp;
      meta.appendChild(author);
      meta.appendChild(separator);
      meta.appendChild(timeEl);
      bubble.appendChild(meta);

      if (sanitizedText) {
        const textEl = document.createElement('p');
        textEl.className = 'text';
        textEl.textContent = sanitizedText;
        bubble.appendChild(textEl);
      }

      if (location) {
        const link = document.createElement('a');
        link.className = 'location-link';
        link.href = `https://www.google.com/maps?q=${location.latitude},${location.longitude}`;
        link.target = '_blank';
        link.rel = 'noopener';
        link.textContent = '地図で確認する';
        bubble.appendChild(link);
      }

      if (isSelf) {
        li.appendChild(bubble);
        li.appendChild(avatar);
      } else {
        li.appendChild(avatar);
        li.appendChild(bubble);
      }
    }

    return {
      element: li,
      persisted: {
        user: rawUser,
        text: sanitizedText,
        time: timestampValue,
        icon,
        location,
      },
    };
  }

  function addMessage(message, { persist = true } = {}) {
    const previousUser = messagesEl && messagesEl.lastElementChild ? messagesEl.lastElementChild.dataset.user : null;
    const wasNearBottom = isNearBottom();
    const built = createMessageElement(message, { previousUser });
    if (!built) return;
    messagesEl.appendChild(built.element);
    if (built.persisted && built.persisted.location) {
      upsertLiveMapMarker(built.persisted, { focus: true, announce: true });
    }
    if (persist && ROOM) {
      appendLocalMessage(ROOM, built.persisted);
    }

    if (built.persisted.user) {
      typingUsers.delete(built.persisted.user);
      updateTypingIndicator();
    }

    if (wasNearBottom) {
      shouldAutoScroll = true;
      scheduleMessagesScrollToBottom({ force: true });
    } else {
      shouldAutoScroll = false;
      showNewMessagesButton();
    }
  }

  function renderMessages(messages) {
    messagesEl.innerHTML = '';
    if (!Array.isArray(messages) || messages.length === 0) {
      hideNewMessagesButton();
      scheduleMessagesScrollToBottom({ force: true });
      return;
    }

    const fragment = document.createDocumentFragment();
    let previousUser = null;
    messages.forEach((message) => {
      const built = createMessageElement(message, { previousUser });
      if (!built) return;
      fragment.appendChild(built.element);
      previousUser = typeof message.user === 'string' ? message.user : null;
    });
    messagesEl.appendChild(fragment);
    rebuildLiveMapFromMessages(messages);
    hideNewMessagesButton();
    shouldAutoScroll = true;
    scheduleMessagesScrollToBottom({ force: true });
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
    updateLeaveRoomButton();
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

    rooms.forEach(({ name, password, createdAt, blockedIps }) => {
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

      const blockedSection = document.createElement('div');
      blockedSection.className = 'blocked-ip-section';
      const blockedTitle = document.createElement('span');
      blockedTitle.className = 'title';
      blockedTitle.textContent = 'ブロック中のIPアドレス';
      blockedSection.appendChild(blockedTitle);
      const blockedList = document.createElement('ul');
      blockedList.className = 'blocked-ip-list';
      const ips = Array.isArray(blockedIps) ? blockedIps : [];
      if (ips.length === 0) {
        const emptyBlocked = document.createElement('li');
        emptyBlocked.className = 'empty';
        emptyBlocked.textContent = '現在はありません。';
        blockedList.appendChild(emptyBlocked);
      } else {
        ips.forEach((ip) => {
          if (!ip) return;
          const blockedItem = document.createElement('li');
          const ipText = document.createElement('span');
          ipText.textContent = ip;
          blockedItem.appendChild(ipText);
          const unblockBtn = document.createElement('button');
          unblockBtn.type = 'button';
          unblockBtn.className = 'secondary-button';
          unblockBtn.textContent = '解除';
          unblockBtn.addEventListener('click', () => {
            unblockIpForRoom(name, ip);
          });
          blockedItem.appendChild(unblockBtn);
          blockedList.appendChild(blockedItem);
        });
      }
      blockedSection.appendChild(blockedList);
      info.appendChild(blockedSection);

      const actions = document.createElement('div');
      actions.className = 'actions';
      const blockBtn = document.createElement('button');
      blockBtn.type = 'button';
      blockBtn.className = 'secondary-button';
      blockBtn.textContent = 'IPをブロック';
      blockBtn.addEventListener('click', () => {
        if (!adminToken) return;
        const input = prompt(`ルーム「${name}」でブロックするIPアドレスを入力してください。`);
        if (!input) {
          return;
        }
        blockIpForRoom(name, input.trim());
      });
      actions.appendChild(blockBtn);
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

  async function blockIpForRoom(name, ip) {
    if (!adminToken) return;
    const trimmedIp = typeof ip === 'string' ? ip.trim() : '';
    if (!trimmedIp) {
      adminError.textContent = 'IPアドレスを入力してください。';
      return;
    }
    adminError.textContent = '';
    try {
      const response = await fetch(`/api/admin/rooms/${encodeURIComponent(name)}/block-ip`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-token': adminToken,
        },
        body: JSON.stringify({ ip: trimmedIp }),
      });
      if (response.status === 401) {
        adminToken = null;
        setAdminView(false);
        adminError.textContent = '認証の有効期限が切れました。再度ログインしてください。';
        return;
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) {
        const message = data && data.error ? data.error : 'IPアドレスのブロックに失敗しました。';
        adminError.textContent = message;
        return;
      }
      renderAdminRooms(data.rooms || []);
      adminError.textContent = `IPアドレス「${trimmedIp}」をブロックしました。`;
      fetchRooms();
    } catch (error) {
      console.warn('IPアドレスのブロックに失敗しました:', error);
      adminError.textContent = 'IPアドレスのブロックに失敗しました。';
    }
  }

  async function unblockIpForRoom(name, ip) {
    if (!adminToken) return;
    const targetIp = typeof ip === 'string' ? ip.trim() : '';
    if (!targetIp) {
      adminError.textContent = '解除するIPアドレスが無効です。';
      return;
    }
    adminError.textContent = '';
    try {
      const response = await fetch(`/api/admin/rooms/${encodeURIComponent(name)}/block-ip`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-token': adminToken,
        },
        body: JSON.stringify({ ip: targetIp }),
      });
      if (response.status === 401) {
        adminToken = null;
        setAdminView(false);
        adminError.textContent = '認証の有効期限が切れました。再度ログインしてください。';
        return;
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) {
        const message = data && data.error ? data.error : 'IPアドレスの解除に失敗しました。';
        adminError.textContent = message;
        return;
      }
      renderAdminRooms(data.rooms || []);
      adminError.textContent = `IPアドレス「${targetIp}」のブロックを解除しました。`;
      fetchRooms();
    } catch (error) {
      console.warn('IPアドレスの解除に失敗しました:', error);
      adminError.textContent = 'IPアドレスの解除に失敗しました。';
    }
  }

  iconInput.addEventListener('change', async (event) => {
    const [file] = event.target.files || [];
    if (!file) return;
    iconInput.disabled = true;
    setIconStatus('アイコンを最適化しています…', { autoClear: false });
    try {
      const dataUrl = await createOptimizedIconDataUrl(file);
      if (!dataUrl) {
        setIconStatus('画像の処理に失敗しました。別の画像を選択してください。', { isError: true, autoClear: false });
        return;
      }
      const result = await applyUserIconChange(dataUrl);
      if (!result.ok) {
        setIconStatus(result.error || 'アイコンの更新に失敗しました。', { isError: true, autoClear: false });
      } else {
        setIconStatus('アイコンを更新しました。');
      }
    } catch (error) {
      console.warn('Failed to update icon:', error);
      setIconStatus('アイコンの更新中にエラーが発生しました。', { isError: true, autoClear: false });
    } finally {
      iconInput.disabled = false;
      iconInput.value = '';
      setInteractionEnabled(joined);
      if (joined) {
        inputEl.focus();
      }
    }
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

  inputEl.addEventListener('input', () => {
    if (!joined || !ROOM) return;
    emitTyping();
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

  socket.on('typing', (payload = {}) => {
    if (!payload || typeof payload !== 'object') return;
    if (typeof payload.user === 'string') {
      registerTypingUser(payload.user);
    }
  });

  setConnectionStatus(navigator.onLine ? 'online' : 'offline');
  window.addEventListener('online', () => setConnectionStatus('online'));
  window.addEventListener('offline', () => setConnectionStatus('offline'));

  socket.on('connect', () => {
    setConnectionStatus('online');
  });

  socket.on('disconnect', () => {
    setConnectionStatus(navigator.onLine ? 'reconnecting' : 'offline');
  });

  if (socket.io && socket.io.on) {
    socket.io.on('reconnect_attempt', () => {
      setConnectionStatus('reconnecting');
    });
    socket.io.on('reconnect', () => {
      setConnectionStatus('online');
    });
    socket.io.on('error', () => {
      if (!navigator.onLine) {
        setConnectionStatus('offline');
      } else {
        setConnectionStatus('reconnecting');
      }
    });
  }

  socket.on('call-participants', (participants) => {
    renderParticipants(participants);
    if (Array.isArray(participants)) {
      const activeIds = new Set();
      participants.forEach(({ id }) => {
        if (typeof id === 'string') {
          activeIds.add(id);
        }
      });
      Array.from(peerConnections.keys()).forEach((peerId) => {
        if (!activeIds.has(peerId)) {
          removePeerConnection(peerId);
        }
      });
      if (!activeIds.has(socket.id) && inCall) {
        endCall({ notifyPeers: false, notifyServer: false });
      }
    }
    if (inCall) {
      connectToExistingParticipants().catch((error) => {
        console.error('Failed to connect to participants after update:', error);
      });
    }
  });

  socket.on('room-users', (users) => {
    renderRoomUsers(users);
  });

  socket.on('profile-updated', (payload = {}) => {
    upsertRoomUser(payload);
    if (payload.id === socket.id) {
      if (Object.prototype.hasOwnProperty.call(payload, 'icon')) {
        setUserIcon(payload.icon ?? null);
      }
      if (typeof payload.user === 'string' && payload.user.trim()) {
        userName = payload.user.trim();
      }
    }
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
        exitCurrentRoom('参加中のルームは管理者により削除されました。別のルームを選択してください。');
      }
    }
    fetchRooms();
  });

  socket.on('room-blocked', ({ room } = {}) => {
    if (room && ROOM === room) {
      exitCurrentRoom('このルームへの参加は管理者によってブロックされました。');
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
    toggleActionsMenu(false);
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

  if (toggleLocationShareBtn) {
    toggleLocationShareBtn.addEventListener('click', () => {
      toggleActionsMenu(false);
      if (isContinuousLocationSharing) {
        const shouldNotify = hasSentInitialContinuousLocationMessage;
        stopContinuousLocationShare({ notify: shouldNotify });
      } else {
        startContinuousLocationShare();
      }
    });
  }

  // ---------- WebRTC VOICE CALL -----------
  let localStream = null;
  const iceServers = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

  function cleanupRemoteAudio(peerId) {
    if (!peerId) return;
    const el = remoteAudioElements.get(peerId);
    if (el) {
      cleanupAudioElement(el);
      remoteAudioElements.delete(peerId);
    }
  }

  function removePeerConnection(peerId) {
    if (!peerId) return;
    const pc = peerConnections.get(peerId);
    if (!pc) {
      cleanupRemoteAudio(peerId);
      pendingIceCandidates.delete(peerId);
      return;
    }
    peerConnections.delete(peerId);
    pendingIceCandidates.delete(peerId);
    cleanupRemoteAudio(peerId);
    try {
      pc.close();
    } catch (error) {
      console.warn('Failed to close peer connection:', error);
    }
  }

  function removeAllPeerConnections() {
    Array.from(peerConnections.keys()).forEach((peerId) => {
      removePeerConnection(peerId);
    });
    peerConnections.clear();
    pendingIceCandidates.clear();
  }

  async function getLocalStream() {
    if (localStream) {
      return localStream;
    }
    if (!joined || !ROOM) {
      throw new Error('ルームに参加していません。');
    }
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
      throw new Error('お使いのブラウザは音声通話に対応していません。');
    }
    if (!acquiringLocalStream) {
      acquiringLocalStream = navigator.mediaDevices.getUserMedia({ audio: true });
    }
    let stream;
    try {
      stream = await acquiringLocalStream;
    } catch (error) {
      acquiringLocalStream = null;
      throw error;
    }
    acquiringLocalStream = null;
    localStream = stream;
    cleanupAudioElement(localAudioEl);
    localAudioEl = attachAudioElement(localStream, { muted: true });
    return localStream;
  }

  function flushPendingCandidates(peerId, pc) {
    const queued = pendingIceCandidates.get(peerId);
    if (!queued || !queued.length) {
      return;
    }
    queued.forEach((candidateInit) => {
      try {
        pc.addIceCandidate(new RTCIceCandidate(candidateInit)).catch((error) => {
          console.warn('Failed to apply queued ICE candidate:', error);
        });
      } catch (error) {
        console.warn('Failed to queue ICE candidate:', error);
      }
    });
    pendingIceCandidates.delete(peerId);
  }

  async function preparePeerConnection(peerId) {
    if (!peerId || peerId === socket.id) {
      return null;
    }
    let pc = peerConnections.get(peerId);
    if (pc) {
      return pc;
    }
    const stream = await getLocalStream();
    pc = new RTCPeerConnection(iceServers);
    stream.getTracks().forEach((track) => {
      pc.addTrack(track, stream);
    });
    pc.addEventListener('track', (event) => {
      const [remoteStream] = event.streams;
      if (!remoteStream) return;
      cleanupRemoteAudio(peerId);
      const audioEl = attachAudioElement(remoteStream);
      remoteAudioElements.set(peerId, audioEl);
    });
    pc.addEventListener('icecandidate', (event) => {
      if (event.candidate && joined && ROOM) {
        socket.emit('webrtc', {
          room: ROOM,
          data: { type: 'candidate', candidate: event.candidate, target: peerId },
        });
      }
    });
    pc.addEventListener('connectionstatechange', () => {
      if (['failed', 'closed'].includes(pc.connectionState)) {
        removePeerConnection(peerId);
      }
    });
    peerConnections.set(peerId, pc);
    return pc;
  }

  async function connectToExistingParticipants() {
    if (!joined || !ROOM) {
      return;
    }
    if (!Array.isArray(latestCallParticipants) || latestCallParticipants.length === 0) {
      return;
    }
    for (const participant of latestCallParticipants) {
      if (!participant || typeof participant.id !== 'string') continue;
      const peerId = participant.id;
      if (peerId === socket.id) continue;
      if (socket.id < peerId && !peerConnections.has(peerId)) {
        await createOfferForPeer(peerId);
      }
    }
  }

  async function ensureCallActive({ notifyPeers = false, updateStatus = false } = {}) {
    const alreadyInCall = inCall;
    await getLocalStream();
    if (!alreadyInCall) {
      inCall = true;
      refreshCallButtons();
      updateCallParticipation('join');
      await connectToExistingParticipants();
    } else if (updateStatus) {
      updateCallParticipation('update');
    }
    if (notifyPeers && joined && ROOM) {
      socket.emit('webrtc', { room: ROOM, data: { type: 'call-ready' } });
    }
  }

  async function createOfferForPeer(peerId) {
    try {
      const pc = await preparePeerConnection(peerId);
      if (!pc) return;
      if (pc.signalingState === 'have-local-offer') {
        return;
      }
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('webrtc', { room: ROOM, data: { type: 'offer', sdp: offer, target: peerId } });
    } catch (error) {
      console.error('Failed to create offer for peer:', peerId, error);
    }
  }

  async function handleCallReady(peerId) {
    if (!peerId || peerId === socket.id) return;
    if (!inCall) {
      return;
    }
    if (!(socket.id < peerId)) {
      return;
    }
    if (peerConnections.has(peerId)) {
      return;
    }
    try {
      await ensureCallActive();
      await createOfferForPeer(peerId);
    } catch (error) {
      console.error('Failed to respond to call-ready from', peerId, error);
    }
  }

  async function handleOffer(peerId, sdp) {
    if (!peerId || !sdp) return;
    try {
      await ensureCallActive();
    } catch (error) {
      console.error('Failed to prepare for incoming offer:', error);
      return;
    }
    try {
      const pc = await preparePeerConnection(peerId);
      if (!pc) return;
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      flushPendingCandidates(peerId, pc);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('webrtc', { room: ROOM, data: { type: 'answer', sdp: answer, target: peerId } });
      inCall = true;
      refreshCallButtons();
    } catch (error) {
      console.error('Error handling offer from', peerId, error);
    }
  }

  async function handleAnswer(peerId, sdp) {
    if (!peerId || !sdp) return;
    const pc = peerConnections.get(peerId);
    if (!pc) return;
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      flushPendingCandidates(peerId, pc);
    } catch (error) {
      console.error('Error applying answer from', peerId, error);
    }
  }

  function handleCandidate(peerId, candidate) {
    if (!peerId || !candidate) return;
    const pc = peerConnections.get(peerId);
    if (pc && pc.remoteDescription && pc.remoteDescription.type) {
      pc.addIceCandidate(new RTCIceCandidate(candidate)).catch((error) => {
        console.warn('Failed to add ICE candidate from', peerId, error);
      });
      return;
    }
    const queued = pendingIceCandidates.get(peerId) || [];
    queued.push(candidate);
    pendingIceCandidates.set(peerId, queued);
  }

  function handleRemoteHangup(peerId) {
    if (!peerId || peerId === socket.id) return;
    removePeerConnection(peerId);
  }

  function endCall({ notifyPeers = true, notifyServer = true } = {}) {
    removeAllPeerConnections();
    remoteAudioElements.forEach((el) => {
      cleanupAudioElement(el);
    });
    remoteAudioElements.clear();
    if (localStream) {
      localStream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch (error) {
          console.warn('Failed to stop local track:', error);
        }
      });
      localStream = null;
    }
    acquiringLocalStream = null;
    cleanupAudioElement(localAudioEl);
    localAudioEl = null;
    if (inCall && notifyServer) {
      updateCallParticipation('leave');
    }
    inCall = false;
    refreshCallButtons();
    if (notifyPeers && joined && ROOM) {
      socket.emit('webrtc', { room: ROOM, data: { type: 'hangup' } });
    }
  }

  startCallBtn.addEventListener('click', async () => {
    startCallBtn.disabled = true;
    try {
      await ensureCallActive({ notifyPeers: true, updateStatus: true });
    } catch (error) {
      console.error('Failed to start call:', error);
      const message = error && error.message ? error.message : String(error || '不明なエラー');
      alert('マイクへのアクセスに失敗しました: ' + message);
      endCall({ notifyPeers: false, notifyServer: false });
    } finally {
      refreshCallButtons();
    }
  });

  endCallBtn.addEventListener('click', () => {
    endCall();
  });

  // Handle incoming WebRTC signaling
  socket.on('webrtc', async ({ sender, data }) => {
    if (!data || !sender || sender === socket.id) {
      return;
    }
    if (data.target && data.target !== socket.id) {
      return;
    }
    switch (data.type) {
      case 'call-ready':
        await handleCallReady(sender);
        break;
      case 'offer':
        await handleOffer(sender, data.sdp);
        break;
      case 'answer':
        await handleAnswer(sender, data.sdp);
        break;
      case 'candidate':
        handleCandidate(sender, data.candidate);
        break;
      case 'hangup':
        handleRemoteHangup(sender);
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
