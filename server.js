import express from "express";
import session from "express-session";
import connectPg from "connect-pg-simple";
import pg from "pg";
import { readFileSync } from "node:fs";
import { randomUUID, createHash } from "node:crypto";
import {
  brands,
  categories,
  channels,
  phases,
  priorities,
  teams,
  initial,
  validate,
  route,
  fixtures,
  classify,
} from "./domain.js";
const app = express(),
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL }),
  key = process.env.INTERNAL_KEY;
await pool.query(
  readFileSync(new URL("./schema.sql", import.meta.url), "utf8"),
);
await pool.query("INSERT INTO configs VALUES (1,$1) ON CONFLICT DO NOTHING", [
  initial,
]);
const one = async (db, q, args = []) => (await db.query(q, args)).rows[0],
  all = async (db, q, args = []) => (await db.query(q, args)).rows;
const tx = async (fn) => {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const v = await fn(db);
    await db.query("COMMIT");
    return v;
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  } finally {
    db.release();
  }
};
const err = (msg, status = 400) => {
    throw Object.assign(Error(msg), { status });
  },
  live = (db) => one(db, "SELECT * FROM configs ORDER BY v DESC LIMIT 1"),
  audit = (db, id, k, d) =>
    db.query("INSERT INTO audit(ticket,kind,detail) VALUES ($1,$2,$3)", [
      id,
      k,
      d,
    ]),
  msg = (db, id, a, b) =>
    db.query("INSERT INTO messages(ticket,author,body) VALUES ($1,$2,$3)", [
      id,
      a,
      b,
    ]);
const bodyText = (s) =>
  typeof s === "string" && s.trim().length > 0 && s.length <= 1500
    ? s.trim()
    : err("Digite uma mensagem de até 1.500 caracteres.");
const pick = (v, l) => (l.includes(v) ? v : err("Opção inválida."));
const digest = (c) =>
  createHash("sha256").update(JSON.stringify(c)).digest("hex");
app.use(express.json({ limit: "180kb" }));
app.use((r, s, n) => {
  if (
    r.method === "POST" &&
    r.headers.origin &&
    new URL(r.headers.origin).host !== r.headers.host
  )
    err("Origem inválida.", 403);
  n();
});
app.use(
  session({
    store: new (connectPg(session))({ pool, createTableIfMissing: true }),
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: "strict", maxAge: 12 * 3600000 },
  }),
);
app.use("/api", (r, s, n) => {
  r.session.client ??= randomUUID();
  s.set("Cache-Control", "no-store");
  n();
});
const staff = (r) => r.session.staff,
  ops = (r) => {
    if (staff(r)?.role !== "ops") err("Acesso da operação necessário.", 403);
  },
  analyst = (r) => {
    if (staff(r)?.role !== "analyst")
      err("Acesso de analista necessário.", 403);
    return staff(r);
  };
const accessible = (r, t) =>
  t.client === r.session.client ||
  staff(r)?.role === "ops" ||
  (staff(r)?.brand === t.brand &&
    staff(r)?.team === t.team &&
    t.phase === "Humano");
const listed =
  "SELECT t.*, COALESCE((SELECT q->>'name' FROM configs c, jsonb_array_elements(c.config->'queues') q WHERE c.v=t.version AND q->>'id'=t.queue LIMIT 1),t.queue) AS queue_name FROM tickets t";
const ticket = async (db, id, lock = false) =>
  (await one(
    db,
    (lock ? "SELECT * FROM tickets" : listed) +
      " WHERE id=$1" +
      (lock ? " FOR UPDATE" : ""),
    [id],
  )) ?? err("Atendimento não encontrado.", 404);
