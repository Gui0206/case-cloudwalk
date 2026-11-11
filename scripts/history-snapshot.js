// Run after mixed.js and before stopping the isolated stack.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const project = process.env.MIXED_PROJECT;
assert.ok(["central-history-empty", "central-history-aged"].includes(project));
const compose = (...args) =>
  execFileSync("docker", ["compose", "-p", project, "exec", "-T", ...args], {
    encoding: "utf8",
  });
const query = (sql) =>
  JSON.parse(compose("db", "psql", "-XAt", "-U", "helpdesk", "-c", sql));
const topics = JSON.parse(
  compose(
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
assert.equal(topics[0].partitions.length, 3);
const offsets = topics[0].partitions.map(
  ({ partition, log_start_offset, high_watermark }) => ({
    partition,
    log_start_offset,
    high_watermark,
  }),
);
const database =
  query(`SELECT json_build_object('archiveTickets',count(*),'oldest',min(updated),'newest',max(updated),
  'databaseBytesAfterRun',pg_database_size(current_database())) FROM tickets WHERE client LIKE 'archive-%'`);
const plan =
  query(`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT id,priority,updated FROM tickets
  WHERE phase='Humano' AND brand='InfinitePay' AND team='Atendimento' AND status IN ('Aguardando analista','Em atendimento')
  ORDER BY CASE priority WHEN 'Urgente' THEN 1 WHEN 'Alta' THEN 2 ELSE 3 END,updated,id LIMIT 250`);
writeFileSync(
  "results/" + project + "-snapshot.json",
  JSON.stringify(
    { database, failedTopicOffsets: offsets, queuePlanAfterDrain: plan },
    null,
    2,
  ) + "\n",
);
