package main

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestRouting(t *testing.T) {
	var c Config
	if err := json.Unmarshal(initial, &c); err != nil {
		t.Fatal(err)
	}
	if err := c.validate(); err != nil {
		t.Fatal(err)
	}
	rule := fields{"id": "rep-br", "name": "Repasses BR", "queue": "rep", "phase": "Humano", "category": "Repasse"}
	c.Rules = append([]fields{rule}, c.Rules...)
	for _, brand := range brands {
		x := fields{"brand": brand, "phase": "Humano", "category": "Repasse"}
		if c.route(x)["queue"] != "rep" {
			t.Fatal(x)
		}
	}
	rule["brand"] = "InfinitePay"
	if c.route(fields{"brand": "JIM", "phase": "Humano", "category": "Repasse"})["queue"] != "us" {
		t.Fatal("regra afetou outra marca")
	}
	rule["queue"] = "missing"
	if c.validate() == nil {
		t.Fatal("destino inexistente aceito")
	}
}
func TestHandoff(t *testing.T) {
	reply, err := mockReply(object{"category": "Repasse", "history": []fields{{"author": "Cliente", "text": "Venda atrasada"}, {"author": "IA", "text": "Qual venda?"}, {"author": "Cliente", "text": "SYN-01"}}})
	if err != nil || reply["type"] != "handoff" || !strings.Contains(str(reply, "summary"), "SYN-01") {
		t.Fatalf("%v %v", reply, err)
	}
}
