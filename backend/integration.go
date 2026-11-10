package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/segmentio/kafka-go"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

const requests = "desk.requests"
const responses = "desk.responses"
const failed = "desk.failed"

func mockReply(e object) (object, error) {
	var history []fields
	if err := json.Unmarshal([]byte(encode(e["history"])), &history); err != nil || len(history) == 0 {
		return nil, errors.New("histórico inválido")
	}
	last := history[len(history)-1]["text"]
	category := str(e, "category")
	asked := contains(last, "human", "analista", "atendente")
	closed := contains(last, "resolvido", "obrigad", "funcionou") && !contains(last, "não", "nao")
	prior := false
	for _, m := range history {
		if m["author"] == "IA" {
			prior = true
		}
	}
	out := object{"id": e["id"], "ticket": e["ticket"], "revision": e["revision"]}
	switch {
	case asked || contains(last, "diverg", "não resolveu") || (!closed && prior && (category == "Repasse" || category == "Maquininha")):
		out["type"] = "handoff"
		out["text"] = "Vou encaminhar seu caso à equipe com o histórico da conversa."
		out["summary"] = "Assunto: " + category + ". Relato inicial: " + history[0]["text"] + ". Última informação: " + last
		out["motive"] = "Análise do caso pela equipe"
		if asked {
			out["motive"] = "Solicitação do cliente"
		}
	case closed:
		out["type"] = "close"
		out["text"] = "Que bom que deu certo. Atendimento encerrado."
	default:
		out["type"] = "reply"
		out["text"] = fields{"Repasse": "Para conferir a divergência simulada, qual é o identificador fictício da venda?", "Maquininha": "Qual erro aparece na tela da maquininha simulada?", "Pix": "No app simulado, abra Pix → Histórico para consultar o status. Conseguiu localizar?", "Outros": "Conte um pouco mais. Se precisar da equipe, escreva “falar com humano”."}[category]
	}
	return out, nil
}
func integration(role string) {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	broker := os.Getenv("KAFKA_BROKERS")
	topic := requests
	writer := kafka.Writer{Addr: kafka.TCP(broker), Balancer: &kafka.Murmur2Balancer{}, RequiredAcks: kafka.RequireAll, BatchSize: 1}
	defer writer.Close()
	publish := func(ctx context.Context, topic string, key, value []byte) error {
		return writer.WriteMessages(ctx, kafka.Message{Topic: topic, Key: key, Value: value})
	}
	if role == "bridge" {
		topic = responses
		conn, err := kafka.Dial("tcp", broker)
		check(err)
		for _, t := range []string{requests, responses, failed} {
			check(conn.CreateTopics(kafka.TopicConfig{Topic: t, NumPartitions: 3, ReplicationFactor: 1}))
		}
		conn.Close()
		mux := http.NewServeMux()
		mux.HandleFunc("POST /webhook", func(w http.ResponseWriter, r *http.Request) {
			if r.Header.Get("x-internal-key") != os.Getenv("INTERNAL_KEY") {
				http.Error(w, "forbidden", 403)
				return
			}
			var e object
			if json.NewDecoder(http.MaxBytesReader(w, r.Body, 5<<20)).Decode(&e) != nil || str(e, "ticket") == "" {
				http.Error(w, "invalid event", 400)
				return
			}
			if err := publish(r.Context(), requests, []byte(str(e, "ticket")), []byte(encode(e))); err != nil {
				http.Error(w, "publish failed", 503)
				return
			}
			w.WriteHeader(202)
		})
		srv := http.Server{Addr: ":3001", Handler: mux, ReadHeaderTimeout: 5 * time.Second}
		go func() {
			if err := srv.ListenAndServe(); !errors.Is(err, http.ErrServerClosed) {
				log.Print(err)
				stop()
			}
		}()
		defer srv.Close()
	}
	reader := kafka.NewReader(kafka.ReaderConfig{Brokers: []string{broker}, Topic: topic, GroupID: "central-" + role + "-v1", StartOffset: kafka.FirstOffset, MaxWait: 150 * time.Millisecond})
	defer reader.Close()
	client := http.Client{Timeout: 3500 * time.Millisecond}
	process := func(m kafka.Message) error {
		var e object
		if err := json.Unmarshal(m.Value, &e); err != nil {
			return err
		}
		if role == "agent" {
			reply, err := mockReply(e)
			if err != nil {
				return err
			}
			return publish(ctx, responses, m.Key, []byte(encode(reply)))
		}
		req, err := http.NewRequestWithContext(ctx, "POST", os.Getenv("APP_URL")+"/internal/reply", bytes.NewReader(m.Value))
		if err != nil {
			return err
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("x-internal-key", os.Getenv("INTERNAL_KEY"))
		res, err := client.Do(req)
		if err != nil {
			return err
		}
		defer res.Body.Close()
		if res.StatusCode/100 != 2 {
			return fmt.Errorf("HTTP %d", res.StatusCode)
		}
		return nil
	}
	for ctx.Err() == nil {
		m, err := reader.FetchMessage(ctx)
		if ctx.Err() != nil {
			return
		}
		check(err)
		for attempt := 0; attempt < 4; attempt++ {
			err = process(m)
			if err == nil {
				break
			}
			select {
			case <-ctx.Done():
				return
			case <-time.After(250 * time.Millisecond << attempt):
			}
		}
		if err != nil {
			check(publish(ctx, failed, m.Key, []byte(encode(object{"topic": topic, "partition": m.Partition, "offset": fmt.Sprint(m.Offset), "error": err.Error(), "raw": string(m.Value)}))))
		}
		check(reader.CommitMessages(ctx, m))
	}
}
func main() {
	if len(os.Args) == 1 {
		serve()
		return
	}
	switch os.Args[1] {
	case "agent", "bridge":
		integration(os.Args[1])
	default:
		log.Fatal("perfil desconhecido")
	}
}
