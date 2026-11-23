// Fresh isolated installation; exercises real webhook/Kafka/agent callbacks.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
const base = process.env.TEST_URL || "http://localhost:4396";
assert.equal(new URL(base).port, "4396", "Dedicated policy test only");
const checks = [];
const done = (s) => {
  checks.push(s);
  console.log("PASS", s);
};
function session() {
  let cookie = "";
  return async (
    path,
    body,
    status = path === "tickets" && body ? 201 : 200,
  ) => {
    const r = await fetch(base + "/api/" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: { cookie, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    cookie = r.headers.getSetCookie()[0]?.split(";")[0] || cookie;
    const j = await r.json();
    assert.equal(r.status, status, JSON.stringify(j));
    return j;
  };
}
const op = session(),
  other = session(),
  client = session();
await op("profile", {
  role: "ops",
  operator: "ops-ana",
  code: process.env.STAFF_CODE || "demo-local",
});
await other("profile", {
  role: "ops",
  operator: "ops-lia",
  code: process.env.STAFF_CODE || "demo-local",
});
await client("publications", undefined, 403);
await client(
  "profile",
  {
    role: "ops",
    operator: "forged",
    code: process.env.STAFF_CODE || "demo-local",
  },
  403,
);
const initial = await op("config");
assert.equal(initial.version, 1);
assert.equal((await op("tickets")).length, 0);
const cfg = structuredClone(initial.active);
const rule = {
  id: "policy-rep",
  name: "Repasses prioritários",
  category: "Repasse",
  phase: "Humano",
  queue: "br",
  setPriority: "Alta",
};
cfg.rules.unshift(rule, {
  ...rule,
  id: "shadow",
  name: "Regra encoberta",
  brand: "JIM",
});
await op("draft", { base: 1, config: cfg });
const broad = await op("simulate", {});
assert.equal(broad.rows.length, 48);
assert(broad.alerts.some((a) => a.code === "cross_brand"));
assert(broad.alerts.some((a) => a.code === "shadowed_rule"));
assert.deepEqual((await op("config")).active, initial.active);
assert.equal((await op("publications")).length, 0);
done("Simulação sem publicação; alertas de alcance e regra encoberta");
const bad = structuredClone(cfg);
bad.rules[0].setPriority = "Critical";
await op("draft", { base: 1, config: bad }, 400);
cfg.rules.splice(1, 1);
rule.brand = "InfinitePay";
cfg.rules.unshift({
  id: "policy-pix",
  name: "Pix urgente",
  brand: "InfinitePay",
  category: "Pix",
  phase: "Humano",
  queue: "br",
  setPriority: "Urgente",
});
await op("draft", { base: 1, config: cfg });
await op("publish", { base: 1, hash: broad.hash }, 409);
const preview = await op("simulate", {});
assert(!preview.alerts.some((a) => a.code === "cross_brand"));
for (const row of preview.rows) {
  const expected =
    row.phase === "Humano" && row.brand === "InfinitePay"
      ? row.category === "Pix"
        ? "Urgente"
        : row.category === "Repasse"
          ? "Alta"
          : "Normal"
      : "Normal";
  assert.equal(row.after.priority, expected);
}
done(
  "48 prioridades previstas contra expectativa independente; prévia obsoleta rejeitada",
);
const outcomes = await Promise.all([
  op("publish", { base: 1, hash: preview.hash, actor: { id: "forged" } })
    .then(() => 200)
    .catch((e) => e),
  other("publish", { base: 1, hash: preview.hash })
    .then(() => 200)
    .catch((e) => e),
]);
assert.equal(outcomes.filter((x) => x === 200).length, 1);
assert.equal(
  outcomes.filter((x) => x instanceof assert.AssertionError && x.actual === 409)
    .length,
  1,
);
let publications = await op("publications");
assert.equal(publications.length, 1);
const publication = publications[0];
assert(["ops-ana", "ops-lia"].includes(publication.detail.actor.id));
assert.equal(publication.detail.previousVersion, 1);
assert.equal(publication.detail.version, 2);
assert(publication.detail.correlationId);
assert(
  publication.detail.changes.some((c) => c.after?.setPriority === "Urgente"),
);
assert(publication.created);
done(
  "Publicação concorrente: uma versão, autor da sessão, diff, horário e correlação",
);
async function wait(id, predicate) {
  const until = Date.now() + 45000;
  while (Date.now() < until) {
    const t = await op("tickets/" + id);
    if (predicate(t)) return t;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error("Timeout " + id);
}
const ids = {};
for (const [cat, p] of [
  ["Outros", "Normal"],
  ["Repasse", "Alta"],
  ["Pix", "Urgente"],
]) {
  const c = session();
  const { id } = await c("tickets", {
    brand: "InfinitePay",
    channel: "Chat",
    priority: "Urgente",
    text: cat + " preciso de ajuda",
  });
  ids[p] = id;
  let t = await wait(id, (t) => t.messages.length >= 2);
  assert.equal(t.priority, "Normal");
  assert.equal(t.declared_priority, "Urgente");
  await c("tickets/" + id + "/action", {
    action: "client",
    text: "Quero falar com humano",
  });
  t = await wait(id, (t) => t.phase === "Humano");
  assert.equal(t.priority, p);
  assert.equal(t.declared_priority, "Urgente");
  const handoff = t.audit.find((a) => a.kind === "Transferência humana");
  assert.equal(handoff.detail.priority, p);
  assert.equal(handoff.detail.declaredPriority, "Urgente");
  assert.equal(handoff.detail.version, 2);
  // Repeated delivery must not duplicate the handoff or change its priority.
  const replay = await fetch(base + "/internal/reply", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-internal-key": process.env.INTERNAL_KEY,
    },
    body: JSON.stringify({
      id: handoff.detail.event,
      ticket: id,
      revision: t.revision,
      type: "handoff",
    }),
  });
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).duplicate, true);
  assert.deepEqual((await op("tickets/" + id)).audit, t.audit);
}
done(
  "Pedido Urgente não eleva prioridade; handoff aplica política e deduplica reentrega",
);
const jim = session();
const jt = await jim("tickets", {
  brand: "JIM",
  channel: "E-mail",
  priority: "Urgente",
  text: "Pix quero falar com humano",
});
assert.equal(
  (await wait(jt.id, (t) => t.phase === "Humano")).priority,
  "Normal",
);
done("Política InfinitePay não eleva prioridade da JIM");
const analysts = await Promise.all(
  [1, 2, 3].map(async (n) => {
    const a = session();
    await a("profile", {
      role: "analyst",
      code: process.env.STAFF_CODE || "demo-local",
      name: "Teste " + n,
      team: "Atendimento",
      brand: "InfinitePay",
    });
    return a;
  }),
);
const first = await analysts[0]("tickets/claim-next", {});
assert.equal(first.ticket.id, ids.Urgente);
const rest = await Promise.all(
  analysts.slice(1).map((a) => a("tickets/claim-next", {})),
);
assert.equal(new Set([first, ...rest].map((x) => x.ticket.id)).size, 3);
for (const id of Object.values(ids))
  assert.equal(
    (await op("tickets/" + id)).audit.filter((a) => a.kind === "Caso assumido")
      .length,
    1,
  );
done(
  "Atribuição usa prioridade efetiva; três analistas sem atribuição duplicada",
);
const current = await op("config");
[current.draft.rules[0], current.draft.rules[1]] = [
  current.draft.rules[1],
  current.draft.rules[0],
];
await other("draft", { base: 2, config: current.draft });
const reorder = await other("simulate", {});
await other("publish", { base: 2, hash: reorder.hash });
publications = await op("publications");
assert.equal(publications[0].detail.actor.id, "ops-lia");
assert(
  publications[0].detail.changes.some(
    (c) => c.beforePosition !== c.afterPosition,
  ),
);
done("Reordenação auditada com identidade estável de outro operador");
writeFileSync(
  "results/policy-check.json",
  JSON.stringify(
    {
      date: new Date().toISOString(),
      pass: true,
      checks,
      scenarios: 48,
      publicationCount: publications.length,
      scope:
        "API + PostgreSQL + outbox + webhook + Kafka + agente simulado; instalação isolada",
    },
    null,
    2,
  ) + "\n",
);
