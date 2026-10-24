/**
 * Convert to it! — desktop wrapper (preload)
 * ------------------------------------------
 * Two jobs:
 *
 *  1. Bridge a tiny API to the page (contextBridge) so the app itself could
 *     ask for files / info if it ever wants to.
 *  2. Load files the operating system handed us ("Open with …", File → Open)
 *     into the converter UI. The bundled web app listens for drag & drop on
 *     `window` and keeps a hidden <input type="file" id="uploadFile">, so we
 *     replay exactly those events with a real File object built from disk.
 */
const { contextBridge, ipcRenderer } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

/**
 * Optional debug log — set CONVERT_DEBUG=1 (and optionally
 * CONVERT_DEBUG_LOG=/path/to/file) before launching the app to trace what
 * happens when a file is handed over by the operating system.
 */
const DEBUG = !!process.env.CONVERT_DEBUG;
const DEBUG_LOG = process.env.CONVERT_DEBUG_LOG || path.join(require("node:os").tmpdir(), "convert-to-it-debug.log");

function debug(...args) {
  if (!DEBUG) return;
  try {
    fs.appendFileSync(DEBUG_LOG, `[${new Date().toISOString()}] ${args.join(" ")}\n`);
  } catch {
    /* logging must never break the app */
  }
}

/** Small extension → MIME table so the app can pick the right converter. */
const MIME_TYPES = {
  // images
  png: "image/png", apng: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", jpe: "image/jpeg",
  jfif: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif", bmp: "image/bmp",
  dib: "image/bmp", ico: "image/x-icon", cur: "image/x-icon", svg: "image/svg+xml",
  svgz: "image/svg+xml", tif: "image/tiff", tiff: "image/tiff", heic: "image/heic",
  heif: "image/heif", psd: "image/vnd.adobe.photoshop", xcf: "image/x-xcf", kra: "application/x-krita",
  tga: "image/x-tga", icb: "image/x-tga", vda: "image/x-tga", vst: "image/x-tga",
  exr: "image/x-exr", hdr: "image/vnd.radiance", rgbe: "image/vnd.radiance", jxl: "image/jxl",
  jp2: "image/jp2", j2k: "text/jp2", jpf: "image/jpx", jpx: "image/jpx", pnm: "image/x-portable-anymap",
  pbm: "image/x-portable-bitmap", pgm: "image/x-portable-graymap", ppm: "image/x-portable-pixmap",
  pam: "image/x-portable-anymap", pcx: "image/x-pcx", xpm: "image/x-xpixmap", xbm: "image/x-xbitmap",
  wbmp: "image/vnd.wap.wbmp", dds: "image/vnd-ms.dds", sgi: "image/x-sgi", bw: "image/x-sgi",
  ras: "image/x-cmu-raster", farbfeld: "application/x-farbfeld", ff: "application/x-farbfeld",
  qoi: "image/x-qoi", pict: "image/x-pict", pictclipping: "image/x-pict", pct: "image/pict",
  pic: "image/x-pict", arw: "image/x-sony-arw", cr2: "image/x-canon-cr2", cr3: "image/x-canon-cr3",
  crw: "image/x-canon-crw", nef: "image/x-nikon-nef", nrw: "image/x-nikon-nrw", orf: "image/x-olympus-orf",
  rw2: "image/x-panasonic-rw2", pef: "image/x-pentax-pef", dng: "image/x-adobe-dng",
  erf: "image/x-epson-erf", kdc: "image/x-kodak-kdc", dcr: "image/x-kodak-dcr", mrw: "image/x-minolta-mrw",
  raf: "image/x-fuji-raf", raw: "image/x-panasonic-raw", sr2: "image/x-sony-sr2", srf: "image/x-sony-srf",
  x3f: "image/x-sigma-x3f", "3fr": "image/x-hasselblad-3fr", fff: "image/x-hasselblad-fff",
  iiq: "image/x-phaseone-iiq", mef: "image/x-mamiya-mef", mos: "image/x-leaf-mos",
  // audio
  mp3: "audio/mpeg", mp2: "audio/mpeg", mpga: "audio/mpeg", wav: "audio/wav", wave: "audio/wav",
  flac: "audio/flac", oga: "audio/ogg", ogg: "audio/ogg", opus: "audio/opus", spx: "audio/ogg",
  aac: "audio/aac", m4a: "audio/mp4", m4b: "audio/mp4", m4r: "audio/mp4", wma: "audio/x-ms-wma",
  aiff: "audio/aiff", aif: "audio/aiff", aifc: "audio/aiff", aifr: "audio/aiff", alac: "audio/x-m4a",
  ape: "audio/x-ape", wv: "audio/x-wavpack", wvc: "audio/x-wavpack", amr: "audio/amr",
  awb: "audio/amr-wb", ac3: "audio/ac3", eac3: "audio/eac3", caf: "audio/x-caf", au: "audio/basic",
  snd: "audio/basic", mid: "audio/midi", midi: "audio/midi", kar: "audio/midi", rmi: "audio/midi",
  xm: "audio/x-xm", mod: "audio/x-mod", s3m: "audio/x-s3m", it: "audio/x-it", mptm: "audio/x-mod",
  mtm: "audio/x-mod", mt2: "audio/x-mod", "669": "audio/x-mod", far: "audio/x-mod",
  okt: "audio/x-mod", stm: "audio/x-mod", ult: "audio/x-mod", m15: "audio/x-mod", dsm: "audio/x-mod",
  amf: "audio/x-mod", gdm: "audio/x-mod", imf: "audio/x-mod", med: "audio/x-mod", mdl: "audio/x-mod",
  mo3: "audio/x-mod", psm: "audio/x-mod", ptm: "audio/x-mod", umx: "audio/x-mod",
  dsf: "audio/x-dsf", dff: "audio/x-dff", tta: "audio/x-tta", voc: "audio/x-voc", gsm: "audio/x-gsm",
  ra: "audio/x-realaudio", ram: "audio/x-pn-realaudio", rm: "audio/x-pn-realaudio",
  mpc: "audio/x-musepack", mpp: "audio/x-musepack", "mp+": "audio/x-musepack", cda: "application/x-cdf",
  "8svx": "audio/x-8svx", "16svx": "audio/x-16svx", iff: "application/x-iff", sph: "audio/basic",
  nist: "audio/x-nist", pvf: "audio/x-pvf", sd2: "audio/x-sd2", txw: "audio/x-txw", vox: "audio/x-vox",
  w64: "audio/x-w64", wve: "audio/x-wve", aa: "audio/x-audible", aax: "audio/x-audible",
  act: "audio/x-act", aue: "audio/x-aue", dct: "audio/x-dct", dss: "audio/x-dss", dvf: "audio/x-dvf",
  iklax: "audio/x-iklax", ivs: "audio/x-ivs", m4p: "audio/mp4", mmf: "audio/x-mmf", msv: "audio/x-msv",
  nmf: "audio/x-nmf", ogx: "application/ogg", paf: "audio/x-paf", qcp: "audio/x-qcp",
  sds: "audio/x-sds", vb: "audio/x-vb", vqf: "audio/x-vqf",
  // video
  mp4: "video/mp4", m4v: "video/mp4", m4p2: "video/mp4", mov: "video/quicktime", qt: "video/quicktime",
  mkv: "video/x-matroska", mk3d: "video/x-matroska", mka: "audio/x-matroska", webm: "video/webm",
  avi: "video/x-msvideo", wmv: "video/x-ms-wmv", asf: "video/x-ms-asf", mpg: "video/mpeg",
  mpeg: "video/mpeg", mpe: "video/mpeg", mpv: "video/mpv", m1v: "video/mpeg", m2v: "video/mpeg",
  mp2v: "video/mpeg", ts: "video/mp2t", m2ts: "video/mp2t", mts: "video/mp2t", m2t: "video/mp2t",
  tp: "video/mp2t", trp: "video/mp2t", "3gp": "video/3gpp", "3gpp": "video/3gpp", "3g2": "video/3gpp2",
  "3gp2": "video/3gpp2", ogv: "video/ogg", ogm: "video/ogg", flv: "video/x-flv", f4v: "video/x-f4v",
  f4p: "video/x-f4v", f4a: "video/x-f4v", f4b: "video/x-f4v", vob: "video/dvd", ifo: "video/dvd",
  rmvb: "video/vnd.rn-realvideo", divx: "video/divx", dv: "video/x-dv", sdv: "video/x-sdv",
  hdv: "video/x-hdv", mxf: "application/mxf", gxf: "application/gxf", lxf: "application/lxf",
  wtv: "video/x-ms-wtv", amv: "video/x-amv", nsv: "video/x-nsv", roq: "video/x-roq",
  smk: "video/x-smacker", bik: "video/x-bik", bk2: "video/x-bik", fli: "video/x-fli",
  flc: "video/x-fli", gifv: "video/mp4", yuv: "video/x-raw-yuv",
  // documents / text / data
  txt: "text/plain", text: "text/plain", log: "text/plain", md: "text/markdown",
  markdown: "text/markdown", mkd: "text/markdown", mdown: "text/markdown", rst: "text/x-rst",
  tex: "text/x-tex", ltx: "text/x-tex", bib: "text/x-bibtex", csv: "text/csv",
  tsv: "text/tab-separated-values", tab: "text/tab-separated-values", psv: "text/csv",
  json: "application/json", jsonl: "application/jsonlines", ndjson: "application/x-ndjson",
  json5: "application/json5", jsonc: "application/json", xml: "text/xml", yaml: "text/yaml",
  yml: "text/yaml", toml: "text/plain", ini: "text/plain", cfg: "text/plain", conf: "text/plain",
  config: "text/plain", properties: "text/plain", env: "text/plain", html: "text/html",
  htm: "text/html", xhtml: "application/xhtml+xml", xht: "application/xhtml+xml",
  css: "text/css", scss: "text/x-scss", sass: "text/x-sass", less: "text/x-less",
  rtf: "application/rtf", doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  docm: "application/vnd.ms-word.document.macroEnabled.12", dot: "application/msword",
  dotx: "application/vnd.openxmlformats-officedocument.wordprocessingml.template",
  odt: "application/vnd.oasis.opendocument.text", ott: "application/vnd.oasis.opendocument.text",
  fodt: "application/vnd.oasis.opendocument.text-flat-xml", sxw: "application/vnd.sun.xml.writer",
  pdf: "application/pdf", epub: "application/epub+zip", mobi: "application/x-mobipocket-ebook",
  prc: "application/x-mobipocket-ebook", azw: "application/x-mobipocket-ebook",
  azw3: "application/x-mobi8-ebook", azw4: "application/x-mobi8-ebook",
  kfx: "application/x-mobi8-ebook", fb2: "application/x-fictionbook+xml",
  djvu: "image/vnd.djvu", djv: "image/vnd.djvu", ps: "application/postscript",
  eps: "application/postscript", epsf: "application/postscript", epsi: "application/postscript",
  ai: "application/postscript", pages: "application/x-iwork-pages-sffpages",
  numbers: "application/x-iwork-numbers-sffnumbers", key: "application/x-iwork-keynote-sffkey",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odp: "application/vnd.oasis.opendocument.presentation", xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ods: "application/vnd.oasis.opendocument.spreadsheet", eml: "message/rfc822",
  mbox: "application/mbox", msg: "application/vnd.ms-outlook", ics: "text/calendar",
  ical: "text/calendar", vcf: "text/x-vcard", vcard: "text/x-vcard", ipynb: "application/x-ipynb+json",
  npy: "application/x-npy", npz: "application/x-npz", parquet: "application/vnd.apache.parquet",
  avro: "application/avro", orc: "application/x-orc", bson: "application/bson",
  cbor: "application/cbor", db: "application/vnd.sqlite3", db3: "application/vnd.sqlite3",
  sqlite: "application/vnd.sqlite3", sqlite3: "application/vnd.sqlite3",
  mdb: "application/x-msaccess", accdb: "application/x-msaccess", sav: "application/x-spss-sav",
  dta: "application/x-stata-dta", por: "application/x-spss-por", sas7bdat: "application/x-sas-data",
  xpt: "application/x-sas-xport", h5: "application/x-hdf5", hdf5: "application/x-hdf5",
  nc: "application/x-netcdf", cdf: "application/x-netcdf", mat: "application/x-matlab-data",
  pickle: "application/x-pickle", pkl: "application/x-pickle", feather: "application/x-feather",
  arrow: "application/x-arrow", toon: "application/x-toon", shp: "application/x-shapefile",
  dbf: "application/x-dbf", geojson: "application/geo+json", kml: "application/vnd.google-earth.kml+xml",
  kmz: "application/vnd.google-earth.kmz", gpx: "application/gpx+xml", osm: "application/x-osm",
  topojson: "application/json",
  // archives
  zip: "application/zip", zipx: "application/zip", tar: "application/x-tar", gtar: "application/x-tar",
  gz: "application/gzip", gzip: "application/gzip", tgz: "application/gzip", taz: "application/x-tar",
  bz2: "application/x-bzip2", bzip2: "application/x-bzip2", tbz: "application/x-bzip2",
  tbz2: "application/x-bzip2", xz: "application/x-xz", lzma: "application/x-lzma",
  txz: "application/x-xz", tlz: "application/x-lzma", zst: "application/zstd",
  zstd: "application/zstd", sz: "application/x-snappy-framed", snappy: "application/x-snappy-framed",
  br: "application/x-brotli", brotli: "application/x-brotli", lz: "application/x-lzip",
  lzip: "application/x-lzip", lz4: "application/x-lz4", lzo: "application/x-lzop",
  lzop: "application/x-lzop", "7z": "application/x-7z-compressed", rar: "application/vnd.rar",
  rar5: "application/vnd.rar", cab: "application/vnd.ms-cabinet", arj: "application/x-arj",
  lha: "application/x-lzh-compressed", lzh: "application/x-lzh-compressed",
  ace: "application/x-ace-compressed", cpio: "application/x-cpio", ar: "application/x-archive",
  a: "application/x-archive", deb: "application/vnd.debian.binary-package",
  rpm: "application/x-rpm", pkg: "application/x-rpm", apk: "application/vnd.android.package-archive",
  aab: "application/x-authorware-bin", xapk: "application/vnd.android.package-archive",
  ipa: "application/x-ios-app", jar: "application/java-archive", war: "application/zip",
  ear: "application/java-archive", sar: "application/java-archive",
  iso: "application/x-iso9660-image", img: "application/x-raw-disk-image",
  dmg: "application/x-apple-diskimage", cdr: "application/x-coreldraw", nrg: "application/x-nrg",
  mdf: "application/x-mdf", mds: "application/x-mds", b5t: "application/x-b5t", cue: "application/x-cue",
  cdi: "application/x-cdi", isz: "application/x-iso9660-image", z: "application/x-compress",
  tz: "application/x-compress", zpaq: "application/x-zpaq", arc: "application/x-freearc",
  sit: "application/x-stuffit", sitx: "application/x-stuffit", sea: "application/x-sea",
  hqx: "application/mac-binhex40", bin: "application/octet-stream", uefi: "application/octet-stream",
  vhd: "application/x-vhd", vhdx: "application/x-vhd", vdi: "application/x-virtualbox-vdi",
  vmdk: "application/x-vmware-vm-disk", qcow: "application/x-qemu-disk", qcow2: "application/x-qemu-disk",
  wim: "application/x-wim", swm: "application/x-wim", esd: "application/x-esd", fat: "application/x-fat",
  ext2: "application/x-ext2", ext3: "application/x-ext3", ext4: "application/x-ext4",
  squashfs: "application/x-squashfs", cramfs: "application/x-cramfs", romfs: "application/x-romfs",
  initrd: "application/x-initrd",
  // fonts
  ttf: "font/ttf", ttc: "font/collection", otf: "font/otf", otc: "font/collection",
  woff: "font/woff", woff2: "font/woff2", eot: "application/vnd.ms-fontobject",
  pfa: "application/x-font-type1", pfb: "application/x-font-type1", pfm: "application/x-font-type1",
  afm: "application/x-font-afm", bdf: "application/x-font-bdf", pcf: "application/x-font-pcf",
  psf: "application/x-font-linux-psf", psfu: "application/x-font-linux-psf", snf: "application/x-font-snf",
  fnt: "application/x-font-ttf", fon: "application/x-font-ttf", pfr: "application/x-font-pfr",
  t42: "application/x-font-type42", cff: "application/x-font-cff", mf: "text/x-metafont",
  ttx: "application/x-font-ttx", ufo: "application/x-font-ufo", glyphs: "application/x-glyphs",
  sfd: "application/x-font-sfd", vfb: "application/x-font-vfb", etx: "application/x-font-etx",
  chr: "application/x-font-chr",
  // 3d / models
  obj: "text/plain", mtl: "text/plain", stl: "model/stl", stla: "model/stl", stlb: "model/stl",
  "3mf": "model/3mf", ply: "text/plain", pcd: "application/x-point-cloud-data", xyz: "text/plain",
  pts: "text/plain", ptx: "text/plain", asc: "text/plain", fbx: "application/octet-stream",
  gltf: "model/gltf+json", glb: "model/gltf-binary", vrm: "model/gltf-binary",
  vrma: "model/gltf-binary", dae: "model/vnd.collada+xml", zae: "model/vnd.collada+xml",
  "3ds": "application/x-3ds", prj: "application/x-3ds", blend: "application/x-blender",
  max: "application/x-max", ma: "application/x-maya", mb: "application/x-maya-ascii",
  usd: "model/vnd.usda", usda: "model/vnd.usda", usdc: "model/vnd.usdc",
  usdz: "model/vnd.usdz+zip", vrml: "model/vrml", wrl: "model/vrml", wrz: "model/vrml",
  x3d: "model/x3d+xml", x3dz: "model/x3d+xml", x3db: "model/x3d+binary", x3dv: "model/x3d+vrml",
  off: "text/plain", noff: "text/plain", coff: "text/plain", lwo: "application/x-lightwave",
  lw: "application/x-lightwave", lws: "application/x-lightwave", cob: "application/x-truespace",
  scn: "application/x-truespace", md2: "application/x-md2", md3: "application/x-md3",
  ms3d: "application/x-ms3d", nff: "application/x-nff", smf: "application/x-smf",
  ter: "application/x-terragen", abc: "application/x-alembic", b3dm: "application/x-b3dm",
  czml: "application/json",
  // code
  js: "text/javascript", mjs: "text/javascript", cjs: "text/javascript", jsx: "text/jsx",
  ts: "text/typescript", mts: "text/typescript", cts: "text/typescript", tsx: "text/typescript",
  py: "text/x-python", pyw: "text/x-python", pyc: "application/x-python-code", pyi: "text/x-python",
  rb: "text/x-ruby", rbw: "text/x-ruby", rake: "text/x-ruby", gemspec: "text/x-ruby",
  php: "text/x-php", phtml: "text/x-php", java: "text/x-java", kt: "text/x-kotlin",
  kts: "text/x-kotlin", scala: "text/x-scala", sc: "text/x-scala", sbt: "text/x-scala",
  swift: "text/x-swift", go: "text/x-go", rs: "text/x-rust", rlib: "text/x-rust",
  c: "text/x-c", h: "text/x-c", cc: "text/x-c", cpp: "text/x-c", cxx: "text/x-c",
  hpp: "text/x-c", hh: "text/x-c", hxx: "text/x-c", inl: "text/x-c", cs: "text/x-csharp",
  csx: "text/x-csharp", vb: "text/x-vb", fs: "text/x-fsharp", fsi: "text/x-fsharp",
  fsx: "text/x-fsharp", ml: "text/x-ocaml", mli: "text/x-ocaml", pl: "text/x-perl",
  pm: "text/x-perl", pod: "text/x-perl", lua: "text/x-lua", luac: "text/x-lua",
  r: "text/x-r", rmd: "text/x-r", jl: "text/x-julia", dart: "text/x-dart", sql: "text/x-sql",
  sh: "text/x-shellscript", bash: "text/x-shellscript", zsh: "text/x-shellscript",
  fish: "text/x-shellscript", ksh: "text/x-shellscript", csh: "text/x-shellscript",
  bat: "text/x-batch", cmd: "text/x-batch", btm: "text/x-batch", ps1: "text/x-powershell",
  psm1: "text/x-powershell", vim: "text/x-vim", el: "text/x-emacs-lisp", clj: "text/x-clojure",
  cljs: "text/x-clojure", edm: "text/x-clojure", hs: "text/x-haskell", lhs: "text/x-haskell",
  erl: "text/x-erlang", hrl: "text/x-erlang", ex: "text/x-elixir", exs: "text/x-elixir",
  eex: "text/x-elixir", heex: "text/x-elixir", cr: "text/x-crystal", nim: "text/x-nim",
  nims: "text/x-nim", zig: "text/x-zig", v: "text/x-v", sv: "text/x-verilog", d: "text/x-d",
  di: "text/x-d", pas: "text/x-pascal", pp: "text/x-pascal", asm: "text/x-asm",
  s: "text/x-asm", nasm: "text/x-asm", f: "text/x-fortran", for: "text/x-fortran",
  f90: "text/x-fortran", f95: "text/x-fortran", f03: "text/x-fortran", cob: "text/x-cobol",
  cbl: "text/x-cobol", ada: "text/x-ada", adb: "text/x-ada", ads: "text/x-ada",
  tcl: "text/x-tcl", awk: "text/x-awk", sed: "text/x-sed", make: "text/x-makefile",
  mk: "text/x-makefile", mak: "text/x-makefile", cmake: "text/x-cmake",
  dockerfile: "text/x-dockerfile", tf: "text/x-terraform", tfvars: "text/x-terraform",
  hcl: "text/x-hcl", proto: "text/x-protobuf", thrift: "text/x-thrift", graphql: "text/x-graphql",
  gql: "text/x-graphql", vue: "text/x-vue", svelte: "text/x-svelte", astro: "text/x-astro",
  mdx: "text/mdx",
  // music / notation
  musicxml: "application/vnd.recordare.musicxml+xml", mxl: "application/vnd.recordare.musicxml",
  mei: "application/x-mei", abc: "text/vnd.abc", sib: "application/x-sibelius",
  mus: "application/x-finale", musx: "application/x-finale", niff: "application/x-niff",
  sco: "text/x-sco", ly: "text/x-lilypond", ily: "text/x-lilypond", gtp: "application/x-guitar-pro",
  gp: "application/x-guitar-pro", gp3: "application/x-guitar-pro", gp4: "application/x-guitar-pro",
  gp5: "application/x-guitar-pro", gpx: "application/x-guitar-pro", ptb: "application/x-power-tab",
  tef: "application/x-tabledit", tg: "application/x-tuxguitar", crd: "application/x-chordpro",
  // misc / game / subtitle data
  nbt: "application/octet-stream", dat: "application/octet-stream", mca: "application/octet-stream",
  mcr: "application/octet-stream", mcworld: "application/octet-stream",
  mcpack: "application/octet-stream", mcaddon: "application/octet-stream",
  mcmeta: "application/json", mcstructure: "application/octet-stream",
  sb: "application/octet-stream", sb2: "application/octet-stream", sb3: "application/octet-stream",
  torrent: "application/x-bittorrent", vtt: "text/vtt", srt: "application/x-subrip",
  ssa: "text/x-ssa", ass: "text/x-ssa", sub: "text/x-subviewer", idx: "application/x-subidx",
  sup: "application/x-sup", usf: "application/x-usf", ttxt: "text/x-ttxt", smi: "application/x-sami",
  rt: "text/vnd.rn-realtext", pjs: "application/x-pjs", mpl: "application/x-mpl2",
  sbv: "text/x-sbv", lrc: "text/x-lrc", elrc: "text/x-lrc", qrc: "text/x-qrc",
  srv3: "text/x-srv3", ttml: "application/ttml+xml", dfxp: "application/ttml+xml",
  itt: "application/itt", scc: "text/x-scc", cap: "text/x-cap",
};

