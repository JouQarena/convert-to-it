#!/usr/bin/env node
/**
 * fetch-web-assets.cjs
 * --------------------
 * Downloads the *official* offline desktop build of "Convert to it!"
 * (https://github.com/p2r3/convert — "Rolling Release", tag `latest`) for the
 * platform we are building for, and extracts the bundled web app into ./web.
 *
 * That web app (dist/) is the complete, self-contained converter: every
 * conversion engine (FFmpeg, ImageMagick, Pandoc, Typst, FluidSynth, SQLite,
 * 7-Zip, Clang/LLVM, pdf.js, …) ships as WASM inside it, so the finished
 * desktop app needs no network at all.
 *
 * Usage:  node scripts/fetch-web-assets.cjs [win|mac|linux]
 */
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const https = require("node:https");

const REPO = "p2r3/convert";
const TAG = "latest";
const ROOT = path.join(__dirname, "..");
const UPSTREAM_DIR = path.join(ROOT, "upstream");
const WEB_DIR = path.join(ROOT, "web");

const PLATFORM = normalizePlatform(process.argv[2] || process.platform);

function normalizePlatform(value) {
  const v = String(value || "").toLowerCase();
  if (v.startsWith("win") || v === "win32") return "win";
  if (v.startsWith("darwin") || v.startsWith("mac") || v === "osx") return "mac";
  return "linux";
}

/* ----------------------------- networking ----------------------------- */

function httpsGet(url, options = {}) {
  return new Promise((resolve, reject) => {
    const request = (target, depth) => {
      if (depth > 6) {
        reject(new Error(`Too many redirects for ${url}`));
        return;
      }
      https
        .get(target, {
          headers: {
            "user-agent": "convert-to-it-desktop",
            accept: options.accept || "application/octet-stream",
          },
        }, (response) => {
          if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
            response.resume();
            request(new URL(response.headers.location, target).toString(), depth + 1);
            return;
          }
          if (response.statusCode !== 200) {
            response.resume();
            reject(new Error(`HTTP ${response.statusCode} while fetching ${target}`));
            return;
          }
          resolve(response);
        })
        .on("error", reject);
    };
    request(url, 0);
  });
}

async function getJson(url) {
  const response = await httpsGet(url, { accept: "application/vnd.github+json" });
  const chunks = [];
  for await (const chunk of response) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function download(url, destination) {
  const response = await httpsGet(url);
  await new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destination);
    response.pipe(file);
    file.on("finish", () => file.close(() => resolve()));
    file.on("error", reject);
  });
}

/* ----------------------------- extraction ----------------------------- */

function run(command, args, cwd) {
  execFileSync(command, args, { cwd, stdio: "inherit" });
}

function asarExtract(asarPath, destination) {
  const localBin = path.join(
    ROOT,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "asar.cmd" : "asar"
  );
  if (fs.existsSync(localBin)) {
    run(localBin, ["extract", asarPath, destination], ROOT);
    return;
  }
  // Fall back to a one-off npx download of the asar tool.
  run("npx", ["--yes", "@electron/asar", "extract", asarPath, destination], ROOT);
}

function pickAsset(assets) {
  const matchers = {
    win: (name) => /\.exe$/i.test(name) && /win/i.test(name),
    mac: (name) => /\.dmg$/i.test(name) && /mac/i.test(name),
    linux: (name) => /\.appimage$/i.test(name) && /linux/i.test(name),
  };
  const matches = assets.filter((asset) => matchers[PLATFORM](asset.name));
  if (matches.length === 0) {
    throw new Error(
      `No ${PLATFORM} asset found in the ${TAG} release of ${REPO}.\n` +
        `Available: ${assets.map((a) => a.name).join(", ")}`
    );
  }
  // Prefer x64 when several builds exist.
  matches.sort((a, b) => (b.size || 0) - (a.size || 0));
  return matches[0];
}

function extractLinux(assetPath) {
  const extracted = path.join(UPSTREAM_DIR, "squashfs-root");
  fs.rmSync(extracted, { recursive: true, force: true });
  fs.chmodSync(assetPath, 0o755);
  run(assetPath, ["--appimage-extract"], UPSTREAM_DIR);
  const asar = path.join(extracted, "resources", "app.asar");
  if (!fs.existsSync(asar)) throw new Error(`app.asar not found in ${extracted}`);
  return asar;
}

