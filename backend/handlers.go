package main

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"os"
	"strconv"
	"strings"
)

var ok = object{"ok": true}

func (q *request) handle() any {
	b := q.body
	path := q.r.Method + " " + q.r.URL.Path
	switch path {
	case "GET /api/meta":
		return object{"brands": brands, "channels": channels, "teams": teams, "staff": q.staff, "phases": phases, "categories": categories, "priorities": priorities}
	case "GET /api/health":
		return ok
	case "POST /api/profile":
		role := pick(str(b, "role"), []string{"client", "ops", "analyst"})
		q.staff = nil
		if role != "client" {
			require(str(b, "code") == os.Getenv("STAFF_CODE"))
			q.staff = fields{"role": role}
			if role == "analyst" {
				q.staff = fields{"role": role, "name": message(str(b, "name")), "id": q.client, "team": pick(str(b, "team"), teams), "brand": pick(str(b, "brand"), brands)}
			}
		}
		q.exec("UPDATE session SET sess=$2 WHERE sid=$1", q.sid, encode(object{"client": q.client, "staff": q.staff}))
		return ok
	case "POST /api/tickets":
		return q.create()
	case "GET /api/tickets":
		order := " ORDER BY CASE priority WHEN 'Urgente' THEN 1 WHEN 'Alta' THEN 2 ELSE 3 END,updated LIMIT 250"
		if q.staff == nil || q.r.URL.Query().Get("mine") == "1" {
			return q.rows(listed+" WHERE client=$1"+order, q.client)
		}
		if q.staff["role"] == "ops" {
			return q.rows(listed + order)
		}
		offset := 0
		if raw := q.r.URL.Query().Get("offset"); raw != "" {
			n, err := strconv.Atoi(raw)
			if err != nil || n < 0 || n > 10000000 {
				fail(400, "Página inválida.")
			}
			offset = n
		}
		state := "status IN ('Aguardando analista','Em atendimento')"
		if q.r.URL.Query().Get("closed") == "1" {
			state = "status='Encerrado'"
		}
		return q.rows(listed+" WHERE phase='Humano' AND brand=$1 AND team=$2 AND "+state+
			" ORDER BY CASE priority WHEN 'Urgente' THEN 1 WHEN 'Alta' THEN 2 ELSE 3 END,updated,id LIMIT 250 OFFSET $3",
			q.staff["brand"], q.staff["team"], offset)
	case "POST /internal/reply":
		return q.callback()
	}
	if strings.HasPrefix(q.r.URL.Path, "/api/tickets/") {
		parts := strings.Split(strings.TrimPrefix(q.r.URL.Path, "/api/tickets/"), "/")
		if len(parts) == 1 && q.r.Method == "GET" {
			return q.detail(parts[0])
		}
		if len(parts) == 2 && parts[1] == "status" && q.r.Method == "GET" {
			return q.status(parts[0])
		}
		if len(parts) == 2 && parts[1] == "action" && q.r.Method == "POST" {
			return q.action(parts[0])
		}
		fail(404, "Rota inexistente.")
	}
	require(q.staff["role"] == "ops")
	if path == "GET /api/metrics" {
		return q.one("SELECT (SELECT count(*) FROM tickets) tickets,(SELECT count(*) FROM outbox WHERE state='pending') pending,(SELECT count(*) FROM outbox WHERE state='failed') failed,(SELECT count(*) FROM inbox) received,(SELECT count(*) FROM audit WHERE kind='Transferência humana') handoffs")
	}
	q.exec("SELECT pg_advisory_xact_lock(781)")
	active := q.active()
	draft := q.one("SELECT * FROM drafts WHERE id=1")
	switch path {
	case "GET /api/config":
		c := active["config"]
		if draft != nil {
			c = draft["config"]
		}
		return object{"active": active["config"], "draft": c, "version": active["v"]}
	case "POST /api/draft":
		var c Config
		if e := json.Unmarshal([]byte(encode(b["config"])), &c); e != nil {
			fail(400, "Configuração inválida.")
		}
		if e := c.validate(); e != nil {
			fail(400, e.Error())
		}
		if b["base"] != active["v"] {
			fail(409, "Versão mudou. Recarregue.")
		}
		q.exec("INSERT INTO drafts VALUES(1,$1,$2) ON CONFLICT(id) DO UPDATE SET base=$1,config=$2", active["v"], encode(c))
		return ok
	case "POST /api/simulate", "POST /api/publish":
		if draft == nil || draft["base"] != active["v"] {
			fail(409, "Salve e simule o rascunho.")
		}
		hash := fmt.Sprintf("%x", sha256.Sum256([]byte(encode(draft["config"]))))
		if path == "POST /api/publish" {
			if b["hash"] != hash || b["base"] != active["v"] {
				fail(409, "Prévia desatualizada. Simule de novo.")
			}
			v := int(active["v"].(float64)) + 1
			q.exec("INSERT INTO configs(v,config) VALUES($1,$2)", v, encode(draft["config"]))
			q.exec("DELETE FROM drafts")
			q.audit(nil, "Publicação", object{"version": v})
			return object{"version": v}
		}
		before, after := configuration(active), configuration(draft)
		rows := []object{}
		for _, brand := range brands {
			for _, cat := range categories {
				for _, phase := range phases {
					for _, p := range priorities {
						x := fields{"brand": brand, "category": cat, "phase": phase, "priority": p}
						rows = append(rows, object{"brand": brand, "category": cat, "phase": phase, "priority": p, "before": before.route(x), "after": after.route(x)})
					}
				}
			}
		}
		return object{"base": active["v"], "hash": hash, "rows": rows}
	}
	fail(404, "Rota inexistente.")
	return nil
}

