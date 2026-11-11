// A fixed synthetic day. Each slot has its own arrival count, independent of previous replies.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { checkBrandRoute } from "../public/routing-proof.js";

const project = process.env.VARIED_PROJECT || "central-varied";
assert.match(project, /^central-varied(?:-[a-z0-9-]+)?$/);
const dc = (...args) =>
  execFileSync("docker", ["compose", "-p", project, ...args], {
    encoding: "utf8",
  }).trim();
assert.equal(dc("port", "web", "3000"), "127.0.0.1:4390");
const sql = (query) =>
  JSON.parse(
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
      query,
    ),
  );
assert.equal(
  sql("SELECT count(*) FROM tickets"),
  0,
  "Use uma instalação de ensaio vazia",
);
const slotSeconds = Number(process.env.VARIED_SLOT_SECONDS || 15);
assert.ok(
  Number.isInteger(slotSeconds) && slotSeconds >= 1 && slotSeconds <= 3600,
);
const byHour = [
  60, 40, 35, 30, 35, 70, 120, 200, 320, 500, 400, 350, 280, 300, 360, 450, 750,
  600, 400, 300, 220, 150, 110, 80,
];
const code = process.env.STAFF_CODE || "demo-local";
function session() {
  let cookie = "";
  return async (path, body, expected) => {
    const r = await fetch("http://127.0.0.1:4390/api/" + path, {
      method: body ? "POST" : "GET",
      headers: { cookie, "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10000),
    });
    cookie = r.headers.getSetCookie()[0]?.split(";")[0] || cookie;
    const data = await r.json();
    assert.equal(
      r.status,
      expected ?? (path === "tickets" && body ? 201 : 200),
      path + " " + JSON.stringify(data.error),
    );
    return data;
  };
}
const op = session();
await op("profile", { role: "ops", code });
const config = await op("config");
assert.equal(config.version, 1);
const rule = {
  id: "repasse-demo",
  name: "Repasses InfinitePay",
  brand: "",
  category: "Repasse",
  phase: "Humano",
  priority: "",
  queue: "rep",
};
config.active.rules.unshift(rule);
const simulate = async () => {
  await op("draft", { base: 1, config: config.active });
  return op("simulate", {});
};
const wide = await simulate();
const changed = (s) =>
  s.rows.filter((r) => r.before.queue !== r.after.queue).length;
assert.equal(changed(wide), 6);
rule.brand = "InfinitePay";
const scoped = await simulate();
assert.equal(changed(scoped), 3);
await op("publish", { base: 1, hash: scoped.hash });
const brands = ["InfinitePay", "JIM"],
  channels = ["Chat", "WhatsApp", "E-mail"],
  priorities = ["Normal", "Alta", "Urgente"];
const topics = ["Pix", "Repasse", "Maquininha", "Outros"];
const opening = [
  "Onde vejo o Pix?",
  "Meu repasse atrasou.",
  "A maquininha perdeu o sinal.",
  "Preciso de ajuda com o cadastro.",
];
const staff = new Map();
for (const [brand, team] of [
  ["JIM", "Atendimento"],
  ["InfinitePay", "Atendimento"],
  ["InfinitePay", "Repasses"],
]) {
  const agent = session(),
    name = brand + " " + team;
  await agent("profile", { role: "analyst", name, team, brand, code });
  staff.set(name, agent);
}
let seed = 20261111;
function random(n) {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return Math.floor((seed / 2 ** 32) * n);
}
function plan(i) {
  const topic = random(4),
    brand = brands[random(2)],
    channel = channels[random(3)],
    priority = priorities[random(3)],
    mode = random(5);
  const lines = [opening[topic]];
  let human = false;
  if (mode === 0) {
    lines[0] += " Quero falar com humano.";
    human = true;
  } else if (mode === 1) {
    lines[0] += " Obrigado, resolvido.";
  } else {
    if (topic === 0 || topic === 3) {
      for (let j = 0, extra = random(4); j < extra; j++)
        lines.push("Pode explicar a etapa " + (j + 1) + "?");
    }
    human = mode === 2 || (mode === 3 && (topic === 1 || topic === 2));
    lines.push(
      human
        ? mode === 2
          ? "Quero falar com humano."
          : "Referência fictícia " + i
        : "Obrigado, resolvido.",
    );
  }
  return {
    topic,
    brand,
    channel,
    priority,
    lines,
    human,
    think: 100 + random(850),
  };
}
const target = byHour.reduce((a, b) => a + b, 0),
  pending = new Set(),
  durations = [],
  responseMs = [],
  errors = [];
const report = {
  date: new Date().toISOString(),
  revision: execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  seed,
  slotSeconds,
  byHour,
  target,
  issued: 0,
  finished: 0,
  handoffs: 0,
  peakActive: 0,
  maxLaunchDelayMs: 0,
  windows: [],
  byCategory: {},
  byTurns: {},
};
async function conversation(p) {
  const client = session(),
    since = performance.now(),
    transcript = [];
  const { id } = await client("tickets", {
    brand: p.brand,
    channel: p.channel,
    priority: p.priority,
    text: p.lines[0],
  });
  const path = "tickets/" + id;
  for (const [i, line] of p.lines.entries()) {
    if (i) {
      await sleep(p.think);
      await client(path + "/action", { action: "client", text: line });
    }
    transcript.push("Cliente", "IA");
    const deadline = performance.now() + 45000;
    let t;
    do {
      await sleep(120);
      t = await client(path);
      if (t.messages.length === transcript.length) break;
    } while (performance.now() < deadline);
    assert.deepEqual(
      t.messages.map((m) => m.author),
      transcript,
    );
    assert.equal(t.messages.at(-2).body, line);
    responseMs.push(
      Date.parse(t.messages.at(-1).created) -
        Date.parse(t.messages.at(-2).created),
    );
    if (i + 1 < p.lines.length) assert.equal(t.status, "Aberto");
  }
  if (p.human) {
    const team =
      p.brand === "InfinitePay" && p.topic === 1 ? "Repasses" : "Atendimento";
    const name = p.brand + " " + team,
      agent = staff.get(name),
      handoff = await agent(path);
    assert.equal(handoff.phase, "Humano");
    assert.equal(handoff.team, team);
    assert.equal(
      handoff.queue,
      p.brand === "JIM" ? "us" : p.topic === 1 ? "rep" : "br",
    );
    assert.ok(
      handoff.summary.includes(p.lines[0]) &&
        handoff.summary.includes(p.lines.at(-1)),
    );
    const trace = handoff.audit.filter(
      (a) => a.kind === "Transferência humana",
    );
    assert.equal(trace.length, 1);
    assert.equal(trace[0].detail.version, 2);
    await agent(path + "/action", { action: "claim" });
    await sleep(p.think);
    await client(path + "/action", {
      action: "client",
      text: "Tenho o comprovante fictício.",
    });
    await agent(path + "/action", {
      action: "reply",
      text: "Conferi o contexto e o comprovante.",
    });
    await agent(path + "/action", { action: "close" });
    transcript.push("Cliente", name);
    report.handoffs++;
  }
  const end = await client(path);
  assert.equal(end.status, "Encerrado");
  assert.equal(end.category, topics[p.topic]);
  assert.deepEqual(
    end.messages.map((m) => m.author),
    transcript,
  );
  durations.push(performance.now() - since);
  report.byCategory[end.category] = (report.byCategory[end.category] || 0) + 1;
  report.byTurns[p.lines.length] = (report.byTurns[p.lines.length] || 0) + 1;
  report.finished++;
}
const start = performance.now();
for (const [hour, count] of byHour.entries()) {
  for (let i = 0; i < count; i++) {
    const due = start + (hour + i / count) * slotSeconds * 1000;
    await sleep(Math.max(0, due - performance.now()));
    report.maxLaunchDelayMs = Math.max(
      report.maxLaunchDelayMs,
      Math.round(performance.now() - due),
    );
    const p = plan(report.issued++),
      work = conversation(p)
        .catch((e) => errors.push(e.message))
        .finally(() => pending.delete(work));
    pending.add(work);
    report.peakActive = Math.max(report.peakActive, pending.size);
  }
  report.windows.push({
    hour,
    issued: report.issued,
    completed: report.finished,
    inFlight: pending.size,
  });
  console.log(JSON.stringify(report.windows.at(-1)));
}
await Promise.all(pending);
report.elapsedSeconds = (performance.now() - start) / 1000;
function percentiles(values) {
  values.sort((a, b) => a - b);
  return [0.5, 0.95, 0.99].map((p) =>
    Math.round(values[Math.ceil(values.length * p) - 1]),
  );
}
report.replyMs = percentiles(responseMs);
report.conversationMs = percentiles(durations);
report.persisted =
  sql(`SELECT json_build_object('tickets',count(*),'distinctClients',count(DISTINCT client),
 'closed',count(*) FILTER(WHERE status='Encerrado'),'brands',count(DISTINCT brand),'channels',count(DISTINCT channel),
 'priorities',count(DISTINCT priority),'categories',count(DISTINCT category),'outboxUnsent',(SELECT count(*) FROM outbox WHERE state<>'sent'),
 'outboxEvents',(SELECT count(*) FROM outbox),'inboxEvents',(SELECT count(*) FROM inbox)) FROM tickets`);
report.errorCount = errors.length;
report.errors = errors.slice(0, 10);
const v = report.persisted;
report.pass =
  errors.length === 0 &&
  report.finished === target &&
  v.closed === target &&
  v.distinctClients === target &&
  v.outboxUnsent === 0 &&
  v.outboxEvents === v.inboxEvents &&
  v.categories === 4 &&
  v.brands === 2 &&
  v.channels === 3 &&
  v.priorities === 3;
writeFileSync("results/varied.json", JSON.stringify(report, null, 2) + "\n");
assert.ok(report.pass, JSON.stringify(report.errors));
const proofs = [];
for (const f of scoped.rows.filter(
  (r) =>
    r.category === "Repasse" && r.phase === "Humano" && r.priority === "Normal",
)) {
  const proof = await checkBrandRoute(op, f, 2);
  assert.ok(proof.matches);
  assert.equal(proof.actual.queue, proof.brand === "JIM" ? "us" : "rep");
  proofs.push(proof);
}
writeFileSync(
  "results/routing-proof.json",
  JSON.stringify(
    {
      version: 2,
      wideChanges: changed(wide),
      scopedChanges: changed(scoped),
      cases: proofs,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify({ pass: report.pass, persisted: v, proofs: proofs.length }),
);