function extractWindows(assetPath) {
  const step1 = path.join(UPSTREAM_DIR, "nsis");
  const step2 = path.join(UPSTREAM_DIR, "win-app");
  fs.rmSync(step1, { recursive: true, force: true });
  fs.rmSync(step2, { recursive: true, force: true });
  run("7z", ["x", "-y", `-o${step1}`, assetPath], UPSTREAM_DIR);
  const inner = path.join(step1, "$PLUGINSDIR", "app-64.7z");
  if (!fs.existsSync(inner)) throw new Error(`app-64.7z not found in ${step1}`);
  run("7z", ["x", "-y", `-o${step2}`, inner], UPSTREAM_DIR);
  const asar = path.join(step2, "resources", "app.asar");
  if (!fs.existsSync(asar)) throw new Error(`app.asar not found in ${step2}`);
  return asar;
}

function extractMac(assetPath) {
  const mountPoint = path.join(UPSTREAM_DIR, "mnt");
  fs.rmSync(mountPoint, { recursive: true, force: true });
  fs.mkdirSync(mountPoint, { recursive: true });
  run("hdiutil", ["attach", "-nobrowse", "-noverify", "-mountpoint", mountPoint, assetPath]);
  try {
    const entries = fs.readdirSync(mountPoint).filter((name) => name.endsWith(".app"));
    if (entries.length === 0) throw new Error(`No .app found in ${assetPath}`);
    const asar = path.join(mountPoint, entries[0], "Contents", "Resources", "app.asar");
    if (!fs.existsSync(asar)) throw new Error(`app.asar not found in ${entries[0]}`);
    const copy = path.join(UPSTREAM_DIR, "app.asar");
    fs.copyFileSync(asar, copy);
    return copy;
  } finally {
    try {
      run("hdiutil", ["detach", mountPoint]);
    } catch {
      /* already detached */
    }
  }
}

/* -------------------------------- main -------------------------------- */

(async () => {
  console.log(`[assets] platform: ${PLATFORM}`);

  const release = await getJson(`https://api.github.com/repos/${REPO}/releases/tags/${TAG}`);
  const asset = pickAsset(release.assets || []);
  console.log(`[assets] upstream build: ${asset.name} (${(asset.size / 1048576).toFixed(1)} MB)`);

  fs.rmSync(UPSTREAM_DIR, { recursive: true, force: true });
  fs.mkdirSync(UPSTREAM_DIR, { recursive: true });
  const assetPath = path.join(UPSTREAM_DIR, asset.name);
  await download(asset.browser_download_url, assetPath);
  console.log(`[assets] downloaded to ${path.relative(ROOT, assetPath)}`);

  let asarPath;
  if (PLATFORM === "linux") asarPath = extractLinux(assetPath);
  else if (PLATFORM === "win") asarPath = extractWindows(assetPath);
  else asarPath = extractMac(assetPath);

  const unpacked = path.join(UPSTREAM_DIR, "asar");
  fs.rmSync(unpacked, { recursive: true, force: true });
  asarExtract(asarPath, unpacked);

  const dist = path.join(unpacked, "dist");
  if (!fs.existsSync(path.join(dist, "index.html"))) {
    throw new Error(`The upstream build does not contain a dist/index.html — layout changed?`);
  }

  fs.rmSync(WEB_DIR, { recursive: true, force: true });
  fs.cpSync(dist, WEB_DIR, { recursive: true });
  console.log(
    `[assets] web app ready in ${path.relative(ROOT, WEB_DIR)} (${(dirSize(WEB_DIR) / 1048576).toFixed(1)} MB)`
  );

  // The downloaded build + unpacked archive are no longer needed.
  fs.rmSync(UPSTREAM_DIR, { recursive: true, force: true });
  console.log("[assets] done — the desktop app will be fully offline.");
})().catch((error) => {
  console.error(`[assets] FAILED: ${error.message}`);
  process.exit(1);
});

function dirSize(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += dirSize(full);
    else total += fs.statSync(full).size;
  }
  return total;
}
