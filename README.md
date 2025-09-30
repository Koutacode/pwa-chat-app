# Kのチャット

This is a minimal progressive web app (PWA) that demonstrates how to build a simple chat application with group messaging and voice call capabilities using Socket.io and WebRTC.

## Features

- **Real‑time chat:** Messages are sent via Socket.io, enabling real‑time communication in the default `global` room. Multiple users can join and participate concurrently.
- **Group chat:** All connected clients join the same room; extend the implementation to support multiple rooms or private groups.
- **Voice calls:** Users can initiate a peer‑to‑peer voice call using the browser’s WebRTC API. Signaling is handled via Socket.io.
- **PWA functionality:** The app registers a service worker, provides a manifest, and can be installed on supported mobile and desktop platforms. It also supports basic offline caching of static assets.

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (version 18 or later recommended)

### Installation

1. Install dependencies:

```bash
npm install
```

2. Start the development server:

```bash
npm start
```

3. Open your browser at [http://localhost:3000](http://localhost:3000) to access the app.

### Running in Production

For production deployments you should:

- Serve the app over HTTPS (required for PWA installation and WebRTC); consider using a reverse proxy like Nginx with SSL certificates.
- Configure a TURN server if your users are behind strict NATs. This example uses only a public STUN server which may not work in all cases.
- Improve security by implementing authentication, authorization and message encryption.

## File Structure

```
pwa-chat-app/
├── public/
│   ├── app.js            # Client‑side chat and WebRTC logic
│   ├── icon-192.png      # App icon (192×192)
│   ├── icon-512.png      # App icon (512×512)
│   ├── index.html        # Main web page
│   ├── manifest.json     # PWA manifest
│   ├── service-worker.js # Service worker for offline caching
├── server.js             # Express and Socket.io server
├── package.json          # Project configuration
└── README.md             # This file
```

## License

This project is provided under the MIT License. Feel free to use it as a starting point for your own chat application.