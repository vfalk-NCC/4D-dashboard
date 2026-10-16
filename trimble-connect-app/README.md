# Min Trimble Connect App

En ny grundmall för att utveckla en extension/applikation i Trimble Connect.

## Filer

- `manifest.json`: Appens manifest som registreras i Trimble Connect.
- `index.html`: Webbläsargränssnitt med Trimble Connect Workspace API integrerat.
- `app.js`: Huvudlogik och anslutning till `TrimbleConnectWorkspace.connect()`.
- `style.css`: Appens stilmall.

## Kom igång

1. Publicera denna mapp via GitHub Pages eller valfri webbhotellstjänst.
2. I Trimble Connect (Browser Viewer) -> Inställningar -> Extensions -> Lägg till anpassad extension.
3. Klistra in länken till din publicerade `manifest.json`.
