import assert from "node:assert/strict";
const base = "http://127.0.0.1:4383/api/";
let cookie = "";
async function request(path, body, status = 200) {
  const r = await fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: { cookie, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  cookie = r.headers.getSetCookie()[0]?.split(";")[0] || cookie;
  assert.equal(r.status, status);
  return r.json();
}
for (const brand of ["InfinitePay", "JIM"]) {
  await request("profile", {
    role: "analyst",
    brand,
    team: "Atendimento",
    name: "Verificação",
    code: process.env.STAFF_CODE || "demo-local",
  });
  const active = await request("tickets"),
    next = await request("tickets?offset=250");
  assert.equal(active.length, 250);
  assert.equal(next.length, 250);
  assert.ok(
    active.every(
      (t) =>
        t.brand === brand &&
        ["Aguardando analista", "Em atendimento"].includes(t.status),
    ),
  );
  assert.equal(new Set([...active, ...next].map((t) => t.id)).size, 500);
  const closed = await request("tickets?closed=1"),
    closedNext = await request("tickets?closed=1&offset=250");
  assert.equal(closed.length, 250);
  assert.ok(closedNext.length > 0);
  assert.ok(
    [...closed, ...closedNext].every(
      (t) => t.status === "Encerrado" && t.brand === brand,
    ),
  );
  const detail = await request("tickets/" + closed[0].id);
  assert.ok(detail.messages.length >= 4 && detail.audit.length > 0);
  await request("tickets?offset=-1", undefined, 400);
}
console.log(
  "Active and closed pagination, existing history, brand isolation and invalid offset passed.",
);
