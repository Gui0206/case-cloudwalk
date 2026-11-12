// Run on a fresh central-mixed Compose volume so every persisted case belongs to this run.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as sleep } from "node:timers/promises";
import { writeFileSync } from "node:fs";
const exec = promisify(execFile);
const project = process.env.MIXED_PROJECT || "central-mixed";
const port = {
  "central-history-dispatch": 4395,
  "central-history-empty": 4393,
  "central-history-aged": 4394,
  "central-mixed": 4383,
  "central-mixed-fixed": 4384,
  "central-mixed-reserved": 4385,
  "central-mixed-optimized": 4386,
  "central-mixed-conversation": 4387,
  "central-mixed-capacity": 4388,
}[project];
assert.ok(port);
const optimized = port >= 4386;
const maxConcurrentOpens = Number(process.env.MIXED_MAX_OPENS ?? 1024);
assert.ok(Number.isSafeInteger(maxConcurrentOpens) && maxConcurrentOpens > 0);
const dc = async (...args) =>
  (await exec("docker", ["compose", "-p", project, ...args])).stdout.trim();
const sql = async (query) =>
  JSON.parse(
    await dc(
      "exec",
      "-T",
      "db",
      "psql",
      "-XAt",
      "-U",
      "helpdesk",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      query,
    ),
  );
assert.equal(await dc("port", "web", "3000"), "127.0.0.1:" + port);
const comparison = project.startsWith("central-history-");
const dispatch = project === "central-history-dispatch";
const historical = dispatch || project === "central-history-aged" ? 360000 : 0;
assert.equal(await sql("SELECT count(*) FROM tickets"), historical);
if (historical)
  assert.equal(
    await sql(
      "SELECT count(*) FROM tickets WHERE client LIKE 'archive-%' AND status='Encerrado'",
    ),
    historical,
  );
const samplesByGroup = {};
function observe(key, ms) {
  (samplesByGroup[key] ??= []).push(ms);
}
function summarize(values) {
  values.sort((a, b) => a - b);
  const at = (p) =>
    Math.round(values[Math.ceil(p * values.length) - 1] * 100) / 100;
  return {
    count: values.length,
    p50Ms: at(0.5),
    p95Ms: at(0.95),
    p99Ms: at(0.99),
  };
}
const rate = 400,
  seconds = 300,
  drain = 120,
  brands = ["InfinitePay", "JIM"];
