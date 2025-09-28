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

io.on('connection', (socket) => {
  console.log('a user connected:', socket.id);

  // Join a room for group chat; default to 'global'
  socket.on('join', (room = 'global') => {
    if (!rooms.has(room)) rooms.set(room, []);
    rooms.get(room).push(socket.id);
    socket.join(room);
    // Notify others
    socket.to(room).emit('system', `${socket.id} joined ${room}`);
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

  // Handle disconnect
  socket.on('disconnect', () => {
    console.log('user disconnected:', socket.id);
    for (const [room, ids] of rooms.entries()) {
      const idx = ids.indexOf(socket.id);
      if (idx !== -1) {
        ids.splice(idx, 1);
        socket.to(room).emit('system', `${socket.id} left ${room}`);
        if (ids.length === 0) rooms.delete(room);
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
