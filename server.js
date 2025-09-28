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
const rooms = new Map();
// Store basic profile info per socket to show user-friendly names
const userProfiles = new Map();
// Track current call participants per room so the UI can display them
const callParticipants = new Map();

function broadcastParticipants(room) {
  const participants = callParticipants.get(room);
  const payload = participants ? Array.from(participants.values()) : [];
  io.to(room).emit('call-participants', payload);
}

io.on('connection', (socket) => {
  console.log('a user connected:', socket.id);

  // Join a room for group chat; default to 'global'
  socket.on('join', (payload = 'global') => {
    const isObject = payload && typeof payload === 'object';
    const room = isObject ? payload.room || 'global' : payload || 'global';
    if (!rooms.has(room)) rooms.set(room, []);
    const ids = rooms.get(room);
    if (!ids.includes(socket.id)) {
      ids.push(socket.id);
    }
    socket.join(room);

    const existingProfile = userProfiles.get(socket.id) || {};
    let user = existingProfile.user;
    if (isObject && typeof payload.user === 'string' && payload.user.trim()) {
      user = payload.user.trim();
    }
    if (!user) {
      user = socket.id;
    }
    let icon = existingProfile.icon ?? null;
    if (isObject && Object.prototype.hasOwnProperty.call(payload, 'icon')) {
      icon = payload.icon || null;
    }
    userProfiles.set(socket.id, { user, icon });

    // Notify others with a friendlier name when available
    socket.to(room).emit('system', `${user} joined ${room}`);

    const participants = callParticipants.get(room);
    socket.emit('call-participants', participants ? Array.from(participants.values()) : []);
  });

  // Chat message within a room
  socket.on('message', (msg) => {
    const { room = 'global', text, user, icon, location } = msg;
    const payload = {
      user,
      time: Date.now(),
    };
    if (text) payload.text = text;
    if (icon) payload.icon = icon;
    if (location) payload.location = location;
    io.to(room).emit('message', payload);
  });

  // Signaling messages for WebRTC; forward to all peers in the room
  socket.on('webrtc', ({ room = 'global', data }) => {
    socket.to(room).emit('webrtc', { sender: socket.id, data });
  });

  socket.on('call-participation', (data = {}) => {
    const { action } = data;
    if (!action) return;
    const room = data.room || 'global';
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
      const existingProfile = userProfiles.get(socket.id) || {};
      const nameFromData = typeof data.user === 'string' && data.user.trim() ? data.user.trim() : undefined;
      const iconFromData = Object.prototype.hasOwnProperty.call(data, 'icon') ? data.icon || null : undefined;
      const participantUser = nameFromData || existingProfile.user || socket.id;
      const participantIcon = iconFromData !== undefined ? iconFromData : existingProfile.icon ?? null;
      const info = { id: socket.id, user: participantUser, icon: participantIcon };
      participants.set(socket.id, info);
      callParticipants.set(room, participants);
      userProfiles.set(socket.id, { user: participantUser, icon: participantIcon });
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
    for (const [room, ids] of rooms.entries()) {
      const idx = ids.indexOf(socket.id);
      if (idx !== -1) {
        ids.splice(idx, 1);
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
        if (ids.length === 0) rooms.delete(room);
        break;
      }
    }
    userProfiles.delete(socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
