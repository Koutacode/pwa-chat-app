(function (global) {
  'use strict';

  // This file implements a lightweight Leaflet-compatible API that supports the
  // limited subset of features used by the chat app (creating a map, showing a
  // tile layer, placing markers, and fitting bounds). It avoids the full
  // dependency on the upstream Leaflet distribution so the application can run
  // without fetching assets from external CDNs.

  const TILE_SIZE = 256;
  const DEFAULT_SUBDOMAINS = 'abc';

  const MAX_LATITUDE = 85.05112878;

  function latLngToPixel(lat, lng, zoom) {
    const clampedLat = clamp(lat, -MAX_LATITUDE, MAX_LATITUDE);
    const tileScale = TILE_SIZE * Math.pow(2, zoom);
    const sinLat = Math.sin((clampedLat * Math.PI) / 180);
    const x = ((lng + 180) / 360) * tileScale;
    const y =
      (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * tileScale;
    return { x, y };
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function getContainerSize(container) {
    const rect = container.getBoundingClientRect();
    return { x: rect.width, y: rect.height };
  }

  function formatTileUrl(template, x, y, z, subdomains) {
    const domains = typeof subdomains === 'string' ? subdomains.split('') : subdomains;
    const domain = domains && domains.length
      ? domains[Math.abs(x + y) % domains.length]
      : '';
    return template
      .replace('{s}', domain)
      .replace('{z}', String(z))
      .replace('{x}', String(x))
      .replace('{y}', String(y));
  }

  function latLngBounds(latLngs) {
    if (!Array.isArray(latLngs) || latLngs.length === 0) {
      throw new Error('latLngBounds requires an array of coordinates.');
    }
    let minLat = Infinity;
    let maxLat = -Infinity;
    let minLng = Infinity;
    let maxLng = -Infinity;
    latLngs.forEach((pair) => {
      if (!Array.isArray(pair) || pair.length < 2) return;
      const [lat, lng] = pair;
      if (typeof lat !== 'number' || typeof lng !== 'number') return;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
    });
    if (!Number.isFinite(minLat) || !Number.isFinite(minLng)) {
      throw new Error('latLngBounds received invalid coordinates.');
    }
    const bounds = {
      minLat,
      maxLat,
      minLng,
      maxLng,
      getSouthWest() {
        return [minLat, minLng];
      },
      getNorthEast() {
        return [maxLat, maxLng];
      },
      getCenter() {
        return [(minLat + maxLat) / 2, (minLng + maxLng) / 2];
      },
    };
    return bounds;
  }

  class Map {
    constructor(container, options = {}) {
      if (!(container instanceof HTMLElement)) {
        throw new Error('Map container must be a DOM element.');
      }
      this._container = container;
      this._container.classList.add('leaflet-container');
      this._tilePane = document.createElement('div');
      this._tilePane.className = 'leaflet-tile-pane';
      this._markerPane = document.createElement('div');
      this._markerPane.className = 'leaflet-marker-pane';
      this._popupPane = document.createElement('div');
      this._popupPane.className = 'leaflet-popup-pane';
      this._container.appendChild(this._tilePane);
      this._container.appendChild(this._markerPane);
      this._container.appendChild(this._popupPane);

      this._layers = new Set();
      this._center = Array.isArray(options.center) ? options.center.slice(0, 2) : [0, 0];
      this._zoom = typeof options.zoom === 'number' ? options.zoom : 2;
      this._minZoom = typeof options.minZoom === 'number' ? options.minZoom : 0;
      this._maxZoom = typeof options.maxZoom === 'number' ? options.maxZoom : 19;

      this._size = getContainerSize(this._container);
      if (this._size.x === 0 || this._size.y === 0) {
        // Delay initial rendering until the element is visible.
        requestAnimationFrame(() => this._update());
      } else {
        this._update();
      }
    }

    _addLayer(layer) {
      if (!layer) return layer;
      this._layers.add(layer);
      layer._map = this;
      if (typeof layer._onAdd === 'function') {
        layer._onAdd(this);
      }
      this._scheduleUpdate();
      return layer;
    }

    _removeLayer(layer) {
      if (!layer || !this._layers.has(layer)) return;
      if (typeof layer._onRemove === 'function') {
        layer._onRemove(this);
      }
      this._layers.delete(layer);
    }

    _scheduleUpdate() {
      if (this._updateRequested) return;
      this._updateRequested = true;
      requestAnimationFrame(() => {
        this._updateRequested = false;
        this._update();
      });
    }

    _update() {
      this._size = getContainerSize(this._container);
      this._layers.forEach((layer) => {
        if (typeof layer._update === 'function') {
          layer._update();
        }
      });
    }

    _containerPointFromLatLng(latLng) {
      const { x: cx, y: cy } = latLngToPixel(this._center[0], this._center[1], this._zoom);
      const { x, y } = latLngToPixel(latLng[0], latLng[1], this._zoom);
      return {
        x: x - cx + this._size.x / 2,
        y: y - cy + this._size.y / 2,
      };
    }

    setView(center, zoom) {
      if (Array.isArray(center) && center.length >= 2) {
        this._center = [Number(center[0]) || 0, Number(center[1]) || 0];
      }
      if (typeof zoom === 'number' && !Number.isNaN(zoom)) {
        this._zoom = clamp(Math.round(zoom), this._minZoom, this._maxZoom);
      }
      this._scheduleUpdate();
      return this;
    }

    getZoom() {
      return this._zoom;
    }

    invalidateSize() {
      this._scheduleUpdate();
    }

    fitBounds(bounds, options = {}) {
      if (!bounds || typeof bounds.getSouthWest !== 'function') {
        throw new Error('fitBounds expects a bounds object.');
      }
      const padding = Array.isArray(options.padding) ? options.padding : [0, 0];
      const paddingX = padding[0] || 0;
      const paddingY = padding[1] || 0;
      const maxZoom = typeof options.maxZoom === 'number' ? options.maxZoom : this._maxZoom;
      const sw = bounds.getSouthWest();
      const ne = bounds.getNorthEast();
      if (!sw || !ne) return this;
      const size = this._size;
      if (size.x === 0 || size.y === 0) {
        return this;
      }

      let targetZoom = this._minZoom;
      for (let z = maxZoom; z >= this._minZoom; z -= 1) {
        const swPixel = latLngToPixel(sw[0], sw[1], z);
        const nePixel = latLngToPixel(ne[0], ne[1], z);
        const width = Math.abs(nePixel.x - swPixel.x) + paddingX * 2;
        const height = Math.abs(swPixel.y - nePixel.y) + paddingY * 2;
        if (width <= size.x && height <= size.y) {
          targetZoom = z;
          break;
        }
      }
      const centerLat = (sw[0] + ne[0]) / 2;
      const centerLng = (sw[1] + ne[1]) / 2;
      return this.setView([centerLat, centerLng], targetZoom);
    }
  }

  class TileLayer {
    constructor(urlTemplate, options = {}) {
      this._url = urlTemplate;
      this.options = {
        tileSize: TILE_SIZE,
        minZoom: 0,
        maxZoom: 19,
        subdomains: DEFAULT_SUBDOMAINS,
        attribution: '',
        ...options,
      };
      this._tiles = new Map();
    }

    addTo(map) {
      if (!(map instanceof Map)) {
        throw new Error('TileLayer can only be added to a map.');
      }
      map._addLayer(this);
      return this;
    }

    _onAdd(map) {
      this._map = map;
      this._pane = map._tilePane;
      this._container = document.createElement('div');
      this._container.className = 'leaflet-tile-container';
      this._pane.appendChild(this._container);
      if (this.options.attribution) {
        TileLayer._ensureAttributionControl(map, this.options.attribution);
      }
    }

    _onRemove() {
      if (this._container && this._container.parentNode) {
        this._container.parentNode.removeChild(this._container);
      }
      this._tiles.clear();
    }

    _update() {
      if (!this._map || !this._container) return;
      const map = this._map;
      const zoom = clamp(map._zoom, this.options.minZoom, this.options.maxZoom);
      const size = map._size;
      const centerPixel = latLngToPixel(map._center[0], map._center[1], zoom);
      const halfWidth = size.x / 2;
      const halfHeight = size.y / 2;
      const topLeftPixel = { x: centerPixel.x - halfWidth, y: centerPixel.y - halfHeight };
      const bottomRightPixel = { x: centerPixel.x + halfWidth, y: centerPixel.y + halfHeight };
      const tileSize = this.options.tileSize;
      const startX = Math.floor(topLeftPixel.x / tileSize);
      const startY = Math.floor(topLeftPixel.y / tileSize);
      const endX = Math.floor(bottomRightPixel.x / tileSize);
      const endY = Math.floor(bottomRightPixel.y / tileSize);

      const needed = new Set();
      for (let x = startX; x <= endX; x += 1) {
        for (let y = startY; y <= endY; y += 1) {
          const key = `${x}:${y}:${zoom}`;
          needed.add(key);
          if (!this._tiles.has(key)) {
            const tile = document.createElement('img');
            tile.className = 'leaflet-tile';
            tile.alt = '';
            tile.draggable = false;
            tile.decoding = 'async';
            tile.referrerPolicy = 'no-referrer';
            const url = formatTileUrl(
              this._url,
              x,
              y,
              zoom,
              this.options.subdomains || DEFAULT_SUBDOMAINS
            );
            tile.src = url;
            const tileX = x * tileSize - topLeftPixel.x;
            const tileY = y * tileSize - topLeftPixel.y;
            tile.style.transform = `translate(${tileX}px, ${tileY}px)`;
            this._container.appendChild(tile);
            this._tiles.set(key, tile);
          } else {
            const existing = this._tiles.get(key);
            const tileX = x * tileSize - topLeftPixel.x;
            const tileY = y * tileSize - topLeftPixel.y;
            existing.style.transform = `translate(${tileX}px, ${tileY}px)`;
          }
        }
      }
      // Remove tiles that are no longer needed
      Array.from(this._tiles.keys()).forEach((key) => {
        if (!needed.has(key)) {
          const tile = this._tiles.get(key);
          if (tile && tile.parentNode) {
            tile.parentNode.removeChild(tile);
          }
          this._tiles.delete(key);
        }
      });
    }

    static _ensureAttributionControl(map, text) {
      if (!map || !(map instanceof Map)) return;
      if (!map._attributionControl) {
        const control = document.createElement('div');
        control.className = 'leaflet-control-attribution';
        map._container.appendChild(control);
        map._attributionControl = control;
        map._attributionEntries = new Set();
      }
      if (!map._attributionEntries.has(text)) {
        map._attributionEntries.add(text);
        const values = Array.from(map._attributionEntries.values());
        map._attributionControl.innerHTML = values.join(' | ');
      }
    }
  }

  class LayerGroup {
    constructor() {
      this._layers = new Set();
    }

    addTo(map) {
      if (!(map instanceof Map)) {
        throw new Error('LayerGroup can only be added to a map.');
      }
      map._addLayer(this);
      this._map = map;
      this._layers.forEach((layer) => {
        if (typeof layer.addTo === 'function') {
          layer.addTo(this);
        }
      });
      return this;
    }

    addLayer(layer) {
      if (!layer) return this;
      this._layers.add(layer);
      layer._group = this;
      if (this._map && typeof layer._onAdd === 'function') {
        layer._map = this._map;
        layer._onAdd(this._map);
        this._map._scheduleUpdate();
      }
      return this;
    }

    clearLayers() {
      this._layers.forEach((layer) => {
        if (layer && typeof layer._onRemove === 'function' && layer._map) {
          layer._onRemove(layer._map);
        }
        if (layer && layer._element && layer._element.parentNode) {
          layer._element.parentNode.removeChild(layer._element);
        }
      });
      this._layers.clear();
      if (this._map) {
        this._map._scheduleUpdate();
      }
    }

    _update() {
      this._layers.forEach((layer) => {
        if (typeof layer._update === 'function') {
          layer._update();
        }
      });
    }
  }

  class Marker {
    constructor(latLng, options = {}) {
      if (!Array.isArray(latLng) || latLng.length < 2) {
        throw new Error('Marker requires a [lat, lng] coordinate.');
      }
      this._latLng = [Number(latLng[0]) || 0, Number(latLng[1]) || 0];
      this.options = { title: '', ...options };
    }

    addTo(target) {
      if (target instanceof LayerGroup) {
        target.addLayer(this);
      } else if (target instanceof Map) {
        target._addLayer(this);
      } else {
        throw new Error('Marker can only be added to a map or layer group.');
      }
      return this;
    }

    setLatLng(latLng) {
      if (!Array.isArray(latLng) || latLng.length < 2) {
        return this;
      }
      this._latLng = [Number(latLng[0]) || 0, Number(latLng[1]) || 0];
      if (this._map) {
        this._map._scheduleUpdate();
      }
      return this;
    }

    bindPopup(content) {
      this._popupContent = content;
      return this;
    }

    _onAdd(map) {
      this._map = map;
      if (!this._element) {
        this._element = document.createElement('div');
        this._element.className = 'leaflet-marker';
        if (this.options.title) {
          this._element.setAttribute('title', this.options.title);
        }
        this._element.setAttribute('role', 'button');
        this._element.setAttribute('tabindex', '0');
        this._element.addEventListener('click', () => this._togglePopup());
        this._element.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            this._togglePopup();
          }
        });
      }
      map._markerPane.appendChild(this._element);
      this._update();
    }

    _onRemove() {
      if (this._element && this._element.parentNode) {
        this._element.parentNode.removeChild(this._element);
      }
      if (this._popup && this._popup.parentNode) {
        this._popup.parentNode.removeChild(this._popup);
      }
    }

    _update() {
      if (!this._map || !this._element) return;
      const point = this._map._containerPointFromLatLng(this._latLng);
      this._element.style.transform = `translate(${point.x}px, ${point.y}px)`;
      if (this._popup) {
        this._popup.style.transform = `translate(${point.x}px, ${point.y}px)`;
      }
    }

    _togglePopup() {
      if (!this._map || !this._popupContent) return;
      if (this._popup && this._popup.parentNode) {
        this._popup.parentNode.removeChild(this._popup);
        this._popup = null;
        return;
      }
      const popup = document.createElement('div');
      popup.className = 'leaflet-popup';
      popup.innerHTML = this._popupContent;
      this._map._popupPane.appendChild(popup);
      this._popup = popup;
      this._update();
    }
  }

  const L = {
    map(container, options) {
      return new Map(container, options);
    },
    tileLayer(urlTemplate, options) {
      return new TileLayer(urlTemplate, options);
    },
    marker(latLng, options) {
      return new Marker(latLng, options);
    },
    layerGroup() {
      return new LayerGroup();
    },
    latLngBounds,
    version: '1.0.0-lite',
    // Expose helpers for internal consumers (mainly testing)
    __util: { latLngToPixel },
  };

  Object.defineProperty(L, 'Map', { value: Map });
  Object.defineProperty(L, 'TileLayer', { value: TileLayer });
  Object.defineProperty(L, 'Marker', { value: Marker });
  Object.defineProperty(L, 'LayerGroup', { value: LayerGroup });

  global.L = L;
})(typeof window !== 'undefined' ? window : globalThis);
