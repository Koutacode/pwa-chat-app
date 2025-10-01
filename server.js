/*
 * Simple Express server that serves a progressive web app (PWA) for chat.
 *
 * The server hosts static files in the `public` directory and uses Socket.io
 * for real‑time messaging and WebRTC signaling. Clients connect via
 * WebSockets to exchange chat messages and coordinate voice calls. For
 * production use you should secure this server behind HTTPS and configure
 * proper TURN servers for reliable WebRTC connections.
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');
const net = require('net');


const app = express();
const server = http.createServer(app);
const io = new Server(server);

function safeRandomUUID() {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return crypto.randomBytes(16).toString('hex');
}

app.use(express.json());
// Serve static assets from the public directory
app.use(express.static(__dirname));

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '0623';
// Public room directory (name -> meta)
const roomDirectory = new Map();
// Map of room names to array of socket IDs; used for group chat and voice calls
const roomSockets = new Map();
// Persist recent chat messages per room in memory
const roomMessages = new Map();
// Active admin session tokens
const adminSessions = new Map();
// Store basic profile info per socket to show user-friendly names
const userProfiles = new Map();
// Track current call participants per room so the UI can display them
const callParticipants = new Map();
// Track all room members so the client can display a roster
const roomMembers = new Map();
// Track blocked IP addresses per room
const roomBlockedIps = new Map();

const MAX_MESSAGES_PER_ROOM = 500;
const MAX_MEMBERS_PER_ROOM = 5;
const MAX_ICON_DATA_URL_LENGTH = 120000; // ~120 KB upper bound for profile icons
const DEFAULT_ROOMS = [
  { name: 'global', password: 'global' },
];

function sanitizeRoomName(name) {
  return typeof name === 'string' ? name.trim() : '';
}

function ensureRoom(name) {
  if (!roomDirectory.has(name)) {
    return false;
  }
  if (!roomSockets.has(name)) {
    roomSockets.set(name, new Set());
  }
  if (!roomMembers.has(name)) {
    roomMembers.set(name, new Map());
  }
  if (!roomMessages.has(name)) {
    roomMessages.set(name, []);
  }
  if (!roomBlockedIps.has(name)) {
    roomBlockedIps.set(name, new Set());
  }
  return true;
}

function getPublicRooms() {
  return Array.from(roomDirectory.keys()).map((name) => ({ name }));
}

function sanitizeIconDataUrl(value) {
  if (value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed.startsWith('data:image/')) {
    return null;
  }
  if (trimmed.length > MAX_ICON_DATA_URL_LENGTH) {
    return null;
  }
  return trimmed;
}

function getAdminRooms() {
  return Array.from(roomDirectory.entries()).map(([name, info]) => ({
    name,
    password: info.password,
    createdAt: info.createdAt,
    blockedIps: Array.from(roomBlockedIps.get(name) || []),
  }));
}

function broadcastRooms() {
  io.emit('rooms-update', getPublicRooms());
}

function normalizeIp(ip) {
  if (typeof ip !== 'string') {
    return '';
  }
  let value = ip.trim();
  if (!value) {
    return '';
  }
  if (value.startsWith('::ffff:')) {
    value = value.slice(7);
  }
  if (value === '::1') {
    return '127.0.0.1';
  }
  return value;
}

function getClientIp(socket) {
  if (!socket) return '';
  const address = socket.handshake?.address || socket.conn?.remoteAddress || '';
  return normalizeIp(address);
}

function removeSocketFromRoom(socket, room, { notifyOthers = true } = {}) {
  const roomName = sanitizeRoomName(room);
  if (!roomName) return false;
  const sockets = roomSockets.get(roomName);
  let wasMember = false;
  if (sockets && sockets.has(socket.id)) {
    sockets.delete(socket.id);
    wasMember = true;
  }
  socket.leave(roomName);
  const profile = userProfiles.get(socket.id);
  const displayName = profile?.user || socket.id;
  if (notifyOthers && wasMember) {
    socket.to(roomName).emit('system', `${displayName} left ${roomName}`);
  }
  const participants = callParticipants.get(roomName);
  if (participants && participants.has(socket.id)) {
    participants.delete(socket.id);
    if (participants.size === 0) {
      callParticipants.delete(roomName);
    } else {
      callParticipants.set(roomName, participants);
    }
    broadcastParticipants(roomName);
  }
  const members = roomMembers.get(roomName);
  if (members && members.has(socket.id)) {
    members.delete(socket.id);
    emitRoomUsers(roomName);
  }
  if (profile) {
    userProfiles.set(socket.id, { ...profile, room: null });
  }
  return wasMember;
}

function createRoom(name, password) {
  const roomName = sanitizeRoomName(name);
  if (!roomName) {
    throw new Error('Room name is required.');
  }
  if (roomDirectory.has(roomName)) {
    throw new Error('Room already exists.');
  }
  roomDirectory.set(roomName, {
    password: typeof password === 'string' ? password : '',
    createdAt: Date.now(),
  });
  ensureRoom(roomName);
  broadcastRooms();
  return roomName;
}

function deleteRoom(name) {
  const roomName = sanitizeRoomName(name);
  if (!roomDirectory.has(roomName)) {
    throw new Error('Room not found.');
  }

  const sockets = roomSockets.get(roomName);
  if (sockets) {
    sockets.forEach((socketId) => {
      const client = io.sockets.sockets.get(socketId);
      if (client) {
        removeSocketFromRoom(client, roomName, { notifyOthers: false });
        client.emit('room-deleted', { room: roomName });
      }
    });
    roomSockets.delete(roomName);
  }

  roomDirectory.delete(roomName);
  roomMessages.delete(roomName);
  roomMembers.delete(roomName);
  callParticipants.delete(roomName);
  roomBlockedIps.delete(roomName);
  broadcastRooms();
}

function blockIpInRoom(name, ip) {
  const roomName = sanitizeRoomName(name);
  if (!roomDirectory.has(roomName)) {
    throw new Error('Room not found.');
  }
  const normalized = normalizeIp(ip);
  if (!normalized || net.isIP(normalized) === 0) {
    throw new Error('有効なIPアドレスを入力してください。');
  }
  const blocked = roomBlockedIps.get(roomName) || new Set();
  blocked.add(normalized);
  roomBlockedIps.set(roomName, blocked);

  const sockets = roomSockets.get(roomName);
  if (sockets) {
    Array.from(sockets).forEach((socketId) => {
      const client = io.sockets.sockets.get(socketId);
      if (!client) return;
      const clientIp = getClientIp(client);
      if (clientIp === normalized) {
        removeSocketFromRoom(client, roomName, { notifyOthers: true });
        client.emit('room-blocked', { room: roomName, ip: normalized });
      }
    });
  }
}

function unblockIpInRoom(name, ip) {
  const roomName = sanitizeRoomName(name);
  if (!roomDirectory.has(roomName)) {
    throw new Error('Room not found.');
  }
  const normalized = normalizeIp(ip);
  if (!normalized) {
    throw new Error('IPアドレスを入力してください。');
  }
  const blocked = roomBlockedIps.get(roomName);
  if (!blocked || !blocked.has(normalized)) {
    throw new Error('指定されたIPアドレスはブロックされていません。');
  }
  blocked.delete(normalized);
  roomBlockedIps.set(roomName, blocked);
}

DEFAULT_ROOMS.forEach(({ name, password }) => {
  if (!roomDirectory.has(name)) {
    try {
      createRoom(name, password);
    } catch (error) {
      console.error('Failed to create default room', name, error);
    }
  }
});

function authenticateAdmin(req, res, next) {
  const token = req.headers['x-admin-token'];
  if (!token || !adminSessions.has(token)) {
    return res.status(401).json({ ok: false, error: '認証が必要です。' });
  }
  return next();
}

app.get('/api/rooms', (req, res) => {
  res.json({ rooms: getPublicRooms() });
});

app.post('/api/rooms', (req, res) => {
  const { name, password } = req.body || {};
  try {
    const created = createRoom(name, password);
    res.status(201).json({ ok: true, room: created, rooms: getPublicRooms() });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.post('/api/admin/login', (req, res) => {
  const { password } = req.body || {};
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ ok: false, error: 'パスワードが違います。' });
  }
  const token = safeRandomUUID();
  adminSessions.set(token, { createdAt: Date.now() });
  res.json({ ok: true, token, rooms: getAdminRooms() });
});

app.post('/api/admin/logout', authenticateAdmin, (req, res) => {
  const token = req.headers['x-admin-token'];
  adminSessions.delete(token);
  res.json({ ok: true });
});

app.get('/api/admin/rooms', authenticateAdmin, (req, res) => {
  res.json({ rooms: getAdminRooms() });
});

app.post('/api/admin/rooms', authenticateAdmin, (req, res) => {
  const { name, password } = req.body || {};
  try {
    const created = createRoom(name, password);
    res.status(201).json({ ok: true, room: created, rooms: getAdminRooms() });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.delete('/api/admin/rooms/:name', authenticateAdmin, (req, res) => {
  const { name } = req.params;
  try {
    deleteRoom(name);
    res.json({ ok: true, rooms: getAdminRooms() });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.post('/api/admin/rooms/:name/block-ip', authenticateAdmin, (req, res) => {
  const { name } = req.params;
  const { ip } = req.body || {};
  try {
    blockIpInRoom(name, ip);
    res.json({ ok: true, rooms: getAdminRooms() });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.delete('/api/admin/rooms/:name/block-ip', authenticateAdmin, (req, res) => {
  const { name } = req.params;
  const { ip } = req.body || {};
  try {
    unblockIpInRoom(name, ip);
    res.json({ ok: true, rooms: getAdminRooms() });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

function broadcastParticipants(room) {
  const participants = callParticipants.get(room);
  const payload = participants ? Array.from(participants.values()) : [];
  io.to(room).emit('call-participants', payload);
}

function emitRoomUsers(room) {
  const members = roomMembers.get(room);
  const payload = members
    ? Array.from(members.values()).map(({ id, user, icon }) => ({
        id,
        user,
        icon: icon ?? null,
      }))
    : [];
  io.to(room).emit('room-users', payload);
}

io.on('connection', (socket) => {
  console.log('a user connected:', socket.id);

  // Join a room for group chat.
  socket.on('join', (payload = {}, maybeCallback) => {
    const callback = typeof maybeCallback === 'function' ? maybeCallback : undefined;
    const roomName = sanitizeRoomName(payload.room);
    const password = typeof payload.password === 'string' ? payload.password : undefined;
    const rawName = typeof payload.user === 'string' ? payload.user.trim() : '';
    if (!roomName) {
      if (callback) callback({ ok: false, error: 'ルーム名を入力してください。' });
      return;
    }
    const roomInfo = roomDirectory.get(roomName);
    if (!roomInfo) {
      if (callback) callback({ ok: false, error: '指定されたルームは存在しません。' });
      return;
    }
    const clientIp = getClientIp(socket);
    const blockedIps = roomBlockedIps.get(roomName);
    if (clientIp && blockedIps && blockedIps.has(clientIp)) {
      if (callback) callback({ ok: false, error: 'このIPアドレスからの参加はブロックされています。' });
      return;
    }
    if (roomInfo.password !== password) {
      if (callback) callback({ ok: false, error: 'パスワードが違います。' });
      return;
    }
    if (!rawName) {
      if (callback) callback({ ok: false, error: 'ユーザー名を入力してください。' });
      return;
    }

    const icon = Object.prototype.hasOwnProperty.call(payload, 'icon')
      ? sanitizeIconDataUrl(payload.icon)
      : null;

    if (!ensureRoom(roomName)) {
      if (callback) callback({ ok: false, error: 'ルームへの参加に失敗しました。' });
      return;
    }

    const ids = roomSockets.get(roomName);
    const members = roomMembers.get(roomName);

    if (members.size >= MAX_MEMBERS_PER_ROOM && !members.has(socket.id)) {
      if (callback) callback({ ok: false, error: `このルームは満員です。(最大${MAX_MEMBERS_PER_ROOM}人)` });
      return;
    }

    ids.add(socket.id);
    socket.join(roomName);

    const profile = { user: rawName, icon, room: roomName };
    userProfiles.set(socket.id, profile);

    members.set(socket.id, { id: socket.id, user: rawName, icon });

    // Notify others with a friendlier name when available
    socket.to(roomName).emit('system', `${rawName} joined ${roomName}`);

    const participants = callParticipants.get(roomName);
    socket.emit('call-participants', participants ? Array.from(participants.values()) : []);
    emitRoomUsers(roomName);

    const history = roomMessages.get(roomName) || [];

    if (callback) callback({ ok: true, room: roomName, messages: history });
  });

  socket.on('leave-room', (maybeCallback) => {
    const callback = typeof maybeCallback === 'function' ? maybeCallback : () => {};
    const profile = userProfiles.get(socket.id);
    const room = profile?.room;
    if (!room) {
      callback({ ok: false, error: '現在参加しているルームがありません。' });
      return;
    }
    removeSocketFromRoom(socket, room, { notifyOthers: true });
    callback({ ok: true, room });
  });

  // Chat message within a room
  socket.on('message', (msg = {}) => {
    const profile = userProfiles.get(socket.id);
    const room = profile?.room;
    if (!room) {
      return;
    }

    const sockets = roomSockets.get(room);
    if (!sockets || !sockets.has(socket.id)) {
      return;
    }

    const text = typeof msg.text === 'string' ? msg.text.trim() : '';
    const location = msg.location && typeof msg.location === 'object' ? msg.location : undefined;
    const hasIconProp = Object.prototype.hasOwnProperty.call(msg, 'icon');
    const sanitizedIcon = hasIconProp ? sanitizeIconDataUrl(msg.icon) : undefined;
    const requestedRemoval = hasIconProp && msg.icon === null;
    let icon = profile.icon ?? null;
    if (hasIconProp && (sanitizedIcon || requestedRemoval)) {
      const nextIcon = sanitizedIcon ?? null;
      if (nextIcon !== profile.icon) {
        const updatedProfile = { ...profile, icon: nextIcon };
        userProfiles.set(socket.id, updatedProfile);
        const members = roomMembers.get(room);
        if (members && members.has(socket.id)) {
          const existing = members.get(socket.id);
          members.set(socket.id, { ...existing, icon: nextIcon });
        }
        const participants = callParticipants.get(room);
        if (participants && participants.has(socket.id)) {
          const participant = participants.get(socket.id);
          participants.set(socket.id, { ...participant, icon: nextIcon });
          callParticipants.set(room, participants);
          broadcastParticipants(room);
        }
        emitRoomUsers(room);
      }
      icon = nextIcon;
    }

    if (!text && !location) {
      return;
    }

    const payload = {
      user: profile.user,
      time: Date.now(),
    };
    if (text) payload.text = text;
    if (icon) payload.icon = icon;
    if (location) payload.location = location;

    const history = roomMessages.get(room) || [];
    history.push(payload);
    if (history.length > MAX_MESSAGES_PER_ROOM) {
      history.splice(0, history.length - MAX_MESSAGES_PER_ROOM);
    }
    roomMessages.set(room, history);

    io.to(room).emit('message', payload);
  });

  // Signaling messages for WebRTC; forward to all peers in the room
  socket.on('webrtc', ({ room, data } = {}) => {
    const profile = userProfiles.get(socket.id);
    const targetRoom = sanitizeRoomName(room) || profile?.room;
    if (!targetRoom) {
      return;
    }
    socket.to(targetRoom).emit('webrtc', { sender: socket.id, data });
  });

  socket.on('call-participation', (data = {}) => {
    const { action } = data;
    if (!action) return;
    const profile = userProfiles.get(socket.id);
    if (!profile || !profile.room) return;
    const room = sanitizeRoomName(data.room) || profile.room;
    if (!roomDirectory.has(room)) return;
    const sockets = roomSockets.get(room);
    if (!sockets || !sockets.has(socket.id)) return;
    const participants = callParticipants.get(room) || new Map();
    let changed = false;

    if (action === 'leave') {
      if (participants.has(socket.id)) {
        participants.delete(socket.id);
        changed = true;
        if (participants.size === 0) {
          callParticipants.delete(room);
        } else {
          callParticipants.set(room, participants);
        }
      }
    } else if (action === 'join' || action === 'update') {
      const existingProfile = profile;
      const nameFromData = typeof data.user === 'string' && data.user.trim() ? data.user.trim() : undefined;
      let iconProvided = Object.prototype.hasOwnProperty.call(data, 'icon');
      let iconFromData;
      if (iconProvided) {
        if (data.icon === null) {
          iconFromData = null;
        } else {
          const sanitizedIcon = sanitizeIconDataUrl(data.icon);
          if (!sanitizedIcon) {
            iconProvided = false;
          } else {
            iconFromData = sanitizedIcon;
          }
        }
      }
      const participantUser = nameFromData || existingProfile.user || socket.id;
      const participantIcon = iconProvided ? iconFromData ?? null : existingProfile.icon ?? null;
      const info = { id: socket.id, user: participantUser, icon: participantIcon };
      participants.set(socket.id, info);
      callParticipants.set(room, participants);
      userProfiles.set(socket.id, { user: participantUser, icon: participantIcon, room });
      const members = roomMembers.get(room);
      if (members && members.has(socket.id)) {
        members.set(socket.id, { id: socket.id, user: participantUser, icon: participantIcon });
        emitRoomUsers(room);
      }
      changed = true;
    }

    if (changed) {
      broadcastParticipants(room);
    }
  });

  socket.on('profile-update', (payload = {}, maybeCallback) => {
    const callback = typeof maybeCallback === 'function' ? maybeCallback : () => {};
    const profile = userProfiles.get(socket.id);
    if (!profile || !profile.room) {
      callback({ ok: false, error: 'ルームに参加していません。' });
      return;
    }

    const room = profile.room;
    const updates = {};

    if (Object.prototype.hasOwnProperty.call(payload, 'user')) {
      const proposedUser = typeof payload.user === 'string' ? payload.user.trim() : '';
      if (!proposedUser) {
        callback({ ok: false, error: 'ユーザー名を空にはできません。' });
        return;
      }
      updates.user = proposedUser;
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'icon')) {
      if (payload.icon === null) {
        updates.icon = null;
      } else {
        const sanitized = sanitizeIconDataUrl(payload.icon);
        if (!sanitized) {
          callback({ ok: false, error: 'アイコンの形式またはサイズがサポートされていません。' });
          return;
        }
        updates.icon = sanitized;
      }
    }

    if (!Object.keys(updates).length) {
      callback({ ok: false, error: '更新内容が見つかりませんでした。' });
      return;
    }

    const updatedProfile = { ...profile, ...updates };
    userProfiles.set(socket.id, updatedProfile);

    const members = roomMembers.get(room);
    if (members && members.has(socket.id)) {
      const existing = members.get(socket.id);
      members.set(socket.id, { ...existing, ...updates });
      emitRoomUsers(room);
    }

    const participants = callParticipants.get(room);
    if (participants && participants.has(socket.id)) {
      const participant = participants.get(socket.id);
      participants.set(socket.id, { ...participant, ...updates });
      callParticipants.set(room, participants);
      broadcastParticipants(room);
    }

    const payloadForClients = {
      id: socket.id,
      user: updatedProfile.user,
    };

    if (Object.prototype.hasOwnProperty.call(updates, 'icon')) {
      payloadForClients.icon = updates.icon ?? null;
    }

    socket.emit('profile-updated', payloadForClients);
    socket.to(room).emit('profile-updated', payloadForClients);
    callback({ ok: true, profile: { user: updatedProfile.user, icon: updatedProfile.icon ?? null } });
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    console.log('user disconnected:', socket.id);
    const profile = userProfiles.get(socket.id);
    if (profile?.room) {
      removeSocketFromRoom(socket, profile.room, { notifyOthers: true });
    }
    userProfiles.delete(socket.id);
  });
});

const PORT = process.env.PORT || 3000;

const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;
setInterval(() => {
  roomMessages.forEach((messages, room) => {
    if (messages.length > 0) {
      roomMessages.set(room, []);
      io.to(room).emit('clear-history', { room });
    }
  });
}, TWELVE_HOURS_MS);

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