function mimeTypeFor(filePath) {
  const base = path.basename(filePath);
  const ext = base.includes(".") ? base.split(".").pop().toLowerCase() : "";
  return MIME_TYPES[ext] || "";
}

function toFileObject(filePath) {
  const stat = fs.statSync(filePath);
  const name = path.basename(filePath);
  const buffer = fs.readFileSync(filePath);
  return new File([buffer], name, {
    type: mimeTypeFor(filePath),
    lastModified: Math.round(stat.mtimeMs) || Date.now(),
  });
}

function makeDataTransfer(files) {
  const dataTransfer = new DataTransfer();
  for (const file of files) dataTransfer.items.add(file);
  return dataTransfer;
}

/** Replay a real drag & drop onto the window, which is where the app listens. */
function fireDragEvents(files) {
  const dataTransfer = makeDataTransfer(files);
  for (const type of ["dragenter", "dragover", "drop"]) {
    const event = new DragEvent(type, {
      dataTransfer,
      bubbles: true,
      cancelable: true,
      view: window,
    });
    window.dispatchEvent(event);
  }
}

/** Replay the app's own hidden file input (the "Browse files" code path). */
function fireInputChange(files) {
  const input = document.getElementById("uploadFile");
  if (!input) return false;
  try {
    input.files = makeDataTransfer(files).files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  } catch {
    return false;
  }
}

