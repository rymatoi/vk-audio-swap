# VK Audio Swap

Tampermonkey userscript that swaps VK video audio with a custom track and keeps it in sync, even after ads or player reloads.

## Features

- Replace video audio with any local audio file
- Syncs time and playback speed with the video
- Remembers the selected track per video URL
- Recovers after ads and SPA navigation

## Installation

1. Install **Tampermonkey** (Chrome/Edge/Firefox).
2. Create a new script.
3. Paste the contents of [`vk-audio-swap.user.js`](./vk-audio-swap.user.js).
4. Save the script and open any VK video page.

## Usage

- A 🎧 button appears next to the **Share** button.
- Click it to pick **Original** or upload a custom audio track.
- The selected track is stored locally in the browser (IndexedDB).

## Permissions

- `GM_addStyle` is used to inject the menu styles.
- No network requests are made by the script.

## License

MIT License. See [LICENSE](./LICENSE).