const report = {
  date: new Date().toISOString(),
  revision: (await exec("git", ["rev-parse", "HEAD"])).stdout.trim(),
  rate,
  seconds,
  drain,
  maxConcurrentOpens,
  peakConcurrentOpens: 0,
  optimizedPolling: optimized,
  readHistoryOnChange: optimized,
  samples: [],
  diagnostics: [],
  errors: {},
  http: {},
};
async function call(session, label, path, body, priority) {
  const at = performance.now();
  let status = "network";
  try {
    const r = await fetch("http://127.0.0.1:" + port + "/api/" + path, {
      method: body ? "POST" : "GET",
      headers: {
        cookie: session.cookie || "",
        "content-type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
    status = String(r.status);
    session.cookie =
      r.headers.getSetCookie()[0]?.split(";")[0] || session.cookie;
    const data = await r.json();
    if (!r.ok) throw Error(status);
    if (comparison && label === "queue") {
      const duration = performance.now() - at;
      observe("queue", duration);
      for (const value of new Set(data.map((ticket) => ticket.priority)))
        observe("queueWith" + value, duration);
    }
    if (comparison && label === "claim")
      observe("claim" + priority, performance.now() - at);
    if (label === "claimNext") {
      if (data.ticket)
        observe("claim" + data.ticket.priority, performance.now() - at);
      else report.emptyClaims = (report.emptyClaims || 0) + 1;
    }
    return data;
  } catch (e) {
    const key = label + " " + (status === "network" ? e.name : status);
    report.errors[key] = (report.errors[key] || 0) + 1;
    return null;
  } finally {
    const stat = (report.http[label] ??= { calls: 0, totalMs: 0 });
    stat.calls++;
    stat.totalMs += Math.round(performance.now() - at);
  }
}
const clients = Array.from({ length: 128 }, () => ({})),
  agents = Array.from({ length: 16 }, (_, i) => ({
    name: "Analista " + i,
    brand: brands[i % 2],
    handled: 0,
  }));
for (const c of clients) assert.ok(await call(c, "login", "meta"));
for (const a of agents)
  assert.ok(
    await call(a, "login", "profile", {
      role: "analyst",
      name: a.name,
      code: process.env.STAFF_CODE || "demo-local",
      team: "Atendimento",
      brand: a.brand,
    }),
  );
async function diagnostics() {
  const result = await dc(
    "exec",
    "-T",
    "web",
    "node",
    "--input-type=module",
    "-e",
    "const get=async u=>{const r=await fetch(u+'/internal/diagnostics',{headers:{'x-internal-key':process.env.INTERNAL_KEY}});if(!r.ok)throw Error(r.status);return r.json()};console.log(JSON.stringify({api:await get(process.env.APP_URL),bridge:await get(process.env.BROKER_URL)}))",
  );
  return JSON.parse(result);
}
report.diagnostics.push({ second: 0, ...(await diagnostics()) });
const active = new Set(),
  ready = [],
  reserved = new Set(),
  openingMs = [];
let attempted = 0,
  skipped = 0,
  opened = 0,
  followed = 0,
  requestedHuman = 0,
  closedByStaff = 0,
  running = true,
  head = 0;
const start = performance.now(),
  elapsed = () => (performance.now() - start) / 1000;
async function open(i) {
  const session = clients[i % clients.length],
    at = performance.now();
  const t = await call(session, "open", "tickets", {
    brand: brands[i % 2],
    channel: ["Chat", "WhatsApp", "E-mail"][i % 3],
    priority: comparison
      ? ["Normal", "Alta", "Urgente"][Math.floor(i / 2) % 3]
      : i % 10
        ? "Normal"
        : "Alta",
    text: "Dúvida sobre Pix",
  });
  if (t?.id) {
    opened++;
    openingMs.push(performance.now() - at);
    ready.push({
      session,
      id: t.id,
      human: i % 5 === 0,
      after: performance.now() + 800,
    });
  }
}
async function follow() {
  while (running) {
    const job = ready[head];
    if (!job) {
      await sleep(12);
      continue;
    }
    head++;
    if (head > 8192) {
      ready.splice(0, head);
      head = 0;
    }
    if (job.after > performance.now())
      await sleep(job.after - performance.now());
    if (!running) break;
    const path = "tickets/" + job.id;
    const t = await call(
      job.session,
      "clientRead",
      path + (optimized ? "/status" : ""),
    );
    let answered =
      t &&
      (optimized
        ? t.last_author === "IA"
        : t.messages.some((m) => m.author === "IA"));
    if (optimized && answered) {
      const history = await call(job.session, "clientHistory", path);
      answered = history?.messages.some((m) => m.author === "IA" && m.body);
    }
    if (!answered) {
      job.delay = optimized ? Math.min(8000, (job.delay || 400) * 2) : 800;
      job.after = performance.now() + job.delay;
      ready.push(job);
      continue;
    }
    if (
      await call(job.session, "follow", path + "/action", {
        action: "client",
        text: job.human
          ? "Quero falar com humano sobre Pix"
          : "Obrigado, resolvido",
      })
    ) {
      followed++;
      if (job.human) requestedHuman++;
    }
  }
}
async function staff(a) {
  while (running) {
    const list = await call(a, "queue", "tickets");
    for (const t of list || []) {
      if (!running) break;
      if (t.status !== "Aguardando analista" || reserved.has(t.id)) continue;
      reserved.add(t.id);
      try {
        const path = "tickets/" + t.id;
        const detail = await call(a, "staffRead", path);
        if (!detail?.summary || detail.messages.length < 4) {
          report.invalidContext = (report.invalidContext || 0) + 1;
          continue;
        }
        const act = (action, text) =>
          call(a, action, path + "/action", { action, text }, t.priority);
        if (
          (await act("claim")) &&
          (await act("reply", "Conferi o Pix fictício.")) &&
          (await act("close"))
        ) {
          closedByStaff++;
          a.handled++;
        }
      } finally {
        reserved.delete(t.id);
      }
    }
    await sleep(400);
  }
}
async function staffNext(a) {
  while (running) {
    const list = await call(a, "queue", "tickets");
    const waiting = (list || []).filter(
      (t) => t.status === "Aguardando analista",
    ).length;
    for (let i = 0; running && i < waiting; i++) {
      const assignment = await call(a, "claimNext", "tickets/claim-next", {});
      if (!assignment?.ticket) break;
      const path = "tickets/" + assignment.ticket.id;
      const detail = await call(a, "staffRead", path);
      if (
        !detail?.summary ||
        detail.brand !== a.brand ||
        detail.team !== "Atendimento" ||
        detail.messages.length < 4
      ) {
        report.invalidContext = (report.invalidContext || 0) + 1;
        break;
      }
      if (
        (await call(a, "reply", path + "/action", {
          action: "reply",
          text: "Conferi o Pix fictício.",
        })) &&
        (await call(a, "close", path + "/action", { action: "close" }))
      ) {
        a.handled++;
        closedByStaff++;
      }
    }
    await sleep(400);
  }
}
const processes = [
  ...Array.from({ length: 96 }, follow),
  ...agents.map(dispatch ? staffNext : staff),
];
const sample = () => ({
  second: +elapsed().toFixed(2),
  attempted,
  skipped,
  opened,
  followed,
  requestedHuman,
  closedByStaff,
  waitingForClientWorker: ready.length - head,
});
let measurement = Promise.resolve();
let measuring = false;
const monitor = setInterval(() => {
  const s = sample();
  report.samples.push(s);
  console.log(JSON.stringify(s));
  if (!measuring) {
    measuring = true;
    measurement = diagnostics()
      .then((d) =>
        report.diagnostics.push({ second: +elapsed().toFixed(2), ...d }),
      )
      .catch((e) =>
        report.diagnostics.push({
          second: +elapsed().toFixed(2),
          error: e.message,
        }),
      )
      .finally(() => {
        measuring = false;
      });
  }
}, 15000);
for (let i = 0; i < rate * seconds;) {
  const due = Math.min(rate * seconds, Math.floor(elapsed() * rate) + 1);
  while (i < due) {
    if (active.size >= maxConcurrentOpens) {
      skipped++;
      i++;
      continue;
    }
    attempted++;
    const p = open(i++).finally(() => active.delete(p));
    active.add(p);
    report.peakConcurrentOpens = Math.max(
      report.peakConcurrentOpens,
      active.size,
    );
  }
  if (i < rate * seconds) await sleep(4);
}
report.atStop = sample();
await Promise.all(active);
while (
  elapsed() < seconds + drain &&
  (followed < opened || closedByStaff < requestedHuman)
)
  await sleep(250);
running = false;
clearInterval(monitor);
await Promise.all(processes);
await measurement;
report.diagnostics.push({
  second: +elapsed().toFixed(2),
  ...(await diagnostics()),
});
report.end = sample();
report.analysts = agents.map(({ name, brand, handled }) => ({
  name,
  brand,
  handled,
}));
openingMs.sort((a, b) => a - b);
report.openP95Ms = openingMs[Math.ceil(openingMs.length * 0.95) - 1];
report.integrity = await sql(`WITH msg AS (
 SELECT ticket,array_agg(CASE author WHEN 'Cliente' THEN 'C' WHEN 'IA' THEN 'I' ELSE 'A' END ORDER BY n) authors,
 (array_agg(created ORDER BY n)) ts,bool_or(body LIKE 'Quero falar%') handoff
 FROM messages ${historical ? "JOIN tickets ON id=ticket WHERE client NOT LIKE 'archive-%'" : ""} GROUP BY ticket)
 SELECT json_build_object('tickets',count(*),'firstReplies',count(*) FILTER(WHERE authors[2]='I'),
 'secondReplies',count(*) FILTER(WHERE authors[4]='I'),
 'closedAuto',count(*) FILTER(WHERE NOT handoff AND status='Encerrado' AND phase='IA' AND authors=ARRAY['C','I','C','I']),
 'closedHuman',count(*) FILTER(WHERE handoff AND status='Encerrado' AND phase='Humano' AND owner IS NOT NULL AND summary<>'' AND authors=ARRAY['C','I','C','I','A']),
 'awaitingStaff',count(*) FILTER(WHERE phase='Humano' AND status<>'Encerrado'),
 'unexpectedOrder',count(*) FILTER(WHERE authors<>(ARRAY['C','I','C','I','A'])[1:cardinality(authors)] OR cardinality(authors)>5),
 'firstP95Ms',percentile_cont(.95) WITHIN GROUP(ORDER BY extract(epoch FROM ts[2]-ts[1])*1000),
 'secondP95Ms',percentile_cont(.95) WITHIN GROUP(ORDER BY extract(epoch FROM ts[4]-ts[3])*1000),
 'pendingOutbox',(SELECT count(*) FROM outbox WHERE state='pending'),'failedOutbox',(SELECT count(*) FROM outbox WHERE state='failed'))
 FROM tickets JOIN msg ON ticket=id`);
const v = report.integrity;
report.pass =
  opened === rate * seconds &&
  Object.keys(report.errors).every((error) => error === "claim 409") &&
  !report.invalidContext &&
  v.tickets === opened &&
  v.closedAuto === rate * seconds * 0.8 &&
  v.closedHuman === rate * seconds * 0.2 &&
  !v.unexpectedOrder &&
  !v.pendingOutbox &&
  !v.failedOutbox &&
  v.firstP95Ms <= 2000 &&
  v.secondP95Ms <= 2000 &&
  report.atStop.opened - report.atStop.followed <= rate * 3 &&
  report.atStop.requestedHuman - report.atStop.closedByStaff <= rate * 0.2 * 3;
if (comparison) {
  report.historicalTickets = historical;
  report.panel = Object.fromEntries(
    Object.entries(samplesByGroup).map(([k, v]) => [k, summarize(v)]),
  );
  report.handoff = await sql(`WITH waits AS (
    SELECT t.id,t.priority,extract(epoch FROM max(a.created) FILTER(WHERE kind='Caso assumido') -
      min(a.created) FILTER(WHERE kind='Transferência humana'))*1000 ms
    FROM tickets t JOIN audit a ON a.ticket=t.id
    WHERE t.client NOT LIKE 'archive-%' AND phase='Humano' GROUP BY t.id)
    SELECT json_agg(s) FROM (SELECT priority,count(ms) AS claims,
      round(percentile_cont(.50) WITHIN GROUP(ORDER BY ms)::numeric,2) AS "p50Ms",
      round(percentile_cont(.95) WITHIN GROUP(ORDER BY ms)::numeric,2) AS "p95Ms"
      FROM waits GROUP BY priority ORDER BY priority) s`);
  report.events =
    await sql(`SELECT json_build_object('sent',count(*) FILTER(WHERE state='sent'),
    'missingCallback',count(*) FILTER(WHERE i.id IS NULL)) FROM outbox o JOIN tickets t ON t.id=o.ticket
    LEFT JOIN inbox i ON i.id=o.id WHERE t.client NOT LIKE 'archive-%'`);
  for (const role of ["agent", "bridge"]) {
    const description = await dc(
      "exec",
      "-T",
      "kafka",
      "rpk",
      "group",
      "describe",
      "central-" + role + "-v1",
    );
    report.events[role + "Lag"] = Number(
      description.match(/^TOTAL-LAG\s+(\d+)/m)?.[1] ?? NaN,
    );
  }
  report.pass &&=
    report.events.sent === 240000 &&
    report.events.missingCallback === 0 &&
    report.events.agentLag === 0 &&
    report.events.bridgeLag === 0 &&
    report.handoff?.length === 3 &&
    report.handoff.every((row) => row.claims === 8000);
}
if (dispatch) {
  report.assignments =
    await sql(`SELECT json_build_object('auditRows',count(*),'distinctTickets',count(DISTINCT a.ticket))
    FROM audit a JOIN tickets t ON t.id=a.ticket WHERE kind='Caso assumido' AND t.client NOT LIKE 'archive-%'`);
  report.pass &&=
    Object.keys(report.errors).length === 0 &&
    report.assignments.auditRows === 24000 &&
    report.assignments.distinctTickets === 24000;
}
writeFileSync(
  comparison
    ? "results/" + project + ".json"
    : project === "central-mixed-capacity"
      ? "results/mixed-capacity.json"
      : optimized
        ? "results/mixed-optimized.json"
        : project !== "central-mixed"
          ? "results/mixed-fixed.json"
          : "results/mixed.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify({ pass: report.pass, integrity: v, errors: report.errors }),
);
