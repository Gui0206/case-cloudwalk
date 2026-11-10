package main

import (
	"encoding/json"
	"errors"
	"regexp"
	"slices"
	"strings"
)

type object = map[string]any
type fields = map[string]string
type Config struct {
	Queues []fields `json:"queues"`
	Rules  []fields `json:"rules"`
}

var brands = []string{"InfinitePay", "JIM"}
var channels = []string{"Chat", "WhatsApp", "E-mail"}
var categories = []string{"Repasse", "Pix", "Maquininha", "Outros"}
var priorities = []string{"Normal", "Alta", "Urgente"}
var phases = []string{"IA", "Humano"}
var teams = []string{"Atendimento", "Repasses", "Suporte técnico"}
var axes = []string{"brand", "category", "phase", "priority"}
var options = map[string][]string{"brand": brands, "category": categories, "phase": phases, "priority": priorities}
var validID = regexp.MustCompile("^[a-zA-Z0-9_-]{1,80}$")

func (c Config) validate() error {
	if len(c.Queues) == 0 || len(c.Queues) > 100 || c.Rules == nil || len(c.Rules) > 200 {
		return errors.New("Configuração inválida")
	}
	queues := map[string]bool{}
	for i, list := range [][]fields{c.Queues, c.Rules} {
		seen := map[string]bool{}
		for _, item := range list {
			id := item["id"]
			if seen[id] || !validID.MatchString(id) || strings.TrimSpace(item["name"]) == "" || len([]rune(item["name"])) > 100 {
				return errors.New("Nome ou identificador inválido")
			}
			seen[id] = true
			if i == 0 {
				queues[id] = true
				if !slices.Contains(teams, item["team"]) {
					return errors.New("Equipe inválida")
				}
			} else {
				if !queues[item["queue"]] {
					return errors.New("Fila inexistente")
				}
				for k, values := range options {
					if v := item[k]; v != "" && !slices.Contains(values, v) {
						return errors.New("Condição inválida")
					}
				}
			}
		}
	}
	for _, id := range []string{"br", "us", "auto"} {
		if !queues[id] {
			return errors.New("Preserve as filas padrão")
		}
	}
	return nil
}
func (c Config) route(x fields) fields {
	id := "br"
	if x["phase"] == "IA" {
		id = "auto"
	} else if x["brand"] == "JIM" {
		id = "us"
	}
	rule, reason := "fallback", "Destino padrão da marca e da etapa"
	for _, r := range c.Rules {
		match := true
		parts := []string{}
		for _, k := range axes {
			if r[k] == "" {
				continue
			}
			if r[k] != x[k] {
				match = false
				break
			}
			parts = append(parts, r[k])
		}
		if match {
			id = r["queue"]
			rule = r["id"]
			reason = r["name"] + " · " + strings.Join(parts, " / ")
			break
		}
	}
	for _, q := range c.Queues {
		if q["id"] == id {
			return fields{"queue": id, "name": q["name"], "team": q["team"], "priority": x["priority"], "rule": rule, "reason": reason}
		}
	}
	panic("invalid stored configuration")
}
func contains(text string, words ...string) bool {
	for _, w := range words {
		if strings.Contains(strings.ToLower(text), w) {
			return true
		}
	}
	return false
}
func classify(t string) string {
	switch {
	case contains(t, "repasse", "recebível", "recebivel", "venda"):
		return "Repasse"
	case contains(t, "pix"):
		return "Pix"
	case contains(t, "máquin", "maquin", "dispositivo"):
		return "Maquininha"
	}
	return "Outros"
}
func encode(v any) string {
	b, err := json.Marshal(v)
	if err != nil {
		panic(err)
	}
	return string(b)
}
