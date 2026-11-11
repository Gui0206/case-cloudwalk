// Both sample cases use the same channel, priority and messages.
export async function checkBrandRoute(
  api,
  forecast,
  version,
  progress = () => {},
) {
  const { brand, priority } = forecast;
  const { id } = await api("tickets", {
    brand,
    priority,
    channel: "Chat",
    text: "Meu repasse não caiu.",
  });
  progress(id);
  const path = "tickets/" + id;
  async function waitFor(predicate) {
    const deadline = Date.now() + 45000;
    do {
      const state = await api(path + "/status");
      if (predicate(state)) return;
      await new Promise((resolve) => setTimeout(resolve, 200));
    } while (Date.now() < deadline);
    throw Error("Tempo de espera excedido. Consulte o atendimento " + id);
  }
  await waitFor((state) => state.last_author === "IA");
  await api(path + "/action", { action: "client", text: "VENDA-42" });
  await waitFor((state) => state.phase === "Humano");
  const ticket = await api(path);
  const transfer = ticket.audit.find(
    (event) => event.kind === "Transferência humana",
  );
  if (!transfer)
    throw Error("Transferência sem evento de auditoria no caso " + id);
  const actual = transfer.detail;
  return {
    id,
    brand,
    expected: forecast.after,
    actual,
    summary: ticket.summary,
    messages: ticket.messages,
    matches:
      actual.version === version &&
      ["queue", "team", "rule"].every(
        (key) => actual[key] === forecast.after[key],
      ),
  };
}
