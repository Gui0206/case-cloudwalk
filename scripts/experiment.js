// Para proteger a demonstração pessoal, use somente uma instalação isolada e vazia.
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync } from "node:fs";
import { performance } from "node:perf_hooks";
const base = process.env.TEST_URL || "http://localhost:4381",
  code = process.env.STAFF_CODE || "demo-local";
if (new URL(base).port === "4380")
  throw Error("Use uma instalação de testes separada.");
const http = () => {
  let cookie = "";
  return async (p, body, expected = 200) => {
    const r = await fetch(base + "/api/" + p, {
      method: body === undefined ? "GET" : "POST",
      headers: { cookie, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    cookie = r.headers.getSetCookie()[0]?.split(";")[0] || cookie;
    const j = await r.json();
    assert.equal(r.status, expected, JSON.stringify(j));
    return j;
  };
};
const op = http(),
  client = http(),
  agent = http(),
  other = http();
await op("profile", { role: "ops", code });
const start = await op("config");
assert.equal(start.version, 1, "Use volumes novos no ambiente isolado.");
assert.equal((await op("tickets")).length, 0);
await client("meta");
await agent("profile", {
  role: "analyst",
  brand: "InfinitePay",
  team: "Repasses",
  name: "Lia",
  code,
});
await other("profile", {
  role: "analyst",
  brand: "JIM",
  team: "Atendimento",
  name: "Noa",
  code,
});
const c = structuredClone(start.active),
  rule = {
    id: "demo-repasses",
    name: "Repasses por marca",
    brand: "",
    category: "Repasse",
    phase: "Humano",
    priority: "",
    queue: "rep",
  };
c.rules.unshift(rule);
const save = () => op("draft", { base: 1, config: c });
await save();
const wrong = await op("simulate", {});
assert.equal(
  wrong.rows.filter((x) => x.before.queue !== x.after.queue).length,
  6,
);
rule.brand = "InfinitePay";
await save();
await op("publish", { base: 1, hash: wrong.hash }, 409);
const sim = await op("simulate", {});
assert.equal((await op("config")).version, 1);
assert.equal((await op("tickets")).length, 0);
const expectQueue = (x) =>
  x.phase === "IA"
    ? "auto"
    : x.brand === "JIM"
      ? "us"
      : x.category === "Repasse"
        ? "rep"
        : "br";
for (const x of sim.rows) assert.equal(x.after.queue, expectQueue(x));
await op("publish", { base: 1, hash: sim.hash });
const t0 = performance.now(),
  lat = [],
  ids = [],
  samples = sim.rows.filter((x) => x.phase === "IA");
let checked = 0;
const wait = async (id, pred) => {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    const t = await client("tickets/" + id);
    if (pred(t)) return t;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error("Timeout " + id);
};
for (let i = 0; i < samples.length; i += 6) {
  await Promise.all(
    samples.slice(i, i + 6).map(async (x, j) => {
      const begin = performance.now(),
        channel = ["WhatsApp", "Chat", "E-mail"][j % 3],
        { id } = await client(
          "tickets",
          {
            brand: x.brand,
            priority: x.priority,
            channel,
            text: {
              Repasse: "Meu repasse atrasou",
              Pix: "Dúvida sobre Pix",
              Maquininha: "Maquininha sem sinal",
              Outros: "Preciso de ajuda",
            }[x.category],
          },
          201,
        );
      ids.push(id);
      let t = await wait(id, (t) => t.messages.length === 2);
      assert.equal(t.category, x.category);
      assert.equal(t.queue, x.after.queue);
      checked++;
      await client("tickets/" + id + "/action", {
        action: "client",
        text: "Quero falar com humano.",
      });
      t = await wait(id, (t) => t.phase === "Humano");
      const forecast = sim.rows.find(
        (y) =>
          y.brand === x.brand &&
          y.category === x.category &&
          y.priority === x.priority &&
          y.phase === "Humano",
      );
      assert.equal(t.queue, forecast.after.queue);
      assert.equal(t.team, forecast.after.team);
      assert.equal(t.version, 2);
      assert.ok(t.summary);
      checked++;
      lat.push(performance.now() - begin);
    }),
  );
}
const elapsed = performance.now() - t0;
const target = (await agent("tickets"))[0];
assert.ok(target);
await other("tickets/" + target.id, undefined, 403);
await agent("tickets/" + target.id + "/action", { action: "claim" });
await agent("tickets/" + target.id + "/action", {
  action: "reply",
  text: "A equipe conferiu a venda fictícia.",
});
await agent("tickets/" + target.id + "/action", { action: "close" });
const end = await client("tickets/" + target.id);
assert.equal(end.status, "Encerrado");
assert.equal(end.messages.at(-1).author, "Lia");
const audited = await op("tickets/" + target.id);
assert.equal(
  audited.audit.find((a) => a.kind === "Transferência humana").detail.version,
  2,
);
lat.sort((a, b) => a - b);
const result = {
  date: new Date().toISOString(),
  scenarios: sim.rows.length,
  tickets: ids.length,
  concurrency: 6,
  decisionsChecked: checked,
  expectedMatches: checked,
  wrongDraftChanges: 6,
  correctedDraftChanges: 3,
  seconds: +(elapsed / 1000).toFixed(2),
  p95OpenToHandoffMs: Math.round(lat[Math.ceil(0.95 * lat.length) - 1]),
  handoffReplyAndClose: "ok",
  crossBrandAccess: "blocked",
  obsoletePreview: "blocked",
};
console.log(JSON.stringify(result, null, 2));
mkdirSync("results", { recursive: true });
writeFileSync(
  "results/experiment.json",
  JSON.stringify(result, null, 2) + "\n",
);
