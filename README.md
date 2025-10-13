# Kのチャット

This is a minimal progressive web app (PWA) that demonstrates how to build a simple chat application with group messaging and voice call capabilities using Socket.io and WebRTC.

## Features

- **Real‑time chat:** Messages are sent via Socket.io, enabling real‑time communication in the default `global` room. Multiple users can join and participate concurrently.
- **Group chat:** All connected clients join the same room; extend the implementation to support multiple rooms or private groups.
- **Voice calls:** Users can initiate a peer‑to‑peer voice call using the browser’s WebRTC API. Signaling is handled via Socket.io.
- **PWA functionality:** The app registers a service worker, provides a manifest, and can be installed on supported mobile and desktop platforms. It also supports basic offline caching of static assets.
- **Live location map:** Location shares (one-time or continuous) update a Leaflet-powered map embedded next to the chat so you can follow the most recent coordinates without leaving the conversation. The Leaflet runtime is self-hosted so the map keeps working even when public CDNs are unreachable.

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

The live map uses [Leaflet](https://leafletjs.com/) assets that are bundled inside this repository and cached by the service worker. The application still requires an internet connection for fetching map tiles, but the core scripts and styles no longer depend on external CDNs.

### Running in Production

For production deployments you should:

- Serve the app over HTTPS (required for PWA installation and WebRTC); consider using a reverse proxy like Nginx with SSL certificates.
- Configure a TURN server if your users are behind strict NATs. This example uses only a public STUN server which may not work in all cases.
- Improve security by implementing authentication, authorization and message encryption.

## File Structure

```
pwa-chat-app/
├── docs/
│   └── manual-tests.md   # Manual regression scenarios (e.g. location sharing)
├── app.js                # Client-side chat and WebRTC logic
├── index.html            # Main web page
├── public/
│   ├── styles.css        # Global styles shared by the app shell
│   └── vendor/
│       ├── leaflet.css   # Self-hosted Leaflet-compatible styles
│       ├── leaflet.js    # Self-hosted Leaflet-compatible runtime
│       └── leaflet.LICENSE
├── service-worker.js     # Service worker for offline caching
├── server.js             # Express and Socket.io server
├── src/
│   └── main.js           # Module entry point importing client script
├── package.json          # Project configuration
└── README.md             # This file
```

## Manual Regression Checks

Manual QA scripts are stored under [`docs/manual-tests.md`](docs/manual-tests.md). They include a regression flow that confirms text chat stays usable while continuous location sharing is active.

## License

This project is provided under the MIT License. Feel free to use it as a starting point for your own chat application.
