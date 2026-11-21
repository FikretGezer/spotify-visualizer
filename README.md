# 🎵 Spotify Visualizer Widget

**English** | [Türkçe](README.tr.md)

![Windows](https://img.shields.io/badge/Windows-10%2F11-0078D6?logo=windows)
![Electron](https://img.shields.io/badge/Electron-38-47848F?logo=electron&logoColor=white)
![Spotify](https://img.shields.io/badge/Spotify-Web%20API-1DB954?logo=spotify&logoColor=white)
![License: MIT](https://img.shields.io/badge/license-MIT-yellow)

<p align="center">
  <img src="docs/widget.png" width="380" alt="Widget">
  <img src="docs/player.png" width="380" alt="Player">
</p>

A floating Spotify widget for your desktop. The cover of the current track spins like a vinyl record, and your queue fans out around it like flower petals. Tuck it into a screen edge, or turn the whole screen into a visualizer that moves with your music. Clicks on empty areas pass through to the windows below, so the widget never gets in your way.

## Install and run

1. Install **Node.js 18+** from [nodejs.org](https://nodejs.org).
2. Create an app in the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard):
   - **Redirect URI:** `http://127.0.0.1:8888/`
   - **API:** Web API
   - Copy the generated **Client ID**.
3. Clone the repo and install packages:
   ```bash
   git clone https://github.com/FikretGezer/spotify-visualizer.git
   cd spotify-visualizer
   npm install
   ```
4. Copy `config.example.js` to **`config.js`** and paste your Client ID into it. This file is not committed to git.
5. Run it:
   ```bash
   npm start
   ```
   On first launch you sign in with Spotify. Sign-in uses PKCE, so no client secret is needed. The session is remembered.

> Playback controls (play/pause, skip, volume, shuffle) need **Spotify Premium**. With a free account you still see the current track and queue.

## Usage

| Action | How |
|---|---|
| Mini / full mode | Click the disc |
| Move | Drag the disc |
| Open / close player | Arrow above the disc |
| Play a track | Click it in the list |
| Scroll the list | Drag with the middle mouse button |
| Show / hide | Single-click the tray icon (with a fade) |
| Settings | Double-click the tray icon |
| Menu | Right-click the tray icon |
| Visualizer | Right-click the disc, or use the tray menu or settings |

## Features

- **Spinning disc:**
  - The current cover spins like a record.
  - The glow around it takes the cover's dominant color.
  - When nothing is playing, the last played cover stays on the disc.
- **Petal queue:**
  - Upcoming tracks are laid out around the disc as tilted petals.
  - After you scroll, the list returns to the start by itself. Delay and speed are adjustable.
- **Player:**
  - A glass-style player that opens and closes.
  - Seek bar, previous / play / next, shuffle, repeat, and a matching vertical volume bar.
  - If the disc is near the top of the screen, the player opens below it.
- **Smart positioning:**
  - If the widget goes off-screen, it slides smoothly back in.
  - It snaps to edges and corners.
- **Edge docking:**
  - Move the disc to the left or right edge and it tucks in, half off-screen.
  - Hover the disc to peek out; it slides back after a configurable delay.
  - On the right side the layout mirrors: the list and player move to the left, fading out on one side and back in on the other.
  - On multi-monitor setups, nothing spills onto the neighboring screen.
- **Full-screen visualizer:**
  - Captures system audio and draws behind everything on the widget's monitor.
  - Clicks pass straight through.
  - Opens with a circle growing out of the disc, and closes the same way.
  - Opens behind your current windows instead of jumping in front of them.
  - Animations: **Ring, Spectrum, Wave, Galaxy**, with optional auto-cycling.
- **Settings window:** Everything is saved automatically to `%APPDATA%\spotify-visualizer\settings.json`.

<p align="center"><img src="docs/right.png" width="380" alt="Right-side layout"></p>

## Settings

The settings window's labels are in Turkish; this table gives the English meaning.

| Section | What you can change |
|---|---|
| 📍 Position | Always on top, start with Windows, dock return delay, reset position |
| 🎨 Appearance | Opacity, disc size, background shadow, glow, edge softness, spin |
| 📜 List | Return delay, scroll smoothness, return speed |
| 🌈 Visualizer | Animation, auto-cycle interval |
| ⚡ Quick actions | Show/hide widget, visualizer, log out, quit |

## Files

| File | Purpose |
|---|---|
| `main.js` | Electron main process: windows, tray, dragging, docking, click-through |
| `app.js` | Widget and visualizer: Spotify API, queue, player, audio capture, animations |
| `index.html` | Widget UI and styles |
| `settings.html` | Settings window |
| `preload.js` | Bridge between the main process and the UI |
| `config.example.js` | Client ID template (copy to `config.js`) |

## Troubleshooting

- **Sign-in page shows an error:** Make sure the Redirect URI in the dashboard is exactly `http://127.0.0.1:8888/`.
- **Controls do nothing:** You need Premium, and Spotify must be open on some device.
- **Visualizer doesn't move:** Make sure sound is playing. The visualizer listens to system audio.
- **Widget disappeared:** Click the tray icon, or use *Reset position* in settings.

## License

[MIT](LICENSE) © FikretGezer
