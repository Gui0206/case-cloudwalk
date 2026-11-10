// Run only against the isolated Compose installation on port 4382.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

const exec = promisify(execFile);
const dc = async (...args) =>
  (
    await exec("docker", ["compose", "-p", "central-sustained", ...args])
  ).stdout.trim();
const sql = async (query) =>
  JSON.parse(
    await dc(
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
      query,
    ),
  );
const api = "http://127.0.0.1:4382/api/";
assert.match(await dc("port", "web", "3000"), /127\.0\.0\.1:4382$/);
const clients = [];
for (let i = 0; i < 32; i++) {
  const r = await fetch(api + "meta");
  assert.equal(r.status, 200);
  clients.push(r.headers.getSetCookie()[0].split(";")[0]);
  await r.text();
}
const pct = (list, p) =>
  list.length ? Math.round(list[Math.ceil(list.length * p) - 1]) : null;
const report = {
  date: new Date().toISOString(),
  revision: (await exec("git", ["rev-parse", "HEAD"])).stdout.trim(),
  clients: clients.length,
  stages: [],
};
const target = process.env.RETEST_400;
if (target) assert.ok(["single", "parallel", "indexed"].includes(target));
async function diagnostics() {
  return JSON.parse(
    await dc(
      "exec",
      "-T",
      "web",
      "node",
      "--input-type=module",
      "-e",
      `const get=async url=>{const r=await fetch(url+'/internal/diagnostics',{headers:{'x-internal-key':process.env.INTERNAL_KEY}});if(!r.ok)throw Error(r.status);return r.json()};console.log(JSON.stringify({api:await get(process.env.APP_URL),bridge:await get(process.env.BROKER_URL)}))`,
    ),
  );
}
const save = () =>
  writeFileSync(
    target
      ? "results/retest-400-" + target + ".json"
      : "results/sustained.json",
    JSON.stringify(report, null, 2) + "\n",
  );
async function stage(rate, seconds, kind) {
  const startN = await sql("SELECT coalesce(max(n),0) FROM messages");
  const diagnosticsBefore = target ? await diagnostics() : undefined;
  const start = performance.now(),
    active = new Set(),
    latency = [],
    errors = {},
    samples = [];
  let issued = 0,
    skipped = 0;
  async function post(i) {
    const at = performance.now();
    try {
      const r = await fetch(api + "tickets", {
        method: "POST",
        signal: AbortSignal.timeout(10000),
        headers: {
          "content-type": "application/json",
          cookie: clients[i % clients.length],
        },
        body: JSON.stringify({
          brand: i % 2 ? "JIM" : "InfinitePay",
          channel: ["Chat", "WhatsApp", "E-mail"][i % 3],
          priority: i % 10 ? "Normal" : "Alta",
          text: i % 5 ? "Dúvida sobre Pix" : "Quero falar com humano sobre Pix",
        }),
      });
      const body = await r.json();
      if (r.status !== 201 || !body.id) throw Error("HTTP " + r.status);
      latency.push(performance.now() - at);
    } catch (e) {
      errors[e.message] = (errors[e.message] || 0) + 1;
    }
  }
  const snapshot = async () => ({
    ...(await sql(`SELECT json_build_object(
  'opened',count(*) FILTER(WHERE author='Cliente'),'completed',count(*) FILTER(WHERE author='IA'),
  'outboxPending',(SELECT count(*) FROM outbox WHERE state='pending'),
  'outboxFailed',(SELECT count(*) FROM outbox WHERE state='failed'))
  FROM messages WHERE n>${startN}`)),
    second: +((performance.now() - start) / 1000).toFixed(2),
  });
  let measuring = true;
  const monitor = (async () => {
    while (measuring) {
      samples.push(await snapshot());
      await sleep(2000);
    }
  })();
  while (performance.now() - start < seconds * 1000) {
    const due = Math.min(
      rate * seconds,
      Math.floor(((performance.now() - start) * rate) / 1000) + 1,
    );
    while (issued < due) {
      const i = issued++;
      if (active.size >= 200) {
        skipped++;
        continue;
      }
      const p = post(i).finally(() => active.delete(p));
      active.add(p);
    }
    await sleep(4);
  }
  const atStop = await snapshot();
  measuring = false;
  await Promise.all(active);
  await monitor;
  let final = await snapshot();
  while (
    final.completed < final.opened &&
    performance.now() - start < (seconds + 90) * 1000
  ) {
    await sleep(500);
    final = await snapshot();
  }
  // PostgreSQL now() timestamps the transaction start on both sides of this measurement.
  const integrity = await sql(`WITH per_case AS (SELECT ticket,
    min(created) FILTER(WHERE author='Cliente') opened,
    min(created) FILTER(WHERE author='IA') replied,
    count(*) FILTER(WHERE author='IA') replies
    FROM messages WHERE n>${startN} GROUP BY ticket)
    SELECT json_build_object('total',count(*),'missing',count(*) FILTER(WHERE replies=0),
    'duplicates',count(*) FILTER(WHERE replies>1),'human',count(*) FILTER(WHERE t.phase='Humano'),
    'replyMs',percentile_cont(ARRAY[0.5,0.95,0.99]) WITHIN GROUP(ORDER BY extract(epoch from replied-opened)*1000))
    FROM per_case JOIN tickets t ON t.id=ticket`);
  latency.sort((a, b) => a - b);
  const pass =
    issued - skipped >= rate * seconds * 0.99 &&
    !Object.keys(errors).length &&
    integrity.total === latency.length &&
    integrity.total > 0 &&
    integrity.missing === 0 &&
    integrity.duplicates === 0 &&
    integrity.human === Math.ceil(issued / 5) &&
    integrity.replyMs[1] <= 2000 &&
    atStop.opened - atStop.completed <= rate * 2 &&
    final.outboxFailed === 0;
  const result = {
    diagnosticsBefore,
    diagnosticsAfter: target ? await diagnostics() : undefined,
    kind,
    rate,
    seconds,
    issued,
    skipped,
    accepted: latency.length,
    errors,
    apiMs: [0.5, 0.95, 0.99].map((p) => pct(latency, p)),
    integrity,
    atStop,
    final,
    samples,
    pass,
  };
  report.stages.push(result);
  save();
  console.log(
    kind,
    rate,
    pass,
    JSON.stringify({
      api: result.apiMs,
      reply: integrity.replyMs,
      endBacklog: atStop.opened - atStop.completed,
      errors,
      skipped,
    }),
  );
  return result;
}
let best = 0;
if (target) {
  const first = await stage(400, 60, target);
  if (first.pass) await stage(400, 120, "confirmação");
} else {
  for (const rate of [10, 25, 50, 100, 200, 400]) {
    const result = await stage(rate, 60, "rampa");
    if (!result.pass) break;
    best = rate;
  }
  if (best && report.stages.at(-1).integrity.missing === 0)
    await stage(best, 120, "confirmação");
}