const listed = "SELECT t.*,coalesce((SELECT q->>'name' FROM configs c,jsonb_array_elements(c.config->'queues') q WHERE c.v=t.version AND q->>'id'=t.queue LIMIT 1),t.queue) queue_name FROM tickets t"

func (q *request) active() object { return q.one("SELECT * FROM configs ORDER BY v DESC LIMIT 1") }
func configuration(row object) Config {
	var c Config
	check(json.Unmarshal([]byte(encode(row["config"])), &c))
	return c
}
func (q *request) audit(id any, kind string, detail any) {
	q.exec("INSERT INTO audit(ticket,kind,detail) VALUES($1,$2,$3)", id, kind, encode(detail))
}
func (q *request) msg(id any, author, body string) {
	q.exec("INSERT INTO messages(ticket,author,body) VALUES($1,$2,$3)", id, author, body)
}
func (q *request) dispatch(t object) {
	h := q.rows("SELECT author,body AS text FROM messages WHERE ticket=$1 ORDER BY n", t["id"])
	id := uuid()
	q.exec("INSERT INTO outbox(id,ticket,payload) VALUES($1,$2,$3)", id, t["id"], encode(object{"id": id, "ticket": t["id"], "revision": t["revision"], "brand": t["brand"], "category": t["category"], "history": h}))
}
func (q *request) create() any {
	b := q.body
	text := message(str(b, "text"))
	priority := str(b, "priority")
	if priority == "" {
		priority = "Normal"
	}
	x := fields{"brand": pick(str(b, "brand"), brands), "category": classify(text), "phase": "IA", "priority": pick(priority, priorities)}
	a := q.active()
	d := configuration(a).route(x)
	id := uuid()
	q.exec("INSERT INTO tickets(id,client,brand,channel,category,priority,phase,status,queue,team,version,revision) VALUES($1,$2,$3,$4,$5,$6,'IA','Aberto',$7,$8,$9,1)", id, q.client, x["brand"], pick(str(b, "channel"), channels), x["category"], priority, d["queue"], d["team"], a["v"])
	q.msg(id, "Cliente", text)
	detail := object{"version": a["v"]}
	for k, v := range d {
		detail[k] = v
	}
	q.audit(id, "Triagem", detail)
	q.dispatch(q.ticket(id, true))
	return object{"id": id}
}
func (q *request) ticket(id string, lock bool) object {
	sql := listed + " WHERE t.id=$1"
	if lock {
		sql = "SELECT * FROM tickets WHERE id=$1 FOR UPDATE"
	}
	row := q.one(sql, id)
	if row == nil {
		fail(404, "Atendimento não encontrado.")
	}
	return row
}
func (q *request) team(t object) bool {
	return q.staff["role"] == "analyst" && t["phase"] == "Humano" && q.staff["team"] == t["team"] && q.staff["brand"] == t["brand"]
}
func (q *request) detail(id string) object {
	t := q.ticket(id, false)
	require(t["client"] == q.client || q.staff["role"] == "ops" || q.team(t))
	t["messages"] = q.rows("SELECT author,body,created FROM messages WHERE ticket=$1 ORDER BY n", id)
	t["audit"] = []object{}
	if q.staff != nil {
		t["audit"] = q.rows("SELECT kind,detail,created FROM audit WHERE ticket=$1 ORDER BY n", id)
	}
	return t
}
func (q *request) status(id string) object {
	audit := "'0'::text"
	if q.staff != nil {
		audit = "coalesce((SELECT n::text FROM audit WHERE ticket=t.id ORDER BY n DESC LIMIT 1),'0')"
	}
	t := q.one("SELECT t.id,t.client,t.brand,t.team,t.phase,t.status,t.owner,t.revision,t.updated,"+
		"coalesce(m.n::text,'0') AS message_id,coalesce(m.author,'') AS last_author,"+audit+" AS audit_id "+
		"FROM tickets t LEFT JOIN LATERAL (SELECT n,author FROM messages WHERE ticket=t.id ORDER BY n DESC LIMIT 1) m ON true WHERE t.id=$1", id)
	if t == nil {
		fail(404, "Atendimento não encontrado.")
	}
	require(t["client"] == q.client || q.staff["role"] == "ops" || q.team(t))
	delete(t, "client")
	return t
}
func (q *request) action(id string) any {
	t := q.ticket(id, true)
	action := str(q.body, "action")
	if action == "client" {
		require(t["client"] == q.client)
	} else {
		require(q.team(t))
	}
	if t["status"] == "Encerrado" {
		fail(409, "Caso já encerrado.")
	}
	switch action {
	case "client":
		q.msg(id, "Cliente", message(str(q.body, "text")))
		q.exec("UPDATE tickets SET revision=revision+1,updated=now() WHERE id=$1", id)
		if t["phase"] == "IA" {
			q.dispatch(q.ticket(id, true))
		}
	case "claim":
		if t["owner"] != nil && t["owner"] != q.client {
			fail(409, "Outro analista assumiu.")
		}
		q.exec("UPDATE tickets SET owner=$2,status='Em atendimento',updated=now() WHERE id=$1", id, q.client)
		q.audit(id, "Caso assumido", fields{"analista": q.staff["name"]})
	case "close", "reply":
		if t["owner"] != q.client {
			fail(409, "Assuma o caso primeiro.")
		}
		if action == "reply" {
			q.msg(id, q.staff["name"], message(str(q.body, "text")))
			q.exec("UPDATE tickets SET updated=now() WHERE id=$1", id)
		} else {
			q.exec("UPDATE tickets SET status='Encerrado',updated=now() WHERE id=$1", id)
			q.audit(id, "Encerramento", fields{"analista": q.staff["name"]})
		}
	default:
		fail(400, "Ação inválida.")
	}
	return ok
}
func (q *request) callback() any {
	require(q.r.Header.Get("x-internal-key") == os.Getenv("INTERNAL_KEY"))
	e := q.body
	id := str(e, "ticket")
	t := q.ticket(id, true)
	n, err := q.exec("INSERT INTO inbox(id) VALUES($1) ON CONFLICT DO NOTHING", e["id"]).RowsAffected()
	check(err)
	if n == 0 {
		return object{"duplicate": true}
	}
	if t["phase"] != "IA" || t["status"] == "Encerrado" || t["revision"] != e["revision"] {
		q.audit(id, "Retorno obsoleto ignorado", object{"event": e["id"]})
		return object{"stale": true}
	}
	if e["type"] == "handoff" {
		a := q.active()
		d := configuration(a).route(fields{"phase": "Humano", "brand": str(t, "brand"), "category": str(t, "category"), "priority": str(t, "priority")})
		detail := object{"version": a["v"], "event": e["id"], "motivo": e["motive"]}
		for k, v := range d {
			detail[k] = v
		}
		q.exec(`WITH message AS (
			INSERT INTO messages(ticket,author,body) VALUES($1,'IA',$7)
		), trace AS (
			INSERT INTO audit(ticket,kind,detail) VALUES($1,'Transferência humana',$8)
		)
		UPDATE tickets SET phase='Humano',status='Aguardando analista',queue=$2,team=$3,
			summary=$4,motive=$5,version=$6,updated=now() WHERE id=$1`,
			id, d["queue"], d["team"], e["summary"], e["motive"], a["v"], str(e, "text"), encode(detail))
	} else {
		status := "Aberto"
		if e["type"] == "close" {
			status = "Encerrado"
		}
		q.exec(`WITH message AS (
			INSERT INTO messages(ticket,author,body) VALUES($1,'IA',$3)
		), trace AS (
			INSERT INTO audit(ticket,kind,detail) VALUES($1,'Decisão da IA',$4)
		)
		UPDATE tickets SET status=$2,updated=now() WHERE id=$1`,
			id, status, str(e, "text"), encode(object{"event": e["id"], "acao": e["type"]}))
	}
	return ok
}
