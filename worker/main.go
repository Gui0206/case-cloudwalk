package main

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"fmt"
	_ "github.com/lib/pq"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"sync"
	"syscall"
	"time"
)

var client = &http.Client{Timeout: 4 * time.Second}

func deliver(ctx context.Context, payload []byte) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, os.Getenv("BROKER_URL")+"/webhook", bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Internal-Key", os.Getenv("INTERNAL_KEY"))
	res, err := client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode/100 != 2 {
		return fmt.Errorf("webhook HTTP %d", res.StatusCode)
	}
	return nil
}

func dispatch(ctx context.Context, db *sql.DB) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var id, ticket string
	var payload []byte
	var tries int
	err = tx.QueryRowContext(ctx, `SELECT id,ticket,payload,tries FROM outbox
 WHERE state='pending' AND due<=now() ORDER BY due,id LIMIT 1 FOR UPDATE SKIP LOCKED`).Scan(&id, &ticket, &payload, &tries)
	if err != nil {
		return err
	}
	if failure := deliver(ctx, payload); failure != nil {
		_, err = tx.ExecContext(ctx, `UPDATE outbox SET tries=tries+1,state=CASE WHEN tries>=9 THEN 'failed' ELSE 'pending' END,
  due=now()+ $2 * interval '1 second' WHERE id=$1`, id, min(30, 1<<tries))
		if err != nil {
			return err
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO audit(ticket,kind,detail) VALUES ($1,'Falha de entrega',
  jsonb_build_object('event',$2::text,'tentativa',$3::int,'erro',$4::text))`, ticket, id, tries+1, failure.Error())
	} else {
		_, err = tx.ExecContext(ctx, "UPDATE outbox SET state='sent' WHERE id=$1", id)
	}
	if err != nil {
		return err
	}
	return tx.Commit()
}

func main() {
	count, err := strconv.Atoi(os.Getenv("WORKERS"))
	if err != nil || count < 1 || count > 64 {
		log.Fatal("WORKERS deve estar entre 1 e 64")
	}
	db, err := sql.Open("postgres", os.Getenv("DATABASE_URL")+"?sslmode=disable")
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()
	db.SetMaxOpenConns(count)
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, os.Interrupt)
	defer stop()
	var group sync.WaitGroup
	for range count {
		group.Go(func() {
			for ctx.Err() == nil {
				err := dispatch(ctx, db)
				if err == nil {
					continue
				}
				delay := 70 * time.Millisecond
				if !errors.Is(err, sql.ErrNoRows) && ctx.Err() == nil {
					log.Print(err)
					delay = time.Second
				}
				select {
				case <-ctx.Done():
					return
				case <-time.After(delay):
				}
			}
		})
	}
	group.Wait()
}
