// Independent read-only integrity check after the sustained policy run.
import { execFileSync } from "node:child_process";
import { writeFileSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
const project = "central-policy-capacity";
const dc = (...args) =>
  execFileSync("docker", ["compose", "-p", project, ...args], {
    encoding: "utf8",
  }).trim();
assert.equal(dc("port", "web", "3000"), "127.0.0.1:4398");
const sql = (q) =>
  JSON.parse(
    dc(
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
      q,
    ),
  );
const database = sql(
  `SELECT json_build_object('tickets',(SELECT count(*) FROM tickets),'closed',(SELECT count(*) FROM tickets WHERE status='Encerrado'),'wrongPriority',(SELECT count(*) FROM tickets WHERE priority <> CASE WHEN phase='Humano' AND brand='InfinitePay' THEN 'Urgente' WHEN phase='Humano' THEN 'Alta' ELSE 'Normal' END),'pendingOutbox',(SELECT count(*) FROM outbox WHERE state='pending'),'failedOutbox',(SELECT count(*) FROM outbox WHERE state='failed'),'missingCallback',(SELECT count(*) FROM outbox o LEFT JOIN inbox i ON i.id=o.id WHERE i.id IS NULL),'sent',(SELECT count(*) FROM outbox WHERE state='sent'),'human',(SELECT count(*) FROM tickets WHERE phase='Humano'),'assignments',(SELECT count(*) FROM audit WHERE kind='Caso assumido'),'assignedTickets',(SELECT count(DISTINCT ticket) FROM audit WHERE kind='Caso assumido'),'publications',(SELECT count(*) FROM audit WHERE kind='Publicação'),'publicationActor',(SELECT detail->'actor'->>'id' FROM audit WHERE kind='Publicação' LIMIT 1))`,
);
assert.equal(database.tickets, 120000);
assert.equal(database.closed, 120000);
assert.equal(database.wrongPriority, 0);
assert.equal(database.sent, 240000);
assert.equal(database.human, 24000);
assert.equal(database.assignments, 24000);
assert.equal(database.assignedTickets, 24000);
assert.equal(database.publications, 1);
assert.equal(database.publicationActor, "ops-ana");
for (const k of ["pendingOutbox", "failedOutbox", "missingCallback"])
  assert.equal(database[k], 0);
const lag = {};
for (const role of ["agent", "bridge"]) {
  const text = dc(
    "exec",
    "-T",
    "kafka",
    "rpk",
    "group",
    "describe",
    "central-" + role + "-v1",
  );
  lag[role] = Number(text.match(/^TOTAL-LAG\s+(\d+)/m)?.[1] ?? NaN);
  assert.equal(lag[role], 0);
}
const topics = JSON.parse(
  dc(
    "exec",
    "-T",
    "kafka",
    "rpk",
    "topic",
    "describe",
    "desk.failed",
    "-p",
    "--format",
    "json",
  ),
);
const failedTopicOffsets = topics[0].partitions.map(
  ({ partition, log_start_offset, high_watermark }) => ({
    partition,
    log_start_offset,
    high_watermark,
  }),
);
assert.equal(failedTopicOffsets.length, 3);
assert(failedTopicOffsets.every((p) => p.high_watermark === 0));
const sources = {};
for (const path of [
  "backend/rules.go",
  "backend/policy.go",
  "backend/handlers.go",
  "schema.sql",
])
  sources[path] = createHash("sha256").update(readFileSync(path)).digest("hex");
const snapshot = {
  date: new Date().toISOString(),
  pass: true,
  database,
  lag,
  failedTopicOffsets,
  sourceSHA256: sources,
};
writeFileSync(
  "results/policy-capacity-snapshot.json",
  JSON.stringify(snapshot, null, 2) + "\n",
);
console.log(snapshot);