app.get("/api/meta", async (r, s) =>
  s.json({
    brands,
    channels,
    categories,
    priorities,
    teams,
    phases,
    staff: staff(r) || null,
  }),
);
app.post("/api/profile", (r, s) => {
  const b = r.body;
  if (b.role === "client") delete r.session.staff;
  else {
    if (b.code !== process.env.STAFF_CODE)
      err("Código de equipe inválido.", 403);
    r.session.staff =
      b.role === "ops"
        ? { role: "ops" }
        : {
            role: pick(b.role, ["analyst"]),
            brand: pick(b.brand, brands),
            team: pick(b.team, teams),
            name: bodyText(b.name).slice(0, 60),
            id: r.session.client,
          };
  }
  s.json({ ok: true });
});
async function dispatch(db, t) {
  const h = await all(
      db,
      "SELECT author,body AS text FROM messages WHERE ticket=$1 ORDER BY n",
      [t.id],
    ),
    id = randomUUID();
  await db.query("INSERT INTO outbox(id,ticket,payload) VALUES ($1,$2,$3)", [
    id,
    t.id,
    {
      id,
      ticket: t.id,
      revision: t.revision,
      category: t.category,
      brand: t.brand,
      history: h,
    },
  ]);
}
app.post("/api/tickets", async (r, s) => {
  const b = r.body,
    text = bodyText(b.text),
    category = classify(text),
    x = {
      brand: pick(b.brand, brands),
      category,
      phase: "IA",
      priority: pick(b.priority || "Normal", priorities),
    },
    channel = pick(b.channel, channels);
  s.status(201).json(
    await tx(async (db) => {
      const c = await live(db),
        d = route(c.config, x),
        id = randomUUID();
      const t = await one(
        db,
        "INSERT INTO tickets(id,client,brand,channel,category,priority,phase,status,queue,team,version,revision) VALUES ($1,$2,$3,$4,$5,$6,'IA','Aberto',$7,$8,$9,1) RETURNING *",
        [
          id,
          r.session.client,
          x.brand,
          channel,
          category,
          x.priority,
          d.queue,
          d.team,
          c.v,
        ],
      );
      await msg(db, id, "Cliente", text);
      await audit(db, id, "Triagem", { ...d, version: c.v });
      await dispatch(db, t);
      return { id };
    }),
  );
});
app.get("/api/tickets", async (r, s) => {
  const a = staff(r);
  const order =
    " ORDER BY CASE priority WHEN 'Urgente' THEN 1 WHEN 'Alta' THEN 2 ELSE 3 END, updated ASC LIMIT 250";
  s.json(
    r.query.mine === "1" || !a
      ? await all(pool, listed + " WHERE client=$1" + order, [r.session.client])
      : a.role === "ops"
        ? await all(pool, listed + order)
        : await all(
            pool,
            listed + " WHERE phase='Humano' AND brand=$1 AND team=$2" + order,
            [a.brand, a.team],
          ),
  );
});
app.get("/api/tickets/:id", async (r, s) => {
  const t = await ticket(pool, r.params.id);
  if (!accessible(r, t)) err("Sem acesso.", 403);
  s.json({
    ...t,
    messages: await all(
      pool,
      "SELECT author,body,created FROM messages WHERE ticket=$1 ORDER BY n",
      [t.id],
    ),
    audit: staff(r)
      ? await all(
          pool,
          "SELECT kind,detail,created FROM audit WHERE ticket=$1 ORDER BY n",
          [t.id],
        )
      : [],
  });
});
app.post("/api/tickets/:id/action", async (r, s) => {
  s.json(
    await tx(async (db) => {
      const t = await ticket(db, r.params.id, true),
        { action, text } = r.body,
        a = staff(r);
      if (!accessible(r, t)) err("Sem acesso.", 403);
      if (t.status === "Encerrado") err("Caso já encerrado.", 409);
      if (action === "client") {
        if (t.client !== r.session.client) err("Sem acesso.", 403);
        await msg(db, t.id, "Cliente", bodyText(text));
        const u = await one(
          db,
          "UPDATE tickets SET revision=revision+1,updated=now() WHERE id=$1 RETURNING *",
          [t.id],
        );
        if (u.phase === "IA") await dispatch(db, u);
      } else {
        analyst(r);
        if (t.phase !== "Humano" || t.brand !== a.brand || t.team !== a.team)
          err("Fora da sua fila.", 403);
        if (action === "claim") {
          if (t.owner && t.owner !== a.id) err("Outro analista assumiu.", 409);
          await db.query(
            "UPDATE tickets SET owner=$2,status='Em atendimento',updated=now() WHERE id=$1",
            [t.id, a.id],
          );
          await audit(db, t.id, "Caso assumido", { analista: a.name });
        } else {
          if (t.owner !== a.id) err("Assuma o caso primeiro.", 409);
          if (action === "reply") {
            await msg(db, t.id, a.name, bodyText(text));
            await db.query("UPDATE tickets SET updated=now() WHERE id=$1", [
              t.id,
            ]);
          } else if (action === "close") {
            await db.query(
              "UPDATE tickets SET status='Encerrado',updated=now() WHERE id=$1",
              [t.id],
            );
            await audit(db, t.id, "Encerramento", { analista: a.name });
          } else err("Ação inválida.");
        }
      }
      return { ok: true };
    }),
  );
});
app.post("/internal/reply", async (r, s) => {
  if (r.get("x-internal-key") !== key) err("Sem acesso.", 403);
  const e = r.body;
  s.json(
    await tx(async (db) => {
      const t = await ticket(db, e.ticket, true);
      const newEvent = await one(
        db,
        "INSERT INTO inbox VALUES ($1) ON CONFLICT DO NOTHING RETURNING id",
        [e.id],
      );
      if (!newEvent) return { duplicate: true };
      if (
        t.phase !== "IA" ||
        t.status === "Encerrado" ||
        t.revision !== e.revision
      ) {
        await audit(db, t.id, "Retorno obsoleto ignorado", { event: e.id });
        return { stale: true };
      }
      await msg(db, t.id, "IA", e.text);
      if (e.type === "handoff") {
        const c = await live(db),
          d = route(c.config, { ...t, phase: "Humano" });
        await db.query(
          "UPDATE tickets SET phase='Humano',status='Aguardando analista',queue=$2,team=$3,summary=$4,motive=$5,version=$6,updated=now() WHERE id=$1",
          [t.id, d.queue, d.team, e.summary, e.motive, c.v],
        );
        await audit(db, t.id, "Transferência humana", {
          ...d,
          version: c.v,
          event: e.id,
          motivo: e.motive,
        });
      } else {
        await db.query(
          "UPDATE tickets SET updated=now(),status=$2 WHERE id=$1",
          [t.id, e.type === "close" ? "Encerrado" : "Aberto"],
        );
        await audit(db, t.id, "Decisão da IA", { acao: e.type, event: e.id });
      }
      return { ok: true };
    }),
  );
});
app.get("/api/config", async (r, s) => {
  ops(r);
  const c = await live(pool),
    d = await one(pool, "SELECT * FROM drafts WHERE id=1");
  s.json({ version: c.v, active: c.config, draft: d?.config ?? c.config });
});
app.post("/api/draft", async (r, s) => {
  ops(r);
  const { config, base } = r.body;
  try {
    validate(config);
  } catch (e) {
    err(e.message);
  }
  s.json(
    await tx(async (db) => {
      await db.query("SELECT pg_advisory_xact_lock(781)");
      if ((await live(db)).v !== base) err("Versão mudou. Recarregue.", 409);
      await db.query(
        "INSERT INTO drafts VALUES(1,$1,$2) ON CONFLICT(id) DO UPDATE SET base=$1,config=$2",
        [base, config],
      );
      return { ok: true };
    }),
  );
});
app.post("/api/simulate", async (r, s) => {
  ops(r);
  const c = await live(pool),
    d = await one(pool, "SELECT * FROM drafts WHERE id=1");
  if (!d || d.base !== c.v) err("Salve o rascunho antes.");
  s.json({
    base: c.v,
    hash: digest(d.config),
    rows: fixtures.map((x) => ({
      ...x,
      before: route(c.config, x),
      after: route(d.config, x),
    })),
  });
});
app.post("/api/publish", async (r, s) => {
  ops(r);
  s.json(
    await tx(async (db) => {
      await db.query("SELECT pg_advisory_xact_lock(781)");
      const c = await live(db),
        d = await one(db, "SELECT * FROM drafts WHERE id=1");
      if (
        !d ||
        d.base !== c.v ||
        r.body.base !== c.v ||
        r.body.hash !== digest(d.config)
      )
        err("Prévia desatualizada. Simule de novo.", 409);
      await db.query("INSERT INTO configs(v,config) VALUES($1,$2)", [
        c.v + 1,
        d.config,
      ]);
      await db.query("DELETE FROM drafts");
      await audit(db, null, "Publicação", { version: c.v + 1 });
      return { version: c.v + 1 };
    }),
  );
});
app.get("/api/metrics", async (r, s) => {
  ops(r);
  s.json(
    await one(
      pool,
      "SELECT (SELECT count(*) FROM tickets) AS tickets,(SELECT count(*) FROM outbox WHERE state='pending') AS pending,(SELECT count(*) FROM outbox WHERE state='failed') AS failed,(SELECT count(*) FROM inbox) AS received,(SELECT count(*) FROM audit WHERE kind='Transferência humana') AS handoffs",
    ),
  );
});
app.get("/api/health", async (r, s) => {
  await pool.query("SELECT 1");
  s.json({ ok: true });
});
app.use(express.static("public"));
app.use((e, r, s, n) => {
  if (!e.status) console.error(e.message);
  s.status(e.status || 500).json({
    error: e.status ? e.message : "Falha interna.",
  });
});
app.listen(3000);
async function pump() {
  try {
    await tx(async (db) => {
      const row = await one(
        db,
        "SELECT * FROM outbox WHERE state='pending' AND due<=now() ORDER BY due LIMIT 1 FOR UPDATE SKIP LOCKED",
      );
      if (!row) return;
      try {
        const res = await fetch(process.env.BROKER_URL + "/webhook", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-internal-key": key,
          },
          body: JSON.stringify(row.payload),
          signal: AbortSignal.timeout(4000),
        });
        if (!res.ok) throw Error("HTTP " + res.status);
        await db.query("UPDATE outbox SET state='sent' WHERE id=$1", [row.id]);
      } catch (e) {
        await db.query(
          "UPDATE outbox SET tries=tries+1,state=CASE WHEN tries>=9 THEN 'failed' ELSE 'pending' END,due=now()+ $2 * interval '1 second' WHERE id=$1",
          [row.id, Math.min(30, 2 ** row.tries)],
        );
        await audit(db, row.ticket, "Falha de entrega", {
          event: row.id,
          tentativa: row.tries + 1,
          erro: e.message,
        });
      }
    });
  } catch (e) {
    console.error(e.message);
  }
  setTimeout(pump, 70);
}
pump();
