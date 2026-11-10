// Collect group lag independently of HTTP traffic. Ctrl+C stops collection.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

const exec = promisify(execFile);
const samples = [];
async function lag(role) {
  const { stdout } = await exec("docker", [
    "compose",
    "-p",
    "central-sustained",
    "exec",
    "-T",
    "kafka",
    "rpk",
    "group",
    "describe",
    "central-" + role + "-v1",
  ]);
  const match = stdout.match(/^TOTAL-LAG\s+(\d+)/m);
  return match ? Number(match[1]) : null;
}
for (;;) {
  const [requests, responses] = await Promise.all([
    lag("agent"),
    lag("bridge"),
  ]);
  samples.push({ date: new Date().toISOString(), requests, responses });
  writeFileSync(
    "results/sustained-lag.json",
    JSON.stringify(samples, null, 2) + "\n",
  );
  await sleep(5000);
}
