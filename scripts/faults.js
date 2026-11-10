// Executar apenas contra o compose isolado central-helpdesk-test.
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import assert from "node:assert/strict";
const dc = (...args) =>
    execFileSync(
      "docker",
      ["compose", "-p", process.env.TEST_PROJECT || "central-helpdesk-test", ...args],
      { encoding: "utf8" },
    ),
  sql = (q) =>
    dc("exec", "-T", "db", "psql", "-U", "helpdesk", "-At", "-c", q).trim(),
  delay = (n) => new Promise((r) => setTimeout(r, n));
const base = "http://localhost:4381/api/";
let cookie = "";
async function http(p, b) {
  const r = await fetch(base + p, {
    method: b ? "POST" : "GET",
    headers: { cookie, "content-type": "application/json" },
    body: b ? JSON.stringify(b) : undefined,
  });
  cookie = r.headers.getSetCookie()[0]?.split(";")[0] || cookie;
  assert.ok(r.ok);
  return r.json();
}
async function until(fn, limit = 90000) {
  const end = Date.now() + limit;
  while (Date.now() < end) {
    if (await fn()) return;
    await delay(180);
  }
  throw Error("Tempo esgotado");
}
await http("meta");
let id;
dc("stop", "agent");
try {
  id = (
    await http("tickets", {
      brand: "JIM",
      channel: "Chat",
      priority: "Alta",
      text: "Quero falar com humano sobre Pix",
    })
  ).id;
  await until(
    () => sql("SELECT state FROM outbox WHERE ticket='" + id + "'") === "sent",
  );
  const t = await http("tickets/" + id);
  assert.equal(t.phase, "IA");
  assert.equal(t.messages.length, 1);
} finally {
  dc("start", "agent");
}
await until(async () => (await http("tickets/" + id)).phase === "Humano");
const t = await http("tickets/" + id);
const payload = sql("SELECT payload FROM outbox WHERE ticket='" + id + "'");
dc(
  "exec",
  "-T",
  "web",
  "node",
  "--input-type=module",
  "-e",
  `const r=await fetch(process.env.BROKER_URL+'/webhook',{method:'POST',headers:{'content-type':'application/json','x-internal-key':process.env.INTERNAL_KEY},body:process.argv[1]});if(!r.ok)process.exit(1)`,
  payload,
);
// Barreira na mesma partição: aguardar o callback de um evento posterior para o mesmo caso.
const marker = JSON.parse(payload);
marker.id = crypto.randomUUID();
dc(
  "exec",
  "-T",
  "web",
  "node",
  "--input-type=module",
  "-e",
  `const r=await fetch(process.env.BROKER_URL+'/webhook',{method:'POST',headers:{'content-type':'application/json','x-internal-key':process.env.INTERNAL_KEY},body:process.argv[1]});if(!r.ok)process.exit(1)`,
  JSON.stringify(marker),
);
await until(
  () => sql("SELECT count(*) FROM inbox WHERE id='" + marker.id + "'") === "1",
);
const reread = await http("tickets/" + id);
assert.equal(reread.messages.length, t.messages.length);
assert.equal(
  sql(
    "SELECT count(*) FROM audit WHERE ticket='" +
      id +
      "' AND kind='Transferência humana'",
  ),
  "1",
);
assert.equal(
  sql(
    "SELECT count(*) FROM audit WHERE ticket='" +
      id +
      "' AND kind='Retorno obsoleto ignorado'",
  ),
  "1",
);
const result = {
  date: new Date().toISOString(),
  unavailableAgent: "mensagem persistida enquanto agente desligado",
  recovery: "escalação após reinício",
  duplicate: "uma transferência e uma resposta",
  lateReturn: "ignorado após handoff",
};
mkdirSync("results", { recursive: true });
writeFileSync("results/faults.json", JSON.stringify(result, null, 2) + "\n");
console.log(result);
