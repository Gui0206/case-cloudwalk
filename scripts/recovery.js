// Ferramenta de operação: execute no contêiner web, dentro da rede privada.
import pg from "pg";
import { Kafka, logLevel } from "kafkajs";
const [mode, arg] = process.argv.slice(2);
if (mode === "outbox") {
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  console.table(
    (
      await db.query(
        "SELECT id,ticket,tries FROM outbox WHERE state='failed' ORDER BY due LIMIT 100",
      )
    ).rows,
  );
  await db.end();
} else if (mode === "retry-outbox") {
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  console.log(
    "Eventos recolocados:",
    (
      await db.query(
        "UPDATE outbox SET state='pending',tries=0,due=now() WHERE state='failed' AND id=$1",
        [arg],
      )
    ).rowCount,
  );
  await db.end();
} else if (mode === "retry-dlq") {
  // Passe um registro JSON da desk.failed no stdin.
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  const item = JSON.parse(raw);
  if (!["desk.requests", "desk.responses"].includes(item.topic))
    throw Error("Tópico inválido");
  const e = JSON.parse(item.raw);
  const p = new Kafka({
    brokers: process.env.KAFKA_BROKERS.split(","),
    logLevel: logLevel.ERROR,
  }).producer();
  await p.connect();
  await p.send({
    topic: item.topic,
    messages: [{ key: e.ticket, value: item.raw }],
  });
  await p.disconnect();
  console.log("Reenviado:", e.id);
} else
  throw Error("Use outbox, retry-outbox UUID ou retry-dlq < registro.json");
