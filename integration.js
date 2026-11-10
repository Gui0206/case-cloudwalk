import express from "express";
import { Kafka, logLevel } from "kafkajs";
import { mock } from "./domain.js";
const role = process.argv[2],
  topics = ["desk.requests", "desk.responses", "desk.failed"],
  k = new Kafka({
    clientId: "central-" + role,
    brokers: process.env.KAFKA_BROKERS.split(","),
    logLevel: logLevel.ERROR,
    retry: { retries: 8 },
  }),
  admin = k.admin();
await admin.connect();
const existing = await admin.listTopics();
const missing = topics.filter((t) => !existing.includes(t));
if (role === "bridge" && missing.length)
  await admin.createTopics({
    waitForLeaders: true,
    topics: missing.map((topic) => ({
      topic,
      numPartitions: 3,
      replicationFactor: 1,
    })),
  });
if (role === "agent")
  while (!(await admin.listTopics()).includes(topics[0]))
    await new Promise((r) => setTimeout(r, 300));
await admin.disconnect();
const p = k.producer();
await p.connect();
const send = (topic, key, data) =>
  p.send({ topic, acks: -1, messages: [{ key, value: JSON.stringify(data) }] });
const secret = process.env.INTERNAL_KEY;
if (role === "bridge") {
  const a = express();
  a.use(express.json({ limit: "5mb" }));
  a.post("/webhook", async (r, s) => {
    if (r.get("x-internal-key") !== secret) return s.sendStatus(403);
    await send(topics[0], r.body.ticket, r.body);
    s.sendStatus(202);
  });
  a.listen(3001);
}
const topic = role === "agent" ? topics[0] : topics[1],
  c = k.consumer({ groupId: "central-" + role + "-v1" });
process.once("SIGTERM", async () => {
  await c.disconnect();
  await p.disconnect();
  process.exit(0);
});
await c.connect();
await c.subscribe({ topic, fromBeginning: true });
await c.run({
  eachMessage: async ({ message, partition }) => {
    let error;
    for (let i = 0; i < 4; i++) {
      try {
        const e = JSON.parse(message.value);
        if (role === "agent") {
          await send(topics[1], e.ticket, {
            id: e.id,
            ticket: e.ticket,
            revision: e.revision,
            ...mock(e),
          });
        } else {
          const r = await fetch(process.env.APP_URL + "/internal/reply", {
            method: "POST",
            headers: {
              "x-internal-key": secret,
              "content-type": "application/json",
            },
            body: JSON.stringify(e),
            signal: AbortSignal.timeout(3500),
          });
          if (!r.ok) throw Error("HTTP " + r.status);
        }
        return;
      } catch (e) {
        error = e.message;
        await new Promise((r) => setTimeout(r, 250 * 2 ** i));
      }
    }
    await send(topics[2], message.key?.toString(), {
      topic,
      partition,
      offset: message.offset,
      error,
      raw: message.value.toString(),
    });
    console.error(
      "Enviado a desk.failed",
      topic,
      partition,
      message.offset,
      error,
    );
  },
});
