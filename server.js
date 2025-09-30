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
const path = require('path');


const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static assets from the public directory
app.use(express.static(__dirname));
// Map of room names to array of socket IDs; used for group chat and voice calls
const ROOM_PASSWORD = '0623';
const rooms = new Map();
// Store basic profile info per socket to show user-friendly names
const userProfiles = new Map();
// Track current call participants per room so the UI can display them
const callParticipants = new Map();
// Track all room members so the client can display a roster
const roomMembers = new Map();

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

  // Join a room for group chat; default to 'global'
  socket.on('join', (payload = 'global', maybeCallback) => {
    const callback = typeof maybeCallback === 'function' ? maybeCallback : undefined;
    const isObject = payload && typeof payload === 'object';
    const room = isObject ? payload.room || 'global' : payload || 'global';
    const password = isObject ? payload.password : undefined;
    const rawName = isObject && typeof payload.user === 'string' ? payload.user.trim() : '';
    if (password !== ROOM_PASSWORD) {
      if (callback) callback({ ok: false, error: 'パスワードが違います。' });
      return;
    }
    if (!rawName) {
      if (callback) callback({ ok: false, error: 'ユーザー名を入力してください。' });
      return;
    }

    const icon = isObject && Object.prototype.hasOwnProperty.call(payload, 'icon') && payload.icon
      ? payload.icon
      : null;

    let ids = rooms.get(room);
    if (!ids) {
      ids = new Set();
      rooms.set(room, ids);
    }
    ids.add(socket.id);
    socket.join(room);

    const profile = { user: rawName, icon, room };
    userProfiles.set(socket.id, profile);

    let members = roomMembers.get(room);
    if (!members) {
      members = new Map();
      roomMembers.set(room, members);
    }
    members.set(socket.id, { id: socket.id, user: rawName, icon });

    // Notify others with a friendlier name when available
    socket.to(room).emit('system', `${rawName} joined ${room}`);

    const participants = callParticipants.get(room);
    socket.emit('call-participants', participants ? Array.from(participants.values()) : []);
    emitRoomUsers(room);

    if (callback) callback({ ok: true });
  });

  // Chat message within a room
  socket.on('message', (msg = {}) => {
    const profile = userProfiles.get(socket.id);
    if (!profile || !profile.room) {
      return;
    }
    const requestedRoom = typeof msg.room === 'string' && msg.room.trim() ? msg.room : profile.room;
    const ids = rooms.get(requestedRoom);
    if (!ids || !ids.has(socket.id)) {
      return;
    }
    const text = typeof msg.text === 'string' ? msg.text.trim() : '';
    const location = msg.location;
    const incomingIcon = msg.icon;
    const icon = profile.icon || incomingIcon || null;
    if (incomingIcon && !profile.icon) {
      const updatedProfile = { ...profile, icon: incomingIcon };
      userProfiles.set(socket.id, updatedProfile);
      const members = roomMembers.get(requestedRoom);
      if (members && members.has(socket.id)) {
        const existing = members.get(socket.id);
        members.set(socket.id, { ...existing, icon: incomingIcon });
      }
    }
    const payload = {
      user: profile.user,
      time: Date.now(),
    };
    if (text) payload.text = text;
    if (icon) payload.icon = icon;
    if (location) payload.location = location;
    io.to(requestedRoom).emit('message', payload);
  });

  // Signaling messages for WebRTC; forward to all peers in the room
  socket.on('webrtc', ({ room = 'global', data }) => {
    socket.to(room).emit('webrtc', { sender: socket.id, data });
  });

  socket.on('call-participation', (data = {}) => {
    const { action } = data;
    if (!action) return;
    const profile = userProfiles.get(socket.id);
    if (!profile || !profile.room) return;
    const room = data.room || profile.room;
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
      const ids = rooms.get(room);
      if (ids) {
        ids.delete(socket.id);
        if (ids.size === 0) {
          rooms.delete(room);
        } else {
          rooms.set(room, ids);
        }
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
        if (members.size === 0) {
          roomMembers.delete(room);
        } else {
          roomMembers.set(room, members);
        }
        emitRoomUsers(room);
      }
    }
    userProfiles.delete(socket.id);
  });
});

const PORT = process.env.PORT || 3000;

const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;
setInterval(() => {
  io.emit('clear-history');
}, TWELVE_HOURS_MS);

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
