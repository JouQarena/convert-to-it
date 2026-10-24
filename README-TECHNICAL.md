# Convert to it! — offline desktop app

A real, installable desktop version of **[convert.to.it](https://p2r3.github.io/convert/)** —
the universal, private, on-device file converter — with the two features the
website and the upstream Electron build don't have:

| Feature | How it works |
|---|---|
| **"Open with" / file associations** | The installer registers ~700 file extensions. Right-click any file → *Open with* → **Convert to it**, and the file is loaded straight into the converter UI (same code path as drag & drop). Also `Ctrl+O` / *File → Open File…* inside the app. |
| **Automatic updates** | `electron-updater` checks this repository's rolling release (`latest`) on startup and every 6 hours. New versions download in the background and install when you close the app — no manual downloads. |
| **Fully offline** | The bundled web app carries every conversion engine as WASM (FFmpeg, ImageMagick, Pandoc, Typst, FluidSynth, SQLite, 7-Zip, Clang/LLVM, pdf.js, …). Nothing is uploaded; no network needed to convert. |

## Layout

```
src/main.cjs        Electron main process: app:// protocol server (COOP/COEP so
                    WASM threads work), file-association handling, auto-update, menu
src/preload.cjs     Loads files handed over by the OS into the converter UI
scripts/
  fetch-web-assets.cjs   Downloads the official offline build of convert.to.it for
                         the current platform and extracts its web app into ./web
  configure-feed.cjs     Points electron-updater at this repository
  make-icons.cjs         Builds build/icon.ico and build/icon.icns from the PNG set
.github/workflows/build.yml   Builds Windows + macOS + Linux and publishes the
                              rolling release
web/                (generated) the offline web app — git-ignored, fetched at build time
release/            (generated) electron-builder output
```

## Build

```bash
npm install
npm run assets        # download + unpack the upstream offline web app (~300 MB)
npm run dist          # electron-builder for the current platform
```

Platform-specific: `npm run dist:win`, `dist:mac`, `dist:linux`.
On Windows you also want 7-Zip on `PATH` (the default install includes it).

## How the update feed is published

`.github/workflows/build.yml` runs on every push to `main`, on demand, and every
Monday (to pick up upstream changes). It:

1. stamps a new version (`1.0.<run_number>`) so installed apps see an update,
2. points electron-updater at the repository it runs in,
3. downloads the official offline web app for each platform,
4. builds the installers with `--publish never` — electron-builder writes the
   `latest.yml` / `latest-linux.yml` / `latest-mac.yml` metadata itself,
5. uploads everything to the single rolling release tagged `latest`
   (same file names each time, so the release is overwritten in place).

To host updates somewhere else, change `build.publish` in `package.json`
(any [electron-builder publisher](https://www.electron.build/publish) works,
including a plain generic HTTP server serving `latest.yml` + the installers).

## Adding / removing file extensions

Edit `build.fileAssociations` in `package.json`. Each entry is a category with
an `ext` array, a `name` (the Windows "program id") and a `description`. Adding
an extension makes it show up under *Open with* after the next install/update.

## License

GPL-2.0-or-later. The bundled web app comes from
[p2r3/convert](https://github.com/p2r3/convert) (GPL-2.0) — see
`THIRD-PARTY-NOTICES.md` and `LICENSE`.
