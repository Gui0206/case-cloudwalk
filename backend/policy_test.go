package main

import (
	"encoding/json"
	"testing"
)

func policyFixture(t *testing.T) Config {
	t.Helper()
	var c Config
	if err := json.Unmarshal(initial, &c); err != nil {
		t.Fatal(err)
	}
	return c
}
func TestPolicyPriority(t *testing.T) {
	c := policyFixture(t)
	x := fields{"brand": "InfinitePay", "category": "Repasse", "phase": "Humano", "priority": "Urgente"}
	if c.route(x)["priority"] != "Normal" {
		t.Fatal("untrusted priority was accepted")
	}
	c.Rules = append([]fields{{"id": "priority", "name": "Repasses", "brand": "InfinitePay", "category": "Repasse", "phase": "Humano", "queue": "rep", "setPriority": "Alta"}}, c.Rules...)
	if err := c.validate(); err != nil {
		t.Fatal(err)
	}
	for _, p := range priorities {
		x["priority"] = p
		if d := c.route(x); d["priority"] != "Alta" || d["declaredPriority"] != p {
			t.Fatal(d)
		}
	}
	x["brand"] = "JIM"
	if c.route(x)["priority"] != "Normal" {
		t.Fatal("cross brand priority")
	}
	c.Rules[0]["setPriority"] = "invalid"
	if c.validate() == nil {
		t.Fatal("invalid output accepted")
	}
}
func TestPolicyAlertsAndDiff(t *testing.T) {
	before := policyFixture(t)
	after := policyFixture(t)
	broad := fields{"id": "broad", "name": "Repasses", "category": "Repasse", "phase": "Humano", "queue": "rep", "setPriority": "Alta"}
	shadow := fields{"id": "shadow", "name": "Encoberta", "brand": "JIM", "category": "Repasse", "phase": "Humano", "queue": "us"}
	after.Rules = append([]fields{broad, shadow}, after.Rules...)
	found := map[string]bool{}
	for _, a := range after.alerts(before) {
		found[a["code"].(string)] = true
	}
	if !found["shadowed_rule"] || !found["cross_brand"] {
		t.Fatal(found)
	}
	if len(configDiff(before, after)) == 0 || len(configDiff(before, before)) != 0 {
		t.Fatal("diff")
	}
	original := encode(after)
	after.alerts(before)
	if original != encode(after) {
		t.Fatal("simulation mutated config")
	}
	reordered := policyFixture(t)
	reordered.Rules[0], reordered.Rules[1] = reordered.Rules[1], reordered.Rules[0]
	if len(configDiff(before, reordered)) != 2 {
		t.Fatal("order missing in diff")
	}
	for _, x := range scenarios() {
		if !matches(fields{}, x) {
			t.Fatal(x)
		}
	}
	if len(scenarios()) != 48 {
		t.Fatal("coverage")
	}
}
