// Run alongside varied.js on its isolated Compose project.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const resultDir = process.env.VARIED_RESULTS || "results";
mkdirSync(resultDir, { recursive: true });
const project = process.env.VARIED_PROJECT || "central-varied";
assert.match(project, /^central-varied(?:-[a-z0-9-]+)?$/);
const dc = (...args) =>
  execFileSync("docker", ["compose", "-p", project, ...args], {
    encoding: "utf8",
  }).trim();
assert.equal(dc("port", "web", "3000"), "127.0.0.1:4390");
const scalar = (q) =>
  Number(
    dc(
      "exec",
      "-T",
      "db",
      "psql",
      "-XAt",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "helpdesk",
      "-c",
      q,
    ),
  );
const target = 3550,
  now = () => performance.now(),
  started = now();
const slot = Number(process.env.VARIED_SLOT_SECONDS || 15);
let count = scalar("SELECT count(*) FROM tickets");
while (count < target) {
  assert.ok(
    now() - started < (slot * 24 + 90) * 1000,
    "O ensaio não alcançou o pico",
  );
  await sleep(Math.min(5000, slot * 20));
  count = scalar("SELECT count(*) FROM tickets");
}
assert.ok(count < 4300, "O período de pico já terminou");
const report = { date: new Date().toISOString(), ticketsAtTrigger: count };
let first, last;
try {
  dc("stop", "agent");
  first = scalar("SELECT max(n) FROM audit");
  const off = now();
  await sleep(slot === 3600 ? 30000 : 5000);
  last = scalar("SELECT max(n) FROM audit");
  report.offlineMs = Math.round(now() - off);
  const cohort =
    "SELECT ticket FROM audit WHERE kind='Triagem' AND n>" +
    first +
    " AND n<=" +
    last;
  report.acceptedWhileOffline = scalar(
    "SELECT count(*) FROM (" + cohort + ") cohort",
  );
  report.repliesBeforeRestart = scalar(
    "SELECT count(*) FROM messages WHERE author='IA' AND ticket IN (" +
      cohort +
      ")",
  );
} finally {
  dc("start", "agent");
}
const restart = now();
const cohort =
  "SELECT ticket FROM audit WHERE kind='Triagem' AND n>" +
  first +
  " AND n<=" +
  last;
do {
  report.recovered = scalar(
    "SELECT count(DISTINCT ticket) FROM messages WHERE author='IA' AND ticket IN (" +
      cohort +
      ")",
  );
  if (report.recovered === report.acceptedWhileOffline) break;
  await sleep(150);
} while (now() - restart < 45000);
report.recoveryObservedMs = Math.round(now() - restart);
report.pass =
  report.acceptedWhileOffline > 0 &&
  report.repliesBeforeRestart === 0 &&
  report.recovered === report.acceptedWhileOffline;
writeFileSync(
  join(resultDir, "varied-recovery.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(report);
assert.ok(report.pass);
