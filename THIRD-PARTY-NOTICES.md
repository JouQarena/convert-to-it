# Third-party notices

## Bundled offline web app

This desktop app ships the **offline web application of "Convert to it!"**
(<https://p2r3.github.io/convert/>, also served from <https://convert.to.it>),
built from the project's official desktop releases:

- Project: <https://github.com/p2r3/convert>
- Author: PortalRunner
- License: **GNU General Public License v2.0** (see `LICENSE`)
- What is bundled: the complete self-contained web app (`dist/`) including all
  conversion engines (FFmpeg, ImageMagick, Pandoc, Typst, FluidSynth, libopenmpt,
  SQLite, 7-Zip, Clang/LLVM, pdf.js, espeak-ng, the TurboWarp packager, …) as
  WASM, plus the Electron protocol handler from `src/electron.cjs`.

The complete corresponding source code is available at
<https://github.com/p2r3/convert> (branch `master`). If you received this app
from somewhere else and cannot obtain the source, the maintainers of this
repository will provide it on request.

## Desktop wrapper

The Electron main process (`src/main.cjs`), preload script (`src/preload.cjs`),
build scripts and CI workflow in this repository are original work, also
released under **GPL-2.0-or-later** so that the whole distributed app remains
under one license.

## Bundled open-source libraries

The bundled web app includes many open-source libraries, each under its own
license (MIT, Apache-2.0, BSD, ISC, LGPL, …). Their full license texts and
copyright notices are included in the upstream project's `node_modules` at
build time; the authoritative list is the `dependencies` section of
<https://github.com/p2r3/convert/blob/master/package.json>.

Electron (<https://www.electronjs.org/>) is bundled by `electron-builder` and
is licensed under MIT.
