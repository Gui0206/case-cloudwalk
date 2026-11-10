const $ = (s) => document.querySelector(s),
  out = $("#screen"),
  esc = (v) =>
    String(v ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
let tab = "client",
  meta,
  selected = null,
  data,
  preview,
  filter = "",
  timer,
  epoch = 0;
const label = {
  client: [
    "01 / CANAIS SIMULADOS",
    "Conversa do lojista",
    "Abra uma solicitação fictícia ou continue uma conversa pelo canal de origem.",
  ],
  analyst: [
    "02 / SUPORTE",
    "Mesa de atendimento",
    "Assuma casos da sua equipe com o contexto de quem já atendeu.",
  ],
  ops: [
    "03 / OPERAÇÃO",
    "Laboratório de filas",
    "Edite as regras, confira o impacto e publique quando os destinos estiverem corretos.",
  ],
};
const head = () =>
  '<div class="kicker">' +
  label[tab][0] +
  "</div><h1>" +
  label[tab][1] +
  "</h1><p>" +
  label[tab][2] +
  "</p>";
const opts = (arr, v, any = false) =>
  (any ? '<option value="">Qualquer</option>' : "") +
  arr
    .map(
      (a) =>
        "<option " + (a === v ? "selected" : "") + ">" + esc(a) + "</option>",
    )
    .join("");
const sel = (name, title, arr, v) =>
  "<label>" +
  title +
  '<select name="' +
  name +
  '">' +
  opts(arr, v) +
  "</select></label>";
const note = (m) => {
  $("#notice").textContent = m;
  clearTimeout(timer);
  timer = setTimeout(() => ($("#notice").textContent = ""), 4200);
};
async function api(path, body) {
  const r = await fetch(
    "/api/" + path,
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const j = await r.json();
  if (!r.ok) throw Error(j.error || r.statusText);
  return j;
}
const values = (f) => Object.fromEntries(new FormData(f)),
  on = (id, fn) => {
    const el = $(id);
    if (el) el.onclick = fn;
  };
window.addEventListener("unhandledrejection", (e) => {
  e.preventDefault();
  note(e.reason.message);
});
async function switchTab(t) {
  epoch++;
  tab = t;
  selected = null;
  filter = "";
  preview = null;
  document
    .querySelectorAll("nav button")
    .forEach((b) => b.classList.toggle("sel", b.dataset.tab === tab));
  meta = await api("meta");
  if (tab === "client" && meta.staff) {
    await api("profile", { role: "client" });
    meta.staff = null;
  }
  if (t !== "client" && meta.staff?.role !== t) return login();
  if (t === "ops") {
    data = await api("config");
    data.metrics = await api("metrics");
    opsView();
  } else desks();
}
document
  .querySelectorAll("nav button")
  .forEach((b) => (b.onclick = () => switchTab(b.dataset.tab)));
function login() {
  out.innerHTML =
    head() +
    '<form id="login" class="card stack" style="max-width:530px"><h2>Acesso da equipe</h2><p>Perfil de demonstração local. Código inicial: <b>demo-local</b>.</p>' +
    (tab === "analyst"
      ? '<label>Nome de exibição<input name="name" required value="Analista Demo" maxlength="60"></label>' +
        sel("brand", "Marca", meta.brands) +
        sel("team", "Equipe", meta.teams)
      : "") +
    '<label>Código da equipe<input type="password" required name="code"></label><button class="primary">Entrar</button></form>';
  $("#login").onsubmit = async (e) => {
    e.preventDefault();
    await api("profile", { ...values(e.target), role: tab });
    await switchTab(tab);
  };
}
function desks() {
  const cli = tab === "client";
  out.innerHTML =
    head() +
    '<div class="grid"><section>' +
    (cli
      ? '<form id="new" class="card stack"><h2>Novo atendimento</h2><div class="row">' +
        sel("brand", "Marca", meta.brands) +
        sel("channel", "Canal", meta.channels) +
        "</div>" +
        sel("priority", "Prioridade simulada", meta.priorities) +
        '<label>Mensagem inicial<textarea name="text" required maxlength="1500" placeholder="Meu repasse não caiu."></textarea></label><button class="primary">Iniciar conversa</button></form>'
      : '<div class="card"><span class="badge">' +
        esc(meta.staff.brand) +
        " · " +
        esc(meta.staff.team) +
        '</span> <button id="change">Trocar perfil</button><label>Filtrar por fila<select id="queueFilter"><option value="">Todas</option></select></label></div>') +
    '<div class="card"><h2>' +
    (cli ? "Minhas conversas" : "Casos da equipe") +
    '</h2><div id="list"></div></div></section><section class="card" id="conversation"><div id="conversationBody"><h2>Conversa</h2><p>Selecione um atendimento para visualizar as mensagens.</p></div>' +
    (cli
      ? ""
      : '<details id="decisionHistory" hidden><summary>Histórico de decisões</summary><div id="decisionEvents"></div></details>') +
    "</section></div>";
  if (cli)
    $("#new").onsubmit = async (e) => {
      e.preventDefault();
      const b = e.submitter;
      b.disabled = true;
      try {
        selected = (await api("tickets", values(e.target))).id;
        e.target.reset();
        await refresh(true);
      } finally {
        b.disabled = false;
      }
    };
  else {
    on("#change", login);
    $("#queueFilter").onchange = (e) => {
      filter = e.target.value;
      refresh();
    };
  }
  refresh(true);
}
async function refresh(force = false) {
  if (!$("#list")) return;
  const n = epoch,
    rows = await api("tickets" + (tab === "client" ? "?mine=1" : ""));
  if (n !== epoch || !$("#list")) return;
  if ($("#queueFilter")) {
    const ids = [...new Set(rows.map((t) => t.queue))];
    $("#queueFilter").innerHTML =
      '<option value="">Todas</option>' +
      ids
        .map(
          (id) =>
            '<option value="' +
            esc(id) +
            '" ' +
            (id === filter ? "selected" : "") +
            ">" +
            esc(rows.find((t) => t.queue === id).queue_name) +
            "</option>",
        )
        .join("");
  }
  $("#list").innerHTML =
    rows
      .filter((t) => !filter || t.queue === filter)
      .map(
        (t) =>
          '<button class="case ' +
          (selected === t.id ? "active" : "") +
          '" data-id="' +
          t.id +
          '">' +
          esc(t.category) +
          " · " +
          esc(t.brand) +
          "<br><small>" +
          esc(t.channel) +
          " · " +
          esc(t.status) +
          " · " +
          esc(t.priority) +
          "</small></button>",
      )
      .join("") || "<p>Nenhum atendimento nesta lista.</p>";
  document.querySelectorAll("[data-id]").forEach(
    (b) =>
      (b.onclick = () => {
        selected = b.dataset.id;
        refresh(true);
      }),
  );
  if (!selected) return;
  const id = selected,
    t = await api("tickets/" + id);
  if (n !== epoch || id !== selected || !$("#conversation")) return;
  const sig = JSON.stringify([
    id,
    t.messages.length,
    t.audit.length,
    t.status,
    t.owner,
    t.revision,
  ]);
  if (!force && $("#conversation").dataset.sig === sig) return;
  const old = $("#reply textarea"),
    draft = old?.value ?? "",
    focus = document.activeElement === old,
    cli = tab === "client",
    last = $("#conversation").dataset.id;
  $("#conversation").dataset.sig = sig;
  $("#conversation").dataset.id = id;
  $("#conversationBody").innerHTML =
    '<span class="badge">' +
    esc(t.status) +
    "</span><h2>" +
    esc(t.category) +
    " · " +
    esc(t.brand) +
    "</h2><p>" +
    esc(t.channel) +
    " · " +
    esc(t.priority) +
    " · " +
    esc(t.phase) +
    (cli ? "" : " · Fila: " + esc(t.queue_name)) +
    "</p>" +
    (t.summary && !cli
      ? '<div class="note"><b>Transferência para a equipe</b><br>' +
        esc(t.motive) +
        "<br>" +
        esc(t.summary) +
        "</div>"
      : "") +
    t.messages
      .map(
        (m) =>
          '<div class="bubble ' +
          (m.author === "Cliente" ? "client" : "") +
          '"><b>' +
          esc(m.author) +
          "</b>" +
          esc(m.body) +
          "</div>",
      )
      .join("") +
    (t.status === "Encerrado"
      ? ""
      : cli || t.owner === meta.staff?.id
        ? '<form id="reply" class="stack"><label>Responder<textarea required maxlength="1500" name="text"></textarea></label><div class="row"><button class="primary">Enviar</button>' +
          (!cli ? '<button id="close" type="button">Encerrar</button>' : "") +
          "</div></form>"
        : !t.owner
          ? '<button id="claim" class="primary">Assumir caso</button>'
          : "<p>Outro analista assumiu este caso.</p>");
  if (!cli) {
    const history = $("#decisionHistory");
    if (last !== id) history.open = false;
    history.hidden = false;
    $("#decisionEvents").innerHTML = t.audit
      .map(
        (a) =>
          "<p><b>" +
          esc(a.kind) +
          "</b> · " +
          esc(new Date(a.created).toLocaleTimeString()) +
          "<br>" +
          esc(
            Object.entries(a.detail)
              .map(([k, v]) => k + ": " + v)
              .join(" · "),
          ) +
          "</p>",
      )
      .join("");
  }
  const act = async (action, text) => {
    await api("tickets/" + id + "/action", { action, text });
    await refresh(true);
  };
  on("#claim", () => act("claim"));
  on("#close", () => act("close"));
  if ($("#reply")) {
    if (last === id) {
      $("#reply textarea").value = draft;
      if (focus) $("#reply textarea").focus();
    }
    $("#reply").onsubmit = async (e) => {
      e.preventDefault();
      const input = e.target.elements.text,
        v = input.value;
      e.submitter.disabled = true;
      try {
        await api("tickets/" + id + "/action", {
          action: cli ? "client" : "reply",
          text: v,
        });
        input.value = "";
        await refresh(true);
      } finally {
        if ($("#reply button")) $("#reply button").disabled = false;
      }
    };
  }
}
function field(k, title, el) {
  return (
    "<label>" +
    title +
    el.replace("FIELD", 'data-field="' + k + '"') +
    "</label>"
  );
}
const input = (k, title, v) =>
    field(k, title, '<input FIELD maxlength="100" value="' + esc(v) + '">'),
  select = (k, title, ls, v, any) =>
    field(k, title, "<select FIELD>" + opts(ls, v, any) + "</select>");
function opsView() {
  const c = data.draft;
  out.innerHTML =
    head() +
    '<p class="badge">Atendimentos: ' +
    data.metrics.tickets +
    "　·　Escalas: " +
    data.metrics.handoffs +
    "　·　Webhooks pendentes: " +
    data.metrics.pending +
    "　·　Falhas definitivas: " +
    data.metrics.failed +
    "</p>" +
    '<div class="card"><span class="badge">Em vigor · versão ' +
    data.version +
    "</span><h2>Rascunho da operação</h2><p>A primeira regra compatível vence. Alterações só afetam decisões futuras após a publicação.</p><div class='actions'><button id='example' class='primary'>Exemplo: repasses</button></div><details><summary>Filas e equipes (" +
    c.queues.length +
    ')</summary><div id="queues">' +
    c.queues
      .map(
        (q, i) =>
          '<div class="row rule" data-queue="' +
          i +
          '">' +
          input("name", "Nome da fila", q.name) +
          select("team", "Equipe responsável", meta.teams, q.team) +
          "</div>",
      )
      .join("") +
    '</div><button id="addQ">Adicionar fila</button></details><h3>Regras em ordem de aplicação</h3>' +
    c.rules
      .map(
        (r, i) =>
          '<div class="rule" data-rule="' +
          i +
          '"><div class="row">' +
          input("name", "Regra " + (i + 1), r.name) +
          '<button data-up="' +
          i +
          '" ' +
          (i === 0 ? "disabled" : "") +
          '>↑ Subir</button><button data-del="' +
          i +
          '">Remover</button></div><div class="row">' +
          select("brand", "Marca", meta.brands, r.brand, true) +
          select("category", "Assunto", meta.categories, r.category, true) +
          select("phase", "Etapa", meta.phases, r.phase, true) +
          select("priority", "Prioridade", meta.priorities, r.priority, true) +
          field(
            "queue",
            "Destino",
            "<select FIELD>" +
              c.queues
                .map(
                  (q) =>
                    '<option value="' +
                    esc(q.id) +
                    '" ' +
                    (q.id === r.queue ? "selected" : "") +
                    ">" +
                    esc(q.name) +
                    "</option>",
                )
                .join("") +
              "</select>",
          ) +
          "</div></div>",
      )
      .join("") +
    '<div class="row actions"><button id="addR">Adicionar regra no topo</button></div><div class="row"><button id="save">Salvar rascunho</button><button id="sim" class="primary">Simular impacto</button></div></div><div id="preview"></div>';
  const mutate = (el) => {
    const p = el.closest("[data-queue],[data-rule]");
    if (!p) return;
    const obj = p.hasAttribute("data-queue")
      ? c.queues[p.dataset.queue]
      : c.rules[p.dataset.rule];
    obj[el.dataset.field] = el.value;
    preview = null;
    $("#preview").innerHTML = "";
  };
  out
    .querySelectorAll("[data-field]")
    .forEach((el) => (el.oninput = () => mutate(el)));
  const reset = (fn) => {
    fn();
    preview = null;
    opsView();
  };
  on("#addQ", () =>
    reset(() =>
      c.queues.push({
        id: crypto.randomUUID(),
        name: "Nova fila",
        team: "Atendimento",
      }),
    ),
  );
  const newRule = (example) => ({
    id: crypto.randomUUID(),
    name: example ? "Escalas de repasse da InfinitePay" : "Nova regra",
    brand: example ? "InfinitePay" : "",
    category: example ? "Repasse" : "",
    phase: "Humano",
    priority: "",
    queue: example ? "rep" : "br",
  });
  on("#addR", () => reset(() => c.rules.unshift(newRule(false))));
  on("#example", () => reset(() => c.rules.unshift(newRule(true))));
  out.querySelectorAll("[data-up]").forEach(
    (b) =>
      (b.onclick = () =>
        reset(() => {
          let i = +b.dataset.up;
          [c.rules[i - 1], c.rules[i]] = [c.rules[i], c.rules[i - 1]];
        })),
  );
  out
    .querySelectorAll("[data-del]")
    .forEach(
      (b) => (b.onclick = () => reset(() => c.rules.splice(b.dataset.del, 1))),
    );
  const save = () => api("draft", { base: data.version, config: c });
  on("#save", async () => {
    await save();
    note("Rascunho salvo. A versão ativa não mudou.");
  });
  on("#sim", async () => {
    await save();
    preview = await api("simulate", {});
    renderPreview();
    $("#preview").scrollIntoView({ behavior: "smooth" });
  });
}
function renderPreview(changedOnly = false) {
  const rows = preview.rows,
    changed = (x) =>
      x.before.queue !== x.after.queue ||
      x.before.team !== x.after.team ||
      x.before.name !== x.after.name;
  $("#preview").innerHTML =
    '<div class="card"><div class="kicker">PRÉVIA · SEM ALTERAR CONVERSAS</div><h2>' +
    rows.filter(changed).length +
    " de " +
    rows.length +
    ' cenários mudam de destino</h2><div class="row"><button id="toggle">' +
    (changedOnly ? "Ver todos" : "Só alterações") +
    '</button><button class="primary" id="publish">Publicar como v' +
    (data.version + 1) +
    '</button></div><div class="scroll"><table><tr><th>CENÁRIO</th><th>ANTES</th><th>DEPOIS</th><th>REGRA DO RASCUNHO</th></tr>' +
    rows
      .filter((x) => !changedOnly || changed(x))
      .map(
        (x) =>
          "<tr><td>" +
          esc([x.brand, x.category, x.phase, x.priority].join(" · ")) +
          "</td><td>" +
          esc(x.before.name) +
          "<br>" +
          esc(x.before.team) +
          "</td><td>" +
          esc(x.after.name) +
          "<br>" +
          esc(x.after.team) +
          "</td><td>" +
          esc(x.after.reason) +
          "</td></tr>",
      )
      .join("") +
    "</table></div></div>";
  on("#toggle", () => renderPreview(!changedOnly));
  on("#publish", async () => {
    await api("publish", { base: preview.base, hash: preview.hash });
    await switchTab("ops");
    note("Versão publicada. Aplicável às próximas decisões.");
  });
}
await switchTab("client");
let polling = false;
setInterval(async () => {
  if (!polling && $("#list")) {
    polling = true;
    try {
      await refresh();
    } catch (e) {
      note(e.message);
    } finally {
      polling = false;
    }
  }
}, 1600);
