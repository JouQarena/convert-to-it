#!/usr/bin/env node
/**
 * configure-feed.cjs
 * ------------------
 * Points electron-updater at the repository the app is built from, so the
 * installed app knows where to look for new versions.
 *
 * Usage: node scripts/configure-feed.cjs owner/repo
 * (falls back to the GITHUB_REPOSITORY environment variable)
 */
const fs = require("node:fs");
const path = require("node:path");

const pkgPath = path.join(__dirname, "..", "package.json");
const slug = (process.argv[2] || process.env.GITHUB_REPOSITORY || "").trim();

if (!/^[\w.-]+\/[\w.-]+$/.test(slug)) {
  console.log("[feed] no owner/repo given — leaving package.json untouched");
  process.exit(0);
}

const [owner, repo] = slug.split("/");
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));

pkg.repository = { type: "git", url: `https://github.com/${owner}/${repo}.git` };
pkg.build = pkg.build || {};
pkg.build.publish = [{ provider: "github", owner, repo, releaseType: "release" }];

fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
console.log(`[feed] auto-update feed: https://github.com/${owner}/${repo}`);