function looksLoaded() {
  if (document.querySelector(".file-info-badge")) return true;
  return !document.querySelector(".upload-dropzone");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForSelector(selector, timeoutMs) {
  return new Promise((resolve) => {
    const started = Date.now();
    (function poll() {
      const element = document.querySelector(selector);
      if (element) return resolve(element);
      if (Date.now() - started > timeoutMs) return resolve(null);
      setTimeout(poll, 100);
    })();
  });
}

/* ------------------------------------------------------------------ *
 * Small toast so the user knows what happened                        *
 * ------------------------------------------------------------------ */

let toastElement = null;
let toastTimer = null;

function showToast(message, kind) {
  if (!document.body) return;
  if (!toastElement) {
    toastElement = document.createElement("div");
    toastElement.setAttribute("data-convert-toast", "");
    Object.assign(toastElement.style, {
      position: "fixed",
      left: "16px",
      bottom: "16px",
      maxWidth: "420px",
      padding: "10px 14px",
      borderRadius: "10px",
      background: "rgba(17, 19, 24, 0.94)",
      color: "#f2f4f8",
      font: "13px/1.45 system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
      boxShadow: "0 6px 24px rgba(0,0,0,0.35)",
      border: "1px solid rgba(255,255,255,0.12)",
      zIndex: "2147483647",
      pointerEvents: "none",
      opacity: "0",
      transition: "opacity 180ms ease",
    });
    document.body.appendChild(toastElement);
  }
  toastElement.textContent = message;
  toastElement.style.borderColor =
    kind === "error" ? "rgba(255, 120, 120, 0.6)" : "rgba(255,255,255,0.12)";
  requestAnimationFrame(() => {
    if (toastElement) toastElement.style.opacity = "1";
  });
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    if (toastElement) toastElement.style.opacity = "0";
  }, 6000);
}

