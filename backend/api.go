package main

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	_ "embed"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	_ "github.com/lib/pq"
	"log"
	"net/http"
	"net/url"
	"os"
	"slices"
	"strings"
	"time"
)

//go:embed initial.json
var initial []byte

type problem struct {
	status  int
	message string
}

func fail(status int, msg string) { panic(problem{status, msg}) }
func check(err error) {
	if err != nil {
		panic(err)
	}
}
func require(ok bool) {
	if !ok {
		fail(403, "Sem acesso.")
	}
}
func uuid() string {
	var b [16]byte
	_, err := rand.Read(b[:])
	check(err)
	b[6] = b[6]&15 | 64
	b[8] = b[8]&63 | 128
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[:4], b[4:6], b[6:8], b[8:10], b[10:])
}

type request struct {
	ctx         context.Context
	tx          *sql.Tx
	r           *http.Request
	body        object
	sid, client string
	staff       fields
}

func (q *request) exec(query string, args ...any) sql.Result {
	res, e := q.tx.ExecContext(q.ctx, query, args...)
	check(e)
	return res
}
func (q *request) rows(query string, args ...any) []object {
	rows, e := q.tx.QueryContext(q.ctx, "SELECT row_to_json(record) FROM ("+query+") record", args...)
	check(e)
	defer rows.Close()
	result := []object{}
	for rows.Next() {
		var b []byte
		check(rows.Scan(&b))
		var row object
		check(json.Unmarshal(b, &row))
		result = append(result, row)
	}
	check(rows.Err())
	return result
}
func (q *request) one(query string, args ...any) object {
	rows := q.rows(query, args...)
	if len(rows) == 0 {
		return nil
	}
	return rows[0]
}
func str(m object, k string) string { v, _ := m[k].(string); return v }
func pick(v string, allowed []string) string {
	if !slices.Contains(allowed, v) {
		fail(400, "Opção inválida.")
	}
	return v
}
func message(v string) string {
	v = strings.TrimSpace(v)
	if v == "" || len([]rune(v)) > 1500 {
		fail(400, "Digite uma mensagem de até 1.500 caracteres.")
	}
	return v
}
func sign(id string) string {
	h := hmac.New(sha256.New, []byte(os.Getenv("SESSION_SECRET")))
	h.Write([]byte(id))
	return "s:" + id + "." + base64.RawStdEncoding.EncodeToString(h.Sum(nil))
}
func (q *request) session(w http.ResponseWriter) {
	if c, e := q.r.Cookie("connect.sid"); e == nil {
		value, _ := url.PathUnescape(c.Value)
		id, _, _ := strings.Cut(strings.TrimPrefix(value, "s:"), ".")
		if hmac.Equal([]byte(value), []byte(sign(id))) {
			row := q.one("SELECT sess FROM session WHERE sid=$1 AND expire>now()", id)
			if sess, ok := row["sess"].(map[string]any); ok {
				q.sid = id
				q.client = str(sess, "client")
				if sess["staff"] != nil {
					check(json.Unmarshal([]byte(encode(sess["staff"])), &q.staff))
				}
			}
		}
	}
	if q.client != "" {
		return
	}
	q.sid = uuid()
	q.client = uuid()
	q.exec("INSERT INTO session(sid,sess,expire) VALUES($1,$2,now()+interval '12 hours')", q.sid, encode(object{"client": q.client}))
	http.SetCookie(w, &http.Cookie{Name: "connect.sid", Value: url.PathEscape(sign(q.sid)), Path: "/", HttpOnly: true, SameSite: http.SameSiteStrictMode, MaxAge: 43200})
}
func serve() {
	db, e := sql.Open("postgres", os.Getenv("DATABASE_URL")+"?sslmode=disable")
	check(e)
	defer db.Close()
	maxOpen := setting("API_DB_MAX_OPEN", 32, 256)
	db.SetMaxOpenConns(maxOpen)
	db.SetMaxIdleConns(min(maxOpen, 16))
	db.SetConnMaxIdleTime(5 * time.Minute)
	var acquire, handle, commit durationTotal
	schema, e := os.ReadFile("schema.sql")
	check(e)
	_, e = db.Exec(string(schema))
	check(e)
	_, e = db.Exec("CREATE TABLE IF NOT EXISTS session(sid varchar PRIMARY KEY,sess json NOT NULL,expire timestamp NOT NULL)")
	check(e)
	_, e = db.Exec("INSERT INTO configs(v,config) VALUES(1,$1) ON CONFLICT DO NOTHING", string(initial))
	check(e)
	handler := func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		defer func() {
			if ex := recover(); ex != nil {
				p, ok := ex.(problem)
				if !ok {
					log.Print(ex)
					p = problem{500, "Falha interna."}
				}
				w.WriteHeader(p.status)
				json.NewEncoder(w).Encode(object{"error": p.message})
			}
		}()
		q := request{ctx: r.Context(), r: r}
		if r.Method == "POST" {
			if origin := r.Header.Get("Origin"); origin != "" {
				u, e := url.Parse(origin)
				require(e == nil && u.Host == r.Host)
			}
			if e := json.NewDecoder(http.MaxBytesReader(w, r.Body, 5<<20)).Decode(&q.body); e != nil {
				fail(400, "JSON inválido.")
			}
		}
		var e error
		callback := r.URL.Path == "/internal/reply"
		start := time.Now()
		q.tx, e = db.BeginTx(r.Context(), nil)
		if callback {
			acquire.observe(start)
		}
		check(e)
		defer q.tx.Rollback()
		if strings.HasPrefix(r.URL.Path, "/api/") {
			q.session(w)
		}
		start = time.Now()
		result := q.handle()
		if callback {
			handle.observe(start)
		}
		start = time.Now()
		check(q.tx.Commit())
		if callback {
			commit.observe(start)
		}
		if r.Method == "POST" && r.URL.Path == "/api/tickets" {
			w.WriteHeader(201)
		}
		json.NewEncoder(w).Encode(result)
	}
	mux := http.NewServeMux()
	diagnostics(mux, func() object {
		return object{"pool": db.Stats(), "callbackBegin": acquire.snapshot(), "callbackHandle": handle.snapshot(), "callbackCommit": commit.snapshot()}
	})
	mux.HandleFunc("/api/", handler)
	mux.HandleFunc("/internal/", handler)
	mux.Handle("/", http.FileServer(http.Dir("public")))
	srv := http.Server{Addr: ":3000", Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	if e := srv.ListenAndServe(); !errors.Is(e, http.ErrServerClosed) {
		check(e)
	}
}
