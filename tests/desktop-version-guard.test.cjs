const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  assertDesktopVersion,
  recordExpectedDesktopVersion,
} = require("../electron-dist/desktopVersionGuard.cjs");
test("a verified upgrade blocks an older launch and preserves settings and credentials", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "desktop-version-"));
  try {
    fs.writeFileSync(path.join(dir, "settings.json"), "original layout");
    fs.writeFileSync(path.join(dir, "credentials.json"), "opaque credentials");
    assertDesktopVersion(dir, "1.5.62");
    recordExpectedDesktopVersion(dir, "1.5.62", "1.5.63");
    assert.throws(
      () => assertDesktopVersion(dir, "1.5.62"),
      /DESKTOP_UPDATE_INCOMPLETE.*1.5.63/,
    );
    assertDesktopVersion(dir, "1.5.63");
    assert.throws(
      () => assertDesktopVersion(dir, "1.5.62"),
      /DESKTOP_UPDATE_INCOMPLETE/,
    );
    assert.equal(
      fs.readFileSync(path.join(dir, "settings.json"), "utf8"),
      "original layout",
    );
    assert.equal(
      fs.readFileSync(path.join(dir, "credentials.json"), "utf8"),
      "opaque credentials",
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("a pending newer installer cannot be overwritten by an older or malformed target", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "desktop-version-"));
  try {
    recordExpectedDesktopVersion(dir, "1.5.62", "1.6.0");
    assert.throws(
      () => recordExpectedDesktopVersion(dir, "1.5.62", "1.5.63"),
      /DESKTOP_DOWNGRADE_BLOCKED/,
    );
    assert.throws(
      () => recordExpectedDesktopVersion(dir, "1.5.62", "garbage"),
      /DESKTOP_VERSION_INVALID/,
    );
    assert.throws(() => assertDesktopVersion(dir, "1.5.63"), /1.6.0/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
