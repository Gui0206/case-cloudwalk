// Pico sintético na instância de testes, sem tocar no ambiente da demonstração.
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync } from "node:fs";
const url = "http://localhost:4381/api/",
  pause = (ms) => new Promise((r) => setTimeout(r, ms));
const cookie = (await fetch(url + "meta")).headers
  .getSetCookie()[0]
  .split(";")[0];
const op = await fetch(url + "profile", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    role: "ops",
    code: process.env.STAFF_CODE || "demo-local",
  }),
});
assert.ok(op.ok);
const staff = op.headers.getSetCookie()[0].split(";")[0];
const lat = [],
  seen = [],
  tickets = [],
  begin = performance.now();
let maxPending = 0,
  stopped = false;
const monitor = (async () => {
  while (!stopped) {
    const r = await fetch(url + "metrics", { headers: { cookie: staff } });
    assert.ok(r.ok);
    maxPending = Math.max(maxPending, Number((await r.json()).pending));
    await pause(180);
  }
})();
try {
  for (let batch = 0; batch < 10; batch++) {
    await Promise.all(
      Array.from({ length: 12 }, async (_, i) => {
        const at = performance.now();
        const r = await fetch(url + "tickets", {
          method: "POST",
          headers: { cookie, "Content-Type": "application/json" },
          body: JSON.stringify({
            channel: ["WhatsApp", "Chat", "E-mail"][i % 3],
            brand: i % 2 ? "JIM" : "InfinitePay",
            text: "Dúvida sobre Pix",
            priority: "Normal",
          }),
        });
        assert.equal(r.status, 201);
        const { id } = await r.json();
        tickets.push({ id, at });
        lat.push(performance.now() - at);
      }),
    );
  }
  const accepted = performance.now();
  let pending = [...tickets];
  while (pending.length) {
    assert.ok(performance.now() - begin < 90000, "Timeout drenando pico");
    await pause(250);
    let results = [];
    for (let i = 0; i < pending.length; i += 12)
      results.push(
        ...(await Promise.all(
          pending.slice(i, i + 12).map(async (t) => {
            const r = await fetch(url + "tickets/" + t.id, {
              headers: { cookie },
            });
            assert.ok(r.ok);
            const data = await r.json();
            const replies = data.messages.filter((m) => m.author === "IA");
            assert.ok(replies.length <= 1);
            if (replies.length) {
              seen.push(performance.now() - t.at);
              return null;
            }
            return t;
          }),
        )),
      );
    pending = results.filter(Boolean);
  }
  const p95 = (v) =>
    Math.round(v.sort((a, b) => a - b)[Math.ceil(v.length * 0.95) - 1]);
  const result = {
    date: new Date().toISOString(),
    tickets: tickets.length,
    concurrentSubmissions: 12,
    creationSeconds: +((accepted - begin) / 1000).toFixed(2),
    totalSeconds: +((performance.now() - begin) / 1000).toFixed(2),
    maxObservedOutboxPending: maxPending,
    p95CreationMs: p95(lat),
    p95ObservedFirstReplyMs: p95(seen),
    ticketsWithOneReply: seen.length,
  };
  mkdirSync("results", { recursive: true });
  writeFileSync(process.env.LOAD_RESULT || "results/load-go.json", JSON.stringify(result, null, 2) + "\n");
  console.log(result);
} finally {
  stopped = true;
  await monitor;
}
