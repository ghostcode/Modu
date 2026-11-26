# Modu · 墨牍

[简体中文](README.zh-CN.md)

Modu is a local-first RSS reader for macOS. Follow the blogs and tech publications you enjoy, then read them in one place.

![Modu's three-pane reader in the light theme](docs/images/modu-light.jpg)

## Get Modu

**Requires an Apple Silicon Mac with macOS 12 or later.**

Download the DMG from the [latest release](https://github.com/Yunz93/Modu/releases/latest) and drag `墨牍.app` into Applications. The app has not been notarized by Apple.

To install from Terminal, quit any running copy of Modu with ⌘Q and run:

```sh
(set -o pipefail; curl -fsSL https://raw.githubusercontent.com/Yunz93/Modu/main/scripts/install-macos.sh | /bin/bash)
```

The script verifies the download and installs the app in Applications. Your reading library stays in place. To update from the app, open **Settings → About & updates**.

## Features

- **Manage your subscriptions.** Add RSS or Atom feeds, discover feeds from a website URL, and import or export OPML with folders. Five technology feeds are ready to refresh in a new library, including Trend Weekly (潮流周刊).
- **Find and finish articles.** Browse in three panes, search the current list or your whole library, bookmark articles, and pick up where you left off. Focus mode gives the article more room.
- **Read technical content comfortably.** Fetch the full article on demand when a feed offers an excerpt. Read code with syntax highlighting and one-click copying, view formulas and images, and play supported audio and video.
- **Set your own reading style.** Choose a light or dark theme and an accent color. Set interface and reading fonts independently. The interface is available in English and Simplified Chinese.
- **Keep your library on your Mac.** Read cached articles offline and export a full backup, including subscriptions, bookmarks, and reading progress.

![Modu displaying an article in the dark theme](docs/images/modu-dark.jpg)

## Building from source

Requires Node.js 22+ and npm.

**Web preview** produces a static site in `dist/client` (plus the Worker fallback in `dist/server`). The browser build uses local demo data and supports OPML/file import, but not live feed refresh or in-app updates.

```sh
npm ci
npm run build
npm run preview
npm run test:sites
```

**Windows desktop** produces an NSIS installer. The recommended toolchain is Rust with the MSVC target and the Visual Studio C++ Build Tools. A GNU toolchain also works:

```sh
npm ci
npm run tauri:build:windows
```

With MinGW-w64 only, opt into the GNU target explicitly (see `src-tauri/tauri.windows.conf.json` for the Windows bundle settings):

```sh
MODU_WINDOWS_TARGET=gnu npm run tauri:build:windows
```

The installer is written to `src-tauri/target/<target>/release/bundle/nsis/`. Windows builds do not use the macOS updater signing key; in-app updates are disabled on Windows, and **Settings → About & updates** links to the releases page for manual downloads. The legacy `shidu` storage key and `com.yunz.shidu` migration path are kept for compatibility.

The Windows icon is generated from the existing PNGs with `node scripts/make-windows-icon.mjs`.

## License

Modu is released under the [Apache License 2.0](LICENSE). See the [third-party notices](THIRD_PARTY_NOTICES.md) and [release notes](CHANGELOG.md).
