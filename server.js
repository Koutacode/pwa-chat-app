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


const app = express();
const server = http.createServer(app);
const io = new Server(server);

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

const MAX_MESSAGES_PER_ROOM = 500;
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
  return true;
}

function getPublicRooms() {
  return Array.from(roomDirectory.keys()).map((name) => ({ name }));
}

function getAdminRooms() {
  return Array.from(roomDirectory.entries()).map(([name, info]) => ({
    name,
    password: info.password,
    createdAt: info.createdAt,
  }));
}

function broadcastRooms() {
  io.emit('rooms-update', getPublicRooms());
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
        client.leave(roomName);
        client.emit('room-deleted', { room: roomName });
      }
      const profile = userProfiles.get(socketId);
      if (profile) {
        userProfiles.set(socketId, { ...profile, room: null });
      }
    });
    roomSockets.delete(roomName);
  }

  roomDirectory.delete(roomName);
  roomMessages.delete(roomName);
  roomMembers.delete(roomName);
  callParticipants.delete(roomName);
  broadcastRooms();
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
  const token = crypto.randomUUID();
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

function broadcastParticipants(room) {
  const participants = callParticipants.get(room);
  const payload = participants ? Array.from(participants.values()) : [];
  io.to(room).emit('call-participants', payload);
}

function emitRoomUsers(room) {
  const members = roomMembers.get(room);
  const payload = members
    ? Array.from(members.values()).map(({ id, user }) => ({ id, user }))
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
    if (roomInfo.password !== password) {
      if (callback) callback({ ok: false, error: 'パスワードが違います。' });
      return;
    }
    if (!rawName) {
      if (callback) callback({ ok: false, error: 'ユーザー名を入力してください。' });
      return;
    }

    const icon = Object.prototype.hasOwnProperty.call(payload, 'icon') && payload.icon
      ? payload.icon
      : null;

    if (!ensureRoom(roomName)) {
      if (callback) callback({ ok: false, error: 'ルームへの参加に失敗しました。' });
      return;
    }

    const ids = roomSockets.get(roomName);
    ids.add(socket.id);
    socket.join(roomName);

    const profile = { user: rawName, icon, room: roomName };
    userProfiles.set(socket.id, profile);

    const members = roomMembers.get(roomName);
    members.set(socket.id, { id: socket.id, user: rawName, icon });

    // Notify others with a friendlier name when available
    socket.to(roomName).emit('system', `${rawName} joined ${roomName}`);

    const participants = callParticipants.get(roomName);
    socket.emit('call-participants', participants ? Array.from(participants.values()) : []);
    emitRoomUsers(roomName);

    const history = roomMessages.get(roomName) || [];

    if (callback) callback({ ok: true, room: roomName, messages: history });
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
    const incomingIcon = msg.icon;
    let icon = profile.icon || null;
    if (incomingIcon && !profile.icon) {
      icon = incomingIcon;
      const updatedProfile = { ...profile, icon: incomingIcon };
      userProfiles.set(socket.id, updatedProfile);
      const members = roomMembers.get(room);
      if (members && members.has(socket.id)) {
        const existing = members.get(socket.id);
        members.set(socket.id, { ...existing, icon: incomingIcon });
      }
    }

    if (!text && !location) {
      return;
    }

    const payload = {
      user: profile.user,
      time: Date.now(),
    };
    if (text) payload.text = text;
    if (icon || incomingIcon) payload.icon = icon || incomingIcon;
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
      const iconFromData = Object.prototype.hasOwnProperty.call(data, 'icon') ? data.icon || null : undefined;
      const participantUser = nameFromData || existingProfile.user || socket.id;
      const participantIcon = iconFromData !== undefined ? iconFromData : existingProfile.icon ?? null;
      const info = { id: socket.id, user: participantUser, icon: participantIcon };
      participants.set(socket.id, info);
      callParticipants.set(room, participants);
      userProfiles.set(socket.id, { user: participantUser, icon: participantIcon, room });
      const members = roomMembers.get(room);
      if (members && members.has(socket.id)) {
        members.set(socket.id, { id: socket.id, user: participantUser, icon: participantIcon });
        roomMembers.set(room, members);
        emitRoomUsers(room);
      }
      changed = true;
    }

    if (changed) {
      broadcastParticipants(room);
    }
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    console.log('user disconnected:', socket.id);
    const profile = userProfiles.get(socket.id);
    const room = profile?.room;
    if (room) {
      const ids = roomSockets.get(room);
      if (ids) {
        ids.delete(socket.id);
      }
      const displayName = profile?.user || socket.id;
      socket.to(room).emit('system', `${displayName} left ${room}`);
      const participants = callParticipants.get(room);
      if (participants && participants.has(socket.id)) {
        participants.delete(socket.id);
        if (participants.size === 0) {
          callParticipants.delete(room);
        } else {
          callParticipants.set(room, participants);
        }
        broadcastParticipants(room);
      }
      const members = roomMembers.get(room);
      if (members && members.has(socket.id)) {
        members.delete(socket.id);
        emitRoomUsers(room);
      }
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