/* ------------------------------------------------------------------ *
 * The actual "open with" pipeline                                    *
 * ------------------------------------------------------------------ */

async function openFiles(filePaths) {
  const paths = (filePaths || []).filter((p) => typeof p === "string" && p.length > 0);
  if (paths.length === 0) return;

  let files;
  try {
    files = paths.map(toFileObject);
  } catch (error) {
    showToast(`Could not read that file (${String((error && error.message) || error)})`, "error");
    return;
  }

  const names = files.map((file) => file.name).join(", ");
  showToast(`Opening ${names} — now pick the format you want to convert to.`);
  debug("openFiles:", paths.join(", "));

  // Wait for the converter UI to be mounted and idle.
  const dropzone = await waitForSelector(".upload-dropzone:not(.upload-dropzone--pending)", 25000);
  debug("dropzone ready:", dropzone != null);
  await sleep(500);

  // 1) The app's own file input — exactly what its "Browse" button does.
  const usedInput = fireInputChange(files);
  debug("input#uploadFile injection:", usedInput);
  await sleep(500);
  debug("looksLoaded after input injection:", looksLoaded());
  if (looksLoaded()) {
    debug("SUCCESS via file input");
    return;
  }

  // 2) A synthetic drag & drop onto the window.
  fireDragEvents(files);
  debug("window drop event dispatched");
  await sleep(700);
  debug("looksLoaded after window drop:", looksLoaded());
  if (looksLoaded()) {
    debug("SUCCESS via window drop");
    return;
  }

  debug("FAILED to load the file");
  showToast("Drag the file into the window to load it into the converter.", "error");
}

/* ------------------------------------------------------------------ *
 * Bridge + bootstrap                                                 *
 * ------------------------------------------------------------------ */

contextBridge.exposeInMainWorld("convertDesktop", {
  initialFiles: () => ipcRenderer.invoke("convert:get-initial-files"),
  onOpenFiles: (handler) => {
    const listener = (_event, files) => handler(files);
    ipcRenderer.on("convert:open-files", listener);
    return () => ipcRenderer.removeListener("convert:open-files", listener);
  },
  info: () => ipcRenderer.invoke("convert:info"),
});

(async () => {
  try {
    const initial = await ipcRenderer.invoke("convert:get-initial-files");
    debug("initial files from main:", JSON.stringify(initial));
    if (Array.isArray(initial) && initial.length > 0) await openFiles(initial);
  } catch (error) {
    debug("bootstrap error:", String(error));
  }
  ipcRenderer.on("convert:open-files", (_event, files) => {
    debug("open-files event:", JSON.stringify(files));
    openFiles(files);
  });
})();
