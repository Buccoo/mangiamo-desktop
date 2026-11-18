import fs from "node:fs";
import path from "node:path";
const filename = "desktop-version-checkpoint.json";
function parts(value: string): number[] {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:\+[\w.-]+)?$/.exec(value);
  if (!match) throw new Error("DESKTOP_VERSION_INVALID");
  return match.slice(1).map(Number);
}
function compare(a: string, b: string) {
  const left = parts(a),
    right = parts(b);
  return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
}
function read(directory: string): string | null {
  const file = path.join(directory, filename);
  if (!fs.existsSync(file)) return null;
  const record = JSON.parse(fs.readFileSync(file, "utf8"));
  if (record.schema_version !== 1 || typeof record.minimum_version !== "string")
    throw new Error("DESKTOP_CHECKPOINT_INVALID");
  parts(record.minimum_version);
  return record.minimum_version;
}
function write(directory: string, minimum: string) {
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, filename),
    temporary = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(
      temporary,
      JSON.stringify({ schema_version: 1, minimum_version: minimum }),
    );
    fs.renameSync(temporary, file);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}
/** Only version metadata: application settings and credentials are never touched. */
export function assertDesktopVersion(directory: string, current: string) {
  parts(current);
  const minimum = read(directory);
  if (minimum && compare(current, minimum) < 0)
    throw new Error(`DESKTOP_UPDATE_INCOMPLETE: ${current} < ${minimum}`);
  write(directory, current);
}
export function recordExpectedDesktopVersion(
  directory: string,
  current: string,
  target: string,
) {
  parts(current);
  parts(target);
  const minimum = read(directory);
  if (
    compare(target, current) <= 0 ||
    (minimum && compare(target, minimum) < 0)
  )
    throw new Error("DESKTOP_DOWNGRADE_BLOCKED");
  write(directory, target);
}
