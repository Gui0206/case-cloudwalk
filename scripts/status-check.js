import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
const base = "http://localhost:4381/api/";
function session() {
  let cookie = "";
  return async (path, body, status = 200) => {
    const r = await fetch(base + path, {
      method: body ? "POST" : "GET",
      headers: { cookie, "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    cookie = r.headers.getSetCookie()[0]?.split(";")[0] || cookie;
    assert.equal(r.status, status);
    return r.json();
  };
}
const client = session(),
  stranger = session(),
  wrongBrand = session(),
  staff = session();
const code = process.env.STAFF_CODE || "demo-local";
await wrongBrand("profile", {
  role: "analyst",
  name: "Other",
  brand: "JIM",
  team: "Atendimento",
  code,
});
await staff("profile", {
  role: "analyst",
  name: "Check",
  brand: "InfinitePay",
  team: "Atendimento",
  code,
});
const { id } = await client(
  "tickets",
  {
    brand: "InfinitePay",
    channel: "Chat",
    priority: "Normal",
    text: "Dúvida sobre Pix",
  },
  201,
);
const path = "tickets/" + id;
async function until(fn) {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    const s = await client(path + "/status");
    if (fn(s)) return s;
    await sleep(100);
  }
  throw Error("status timeout");
}
const first = await until((s) => s.last_author === "IA");
assert.equal(first.audit_id, "0");
assert.ok(!("messages" in first));
assert.deepEqual(await client(path + "/status"), first);
await stranger(path + "/status", undefined, 403);
await wrongBrand(path + "/status", undefined, 403);
await client(path + "/action", {
  action: "client",
  text: "Quero falar com humano",
});
const handoff = await until((s) => s.phase === "Humano");
assert.notEqual(first.message_id, handoff.message_id);
const before = await staff(path + "/status");
assert.notEqual(before.audit_id, "0");
await staff(path + "/action", { action: "claim" });
const after = await staff(path + "/status");
assert.notEqual(before.audit_id, after.audit_id);
assert.equal(after.message_id, before.message_id);
assert.equal(after.status, "Em atendimento");
await staff(path + "/action", { action: "reply", text: "Conferido." });
await staff(path + "/action", { action: "close" });
const closed = await client(path + "/status"),
  full = await client(path);
assert.equal(closed.status, "Encerrado");
assert.equal(full.messages.length, 5);
assert.equal(closed.last_author, "Check");
console.log(
  "Status changes, unchanged state, audit-only changes, authorization and full history passed.",
);
