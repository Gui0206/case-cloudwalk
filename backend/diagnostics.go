package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"sync/atomic"
	"time"
)

type durationTotal struct{ calls, micros atomic.Int64 }

func (t *durationTotal) observe(start time.Time) {
	t.micros.Add(time.Since(start).Microseconds())
	t.calls.Add(1)
}
func (t *durationTotal) snapshot() object {
	return object{"calls": t.calls.Load(), "microseconds": t.micros.Load()}
}

func setting(name string, fallback, maximum int) int {
	value := os.Getenv(name)
	if value == "" {
		return fallback
	}
	n, err := strconv.Atoi(value)
	if err != nil || n < 1 || n > maximum {
		panic(fmt.Errorf("%s deve estar entre 1 e %d", name, maximum))
	}
	return n
}
func diagnostics(mux *http.ServeMux, snapshot func() object) {
	mux.HandleFunc("GET /internal/diagnostics", func(w http.ResponseWriter, r *http.Request) {
		if key := os.Getenv("INTERNAL_KEY"); key == "" || r.Header.Get("x-internal-key") != key {
			http.Error(w, "forbidden", 403)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(snapshot())
	})
}
