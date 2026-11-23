package main

import "slices"

// Stable demo identities, selected with the shared local staff credential.
// They are not production authentication or proof of a person's identity.
var operators = map[string]string{"ops-demo": "Operação Demo", "ops-ana": "Ana · Operação", "ops-lia": "Lia · Operação"}

func scenarios() []fields {
	rows := []fields{}
	for _, b := range brands {
		for _, c := range categories {
			for _, p := range phases {
				for _, u := range priorities {
					rows = append(rows, fields{"brand": b, "category": c, "phase": p, "priority": u})
				}
			}
		}
	}
	return rows
}
func matches(r, x fields) bool {
	for _, k := range axes {
		if r[k] != "" && r[k] != x[k] {
			return false
		}
	}
	return true
}
func changedRoute(a, b fields) bool {
	for _, k := range []string{"queue", "team", "name", "priority"} {
		if a[k] != b[k] {
			return true
		}
	}
	return false
}
func (c Config) alerts(before Config) []object {
	result := []object{}
	wins, destinations := map[string]int{}, map[string]int{}
	changedBrands := map[string][]string{}
	rows := scenarios()
	for _, x := range rows {
		a, b := before.route(x), c.route(x)
		wins[b["rule"]]++
		destinations[b["queue"]]++
		if changedRoute(a, b) && !slices.Contains(changedBrands[b["rule"]], x["brand"]) {
			changedBrands[b["rule"]] = append(changedBrands[b["rule"]], x["brand"])
		}
	}
	for _, r := range c.Rules {
		if wins[r["id"]] == 0 {
			blockers := []string{}
			for _, x := range rows {
				if matches(r, x) {
					winner := c.route(x)["rule"]
					if !slices.Contains(blockers, winner) {
						blockers = append(blockers, winner)
					}
				}
			}
			result = append(result, object{"code": "shadowed_rule", "rule": r["id"], "blockers": blockers, "message": "A regra “" + r["name"] + "” não vence em nenhuma combinação do domínio atual; regras anteriores a encobrem."})
		}
		if len(changedBrands[r["id"]]) > 1 {
			result = append(result, object{"code": "cross_brand", "rule": r["id"], "brands": changedBrands[r["id"]], "message": "A regra “" + r["name"] + "” altera fila ou prioridade nas duas marcas. Confira se esse alcance é intencional."})
		}
	}
	for _, q := range c.Queues {
		if destinations[q["id"]] == 0 {
			result = append(result, object{"code": "unused_queue", "queue": q["id"], "message": "A fila “" + q["name"] + "” não recebe cenários simulados. Isso não significa que não existam casos antigos nessa fila."})
		}
	}
	for _, brand := range brands {
		queues := map[string]int{}
		total := 0
		for _, x := range rows {
			if x["brand"] == brand && x["phase"] == "Humano" {
				queues[c.route(x)["queue"]]++
				total++
			}
		}
		for queue, count := range queues {
			if count == total {
				result = append(result, object{"code": "concentrated_brand", "brand": brand, "queue": queue, "message": "Todos os cenários humanos de " + brand + " chegam à mesma fila. Pode ser intencional; não é previsão do volume real."})
			}
		}
	}
	return result
}

// Diff includes order, since changing the first matching rule changes behavior.
func configDiff(before, after Config) []object {
	changes := []object{}
	for i, kind := range []string{"queues", "rules"} {
		old, new := before.Queues, after.Queues
		if i == 1 {
			old, new = before.Rules, after.Rules
		}
		oldByID, newByID := map[string]fields{}, map[string]fields{}
		oldPos, newPos := map[string]int{}, map[string]int{}
		ids := []string{}
		for j, r := range old {
			oldByID[r["id"]] = r
			oldPos[r["id"]] = j
			ids = append(ids, r["id"])
		}
		for j, r := range new {
			newByID[r["id"]] = r
			newPos[r["id"]] = j
			if !slices.Contains(ids, r["id"]) {
				ids = append(ids, r["id"])
			}
		}
		for _, id := range ids {
			a, b := oldByID[id], newByID[id]
			if encode(a) != encode(b) || oldPos[id] != newPos[id] {
				changes = append(changes, object{"kind": kind, "id": id, "before": a, "after": b, "beforePosition": oldPos[id], "afterPosition": newPos[id]})
			}
		}
	}
	return changes
}
