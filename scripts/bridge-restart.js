// Exercise abrupt bridge termination while response offsets are batched.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
const project = "central-optimized-functional";
const dc = (...args) =>
  execFileSync("docker", ["compose", "-p", project, ...args], {
    encoding: "utf8",
  }).trim();
assert.equal(dc("port", "web", "3000"), "127.0.0.1:4381");
const marker = "Dúvida sobre Pix " + randomUUID();
const cohort =
  "SELECT ticket FROM messages WHERE author='Cliente' AND body='" +
  marker +
  "'";
const count = (query) =>
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
      query,
    ),
  );
async function until(read, ok) {
  const deadline = Date.now() + 90000;
  do {
    const result = read();
    if (ok(result)) return result;
    await sleep(50);
  } while (Date.now() < deadline);
  throw Error("Timeout aguardando a ponte");
}
const base = "http://localhost:4381/api/";
const n = 512;
const replies = () =>
  count(
    "SELECT count(*) FROM messages WHERE author='IA' AND ticket IN (" +
      cohort +
      ")",
  );
try {
  dc("stop", "agent");
  let issued = 0;
  await Promise.all(
    Array.from({ length: 16 }, async () => {
      const login = await fetch(base + "meta");
      const cookie = login.headers.getSetCookie()[0].split(";")[0];
      await login.text();
      while (issued++ < n) {
        const r = await fetch(base + "tickets", {
          method: "POST",
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify({
            brand: "InfinitePay",
            channel: "Chat",
            text: marker,
          }),
        });
        assert.equal(r.status, 201);
        await r.json();
      }
    }),
  );
  await until(
    () =>
      count(
        "SELECT count(*) FROM outbox WHERE state='sent' AND ticket IN (" +
          cohort +
          ")",
      ),
    (v) => v === n,
  );
  dc("start", "agent");
  const before = await until(replies, (v) => v > 0);
  assert.ok(before < n, "A interrupção deve ocorrer com respostas pendentes");
  dc("kill", "-s", "SIGKILL", "bridge");
  dc("start", "bridge");
  await until(replies, (v) => v >= n);
  await until(
    () =>
      dc(
        "exec",
        "-T",
        "kafka",
        "rpk",
        "group",
        "describe",
        "central-bridge-v1",
      ),
    (group) =>
      /^STATE\s+Stable$/m.test(group) && /^TOTAL-LAG\s+0$/m.test(group),
  );
  const exact = () =>
    count(
      "SELECT count(*) FROM (SELECT ticket FROM messages WHERE ticket IN (" +
        cohort +
        ") GROUP BY ticket HAVING array_agg(author ORDER BY n)=ARRAY['Cliente','IA']::text[]) cases",
    );
  assert.equal(exact(), n);
  const audit = count(
    "SELECT count(*) FROM audit WHERE kind='Decisão da IA' AND ticket IN (" +
      cohort +
      ")",
  );
  assert.equal(audit, n);
  console.log(
    JSON.stringify({
      tickets: n,
      observedBeforeKill: before,
      orderedSingleReplies: n,
      auditedDecisions: audit,
    }),
  );
} finally {
  dc("start", "bridge", "agent");
}
