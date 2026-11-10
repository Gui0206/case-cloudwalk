export const brands = ["InfinitePay", "JIM"],
  categories = ["Repasse", "Pix", "Maquininha", "Outros"],
  channels = ["Chat", "WhatsApp", "E-mail"],
  phases = ["IA", "Humano"],
  priorities = ["Normal", "Alta", "Urgente"],
  teams = ["Atendimento", "Repasses", "Suporte técnico"];
export const initial = {
  queues: [
    { id: "auto", name: "Primeiro atendimento", team: "Atendimento" },
    { id: "br", name: "Geral BR", team: "Atendimento" },
    { id: "us", name: "Suporte EUA", team: "Atendimento" },
    { id: "rep", name: "Repasses BR", team: "Repasses" },
  ],
  rules: [
    {
      id: "r-br",
      name: "Escalas InfinitePay",
      brand: "InfinitePay",
      category: "",
      phase: "Humano",
      priority: "",
      queue: "br",
    },
    {
      id: "r-us",
      name: "Escalas JIM",
      brand: "JIM",
      category: "",
      phase: "Humano",
      priority: "",
      queue: "us",
    },
    {
      id: "r-ai",
      name: "Primeiro atendimento",
      brand: "",
      category: "",
      phase: "IA",
      priority: "",
      queue: "auto",
    },
  ],
};
export function validate(c) {
  if (
    !Array.isArray(c?.queues) ||
    !Array.isArray(c.rules) ||
    !c.queues.length ||
    c.queues.length > 100 ||
    c.rules.length > 200
  )
    throw Error("Configuração inválida.");
  for (const list of [c.queues, c.rules]) {
    if (new Set(list.map((x) => x.id)).size !== list.length)
      throw Error("Identificadores repetidos.");
    for (const x of list)
      if (
        !/^[\w-]{1,80}$/.test(x.id) ||
        typeof x.name !== "string" ||
        !x.name.trim() ||
        x.name.length > 100
      )
        throw Error("Preencha um nome e identificador válidos.");
  }
  for (const q of c.queues)
    if (!teams.includes(q.team)) throw Error("Equipe inválida.");
  for (const r of c.rules) {
    for (const [k, vs] of Object.entries({
      brand: brands,
      category: categories,
      phase: phases,
      priority: priorities,
    }))
      if (r[k] !== "" && !vs.includes(r[k]))
        throw Error("Condição inválida: " + k);
    if (!c.queues.some((q) => q.id === r.queue))
      throw Error("Fila inexistente.");
  }
  for (const id of ["auto", "br", "us"])
    if (!c.queues.some((q) => q.id === id))
      throw Error("Preserve as três filas padrão.");
  return c;
}
export function route(c, x) {
  const r = c.rules.find((r) =>
    ["brand", "category", "phase", "priority"].every(
      (k) => !r[k] || r[k] === x[k],
    ),
  );
  const q = c.queues.find(
    (q) =>
      q.id ===
      (r?.queue ??
        (x.phase === "IA" ? "auto" : x.brand === "JIM" ? "us" : "br")),
  );
  return {
    queue: q.id,
    name: q.name,
    team: q.team,
    priority: x.priority,
    rule: r?.id ?? "fallback",
    reason: r
      ? r.name +
        " · " +
        ["brand", "category", "phase", "priority"]
          .map((k) => r[k])
          .filter(Boolean)
          .join(" / ")
      : "Destino padrão da marca e da etapa",
  };
}
export const fixtures = brands.flatMap((brand) =>
  categories.flatMap((category) =>
    phases.flatMap((phase) =>
      priorities.map((priority) => ({ brand, category, phase, priority })),
    ),
  ),
);
export function classify(text) {
  return /repasse|receb[ií]vel|venda/i.test(text)
    ? "Repasse"
    : /pix/i.test(text)
      ? "Pix"
      : /m[aá]quin|dispositivo/i.test(text)
        ? "Maquininha"
        : "Outros";
}
export function mock(e) {
  const last = e.history.at(-1).text,
    prior = e.history.filter((m) => m.author === "IA");
  const closed =
    /resolvido|obrigad|funcionou/i.test(last) && !/não|nao/i.test(last);
  const human =
    /human|analista|atendente|diverg|não resolveu/i.test(last) ||
    (!closed && prior.length > 0 && /repasse|maquininha/i.test(e.category));
  if (human)
    return {
      type: "handoff",
      text: "Vou encaminhar seu caso à equipe com o histórico da conversa.",
      summary:
        "Assunto: " +
        e.category +
        ". Relato inicial: " +
        e.history[0].text +
        ". Última informação: " +
        last,
      motive: /human|analista|atendente/i.test(last)
        ? "Solicitação do cliente"
        : "Análise do caso pela equipe",
    };
  if (closed)
    return {
      type: "close",
      text: "Que bom que deu certo. Atendimento encerrado.",
    };
  return {
    type: "reply",
    text: {
      Repasse:
        "Para conferir a divergência simulada, qual é o identificador fictício da venda?",
      Maquininha: "Qual erro aparece na tela da maquininha simulada?",
      Pix: "No app simulado, abra Pix → Histórico para consultar o status. Conseguiu localizar?",
      Outros:
        "Conte um pouco mais. Se precisar da equipe, escreva “falar com humano”.",
    }[e.category],
  };
}
