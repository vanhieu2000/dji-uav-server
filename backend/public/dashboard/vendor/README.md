# UI dependencies served locally

Regenerate with `cd backend && npm ci && npm run vendor:sync`. Versions/integrity are locked in package-lock.json; manifest.json records SHA256 of copied assets and licenses. Runtime serves these files from the same origin and needs no package registry/CDN access. Fonts use installed system fallbacks.

- Leaflet 1.9.4 (BSD-2-Clause).
- Leaflet-Geoman Free 2.20.4 (MIT), updated from the old CDN version 2.18.3.
- flv.js 1.6.2 (Apache-2.0).
- SheetJS CE 0.20.3 (Apache-2.0), npm package `@e965/xlsx` republishing the SheetJS distribution. This is a repackaged npm distribution, not the obsolete official npm `xlsx@0.18.5`; do not silently switch package/provenance when updating. It preserves the XLS/XLSX/CSV API used by the existing importer. License is included.

Map tiles remain separately configured sources; the UI libraries being local does not download third-party basemap imagery. Use uploaded factory tiles for offline basemaps.
