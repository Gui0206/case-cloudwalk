import test from "node:test";
import assert from "node:assert/strict";
import { initial, fixtures, route, validate, mock } from "../domain.js";
test("Uma regra genérica desvia também repasses JIM; restringir a marca corrige sem mutar a versão ativa", () => {
  const draft = structuredClone(initial);
  const r = {
    id: "test",
    name: "Repasses",
    brand: "",
    phase: "Humano",
    category: "Repasse",
    priority: "",
    queue: "rep",
  };
  draft.rules.unshift(r);
  let diff = () =>
    fixtures.filter((x) => route(initial, x).queue !== route(draft, x).queue);
  assert.equal(diff().length, 6);
  r.brand = "InfinitePay";
  assert.equal(diff().length, 3);
  assert.ok(
    diff().every((x) => x.brand === "InfinitePay" && x.phase === "Humano"),
  );
  assert.equal(initial.rules.length, 3);
});
test("Validação rejeita destino inexistente; fallback isola marcas sem regras", () => {
  const c = structuredClone(initial);
  c.rules[0].queue = "x";
  assert.throws(() => validate(c));
  c.rules = [];
  assert.equal(route(c, { brand: "JIM", phase: "Humano" }).queue, "us");
});
test("Mock usa o histórico na escalação", () => {
  const r = mock({
    category: "Repasse",
    history: [
      { author: "Cliente", text: "Venda atrasada" },
      { author: "IA", text: "Qual venda?" },
      { author: "Cliente", text: "SYN-01" },
    ],
  });
  assert.equal(r.type, "handoff");
  assert.match(r.summary, /SYN-01/);
  assert.match(r.summary, /Venda atrasada/);
});
