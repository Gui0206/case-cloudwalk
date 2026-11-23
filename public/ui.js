import { checkBrandRoute } from "./routing-proof.js";
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
  pageOffset = 0,
  timer,
  epoch = 0;
const label = {
  client: [
    "01　/　EXPERIÊNCIA DO CLIENTE",
    "Central do lojista",
    "Inicie um atendimento ou acompanhe suas conversas.",
  ],
  analyst: [
    "02 / SUPORTE",
    "Mesa de atendimento",
    "Veja quem aguarda sua equipe e continue o atendimento com o histórico completo.",
  ],
  ops: [
    "03 / OPERAÇÃO",
    "Roteamento de atendimentos",
    "Defina para onde vai cada atendimento e confira o impacto antes de publicar.",
  ],
};
const head = () =>
  `<section class="page-heading"><h1>${label[tab][1]}</h1><p>${label[tab][2]}</p></section>`;
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
  document.body.dataset.area = t;
  $("#crumb").textContent = {
    client: "Cliente",
    analyst: "Analista",
    ops: "Operação",
  }[t];
  selected = null;
  filter = "";
  preview = null;
  document.querySelectorAll("nav button").forEach((b) => {
    b.classList.toggle("sel", b.dataset.tab === tab);
    if (b.dataset.tab === tab) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });
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
    '<div class="grid"><section class="desk-side">' +
    (cli
      ? '<form id="new" class="card stack"><h2>Novo atendimento</h2><div class="row">' +
        sel("brand", "Marca", meta.brands) +
        "</div><details class='simulation-settings'><summary>Configurar canal e prioridade</summary><div class='row'>" +
        sel("channel", "Canal simulado", meta.channels) +
        sel("priority", "Prioridade simulada", meta.priorities) +
        "</div></details>" +
        '<label>Mensagem inicial<textarea name="text" required maxlength="1500" placeholder="Meu repasse não caiu."></textarea></label><div class="suggest"><span>Experimentar</span><button type="button" data-prompt="Meu repasse não caiu.">Repasse</button><button type="button" data-prompt="Minha maquininha não conecta.">Maquininha</button></div><button class="primary">Iniciar conversa</button></form>'
      : '<div class="card"><span class="badge">' +
        esc(meta.staff.brand) +
        " · " +
        esc(meta.staff.team) +
        '</span> <button id="change" class="quiet">Trocar perfil</button><button class="primary" id="claimNext">Assumir próximo caso</button><details class="queue-filters"><summary>Filtrar casos</summary><label>Filtrar por fila<select id="queueFilter"><option value="">Todas</option></select></label><label>Exibir<select id="caseState"><option value="active">Em aberto</option><option value="closed">Encerrados</option></select></label></details></div>') +
    '<div class="card inbox"><h2>' +
    (cli ? "Minhas conversas" : "Casos da equipe") +
    '</h2><div id="list"></div></div></section><section class="card" id="conversation"><div id="conversationBody"><div class="empty"><div class="empty-icon" aria-hidden="true">↗</div><h2>Selecione um caso</h2><p>As mensagens e o histórico do caso aparecerão aqui.</p></div></div>' +
    (cli
      ? ""
      : '<details id="decisionHistory" hidden><summary>Histórico de decisões</summary><div id="decisionEvents"></div></details>') +
    "</section></div>";
  document.querySelectorAll("[data-prompt]").forEach(
    (b) =>
      (b.onclick = () => {
        const field = $("#new textarea");
        field.value = b.dataset.prompt;
        field.focus();
      }),
  );
  if (cli) {
    const button = document.createElement("button");
    button.id = "newCase";
    button.textContent = "+ Novo atendimento";
    button.hidden = true;
    $(".inbox").prepend(button);
    button.onclick = () => {
      selected = null;
      $(".grid").classList.remove("reading");
      button.hidden = true;
      $("#conversation").removeAttribute("data-id");
      $("#new textarea").focus();
      refresh();
    };
  }
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
    pageOffset = 0;
    const pages = document.createElement("div");
    pages.className = "row";
    pages.innerHTML =
      '<button id="previousPage">Anterior</button><span id="pageNumber"></span><button id="nextPage">Próxima</button>';
    $("#list").after(pages);
    on("#previousPage", () => {
      pageOffset = Math.max(0, pageOffset - 250);
      refresh();
    });
    on("#nextPage", () => {
      pageOffset += 250;
      refresh();
    });
    on("#claimNext", async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        const { ticket } = await api("tickets/claim-next", { queue: filter });
        if (!button.isConnected) return;
        if (ticket) selected = ticket.id;
        else note("Nenhum caso disponível nesta fila agora.");
        await refresh(true);
      } finally {
        button.disabled = false;
      }
    });
    $("#caseState").onchange = () => {
      pageOffset = 0;
      $("#claimNext").hidden = $("#caseState").value === "closed";
      refresh();
    };
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
    rows = await api(
      "tickets" +
        (tab === "client"
          ? "?mine=1"
          : "?offset=" +
            pageOffset +
            ($("#caseState")?.value === "closed" ? "&closed=1" : "")),
    );
  if (n !== epoch || !$("#list")) return;
  if ($("#pageNumber")) {
    $("#pageNumber").textContent = "Página " + (pageOffset / 250 + 1);
    $("#previousPage").disabled = pageOffset === 0;
    $("#nextPage").disabled = rows.length < 250;
  }
  if ($("#queueFilter")) {
    const queues = new Map(rows.map((t) => [t.queue, t.queue_name]));
    if (filter && !queues.has(filter)) {
      queues.set(filter, $("#queueFilter").selectedOptions[0]?.text || filter);
    }
    $("#queueFilter").innerHTML =
      '<option value="">Todas</option>' +
      [...queues]
        .map(
          ([id, name]) =>
            '<option value="' +
            esc(id) +
            '" ' +
            (id === filter ? "selected" : "") +
            ">" +
            esc(name) +
            "</option>",
        )
        .join("");
  }
  const listMarkup =
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
      .join("") || "<p>Nenhum atendimento por aqui ainda.</p>";
  if ($("#list").innerHTML !== listMarkup) $("#list").innerHTML = listMarkup;
  document.querySelectorAll("[data-id]").forEach(
    (b) =>
      (b.onclick = () => {
        selected = b.dataset.id;
        refresh(true);
      }),
  );
  if (!selected) return;
  const id = selected,
    panel = $("#conversation");
  if (
    !force &&
    panel.dataset.id === id &&
    Date.now() < Number(panel.dataset.nextCheck || 0)
  )
    return;
  const status = await api("tickets/" + id + "/status");
  if (n !== epoch || id !== selected || !$("#conversation")) return;
  const version = JSON.stringify(status);
  if (!force && panel.dataset.version === version) {
    const delay = Math.min(8000, Number(panel.dataset.delay || 1600) * 2);
    panel.dataset.delay = delay;
    panel.dataset.nextCheck = Date.now() + delay;
    return;
  }
  const t = await api("tickets/" + id);
  if (n !== epoch || id !== selected || !$("#conversation")) return;
  panel.dataset.version = version;
  panel.dataset.delay = 1600;
  panel.dataset.nextCheck = Date.now() + 1600;
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
  if (cli) {
    $(".grid").classList.add("reading");
    $("#newCase").hidden = false;
  }
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
          ? "<p>Aguardando atribuição. Use Assumir próximo caso para atender por prioridade.</p>"
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
    `<div class="ops-nav" aria-label="Áreas da operação"><button data-ops="rules" aria-pressed="true">Regras</button><button data-ops="queues" aria-pressed="false">Filas e equipes</button><button data-ops="health" aria-pressed="false">Monitoramento</button></div>
    <section class="card" id="queuePanel" hidden><h2>Filas e equipes</h2><p>Cada fila reúne atendimentos para uma equipe. As regras abaixo escolhem a fila de destino.</p><div id="queues">` +
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
    `</div><button id="addQ">Adicionar fila</button><p class="muted">As mudanças nas filas fazem parte do rascunho. Revise o impacto na aba Regras para publicá-las.</p></section>
    <section class="card policy-editor" id="policyEditor"><div class="ops-section-heading"><div><h2>Regras de encaminhamento</h2><p>A primeira regra que combinar com o atendimento define o destino.</p></div><span class="badge">Publicada · v${data.version}</span></div><div class="ops-toolbar"><button id="addR">Adicionar regra</button><button id="example">Exemplo: repasses</button></div><div class="ops-rule-list">` +
    c.rules
      .map(
        (r, i) =>
          `<details class="rule policy" data-rule="${i}" ><summary><span class="rule-index">${String(i + 1).padStart(2, "0")}</span> <span class="rule-title">${esc(r.name)}</span> <small class="rule-dest">→ ${esc(c.queues.find((q) => q.id === r.queue)?.name)}</small><span class="rule-condition">${esc([r.brand || "Todas as marcas", r.category || "Todos os assuntos", r.phase || "Todas as etapas", r.priority || "Todas as prioridades"].join(" · "))}</span></summary><div class="row">` +
          input("name", "Nome da regra", r.name) +
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
          "</div></details>",
      )
      .join("") +
    '</div><div class="ops-review-bar"><span id="draftStatus" role="status">Rascunho · ainda não publicado</span><div class="row"><button id="save">Salvar rascunho</button><button id="sim" class="primary">Simular impacto →</button></div></div></section><div id="preview" hidden></div>' +
    '<section class="card operational-status" id="healthPanel" hidden><h2>Monitoramento</h2><p>Volume de atendimentos e situação das entregas da integração.</p>' +
    '<div class="metrics"><div><small>Atendimentos</small><strong>' +
    data.metrics.tickets +
    "</strong></div><div><small>Escalas humanas</small><strong>" +
    data.metrics.handoffs +
    "</strong></div><div><small>Webhooks pendentes</small><strong>" +
    data.metrics.pending +
    "</strong></div><div><small>Falhas de entrega</small><strong>" +
    data.metrics.failed +
    "</strong></div></div>" +
    "</section>";
  const mutate = (el) => {
    const p = el.closest("[data-queue],[data-rule]");
    if (!p) return;
    const obj = p.hasAttribute("data-queue")
      ? c.queues[p.dataset.queue]
      : c.rules[p.dataset.rule];
    obj[el.dataset.field] = el.value;
    if (p.hasAttribute("data-rule")) {
      p.querySelector(".rule-title").textContent = obj.name;
      p.querySelector(".rule-dest").textContent =
        "→ " + (c.queues.find((q) => q.id === obj.queue)?.name ?? "");
    } else if (el.dataset.field === "name") {
      out.querySelectorAll("select[data-field=queue] option").forEach((o) => {
        if (o.value === obj.id) o.textContent = obj.name;
      });
      out.querySelectorAll("[data-rule]").forEach((row) => {
        if (c.rules[row.dataset.rule].queue === obj.id)
          row.querySelector(".rule-dest").textContent = "→ " + obj.name;
      });
    }
    preview = null;
    $("#preview").innerHTML = "";
    $("#draftStatus").textContent = "Alterações não salvas";
    if (p.hasAttribute("data-rule"))
      p.querySelector(".rule-condition").textContent = [
        obj.brand || "Todas as marcas",
        obj.category || "Todos os assuntos",
        obj.phase || "Todas as etapas",
        obj.priority || "Todas as prioridades",
      ].join(" · ");
  };
  out
    .querySelectorAll("[data-field]")
    .forEach((el) => (el.oninput = () => mutate(el)));
  const showPanel = (area) => {
    $("#policyEditor").hidden = area !== "rules";
    $("#queuePanel").hidden = area !== "queues";
    $("#healthPanel").hidden = area !== "health";
    $("#preview").hidden = true;
    out
      .querySelectorAll("[data-ops]")
      .forEach((b) =>
        b.setAttribute("aria-pressed", String(b.dataset.ops === area)),
      );
  };
  out
    .querySelectorAll("[data-ops]")
    .forEach((b) => (b.onclick = () => showPanel(b.dataset.ops)));
  out.querySelectorAll("details.policy").forEach((rule) =>
    rule.addEventListener("toggle", () => {
      if (rule.open)
        out.querySelectorAll("details.policy").forEach((other) => {
          if (other !== rule) other.open = false;
        });
    }),
  );
  const reset = (fn) => {
    fn();
    preview = null;
    opsView();
  };
  on("#addQ", () => {
    reset(() =>
      c.queues.push({
        id: crypto.randomUUID(),
        name: "Nova fila",
        team: "Atendimento",
      }),
    );
    showPanel("queues");
    $("#queues .rule:last-child input").focus();
  });
  const newRule = (example) => ({
    id: crypto.randomUUID(),
    name: example ? "Escalas de repasse da InfinitePay" : "Nova regra",
    brand: example ? "InfinitePay" : "",
    category: example ? "Repasse" : "",
    phase: "Humano",
    priority: "",
    queue: example ? "rep" : "br",
  });
  const addRule = (example) => {
    reset(() => c.rules.unshift(newRule(example)));
    const first = out.querySelector("details.policy");
    first.open = true;
    first.querySelector("input").focus();
  };
  on("#addR", () => addRule(false));
  on("#example", () => addRule(true));
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
    $("#draftStatus").textContent = "Rascunho salvo · ainda não publicado";
    note("Rascunho salvo. A versão ativa não mudou.");
  });
  on("#sim", async () => {
    await save();
    preview = await api("simulate", {});
    renderPreview(
      preview.rows.some(
        (x) =>
          x.before.queue !== x.after.queue ||
          x.before.team !== x.after.team ||
          x.before.name !== x.after.name,
      ),
    );
    $("#policyEditor").hidden = true;
    $("#preview").hidden = false;
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
    '<div class="card"><p class="preview-step">REVISÃO DO RASCUNHO</p><h2>' +
    rows.filter(changed).length +
    " de " +
    rows.length +
    " cenários mudam de destino</h2><p>" +
    meta.brands
      .map(
        (brand) =>
          esc(brand) +
          " · " +
          rows.filter((row) => row.brand === brand && changed(row)).length +
          " alterações",
      )
      .join(" &nbsp;|&nbsp; ") +
    '</p><div class="row"><button id="editDraft">Voltar às regras</button><button id="toggle">' +
    (changedOnly ? "Ver todos" : "Só alterações") +
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
    `</table></div><div class="ops-review-bar"><p>Publicar aplica este rascunho às próximas decisões de roteamento.</p><button class="primary" id="publish">Publicar versão ${data.version + 1}</button></div></div>`;
  on("#editDraft", () => {
    $("#preview").hidden = true;
    $("#policyEditor").hidden = false;
    $("#policyEditor").scrollIntoView({ behavior: "smooth" });
  });
  on("#toggle", () => renderPreview(!changedOnly));
  on("#publish", async () => {
    const cases = preview.rows.filter(
      (row) =>
        row.phase === "Humano" &&
        row.category === "Repasse" &&
        row.priority === "Normal",
    );
    const { version } = await api("publish", {
      base: preview.base,
      hash: preview.hash,
    });
    await switchTab("ops");
    note("Versão publicada. Aplicável às próximas decisões.");
    if (tab === "ops" && $("#preview")) showRoutingCheck(cases, version);
  });
}
function showRoutingCheck(cases, version) {
  const proof = document.createElement("section");
  proof.className = "card";
  proof.innerHTML =
    "<h2>Conferir repasses na versão " +
    esc(version) +
    '</h2><p>Abra um caso de teste em cada marca. Ambos entram pelo chat com a mesma prioridade e ficam disponíveis para os analistas após a escalação.</p><button class="primary">Abrir os dois casos de teste</button><div class="routing-comparison" aria-live="polite"></div>';
  $("#preview").hidden = false;
  $("#policyEditor").hidden = true;
  $("#preview").append(proof);
  proof.scrollIntoView({ block: "start" });
  const button = proof.querySelector("button");
  button.onclick = async () => {
    button.disabled = true;
    await Promise.all(
      cases.map(async (forecast) => {
        const result = document.createElement("section");
        proof.lastElementChild.append(result);
        result.textContent = forecast.brand + " · Abrindo caso…";
        try {
          const r = await checkBrandRoute(api, forecast, version, (id) => {
            result.textContent =
              forecast.brand + " · Aguardando escalação · " + id;
          });
          result.innerHTML =
            "<h3>" +
            esc(r.brand) +
            "</h3><p><strong>" +
            (r.matches ? "Destino confirmado" : "Diferença encontrada") +
            "</strong></p><p>Prévia · " +
            esc(r.expected.name + " / " + r.expected.team) +
            "<br>Atendimento · " +
            esc(r.actual.name + " / " + r.actual.team) +
            "</p><details><summary>Conversa e decisão</summary><p>" +
            esc(r.id) +
            "</p>" +
            r.messages
              .map(
                (m) =>
                  "<p><strong>" +
                  esc(m.author) +
                  "</strong> · " +
                  esc(m.body) +
                  "</p>",
              )
              .join("") +
            "<p>" +
            esc(r.summary) +
            "</p><p>" +
            esc(r.actual.reason) +
            " · versão " +
            esc(r.actual.version) +
            "</p></details>";
        } catch (error) {
          result.append(document.createTextNode(" · " + error.message));
        }
      }),
    );
  };
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
