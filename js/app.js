/* =========================================================================
   Banco de Horas do Marketing — Sapion
   Aplicação: entrada, painel do colaborador e painel do administrador.
   ========================================================================= */

(() => {
  "use strict";

  const CONFIG = window.APP_CONFIG || {};
  const TOKEN_KEY = "sapion-bh-sessao";
  const ULTIMO_KEY = "sapion-bh-ultimo-usuario";
  const app = document.getElementById("app");

  const state = {
    token: null,
    usuario: null,
    // colaborador
    meus: [],
    filtroStatus: "todos",
    periodo: "todos",
    limite: 30,
    // administrador
    usuarios: [],
    lancamentos: [],
    tab: "aprovacoes",
    selecionados: new Set(),
    filtroAprov: "",
    buscaColab: "",
    filtros: { busca: "", usuario: "", status: "", tipo: "", periodo: "todos" },
    limiteAdm: 50,
  };
  let api = null;

  /* ======================================================================
     Utilidades
     ====================================================================== */

  const $ = (sel, root = document) => root.querySelector(sel);
  const pad = (n) => String(n).padStart(2, "0");
  const hoje = () => Api.hojeIso();
  const isAdmin = () => state.usuario && state.usuario.papel === "admin";

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  /* Minutos -> "+2h30", "−1h05", "0h00" */
  function fmtHoras(min, sinal = true) {
    const m = Math.round(Number(min) || 0);
    const a = Math.abs(m);
    const s = `${Math.floor(a / 60)}h${pad(a % 60)}`;
    if (!sinal) return s;
    return (m > 0 ? "+" : m < 0 ? "−" : "") + s;
  }

  /* Mais de 24 horas -> "equivale a 1 dia e 6h30" (dias de 24 horas). Até 24 horas, vazio. */
  function fmtDias(min) {
    const a = Math.abs(Math.round(Number(min) || 0));
    if (a <= 1440) return "";
    const d = Math.floor(a / 1440);
    const r = a % 1440;
    return `equivale a ${d} ${d === 1 ? "dia" : "dias"}${r ? ` e ${fmtHoras(r, false)}` : ""}`;
  }

  const fmtHorasTela = fmtHoras;
  const deltaCls = (m) => (m > 0 ? "delta--in" : m < 0 ? "delta--out" : "delta--zero");

  function dataDe(iso) {
    const [y, m, d] = String(iso || "").split("-").map(Number);
    return new Date(y, (m || 1) - 1, d || 1);
  }

  function fmtDia(iso) {
    const d = dataDe(iso);
    if (isNaN(d)) return "—";
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
  }

  function diaSemana(iso) {
    const d = dataDe(iso);
    return isNaN(d) ? "" : d.toLocaleDateString("pt-BR", { weekday: "long" });
  }

  function fmtDataHora(ts) {
    const d = new Date(ts);
    if (!ts || isNaN(d)) return "—";
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} às ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function nomeMes(d = new Date()) {
    return d.toLocaleDateString("pt-BR", { month: "long" });
  }

  function norm(s) {
    return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  }

  function primeiroNome(nome) {
    return String(nome || "").trim().split(/\s+/)[0] || "";
  }

  function iniciais(nome) {
    const p = String(nome || "").trim().split(/\s+/).filter(Boolean);
    if (!p.length) return "?";
    return ((p[0][0] || "") + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase();
  }

  function avatar(u, grande = false) {
    let h = 0;
    const s = String((u && u.id) || "");
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return `<span class="avatar avatar--c${(h % 5) + 1} ${grande ? "avatar--lg" : ""}" aria-hidden="true">${esc(iniciais(u && u.nome))}</span>`;
  }

  function icons() {
    if (window.lucide) window.lucide.createIcons({ attrs: { "aria-hidden": "true" } });
  }

  function lsGet(k) {
    try { return localStorage.getItem(k) || ""; } catch (e) { return ""; }
  }
  function lsSet(k, v) {
    try { localStorage.setItem(k, v); } catch (e) { /* sem armazenamento: ignora */ }
  }
  function getToken() {
    try { return sessionStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; }
  }
  function setToken(t) {
    try {
      if (t) sessionStorage.setItem(TOKEN_KEY, t);
      else sessionStorage.removeItem(TOKEN_KEY);
    } catch (e) { /* sem armazenamento: a sessão vale só nesta página */ }
  }

  function gerarSenha() {
    const letras = "abcdefghjkmnpqrstuvwxyz";
    const nums = "23456789";
    const r = (n) => {
      if (window.crypto && crypto.getRandomValues) return crypto.getRandomValues(new Uint32Array(1))[0] % n;
      return Math.floor(Math.random() * n);
    };
    let s = "";
    for (let i = 0; i < 5; i++) s += letras[r(letras.length)];
    for (let i = 0; i < 3; i++) s += nums[r(nums.length)];
    return s;
  }

  /* ======================================================================
     Regras de exibição
     ====================================================================== */

  const STATUS = {
    pendente: { label: "Pendente", tone: "warning" },
    aprovado: { label: "Aprovado", tone: "success" },
    recusado: { label: "Recusado", tone: "danger" },
  };

  const TIPOS = {
    credito: { label: "Crédito", longo: "Horas a mais" },
    debito: { label: "Débito", longo: "Horas a menos" },
    ajuste: { label: "Ajuste", longo: "Ajuste do administrador" },
  };

  function detalheForma(l, jornada) {
    if (l.forma === "horario" && l.hora_inicio && l.hora_fim) {
      const virou = l.hora_fim < l.hora_inicio ? " (até o dia seguinte)" : "";
      return { icon: "clock", texto: `Das ${l.hora_inicio} às ${l.hora_fim}${virou}` };
    }
    if (l.forma === "dia") return { icon: "calendar-days", texto: jornada ? `Dia inteiro (jornada de ${fmtHoras(jornada, false)})` : "Dia inteiro" };
    if (l.forma === "ajuste") return { icon: "sliders-horizontal", texto: "Ajuste do administrador" };
    return { icon: "timer", texto: "Quantidade de horas" };
  }

  const somaAprovado = (ls) => ls.reduce((s, l) => s + (l.status === "aprovado" ? l.minutos : 0), 0);
  const pendentesDe = (ls) => ls.filter((l) => l.status === "pendente");
  const getUsuario = (id) => state.usuarios.find((u) => u.id === id);
  const lancsDe = (id) => state.lancamentos.filter((l) => l.usuario_id === id);
  const saldoDe = (id) => (isAdmin() ? somaAprovado(lancsDe(id)) : somaAprovado(state.meus));
  const nomeDe = (id) => (getUsuario(id) || {}).nome || "Usuário excluído";
  const colaboradores = () => state.usuarios.filter((u) => u.papel === "colaborador");
  const cmpNome = (a, b) => a.nome.localeCompare(b.nome, "pt-BR", { sensitivity: "base" });

  function noPeriodo(l, periodo) {
    if (!periodo || periodo === "todos") return true;
    if (periodo === "mes") return l.data.slice(0, 7) === hoje().slice(0, 7);
    const d = new Date();
    d.setDate(d.getDate() - Number(periodo));
    return l.data >= Api.hojeIso(d);
  }

  const PERIODOS = [
    ["todos", "Todo o período"],
    ["mes", "Este mês"],
    ["30", "Últimos 30 dias"],
    ["90", "Últimos 90 dias"],
    ["365", "Último ano"],
  ];

  /* ======================================================================
     Toasts
     ====================================================================== */

  function toast(msg, tipo = "ok") {
    let wrap = $(".toasts");
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.className = "toasts";
      wrap.setAttribute("role", "status");
      wrap.setAttribute("aria-live", "polite");
      document.body.appendChild(wrap);
    }
    const el = document.createElement("div");
    el.className = "toast" + (tipo === "error" ? " toast--error" : "");
    el.innerHTML = `<i data-lucide="${tipo === "error" ? "circle-alert" : "circle-check"}"></i><span>${esc(msg)}</span>`;
    wrap.appendChild(el);
    icons();
    setTimeout(() => el.remove(), tipo === "error" ? 6000 : 3600);
  }

  /* ======================================================================
     Comunicação com o banco
     ====================================================================== */

  async function rpc(nome, params = {}) {
    try {
      return await api.call(nome, { p_token: state.token, ...params });
    } catch (e) {
      if (e.sessaoExpirada) sessaoExpirou();
      throw e;
    }
  }

  async function carregar() {
    if (isAdmin()) {
      const d = await rpc("bh_admin_dados");
      state.usuario = d.usuario;
      state.usuarios = d.usuarios || [];
      state.lancamentos = d.lancamentos || [];
      const pend = new Set(state.lancamentos.filter((l) => l.status === "pendente").map((l) => l.id));
      state.selecionados = new Set([...state.selecionados].filter((id) => pend.has(id)));
    } else {
      const d = await rpc("bh_meus_dados");
      state.usuario = d.usuario;
      state.meus = d.lancamentos || [];
    }
  }

  /* Executa uma alteração, recarrega os dados e atualiza a tela. */
  async function executar(fn, msg) {
    try {
      await fn();
    } catch (e) {
      if (!e.sessaoExpirada) toast(e.message || String(e), "error");
      return false;
    }
    try {
      await carregar();
    } catch (e) {
      console.error(e);
    }
    renderShell();
    if (msg) toast(msg);
    return true;
  }

  /* ======================================================================
     Entrada (login)
     ====================================================================== */

  function renderLogin(aviso = "") {
    closeModal();
    closeMenu();
    const demo = api && api.mode === "demo";
    app.innerHTML = `
      <main class="login">
        <div class="login__inner">
          <img class="login__logo" src="assets/logos/lockup-white-transparent.png" alt="Sapion Nova Educação">
          <div class="card login__card">
            <h1>Banco de Horas</h1>
            <p>Marketing Sapion. Selecione o seu nome e digite a sua senha para ver e lançar as suas horas.</p>
            ${aviso ? `<div class="callout callout--warning" style="margin-top:16px"><i data-lucide="info"></i><div>${esc(aviso)}</div></div>` : ""}
            <form class="login__form" id="login-form" novalidate>
              <div class="field">
                <label class="field__label" for="l-usuario">Seu nome</label>
                <select class="select" id="l-usuario" name="usuario" disabled>
                  <option value="">Carregando nomes…</option>
                </select>
              </div>
              <div class="field">
                <label class="field__label" for="l-senha">Senha</label>
                <div class="password">
                  <input class="input" id="l-senha" name="senha" type="password" autocomplete="current-password" required>
                  <button class="icon-btn" type="button" data-action="ver-senha" aria-label="Mostrar senha"><i data-lucide="eye"></i></button>
                </div>
              </div>
              <button class="btn" type="submit"><i data-lucide="log-in"></i> Entrar</button>
            </form>
            ${demo ? `
              <div class="callout callout--warning">
                <i data-lucide="flask-conical"></i>
                <div><strong>Modo demonstração.</strong> Os dados são de exemplo e ficam só neste navegador. A senha de todos os usuários é <strong>${Api.DEMO_SENHA}</strong>. Para usar de verdade, conecte o Supabase (veja o tutorial).</div>
              </div>` : ""}
          </div>
          <p class="login__tagline">Aprenda algo novo todos os dias.</p>
        </div>
      </main>`;
    icons();
    const form = $("#login-form");
    const sel = $("#l-usuario");

    (async () => {
      try {
        const nomes = await api.call("bh_listar_nomes");
        const ultimo = lsGet(ULTIMO_KEY);
        sel.innerHTML = `<option value="">Selecione o seu nome</option>` + nomes.map((n) =>
          `<option value="${esc(n.id)}" ${n.id === ultimo ? "selected" : ""}>${esc(n.nome)}</option>`).join("");
        sel.disabled = false;
        (sel.value ? $("#l-senha") : sel).focus();
      } catch (e) {
        sel.innerHTML = `<option value="">Não foi possível carregar</option>`;
        formErroLogin(form, e.message || String(e));
      }
    })();

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (form.dataset.busy) return;
      clearErrors(form);
      const usuarioId = sel.value;
      const senha = $("#l-senha").value;
      if (!usuarioId) return fieldError(form, "usuario", "Selecione o seu nome na lista.");
      if (!senha) return fieldError(form, "senha", "Digite a sua senha.");
      const btn = form.querySelector('[type="submit"]');
      form.dataset.busy = "1";
      btn.disabled = true;
      try {
        const r = await api.call("bh_login", { p_usuario_id: usuarioId, p_senha: senha });
        if (!r || !r.ok) {
          fieldError(form, "senha", (r && r.erro) || "Não foi possível entrar.");
          $("#l-senha").select();
          return;
        }
        lsSet(ULTIMO_KEY, usuarioId);
        state.token = r.token;
        state.usuario = r.usuario;
        setToken(r.token);
        await entrar();
      } catch (err) {
        formErroLogin(form, err.message || String(err));
      } finally {
        delete form.dataset.busy;
        btn.disabled = false;
      }
    });
  }

  function formErroLogin(form, msg) {
    const old = form.querySelector(".form-error");
    if (old) old.remove();
    const d = document.createElement("div");
    d.className = "callout callout--danger form-error";
    d.innerHTML = `<i data-lucide="circle-alert"></i><div>${esc(msg)}</div>`;
    form.prepend(d);
    icons();
  }

  async function entrar() {
    state.tab = "aprovacoes";
    state.selecionados = new Set();
    state.filtros = { busca: "", usuario: "", status: "", tipo: "", periodo: "todos" };
    state.filtroStatus = "todos";
    state.periodo = "todos";
    await carregar();
    renderShell();
  }

  function limparSessao() {
    state.token = null;
    state.usuario = null;
    state.meus = [];
    state.usuarios = [];
    state.lancamentos = [];
    setToken("");
  }

  async function sair() {
    const t = state.token;
    limparSessao();
    renderLogin();
    if (t) {
      try { await api.call("bh_logout", { p_token: t }); } catch (e) { /* já saiu da tela */ }
    }
  }

  function sessaoExpirou() {
    if (!state.token) return;
    limparSessao();
    renderLogin("Sua sessão expirou. Entre de novo para continuar.");
  }

  /* ======================================================================
     Estrutura principal
     ====================================================================== */

  function renderShell() {
    const u = state.usuario;
    if (!u) return renderLogin();
    const demo = api.mode === "demo";
    const admin = isAdmin();
    app.innerHTML = `
      <header class="topbar">
        <div class="topbar__inner">
          <div class="topbar__brand">
            <img class="topbar__logo" src="assets/logos/lockup-black-color.png" alt="Sapion Nova Educação">
            <span class="topbar__divider"></span>
            <div class="topbar__title">Banco de Horas<small>Marketing Sapion${admin ? " · Administração" : ""} ${demo ? `<span class="demo-chip">Demonstração</span>` : ""}</small></div>
          </div>
          <div class="topbar__actions">
            ${admin ? `
              <button class="btn btn--secondary btn--sm" type="button" data-action="exportar" aria-label="Baixar planilha">
                <i data-lucide="file-spreadsheet"></i><span class="label-desktop">Baixar planilha</span>
              </button>` : ""}
            <button class="btn btn--sm" type="button" data-action="novo-lancamento" aria-label="Novo lançamento">
              <i data-lucide="plus"></i><span class="label-desktop">Novo lançamento</span>
            </button>
            <button class="user-btn" type="button" data-action="menu-usuario" aria-label="Menu de ${esc(u.nome)}" aria-haspopup="menu">
              ${avatar(u)}<span class="user-btn__name">${esc(primeiroNome(u.nome))}</span><i data-lucide="chevron-down"></i>
            </button>
          </div>
        </div>
      </header>
      <main class="container" id="view"></main>`;
    renderView();
  }

  function renderView() {
    const view = $("#view");
    if (!view) return;
    view.innerHTML = isAdmin() ? viewAdmin() : viewColaborador();
    if (isAdmin()) renderAdminTab();
    else renderMinhaLista();
    icons();
  }

  /* ======================================================================
     Painel do colaborador
     ====================================================================== */

  function viewColaborador() {
    const u = state.usuario;
    const saldo = somaAprovado(state.meus);
    const pend = pendentesDe(state.meus);
    const somaPend = pend.reduce((s, l) => s + l.minutos, 0);
    const doMes = state.meus.filter((l) => l.status === "aprovado" && noPeriodo(l, "mes"));
    const credMes = doMes.filter((l) => l.minutos > 0).reduce((s, l) => s + l.minutos, 0);
    const debMes = doMes.filter((l) => l.minutos < 0).reduce((s, l) => s + l.minutos, 0);
    const hint = saldo > 0 ? "Você tem horas a seu favor no banco."
      : saldo < 0 ? "Você está devendo horas ao banco."
        : "Seu banco de horas está zerado.";
    const mes = nomeMes();
    const segs = [
      ["todos", "Todos"],
      ["pendente", "Pendentes"],
      ["aprovado", "Aprovados"],
      ["recusado", "Recusados"],
    ];
    return `
      <div class="greeting">
        <h1>Olá, ${esc(primeiroNome(u.nome))}!</h1>
        <p>Só contam no seu saldo os lançamentos aprovados pelo administrador.</p>
      </div>
      <div class="overview">
        <section class="balance" aria-label="Seu saldo">
          <div>
            <span class="balance__label"><i data-lucide="hourglass"></i>Seu saldo no banco de horas</span>
            <div class="balance__value ${saldo > 0 ? "balance__value--pos" : saldo < 0 ? "balance__value--neg" : ""}">${fmtHoras(saldo)}</div>
            ${fmtDias(saldo) ? `<p class="balance__days">${fmtDias(saldo)}</p>` : ""}
            <p class="balance__hint">${hint}</p>
          </div>
          <div class="balance__foot">
            <button class="btn" type="button" data-action="novo-lancamento"><i data-lucide="plus"></i> Lançar horas</button>
            ${pend.length ? `<span class="balance__pending"><i data-lucide="clock-alert"></i>Se tudo for aprovado, seu saldo vai para <strong>${fmtHoras(saldo + somaPend)}</strong></span>` : ""}
          </div>
        </section>
        <div class="mini-stats">
          <div class="card mini">
            <span class="mini__icon mini__icon--wait"><i data-lucide="clock-alert"></i></span>
            <div>
              <div class="mini__label">Aguardando aprovação</div>
              <div class="mini__value ${pend.length ? deltaCls(somaPend) : ""}">${pend.length ? fmtHoras(somaPend) : "Nada"}</div>
              <div class="mini__sub">${!pend.length ? "nenhum lançamento pendente" : pend.length === 1 ? "1 lançamento pendente" : `${pend.length} lançamentos pendentes`}</div>
            </div>
          </div>
          <div class="card mini">
            <span class="mini__icon mini__icon--in"><i data-lucide="trending-up"></i></span>
            <div>
              <div class="mini__label">Horas a mais aprovadas em ${mes}</div>
              <div class="mini__value delta--in">${fmtHoras(credMes)}</div>
            </div>
          </div>
          <div class="card mini">
            <span class="mini__icon mini__icon--out"><i data-lucide="trending-down"></i></span>
            <div>
              <div class="mini__label">Horas a menos aprovadas em ${mes}</div>
              <div class="mini__value ${debMes ? "delta--out" : ""}">${fmtHoras(debMes)}</div>
            </div>
          </div>
        </div>
      </div>
      <div class="section-head">
        <div>
          <h2>Seus lançamentos</h2>
          <p>Histórico de tudo o que você lançou e a resposta do administrador.</p>
        </div>
      </div>
      <div class="filters">
        <div class="segmented" role="radiogroup" aria-label="Filtrar por status">
          ${segs.map(([v, label]) => `
            <input type="radio" name="f-status" id="fs-${v}" value="${v}" ${state.filtroStatus === v ? "checked" : ""}>
            <label for="fs-${v}">${label}</label>`).join("")}
        </div>
        <select class="select select--sm" id="f-periodo" aria-label="Período">
          ${PERIODOS.map(([v, l]) => `<option value="${v}" ${state.periodo === v ? "selected" : ""}>${l}</option>`).join("")}
        </select>
      </div>
      <div class="card" id="lista"></div>`;
  }

  function renderMinhaLista() {
    const el = $("#lista");
    if (!el) return;
    const ls = state.meus.filter((l) =>
      (state.filtroStatus === "todos" || l.status === state.filtroStatus) && noPeriodo(l, state.periodo));
    if (!state.meus.length) {
      el.innerHTML = `
        <div class="empty">
          <div class="empty__icon"><i data-lucide="calendar-clock"></i></div>
          <h3>Nenhum lançamento ainda</h3>
          <p>Quando você trabalhar a mais ou a menos que a sua jornada, faça um lançamento. Ele vai para o administrador aprovar.</p>
          <button class="btn" type="button" data-action="novo-lancamento"><i data-lucide="plus"></i> Fazer o primeiro lançamento</button>
        </div>`;
      icons();
      return;
    }
    if (!ls.length) {
      el.innerHTML = `
        <div class="empty">
          <div class="empty__icon"><i data-lucide="search-x"></i></div>
          <h3>Nada por aqui</h3>
          <p>Nenhum lançamento com esse filtro.</p>
        </div>`;
      icons();
      return;
    }
    const visiveis = ls.slice(0, state.limite);
    el.innerHTML = `
      <ul class="entries">${visiveis.map((l) => entryHtml(l, "colab")).join("")}</ul>
      <div class="list-foot">
        <span>Mostrando ${visiveis.length} de ${ls.length} ${ls.length === 1 ? "lançamento" : "lançamentos"}</span>
        ${ls.length > visiveis.length ? `<button class="btn btn--secondary btn--sm" type="button" data-action="mais">Carregar mais</button>` : ""}
      </div>`;
    icons();
  }

  /* Uma linha da lista de lançamentos.
     modo: "colab" (painel do colaborador), "aprovacao" (fila de aprovação) ou "admin" (todos os lançamentos). */
  function entryHtml(l, modo) {
    const st = STATUS[l.status] || STATUS.pendente;
    const tp = TIPOS[l.tipo] || TIPOS.ajuste;
    const dono = modo === "colab" ? state.usuario : getUsuario(l.usuario_id);
    const det = detalheForma(l, dono && dono.jornada_minutos);
    const selecionavel = modo === "aprovacao";

    const metas = [];
    if (l.criado_pelo_admin) metas.push(`Lançado por ${esc(l.criado_por_nome || "administrador")} em ${fmtDataHora(l.criado_em)}`);
    else metas.push(`Enviado em ${fmtDataHora(l.criado_em)}`);
    if (l.status !== "pendente" && l.analisado_por_nome) {
      metas.push(`${l.status === "aprovado" ? "Aprovado" : "Recusado"} por ${esc(l.analisado_por_nome)} em ${fmtDataHora(l.analisado_em)}`);
    }
    if (l.editado_por_nome) metas.push(`Editado por ${esc(l.editado_por_nome)}`);
    if (modo === "aprovacao") {
      const saldo = saldoDe(l.usuario_id);
      metas.push(`Saldo de ${esc(primeiroNome(nomeDe(l.usuario_id)))}: ${fmtHoras(saldo)} → <strong>${fmtHoras(saldo + l.minutos)}</strong> se aprovar`);
    }

    const nota = l.observacao_admin
      ? `<div class="entry__note entry__note--${l.status}"><strong>Observação${l.analisado_por_nome ? ` de ${esc(primeiroNome(l.analisado_por_nome))}` : " do administrador"}:</strong> ${esc(l.observacao_admin)}</div>`
      : "";

    let acoes = "";
    if (modo === "colab") {
      if (l.status === "pendente") {
        acoes = `
          <button class="icon-btn" type="button" data-action="editar-lanc" data-id="${l.id}" title="Editar" aria-label="Editar lançamento"><i data-lucide="pencil"></i></button>
          <button class="icon-btn" type="button" data-action="excluir-lanc" data-id="${l.id}" title="Excluir" aria-label="Excluir lançamento"><i data-lucide="trash-2"></i></button>`;
      }
    } else if (modo === "aprovacao") {
      acoes = `
        <button class="btn btn--approve btn--sm" type="button" data-action="aprovar" data-id="${l.id}"><i data-lucide="check"></i> Aprovar</button>
        <button class="btn btn--refuse btn--sm" type="button" data-action="recusar" data-id="${l.id}"><i data-lucide="x"></i> Recusar</button>
        <button class="icon-btn" type="button" data-action="menu-lanc" data-id="${l.id}" aria-label="Mais opções" aria-haspopup="menu"><i data-lucide="ellipsis-vertical"></i></button>`;
    } else {
      acoes = `<button class="icon-btn" type="button" data-action="menu-lanc" data-id="${l.id}" aria-label="Opções do lançamento" aria-haspopup="menu"><i data-lucide="ellipsis-vertical"></i></button>`;
    }

    return `
      <li class="entry entry--${l.status} ${selecionavel ? "entry--selectable" : ""}">
        ${selecionavel ? `<div class="entry__check"><input type="checkbox" data-action="selecionar" data-id="${l.id}" ${state.selecionados.has(l.id) ? "checked" : ""} aria-label="Selecionar lançamento"></div>` : ""}
        <div class="entry__date"><strong>${fmtDia(l.data)}</strong><span>${esc(diaSemana(l.data))}</span></div>
        <div class="entry__main">
          <div class="entry__head">
            ${modo !== "colab" ? `<span class="entry__who">${esc(nomeDe(l.usuario_id))}</span>` : ""}
            <span class="badge badge--${st.tone}">${st.label}</span>
            <span class="entry__detail"><i data-lucide="${det.icon}"></i>${esc(det.texto)}</span>
          </div>
          <p class="entry__desc">${esc(l.descricao)}</p>
          ${nota}
          <p class="entry__meta">${metas.join(" · ")}</p>
        </div>
        <div class="entry__hours">
          <span class="delta ${deltaCls(l.minutos)}">${fmtHoras(l.minutos)}</span>
          <span class="muted">${tp.label}</span>
        </div>
        ${acoes ? `<div class="entry__actions">${acoes}</div>` : `<div class="entry__actions"></div>`}
      </li>`;
  }

  /* ======================================================================
     Painel do administrador
     ====================================================================== */

  function viewAdmin() {
    const colabs = colaboradores();
    const pend = pendentesDe(state.lancamentos);
    const credPend = pend.filter((l) => l.minutos > 0).reduce((s, l) => s + l.minutos, 0);
    const debPend = pend.filter((l) => l.minutos < 0).reduce((s, l) => s + l.minutos, 0);
    const saldos = colabs.map((u) => somaAprovado(lancsDe(u.id)));
    const total = saldos.reduce((s, x) => s + x, 0);
    const positivos = saldos.filter((s) => s > 0).length;
    const negativos = saldos.filter((s) => s < 0).length;
    const tabs = [
      ["aprovacoes", "Aprovações", "clipboard-check", pend.length, pend.length > 0],
      ["colaboradores", "Colaboradores", "users", colabs.length, false],
      ["lancamentos", "Todos os lançamentos", "history", state.lancamentos.length, false],
    ];
    return `
      <div class="greeting">
        <h1>Olá, ${esc(primeiroNome(state.usuario.nome))}!</h1>
        <p>Aprove os lançamentos, cuide dos colaboradores e acompanhe o banco de horas do time.</p>
      </div>
      <div class="stats">
        <div class="card stat stat--warning">
          <span class="stat__label"><i data-lucide="clock-alert"></i>Aguardando aprovação</span>
          <span class="stat__value">${pend.length}</span>
          <span class="stat__hint">${pend.length ? `${fmtHoras(credPend)} a mais · ${fmtHoras(debPend)} a menos` : "nenhum lançamento pendente"}</span>
        </div>
        <div class="card stat">
          <span class="stat__label"><i data-lucide="hourglass"></i>Saldo do time</span>
          <span class="stat__value ${deltaCls(total)}">${fmtHoras(total)}</span>
          ${fmtDias(total) ? `<span class="hours-days">${fmtDias(total)}</span>` : ""}
          <span class="stat__hint">soma dos saldos aprovados</span>
        </div>
        <div class="card stat stat--success">
          <span class="stat__label"><i data-lucide="trending-up"></i>Saldo positivo</span>
          <span class="stat__value">${positivos}</span>
          <span class="stat__hint">${positivos === 1 ? "colaborador com horas a favor" : "colaboradores com horas a favor"}</span>
        </div>
        <div class="card stat stat--danger">
          <span class="stat__label"><i data-lucide="trending-down"></i>Saldo negativo</span>
          <span class="stat__value">${negativos}</span>
          <span class="stat__hint">${negativos === 1 ? "colaborador devendo horas" : "colaboradores devendo horas"}</span>
        </div>
      </div>
      <nav class="tabs" role="tablist" aria-label="Seções">
        ${tabs.map(([k, label, ic, c, alerta]) => `
          <button class="tab" type="button" role="tab" aria-selected="${state.tab === k}" data-action="tab" data-tab="${k}">
            <i data-lucide="${ic}"></i>${label}<span class="count ${alerta ? "count--alert" : ""}">${c}</span>
          </button>`).join("")}
      </nav>
      <section id="tab-view"></section>`;
  }

  function renderAdminTab() {
    const el = $("#tab-view");
    if (!el) return;
    if (state.tab === "colaboradores") el.innerHTML = viewColaboradores();
    else if (state.tab === "lancamentos") el.innerHTML = viewTodos();
    else el.innerHTML = viewAprovacoes();
    if (state.tab === "colaboradores") renderColabTabela();
    else if (state.tab === "lancamentos") renderTodosLista();
    else renderAprovLista();
    icons();
  }

  function opcoesColab(selecionado, vazio = "Todos os colaboradores") {
    return `<option value="">${vazio}</option>` + [...state.usuarios].sort(cmpNome)
      .filter((u) => u.papel === "colaborador" || lancsDe(u.id).length)
      .map((u) => `<option value="${u.id}" ${u.id === selecionado ? "selected" : ""}>${esc(u.nome)}</option>`).join("");
  }

  /* ---------- Aprovações ---------- */

  function viewAprovacoes() {
    return `
      <div class="section-head">
        <div>
          <h2>Aguardando aprovação</h2>
          <p>Confira cada lançamento e aprove ou recuse. Só os aprovados contam no banco de horas.</p>
        </div>
        <div class="toolbar">
          <select class="select select--sm" id="f-aprov-usuario" aria-label="Filtrar por colaborador">${opcoesColab(state.filtroAprov)}</select>
        </div>
      </div>
      <div class="card" id="lista"></div>`;
  }

  function pendentesFiltrados() {
    return pendentesDe(state.lancamentos)
      .filter((l) => !state.filtroAprov || l.usuario_id === state.filtroAprov)
      .sort((a, b) => a.data.localeCompare(b.data) || a.criado_em.localeCompare(b.criado_em));
  }

  function renderAprovLista() {
    const el = $("#lista");
    if (!el) return;
    const ls = pendentesFiltrados();
    if (!ls.length) {
      el.innerHTML = `
        <div class="empty">
          <div class="empty__icon empty__icon--ok"><i data-lucide="party-popper"></i></div>
          <h3>Tudo em dia</h3>
          <p>${state.filtroAprov ? "Esse colaborador não tem lançamentos aguardando aprovação." : "Nenhum lançamento aguardando aprovação. Quando alguém lançar horas, elas aparecem aqui."}</p>
        </div>`;
      icons();
      return;
    }
    const sel = ls.filter((l) => state.selecionados.has(l.id));
    const todos = sel.length === ls.length;
    el.innerHTML = `
      <div class="bulkbar">
        <label class="check-all"><input type="checkbox" data-action="selecionar-todos" ${todos ? "checked" : ""}> Selecionar todos</label>
        <span class="bulkbar__info">${sel.length ? `${sel.length} ${sel.length === 1 ? "selecionado" : "selecionados"} · ${fmtHoras(sel.reduce((s, l) => s + l.minutos, 0))}` : `${ls.length} ${ls.length === 1 ? "lançamento" : "lançamentos"}, do mais antigo para o mais recente`}</span>
        ${sel.length ? `
          <button class="btn btn--approve btn--sm" type="button" data-action="aprovar-sel"><i data-lucide="check-check"></i> Aprovar selecionados</button>
          <button class="btn btn--refuse btn--sm" type="button" data-action="recusar-sel"><i data-lucide="x"></i> Recusar selecionados</button>` : ""}
      </div>
      <ul class="entries">${ls.map((l) => entryHtml(l, "aprovacao")).join("")}</ul>`;
    icons();
  }

  /* ---------- Colaboradores ---------- */

  function viewColaboradores() {
    return `
      <div class="section-head">
        <div>
          <h2>Colaboradores</h2>
          <p>Saldo aprovado de cada pessoa. Crie, edite ou exclua usuários e ajuste o banco de horas.</p>
        </div>
        <div class="toolbar">
          <label class="search">
            <i data-lucide="search"></i>
            <span class="sr-only">Buscar colaborador</span>
            <input class="input input--sm" id="busca-colab" type="search" placeholder="Buscar pelo nome" value="${esc(state.buscaColab)}">
          </label>
          <button class="btn btn--sm" type="button" data-action="novo-colab"><i data-lucide="user-plus"></i> Novo colaborador</button>
        </div>
      </div>
      <div class="card" id="lista"></div>`;
  }

  function renderColabTabela() {
    const el = $("#lista");
    if (!el) return;
    const q = norm(state.buscaColab);
    const us = [...state.usuarios].sort((a, b) => (a.papel === b.papel ? cmpNome(a, b) : a.papel === "admin" ? 1 : -1))
      .filter((u) => !q || norm(u.nome).includes(q) || norm(u.cargo).includes(q));
    if (!colaboradores().length && !q) {
      el.innerHTML = `
        <div class="empty">
          <div class="empty__icon"><i data-lucide="users"></i></div>
          <h3>Nenhum colaborador cadastrado</h3>
          <p>Cadastre as pessoas do marketing. Cada uma recebe uma senha para entrar e lançar as próprias horas.</p>
          <button class="btn" type="button" data-action="novo-colab"><i data-lucide="user-plus"></i> Cadastrar colaborador</button>
        </div>`;
      icons();
      return;
    }
    if (!us.length) {
      el.innerHTML = `<div class="empty"><div class="empty__icon"><i data-lucide="search-x"></i></div><h3>Ninguém encontrado</h3><p>Nenhum usuário com esse nome.</p></div>`;
      icons();
      return;
    }
    el.innerHTML = `
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>Colaborador</th>
              <th>Perfil</th>
              <th class="num">Jornada</th>
              <th class="num">Saldo aprovado</th>
              <th class="num">Pendentes</th>
              <th>Acesso</th>
              <th><span class="sr-only">Ações</span></th>
            </tr>
          </thead>
          <tbody>
            ${us.map((u) => {
              const ls = lancsDe(u.id);
              const saldo = somaAprovado(ls);
              const pend = pendentesDe(ls);
              const somaPend = pend.reduce((s, l) => s + l.minutos, 0);
              const semBanco = u.papel === "admin" && !ls.length;
              return `
                <tr class="${u.ativo ? "" : "is-inactive"}">
                  <td><div class="person">${avatar(u, true)}<div><strong>${esc(u.nome)}</strong><span>${esc(u.cargo || "Sem cargo informado")}</span></div></div></td>
                  <td>${u.papel === "admin" ? `<span class="badge badge--purple badge--plain">Administrador</span>` : `<span class="badge badge--neutral badge--plain">Colaborador</span>`}</td>
                  <td class="num">${u.papel === "admin" ? `<span class="muted">—</span>` : fmtHoras(u.jornada_minutos, false)}</td>
                  <td class="num">${semBanco ? `<span class="muted">—</span>` : `<span class="delta ${deltaCls(saldo)}" style="font-size:17px">${fmtHoras(saldo)}</span>${fmtDias(saldo) ? `<span class="hours-days">${fmtDias(saldo)}</span>` : ""}`}</td>
                  <td class="num">${pend.length ? `${pend.length} · <span class="${deltaCls(somaPend)}">${fmtHoras(somaPend)}</span>` : `<span class="muted">—</span>`}</td>
                  <td>${u.ativo ? `<span class="badge badge--success">Liberado</span>` : `<span class="badge badge--neutral">Suspenso</span>`}</td>
                  <td class="nowrap" style="text-align:right">
                    ${u.papel === "colaborador" ? `<button class="btn btn--ghost btn--sm" type="button" data-action="ajustar" data-id="${u.id}"><i data-lucide="sliders-horizontal"></i> Ajustar banco</button>` : ""}
                    <button class="icon-btn" type="button" data-action="menu-colab" data-id="${u.id}" aria-label="Opções de ${esc(u.nome)}" aria-haspopup="menu"><i data-lucide="ellipsis-vertical"></i></button>
                  </td>
                </tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>`;
    icons();
  }

  /* ---------- Todos os lançamentos ---------- */

  function viewTodos() {
    const f = state.filtros;
    const opt = (v, l, atual) => `<option value="${v}" ${atual === v ? "selected" : ""}>${l}</option>`;
    return `
      <div class="section-head">
        <div>
          <h2>Todos os lançamentos</h2>
          <p>Histórico completo do time. Pelo menu ⋮ de cada lançamento você edita, aprova, recusa ou exclui.</p>
        </div>
      </div>
      <div class="card filters filters--grid">
        <label class="search">
          <i data-lucide="search"></i>
          <span class="sr-only">Buscar</span>
          <input class="input input--sm" id="f-busca" type="search" placeholder="Buscar na explicação ou observação" value="${esc(f.busca)}">
        </label>
        <select class="select select--sm" id="f-usuario" aria-label="Colaborador">${opcoesColab(f.usuario)}</select>
        <select class="select select--sm" id="f-status" aria-label="Status">
          ${opt("", "Todos os status", f.status)}${opt("pendente", "Pendentes", f.status)}${opt("aprovado", "Aprovados", f.status)}${opt("recusado", "Recusados", f.status)}
        </select>
        <select class="select select--sm" id="f-tipo" aria-label="Tipo">
          ${opt("", "Todos os tipos", f.tipo)}${opt("credito", "Horas a mais", f.tipo)}${opt("debito", "Horas a menos", f.tipo)}${opt("ajuste", "Ajustes", f.tipo)}
        </select>
        <select class="select select--sm" id="f-periodo-adm" aria-label="Período">
          ${PERIODOS.map(([v, l]) => opt(v, l, f.periodo)).join("")}
        </select>
      </div>
      <div class="card" id="lista"></div>`;
  }

  function todosFiltrados() {
    const f = state.filtros;
    const q = norm(f.busca);
    return state.lancamentos.filter((l) =>
      (!f.usuario || l.usuario_id === f.usuario) &&
      (!f.status || l.status === f.status) &&
      (!f.tipo || l.tipo === f.tipo) &&
      noPeriodo(l, f.periodo) &&
      (!q || norm(l.descricao + " " + l.observacao_admin + " " + nomeDe(l.usuario_id)).includes(q)));
  }

  function renderTodosLista() {
    const el = $("#lista");
    if (!el) return;
    const ls = todosFiltrados();
    if (!ls.length) {
      const algum = state.lancamentos.length > 0;
      el.innerHTML = `
        <div class="empty">
          <div class="empty__icon"><i data-lucide="${algum ? "search-x" : "calendar-clock"}"></i></div>
          <h3>${algum ? "Nenhum lançamento com esses filtros" : "Nenhum lançamento ainda"}</h3>
          <p>${algum ? "Mude os filtros para ver outros lançamentos." : "Os lançamentos dos colaboradores vão aparecer aqui."}</p>
          ${algum ? `<button class="btn btn--secondary" type="button" data-action="limpar-filtros">Limpar filtros</button>` : ""}
        </div>`;
      icons();
      return;
    }
    const visiveis = ls.slice(0, state.limiteAdm);
    const soma = ls.filter((l) => l.status === "aprovado").reduce((s, l) => s + l.minutos, 0);
    el.innerHTML = `
      <ul class="entries">${visiveis.map((l) => entryHtml(l, "admin")).join("")}</ul>
      <div class="list-foot">
        <span>Mostrando ${visiveis.length} de ${ls.length} · aprovados neste filtro: <strong class="${deltaCls(soma)}">${fmtHoras(soma)}</strong></span>
        ${ls.length > visiveis.length ? `<button class="btn btn--secondary btn--sm" type="button" data-action="mais-adm">Carregar mais</button>` : ""}
      </div>`;
    icons();
  }

  /* ======================================================================
     Menus suspensos
     ====================================================================== */

  let menuAtual = null;

  function toggleMenu(anchor, items, head = "") {
    if (menuAtual && menuAtual.anchor === anchor) return closeMenu();
    closeMenu();
    const m = document.createElement("div");
    m.className = "menu";
    m.setAttribute("role", "menu");
    m.innerHTML = head + items.map((it, i) => it === "sep"
      ? "<hr>"
      : `<button type="button" role="menuitem" data-i="${i}" class="${it.danger ? "danger" : ""}"><i data-lucide="${it.icon}"></i>${esc(it.label)}</button>`
    ).join("");
    document.body.appendChild(m);
    icons();
    const r = anchor.getBoundingClientRect();
    const mw = m.offsetWidth;
    const mh = m.offsetHeight;
    let left = Math.min(r.right - mw, window.innerWidth - mw - 8);
    if (left < 8) left = 8;
    let top = r.bottom + 6;
    if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 6);
    m.style.left = left + "px";
    m.style.top = top + "px";
    m.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-i]");
      if (!b) return;
      const it = items[Number(b.dataset.i)];
      closeMenu();
      it.run();
    });
    anchor.setAttribute("aria-expanded", "true");
    menuAtual = { m, anchor };
    const first = m.querySelector("button");
    if (first) first.focus();
  }

  function closeMenu() {
    if (!menuAtual) return;
    menuAtual.m.remove();
    menuAtual.anchor.removeAttribute("aria-expanded");
    menuAtual = null;
  }

  function menuUsuario() {
    const items = [
      { icon: "key-round", label: "Alterar minha senha", run: abrirSenha },
    ];
    if (api.mode === "demo") items.push({ icon: "rotate-ccw", label: "Reiniciar demonstração", run: reiniciarDemo });
    items.push("sep", { icon: "log-out", label: "Sair", run: sair });
    return items;
  }

  function menuLanc(id) {
    const l = state.lancamentos.find((x) => x.id === id);
    if (!l) return [];
    const items = [];
    if (l.status !== "aprovado") items.push({ icon: "check", label: "Aprovar", run: () => abrirAnalise([id], "aprovado") });
    if (l.status !== "recusado") items.push({ icon: "x", label: "Recusar", run: () => abrirAnalise([id], "recusado") });
    if (l.status !== "pendente") items.push({ icon: "undo-2", label: "Voltar para pendente", run: () => abrirAnalise([id], "pendente") });
    items.push(
      "sep",
      { icon: "pencil", label: "Editar lançamento", run: () => abrirLancamento({ lanc: l }) },
      { icon: "user", label: "Ver lançamentos da pessoa", run: () => verLancamentosDe(l.usuario_id) },
      "sep",
      { icon: "trash-2", label: "Excluir lançamento", danger: true, run: () => excluirLancAdmin(id) },
    );
    return items;
  }

  function menuColab(id) {
    const u = getUsuario(id);
    if (!u) return [];
    const items = [
      { icon: "history", label: "Ver lançamentos", run: () => verLancamentosDe(id) },
    ];
    if (u.papel === "colaborador") {
      items.push(
        { icon: "plus", label: "Lançar horas para a pessoa", run: () => abrirLancamento({ usuarioId: id }) },
        { icon: "sliders-horizontal", label: "Ajustar banco de horas", run: () => abrirAjuste(id) },
      );
    }
    items.push(
      "sep",
      { icon: "pencil", label: "Editar dados e senha", run: () => abrirColaborador(id) },
    );
    if (u.id !== state.usuario.id) {
      items.push("sep", { icon: "trash-2", label: "Excluir usuário", danger: true, run: () => excluirColaborador(id) });
    }
    return items;
  }

  function verLancamentosDe(id) {
    state.tab = "lancamentos";
    state.filtros = { busca: "", usuario: id, status: "", tipo: "", periodo: "todos" };
    state.limiteAdm = 50;
    renderView();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /* ======================================================================
     Modais
     ====================================================================== */

  let modalAtual = null;

  function openModal({ title, subtitle = "", body, submitLabel = "Salvar", submitClass = "", cancelLabel = "Cancelar", hideSubmit = false, onSubmit, onMount }) {
    closeModal();
    closeMenu();
    const back = document.createElement("div");
    back.className = "modal-backdrop";
    back.innerHTML = `
      <form class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" novalidate>
        <div class="modal__head">
          <div>
            <h2 id="modal-title">${esc(title)}</h2>
            ${subtitle ? `<p>${subtitle}</p>` : ""}
          </div>
          <button type="button" class="icon-btn" data-close aria-label="Fechar"><i data-lucide="x"></i></button>
        </div>
        <div class="modal__body">${body}</div>
        <div class="modal__foot">
          <button type="button" class="btn btn--secondary" data-close>${esc(cancelLabel)}</button>
          ${hideSubmit ? "" : `<button type="submit" class="btn ${submitClass}">${submitLabel}</button>`}
        </div>
      </form>`;
    document.body.appendChild(back);
    const form = back.querySelector("form");
    modalAtual = { back, form, prevFocus: document.activeElement };

    back.addEventListener("click", (e) => {
      if (e.target.closest("[data-close]")) closeModal();
    });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (form.dataset.busy || !onSubmit) return;
      clearErrors(form);
      const btn = form.querySelector('[type="submit"]');
      form.dataset.busy = "1";
      if (btn) btn.disabled = true;
      let ok = false;
      try {
        ok = await onSubmit(form);
      } catch (err) {
        console.error(err);
        if (!err.sessaoExpirada) formError(form, err.message || String(err));
        ok = false;
      }
      if (modalAtual && modalAtual.form === form) {
        if (ok !== false) closeModal();
        else {
          delete form.dataset.busy;
          if (btn) btn.disabled = false;
        }
      }
    });

    icons();
    if (onMount) onMount(form);
    const first = form.querySelector("[autofocus]") || form.querySelector(".modal__body input:not([type=radio]):not([type=hidden]):not([type=checkbox]), .modal__body select, .modal__body textarea");
    if (first) first.focus();
    return form;
  }

  function closeModal() {
    if (!modalAtual) return;
    const { back, prevFocus } = modalAtual;
    modalAtual = null;
    back.remove();
    if (prevFocus && document.body.contains(prevFocus)) prevFocus.focus();
  }

  function fieldError(form, name, msg) {
    const el = form.querySelector(`[name="${name}"]`);
    const field = el && el.closest(".field");
    if (el) el.setAttribute("aria-invalid", "true");
    if (field) {
      let e = field.querySelector(".field__error");
      if (!e) {
        e = document.createElement("span");
        e.className = "field__error";
        field.appendChild(e);
      }
      e.textContent = msg;
    }
    if (el) el.focus();
    return false;
  }

  function formError(form, msg) {
    const body = form.querySelector(".modal__body");
    const old = form.querySelector(".form-error");
    if (old) old.remove();
    const d = document.createElement("div");
    d.className = "callout callout--danger form-error";
    d.innerHTML = `<i data-lucide="circle-alert"></i><div>${esc(msg)}</div>`;
    body.prepend(d);
    icons();
    body.scrollTop = 0;
    return false;
  }

  function clearErrors(form) {
    form.querySelectorAll("[aria-invalid]").forEach((e) => e.removeAttribute("aria-invalid"));
    form.querySelectorAll(".field__error").forEach((e) => e.remove());
    const fe = form.querySelector(".form-error");
    if (fe) fe.remove();
  }

  function confirmar({ title, body, label, onOk }) {
    openModal({ title, body, submitLabel: label, submitClass: "btn--danger", onSubmit: onOk });
  }

  const fv = (form, name) => {
    const el = form.elements[name];
    return el ? String(el.value || "") : "";
  };

  /* Campos de horas e minutos. prefixo: nome base dos campos (prefixo_h, prefixo_m). */
  function campoHM(prefixo, minutos, { label, hint = "", sinal = false, sinalLabel = ["Somar", "Subtrair"] } = {}) {
    const a = minutos == null ? null : Math.abs(minutos);
    const h = a == null ? "" : Math.floor(a / 60);
    const m = a == null ? "" : a % 60;
    return `
      <div class="field">
        <span class="field__label">${label}</span>
        <div class="hm ${sinal ? "hm--signed" : ""}">
          ${sinal ? `
            <select class="select" name="${prefixo}_s" aria-label="Somar ou subtrair">
              <option value="+" ${minutos == null || minutos >= 0 ? "selected" : ""}>${sinalLabel[0]}</option>
              <option value="-" ${minutos != null && minutos < 0 ? "selected" : ""}>${sinalLabel[1]}</option>
            </select>` : ""}
          <div class="with-suffix"><input class="input" name="${prefixo}_h" type="number" inputmode="numeric" min="0" step="1" value="${h}" placeholder="0" aria-label="Horas"><span>h</span></div>
          <div class="with-suffix"><input class="input" name="${prefixo}_m" type="number" inputmode="numeric" min="0" max="59" step="1" value="${m}" placeholder="0" aria-label="Minutos"><span>min</span></div>
        </div>
        ${hint ? `<span class="field__hint">${hint}</span>` : ""}
      </div>`;
  }

  /* Lê horas e minutos. Retorna minutos (com sinal, se houver) ou null se inválido/vazio. */
  function lerHM(form, prefixo) {
    const hs = fv(form, prefixo + "_h").trim();
    const ms = fv(form, prefixo + "_m").trim();
    if (!hs && !ms) return null;
    if ((hs && !/^\d+$/.test(hs)) || (ms && !/^\d+$/.test(ms))) return NaN;
    const h = hs ? Number(hs) : 0;
    const m = ms ? Number(ms) : 0;
    if (m > 59 || h > 99999) return NaN;
    const total = h * 60 + m;
    return fv(form, prefixo + "_s") === "-" ? -total : total;
  }

  function resumoSaldo(antes, delta, rotulo = "Saldo depois", depois = delta == null ? null : antes + delta) {
    return `
      <div class="summary">
        <div><span>Saldo atual</span><strong class="${deltaCls(antes)}">${fmtHoras(antes)}</strong></div>
        <div><span>Este lançamento</span><strong class="${delta == null ? "muted" : deltaCls(delta)}">${delta == null ? "—" : fmtHoras(delta)}</strong></div>
        <div><span>${rotulo}</span><strong class="${delta == null ? "muted" : deltaCls(depois)}">${delta == null ? "—" : fmtHoras(depois)}</strong></div>
      </div>`;
  }

  /* ----------------------------------------------------------------------
     Lançamento (colaborador e administrador)
     ---------------------------------------------------------------------- */

  function abrirLancamento({ lanc = null, usuarioId = "" } = {}) {
    const admin = isAdmin();
    if (admin && !colaboradores().length && !lanc) {
      toast("Cadastre um colaborador antes de lançar horas.", "error");
      state.tab = "colaboradores";
      renderView();
      return;
    }
    const tipo = lanc ? lanc.tipo : "credito";
    const forma = lanc && lanc.forma !== "ajuste" ? lanc.forma : "horario";
    const durMin = lanc && lanc.forma === "duracao" ? Math.abs(lanc.minutos) : null;
    const ajMin = lanc && lanc.forma === "ajuste" ? lanc.minutos : null;
    const dono = lanc ? lanc.usuario_id : usuarioId;
    const tiposVisiveis = [
      ["credito", "in", "trending-up", "Trabalhei a mais", "Hora extra, evento, viagem, fim de semana"],
      ["debito", "out", "trending-down", "Trabalhei a menos", "Atraso, saída mais cedo, falta ou folga"],
    ];
    if (admin && lanc && lanc.tipo === "ajuste") {
      tiposVisiveis.push(["ajuste", "in", "sliders-horizontal", "Ajuste", "Ajuste de saldo feito pelo administrador"]);
    }
    const formas = [
      ["horario", "clock", "Por horário"],
      ["duracao", "timer", "Por quantidade"],
      ["dia", "calendar-days", "Dia inteiro"],
    ];

    const statusAtual = lanc ? lanc.status : "aprovado";
    const body = `
      ${admin ? `
        <div class="field">
          <label class="field__label" for="f-usuario-lanc">Colaborador</label>
          <select class="select" id="f-usuario-lanc" name="usuario_id">${opcoesColab(dono, "Selecione o colaborador")}</select>
        </div>` : `
        <div class="callout">
          <i data-lucide="info"></i>
          <div>Lance só o que foi <strong>diferente</strong> da sua jornada normal. O lançamento fica <strong>pendente</strong> até o administrador aprovar.</div>
        </div>`}
      <div class="field">
        <span class="field__label">O que aconteceu?</span>
        <div class="big-choices ${tiposVisiveis.length > 2 ? "big-choices--3" : ""}" role="radiogroup" aria-label="Tipo do lançamento">
          ${tiposVisiveis.map(([v, cls, ic, t, sub]) => `
            <div class="big-choice big-choice--${cls}">
              <input type="radio" name="tipo" id="t-${v}" value="${v}" ${tipo === v ? "checked" : ""}>
              <label for="t-${v}">
                <span class="big-choice__icon"><i data-lucide="${ic}"></i></span>
                <span><strong>${t}</strong><span class="sub">${sub}</span></span>
              </label>
            </div>`).join("")}
        </div>
      </div>
      <div class="field">
        <label class="field__label" for="f-data">Dia</label>
        <input class="input" id="f-data" name="data" type="date" value="${esc(lanc ? lanc.data : hoje())}" max="${esc(Api.hojeIso(new Date(Date.now() + 365 * 86400000)))}">
      </div>
      <div class="field" data-bloco="forma">
        <span class="field__label">Como você quer informar as horas?</span>
        <div class="segmented segmented--full" role="radiogroup" aria-label="Como informar">
          ${formas.map(([v, ic, l]) => `
            <input type="radio" name="forma" id="fm-${v}" value="${v}" ${forma === v ? "checked" : ""}>
            <label for="fm-${v}"><i data-lucide="${ic}"></i>${l}</label>`).join("")}
        </div>
      </div>
      <div class="field" data-mostrar="horario">
        <span class="field__label" data-texto="horario-label"></span>
        <div class="time-range">
          <span>Das</span>
          <input class="input" name="ini" type="time" value="${esc(lanc && lanc.hora_inicio ? lanc.hora_inicio : "")}" aria-label="Início">
          <span>às</span>
          <input class="input" name="fim" type="time" value="${esc(lanc && lanc.hora_fim ? lanc.hora_fim : "")}" aria-label="Fim">
        </div>
        <span class="field__hint" data-texto="horario-hint"></span>
      </div>
      <div data-mostrar="duracao" style="display:flex;flex-direction:column;gap:10px">
        ${campoHM("dur", durMin, { label: "Quantas horas?" })}
        <div class="chips" aria-label="Atalhos">
          ${[[30, "30 min"], [60, "1h"], [120, "2h"], [240, "4h"]].map(([m, l]) => `<button type="button" class="chip" data-chip="${m}">${l}</button>`).join("")}
        </div>
      </div>
      <div data-mostrar="dia"><div class="callout"><i data-lucide="calendar-days"></i><div data-texto="dia"></div></div></div>
      <div data-mostrar="ajuste">${campoHM("aj", ajMin, { label: "Ajuste", sinal: true })}</div>
      <div class="field">
        <label class="field__label" for="f-descricao">Explique o lançamento</label>
        <textarea class="textarea" id="f-descricao" name="descricao" maxlength="1000">${esc(lanc ? lanc.descricao : "")}</textarea>
        <span class="field__hint">Obrigatório. Conte o motivo para o administrador entender e aprovar.</span>
      </div>
      ${admin ? `
        <div class="grid-2">
          <div class="field">
            <label class="field__label" for="f-status-lanc">Status</label>
            <select class="select" id="f-status-lanc" name="status">
              <option value="aprovado" ${statusAtual === "aprovado" ? "selected" : ""}>Aprovado</option>
              <option value="pendente" ${statusAtual === "pendente" ? "selected" : ""}>Pendente</option>
              <option value="recusado" ${statusAtual === "recusado" ? "selected" : ""}>Recusado</option>
            </select>
          </div>
        </div>
        <div class="field">
          <label class="field__label" for="f-obs-adm">Observações do administrador <span class="opt">(opcional)</span></label>
          <textarea class="textarea" id="f-obs-adm" name="observacao_admin" maxlength="1000" style="min-height:70px">${esc(lanc ? lanc.observacao_admin : "")}</textarea>
          <span class="field__hint">O colaborador vê esse texto no histórico dele.</span>
        </div>` : ""}
      <div id="previa"></div>`;

    openModal({
      title: lanc ? "Editar lançamento" : admin ? "Novo lançamento" : "Lançar horas",
      subtitle: admin ? (lanc ? `De ${esc(nomeDe(lanc.usuario_id))}` : "O lançamento feito pelo administrador já pode entrar aprovado.") : "",
      body,
      submitLabel: lanc ? `<i data-lucide="check"></i> Salvar alterações` : admin ? `<i data-lucide="check"></i> Salvar lançamento` : `<i data-lucide="send"></i> Enviar para aprovação`,
      onMount: (form) => {
        const atualizar = () => atualizarFormLanc(form, lanc);
        form.addEventListener("input", atualizar);
        form.addEventListener("change", atualizar);
        form.addEventListener("click", (e) => {
          const c = e.target.closest("[data-chip]");
          if (!c) return;
          const m = Number(c.dataset.chip);
          form.elements.dur_h.value = Math.floor(m / 60);
          form.elements.dur_m.value = m % 60;
          atualizar();
        });
        atualizar();
      },
      onSubmit: (form) => salvarLancamento(form, lanc),
    });
  }

  function jornadaDoForm(form) {
    if (!isAdmin()) return state.usuario.jornada_minutos;
    const u = getUsuario(fv(form, "usuario_id"));
    return u ? u.jornada_minutos : 480;
  }

  function lerLanc(form) {
    const tipo = fv(form, "tipo");
    const d = { tipo, forma: fv(form, "forma"), data: fv(form, "data"), descricao: fv(form, "descricao") };
    if (tipo === "ajuste") {
      d.minutos = lerHM(form, "aj");
    } else if (d.forma === "horario") {
      d.hora_inicio = fv(form, "ini");
      d.hora_fim = fv(form, "fim");
    } else if (d.forma === "duracao") {
      d.minutos = lerHM(form, "dur");
    }
    return d;
  }

  function atualizarFormLanc(form, lanc) {
    const admin = isAdmin();
    const tipo = fv(form, "tipo");
    const forma = fv(form, "forma");
    const jornada = jornadaDoForm(form);
    const ajuste = tipo === "ajuste";
    form.querySelector('[data-bloco="forma"]').hidden = ajuste;
    form.querySelectorAll("[data-mostrar]").forEach((el) => {
      el.hidden = ajuste ? el.dataset.mostrar !== "ajuste" : el.dataset.mostrar !== forma;
    });
    const credito = tipo !== "debito";
    form.querySelector('[data-texto="horario-label"]').textContent = credito ? "Em que horário você trabalhou a mais?" : "Em que horário você deixou de trabalhar?";
    form.querySelector('[data-texto="horario-hint"]').textContent = credito
      ? "Informe só o período extra. Ex.: seu horário acaba às 18:00 e você ficou até 20:30 → das 18:00 às 20:30."
      : "Informe só o período em que não trabalhou. Ex.: saiu às 16:00 em vez de 18:00 → das 16:00 às 18:00.";
    form.querySelector('[data-texto="dia"]').innerHTML = `Vale a jornada diária completa: <strong>${fmtHoras(jornada, false)}</strong>${credito ? " a mais (ex.: trabalhou num sábado inteiro)." : " a menos (ex.: folga ou falta no dia)."}`;
    const desc = form.elements.descricao;
    desc.placeholder = ajuste ? "Ex.: Acerto do saldo combinado com o RH."
      : credito ? "Ex.: Fiquei até mais tarde para finalizar as artes do Sapion Summit."
        : "Ex.: Saí mais cedo para uma consulta médica.";

    // Prévia do saldo
    let minutos = null;
    try {
      const d = lerLanc(form);
      minutos = Api.montar({ ...d, descricao: "ok-previa", data: d.data || hoje() }, jornada, admin).minutos;
    } catch (e) {
      minutos = null;
    }
    const previa = $("#previa", form);
    if (admin) {
      const uid = fv(form, "usuario_id");
      if (!uid) {
        previa.innerHTML = "";
        return;
      }
      const atual = somaAprovado(lancsDe(uid));
      const semEste = atual - (lanc && lanc.status === "aprovado" && lanc.usuario_id === uid ? lanc.minutos : 0);
      const conta = fv(form, "status") === "aprovado";
      const depois = minutos == null ? null : conta ? semEste + minutos : semEste;
      previa.innerHTML = resumoSaldo(atual, minutos, conta ? "Saldo depois" : "Saldo (este não conta)", depois);
    } else {
      previa.innerHTML = resumoSaldo(somaAprovado(state.meus), minutos, "Depois de aprovado");
    }
  }

  function campoDoErro(msg) {
    if (/data/i.test(msg)) return "data";
    if (/horário/i.test(msg)) return "ini";
    if (/quantas horas|24 horas/i.test(msg)) return "dur_h";
    if (/ajuste/i.test(msg)) return "aj_h";
    if (/Explique|explicação/i.test(msg)) return "descricao";
    if (/colaborador/i.test(msg)) return "usuario_id";
    return null;
  }

  async function salvarLancamento(form, lanc) {
    const admin = isAdmin();
    const d = lerLanc(form);
    if (admin && !fv(form, "usuario_id")) return fieldError(form, "usuario_id", "Escolha o colaborador.");
    if ((d.tipo === "ajuste" || d.forma === "duracao") && Number.isNaN(d.minutos)) {
      return fieldError(form, d.tipo === "ajuste" ? "aj_h" : "dur_h", "Use só números inteiros. Os minutos vão de 0 a 59.");
    }
    try {
      // Primeiro confere as horas (de cima para baixo no formulário), depois a explicação.
      Api.montar({ ...d, descricao: "ok" + d.descricao }, jornadaDoForm(form), admin);
      Api.montar(d, jornadaDoForm(form), admin);
    } catch (e) {
      const campo = campoDoErro(e.message);
      return campo ? fieldError(form, campo, e.message) : formError(form, e.message);
    }
    const dados = { ...d, id: lanc ? lanc.id : null };
    if (admin) {
      dados.usuario_id = fv(form, "usuario_id");
      dados.status = fv(form, "status");
      dados.observacao_admin = fv(form, "observacao_admin");
    }
    try {
      await rpc(admin ? "bh_admin_salvar_lancamento" : "bh_salvar_lancamento", { p_dados: dados });
    } catch (e) {
      if (e.sessaoExpirada) return true;
      const campo = campoDoErro(e.message);
      return campo ? fieldError(form, campo, e.message) : formError(form, e.message);
    }
    try {
      await carregar();
    } catch (e) {
      console.error(e);
    }
    renderShell();
    toast(lanc ? "Lançamento atualizado." : admin ? "Lançamento salvo." : "Lançamento enviado. Agora é só aguardar a aprovação.");
    return true;
  }

  function excluirMeuLanc(id) {
    const l = state.meus.find((x) => x.id === id);
    if (!l) return;
    confirmar({
      title: "Excluir lançamento?",
      body: `<p>O lançamento de <strong>${fmtDia(l.data)}</strong> (<strong>${fmtHoras(l.minutos)}</strong>) vai ser apagado. Ele ainda não foi analisado, então não muda o seu saldo.</p>`,
      label: "Excluir",
      onOk: () => executar(() => rpc("bh_excluir_lancamento", { p_id: id }), "Lançamento excluído."),
    });
  }

  function excluirLancAdmin(id) {
    const l = state.lancamentos.find((x) => x.id === id);
    if (!l) return;
    confirmar({
      title: "Excluir lançamento?",
      body: `
        <p>O lançamento de <strong>${esc(nomeDe(l.usuario_id))}</strong> em <strong>${fmtDia(l.data)}</strong> (<strong>${fmtHoras(l.minutos)}</strong>) vai ser apagado para sempre.</p>
        ${l.status === "aprovado" ? `<div class="callout callout--warning"><i data-lucide="triangle-alert"></i><div>Ele está aprovado: o saldo da pessoa vai mudar em <strong>${fmtHoras(-l.minutos)}</strong>. Se a ideia é só corrigir, prefira editar ou fazer um ajuste.</div></div>` : ""}`,
      label: "Excluir",
      onOk: () => executar(() => rpc("bh_admin_excluir_lancamento", { p_id: id }), "Lançamento excluído."),
    });
  }

  /* ----------------------------------------------------------------------
     Aprovar / recusar
     ---------------------------------------------------------------------- */

  function abrirAnalise(ids, status) {
    const ls = ids.map((id) => state.lancamentos.find((l) => l.id === id)).filter(Boolean);
    if (!ls.length) return;
    const um = ls.length === 1;
    const l = ls[0];
    const verbo = { aprovado: "Aprovar", recusado: "Recusar", pendente: "Voltar para pendente" }[status];
    let corpo;
    if (um) {
      const u = getUsuario(l.usuario_id);
      const det = detalheForma(l, u && u.jornada_minutos);
      const saldo = somaAprovado(lancsDe(l.usuario_id));
      const depois = saldo - (l.status === "aprovado" ? l.minutos : 0) + (status === "aprovado" ? l.minutos : 0);
      corpo = `
        <div class="review">
          <div class="review__row"><span>Colaborador</span><strong>${esc(nomeDe(l.usuario_id))}</strong></div>
          <div class="review__row"><span>Dia</span><strong>${fmtDia(l.data)} <span class="muted" style="font-weight:400">(${esc(diaSemana(l.data))})</span></strong></div>
          <div class="review__row"><span>Horas</span><strong class="${deltaCls(l.minutos)}">${fmtHoras(l.minutos)} <span class="muted" style="font-weight:400">· ${esc(det.texto)}</span></strong></div>
          <div class="review__row"><span>Saldo</span><strong>${fmtHoras(saldo)} → <span class="${deltaCls(depois)}">${fmtHoras(depois)}</span></strong></div>
          <div class="review__desc">${esc(l.descricao)}</div>
        </div>`;
    } else {
      const pessoas = new Set(ls.map((x) => x.usuario_id)).size;
      const soma = ls.reduce((s, x) => s + x.minutos, 0);
      corpo = `
        <div class="review">
          <div class="review__row"><span>Lançamentos</span><strong>${ls.length}</strong></div>
          <div class="review__row"><span>Colaboradores</span><strong>${pessoas}</strong></div>
          <div class="review__row"><span>Total</span><strong class="${deltaCls(soma)}">${fmtHoras(soma)}</strong></div>
        </div>`;
    }
    const obs = status === "pendente" ? "" : `
      <div class="field">
        <label class="field__label" for="f-obs">Observações <span class="opt">(opcional)</span></label>
        <textarea class="textarea" id="f-obs" name="obs" maxlength="1000" placeholder="${status === "aprovado" ? "Ex.: Confirmado com a produção do evento." : "Ex.: Essa atividade não precisava de hora extra. Vamos conversar."}">${esc(um && l.status === status ? l.observacao_admin : "")}</textarea>
        <span class="field__hint">${um ? "O colaborador vê esse texto no histórico dele." : "O mesmo texto vai para todos os lançamentos selecionados."}</span>
      </div>`;
    const nota = status === "pendente"
      ? `<div class="callout callout--warning"><i data-lucide="undo-2"></i><div>O lançamento volta para a fila de aprovação e ${l.status === "aprovado" ? "deixa de contar no saldo" : "a observação anterior é apagada"}.</div></div>`
      : "";
    openModal({
      title: um ? `${verbo} lançamento` : `${verbo} ${ls.length} lançamentos`,
      body: corpo + nota + obs,
      submitLabel: status === "aprovado" ? `<i data-lucide="check"></i> Aprovar` : status === "recusado" ? `<i data-lucide="x"></i> Recusar` : "Voltar para pendente",
      submitClass: status === "aprovado" ? "btn--approve" : status === "recusado" ? "btn--danger" : "",
      onSubmit: async (form) => {
        const texto = status === "pendente" ? "" : fv(form, "obs").trim();
        const ok = await executar(
          () => rpc("bh_admin_analisar", { p_ids: ls.map((x) => x.id), p_status: status, p_obs: texto }),
          status === "aprovado" ? (um ? "Lançamento aprovado." : `${ls.length} lançamentos aprovados.`)
            : status === "recusado" ? (um ? "Lançamento recusado." : `${ls.length} lançamentos recusados.`)
              : "Lançamento voltou para pendente.");
        if (ok) ls.forEach((x) => state.selecionados.delete(x.id));
        return ok;
      },
    });
  }

  /* ----------------------------------------------------------------------
     Colaboradores
     ---------------------------------------------------------------------- */

  function abrirColaborador(id) {
    const u = id ? getUsuario(id) : null;
    const eu = u && u.id === state.usuario.id;
    const papel = u ? u.papel : "colaborador";
    const body = `
      <div class="field">
        <label class="field__label" for="c-nome">Nome completo</label>
        <input class="input" id="c-nome" name="nome" maxlength="80" value="${esc(u ? u.nome : "")}" placeholder="Como vai aparecer na lista de entrada" autocomplete="off">
      </div>
      <div class="field">
        <label class="field__label" for="c-cargo">Cargo <span class="opt">(opcional)</span></label>
        <input class="input" id="c-cargo" name="cargo" maxlength="80" value="${esc(u ? u.cargo : "")}" placeholder="Ex.: Designer, Social media">
      </div>
      <div class="field">
        <span class="field__label">Perfil</span>
        <div class="segmented segmented--full" role="radiogroup" aria-label="Perfil">
          <input type="radio" name="papel" id="p-colab" value="colaborador" ${papel === "colaborador" ? "checked" : ""} ${eu ? "disabled" : ""}>
          <label for="p-colab"><i data-lucide="user"></i>Colaborador</label>
          <input type="radio" name="papel" id="p-admin" value="admin" ${papel === "admin" ? "checked" : ""}>
          <label for="p-admin"><i data-lucide="shield-check"></i>Administrador</label>
        </div>
        <span class="field__hint" id="papel-hint"></span>
      </div>
      <div data-colab>
        ${campoHM("jor", u ? u.jornada_minutos : 480, { label: "Jornada diária", hint: "Usada quando a pessoa lança um dia inteiro (folga, falta ou dia trabalhado a mais)." })}
      </div>
      <div class="field">
        <label class="field__label" for="c-senha">${u ? `Nova senha <span class="opt">(deixe em branco para manter a atual)</span>` : "Senha inicial"}</label>
        <div class="password">
          <input class="input" id="c-senha" name="senha" type="text" maxlength="72" autocomplete="new-password" spellcheck="false" placeholder="${u ? "" : "Mínimo de 6 caracteres"}">
          <button class="icon-btn" type="button" data-gerar-senha title="Gerar senha" aria-label="Gerar senha"><i data-lucide="wand-sparkles"></i></button>
        </div>
        <span class="field__hint">${u ? "Use quando a pessoa esquecer a senha. Ela vai precisar entrar de novo." : "Passe essa senha para a pessoa. Ela pode trocar depois, no menu com o nome dela."}</span>
      </div>
      ${u ? "" : `<div data-colab>${campoHM("ini", null, { label: `Saldo inicial <span class="opt">(opcional)</span>`, sinal: true, sinalLabel: ["A favor (+)", "Devendo (−)"], hint: "Se a pessoa já tinha horas acumuladas antes do sistema. Entra como um ajuste aprovado." })}</div>`}
      ${u && !eu ? `
        <label class="switch-field">
          <div><strong>Pode acessar o sistema</strong><span>Desligue para suspender o acesso sem apagar o histórico.</span></div>
          <span class="switch"><input type="checkbox" name="ativo" ${u.ativo ? "checked" : ""}><i></i></span>
        </label>` : ""}`;
    openModal({
      title: u ? "Editar usuário" : "Novo colaborador",
      subtitle: u ? esc(u.nome) : "A pessoa vai aparecer na lista da tela de entrada.",
      body,
      submitLabel: u ? `<i data-lucide="check"></i> Salvar` : `<i data-lucide="user-plus"></i> Cadastrar`,
      onMount: (form) => {
        const atualizar = () => {
          const adm = fv(form, "papel") === "admin" || (eu && papel === "admin");
          form.querySelectorAll("[data-colab]").forEach((el) => { el.hidden = adm; });
          $("#papel-hint", form).textContent = adm
            ? "Administrador aprova lançamentos e gerencia todos os usuários. Não tem banco de horas próprio."
            : "Colaborador vê e lança apenas as próprias horas.";
        };
        form.addEventListener("change", atualizar);
        form.querySelector("[data-gerar-senha]").addEventListener("click", () => {
          form.elements.senha.value = gerarSenha();
          form.elements.senha.focus();
        });
        atualizar();
      },
      onSubmit: async (form) => {
        const nome = fv(form, "nome").trim();
        if (nome.length < 2) return fieldError(form, "nome", "Informe o nome completo.");
        const papelNovo = eu ? "admin" : fv(form, "papel") || "colaborador";
        let jornada = u ? u.jornada_minutos : 480;
        if (papelNovo === "colaborador") {
          jornada = lerHM(form, "jor");
          if (jornada == null || Number.isNaN(jornada) || jornada < 60 || jornada > 720) {
            return fieldError(form, "jor_h", "A jornada diária precisa ficar entre 1h e 12h.");
          }
        }
        const senha = fv(form, "senha");
        if ((!u || senha) && senha.length < 6) return fieldError(form, "senha", "A senha precisa ter pelo menos 6 caracteres.");
        let saldo = 0;
        if (!u && papelNovo === "colaborador") {
          const s = lerHM(form, "ini");
          if (Number.isNaN(s)) return fieldError(form, "ini_h", "Use só números inteiros. Os minutos vão de 0 a 59.");
          saldo = s || 0;
        }
        const ativoEl = form.elements.ativo;
        const dados = {
          id: u ? u.id : null,
          nome,
          cargo: fv(form, "cargo").trim(),
          papel: papelNovo,
          jornada_minutos: jornada,
          ativo: ativoEl ? ativoEl.checked : true,
          senha,
          saldo_inicial_minutos: saldo,
        };
        try {
          await rpc("bh_admin_salvar_usuario", { p_dados: dados });
        } catch (e) {
          if (e.sessaoExpirada) return true;
          if (/nome/i.test(e.message)) return fieldError(form, "nome", e.message);
          if (/senha/i.test(e.message)) return fieldError(form, "senha", e.message);
          return formError(form, e.message);
        }
        try { await carregar(); } catch (e) { console.error(e); }
        renderShell();
        toast(u ? "Dados atualizados." : `${primeiroNome(nome)} foi cadastrado(a).`);
        if (!u) mostrarAcesso(nome, senha);
        return true;
      },
    });
  }

  /* Depois de cadastrar, mostra o que enviar para a pessoa. */
  function mostrarAcesso(nome, senha) {
    const link = location.href.split("#")[0].split("?")[0];
    const texto = `Olá, ${primeiroNome(nome)}! Seu acesso ao Banco de Horas do Marketing Sapion:\n\nLink: ${link}\nNome: ${nome}\nSenha: ${senha}\n\nNo primeiro acesso, troque a senha no menu com o seu nome.`;
    setTimeout(() => {
      openModal({
        title: "Acesso criado",
        subtitle: "Envie estas informações para a pessoa.",
        body: `
          <div class="field">
            <label class="field__label" for="acesso-texto">Mensagem pronta</label>
            <textarea class="textarea" id="acesso-texto" readonly style="min-height:170px">${esc(texto)}</textarea>
          </div>`,
        cancelLabel: "Fechar",
        submitLabel: `<i data-lucide="copy"></i> Copiar mensagem`,
        onSubmit: async (form) => {
          const ta = form.elements["acesso-texto"] || $("#acesso-texto", form);
          try {
            await navigator.clipboard.writeText(texto);
          } catch (e) {
            ta.select();
            document.execCommand("copy");
          }
          toast("Mensagem copiada.");
          return true;
        },
      });
    }, 50);
  }

  function excluirColaborador(id) {
    const u = getUsuario(id);
    if (!u) return;
    const n = lancsDe(id).length;
    confirmar({
      title: "Excluir usuário?",
      body: `
        <p><strong>${esc(u.nome)}</strong> vai sair da lista de entrada${n ? ` e os <strong>${n} ${n === 1 ? "lançamento" : "lançamentos"}</strong> dessa pessoa serão apagados` : ""}.</p>
        <div class="callout callout--danger"><i data-lucide="triangle-alert"></i><div>Não dá para desfazer. Se quiser só bloquear o acesso e manter o histórico, use <strong>Editar dados e senha</strong> e desligue "Pode acessar o sistema".</div></div>`,
      label: "Excluir usuário",
      onOk: () => executar(() => rpc("bh_admin_excluir_usuario", { p_id: id }), "Usuário excluído."),
    });
  }

  /* ----------------------------------------------------------------------
     Ajustar banco de horas
     ---------------------------------------------------------------------- */

  function abrirAjuste(id) {
    const u = getUsuario(id);
    if (!u) return;
    const saldo = somaAprovado(lancsDe(id));
    openModal({
      title: "Ajustar banco de horas",
      subtitle: esc(u.nome),
      body: `
        <div class="field">
          <span class="field__label">Tipo de ajuste</span>
          <div class="segmented segmented--full" role="radiogroup" aria-label="Tipo de ajuste">
            <input type="radio" name="modo" id="m-somar" value="somar" checked>
            <label for="m-somar"><i data-lucide="plus-minus"></i>Somar ou subtrair</label>
            <input type="radio" name="modo" id="m-definir" value="definir">
            <label for="m-definir"><i data-lucide="equal"></i>Definir novo saldo</label>
          </div>
        </div>
        <div id="aj-campos"></div>
        <div class="field">
          <label class="field__label" for="aj-data">Data do ajuste</label>
          <input class="input" id="aj-data" name="data" type="date" value="${hoje()}">
        </div>
        <div class="field">
          <label class="field__label" for="aj-desc">Motivo do ajuste</label>
          <textarea class="textarea" id="aj-desc" name="descricao" maxlength="1000" placeholder="Ex.: Horas pagas na folha de outubro."></textarea>
          <span class="field__hint">Obrigatório. Fica no histórico do colaborador.</span>
        </div>
        <div id="previa"></div>`,
      submitLabel: `<i data-lucide="check"></i> Salvar ajuste`,
      onMount: (form) => {
        let modoAnt = "";
        const atualizar = () => {
          const modo = fv(form, "modo");
          if (modo !== modoAnt) {
            modoAnt = modo;
            $("#aj-campos", form).innerHTML = modo === "definir"
              ? campoHM("aj", null, { label: "Novo saldo", sinal: true, sinalLabel: ["A favor (+)", "Devendo (−)"], hint: "O sistema calcula a diferença e registra como ajuste." })
              : campoHM("aj", null, { label: "Quanto ajustar", sinal: true });
          }
          const v = lerHM(form, "aj");
          const ok = v != null && !Number.isNaN(v);
          const delta = !ok ? null : modo === "definir" ? v - saldo : v;
          $("#previa", form).innerHTML = resumoSaldo(saldo, delta, "Novo saldo").replace("Este lançamento", "Ajuste");
        };
        form.addEventListener("input", atualizar);
        form.addEventListener("change", atualizar);
        atualizar();
      },
      onSubmit: async (form) => {
        const modo = fv(form, "modo");
        const v = lerHM(form, "aj");
        if (v == null || Number.isNaN(v)) return fieldError(form, "aj_h", "Informe as horas. Use só números inteiros; os minutos vão de 0 a 59.");
        if (modo === "somar" && v === 0) return fieldError(form, "aj_h", "Informe quanto ajustar.");
        if (modo === "definir" && v === saldo) return fieldError(form, "aj_h", "Esse já é o saldo atual.");
        if (!fv(form, "data")) return fieldError(form, "data", "Informe a data do ajuste.");
        const desc = fv(form, "descricao").trim();
        if (desc.length < 3) return fieldError(form, "descricao", "Explique o motivo do ajuste. Esse campo é obrigatório.");
        try {
          await rpc("bh_admin_ajustar_saldo", { p_usuario_id: id, p_modo: modo, p_minutos: v, p_descricao: desc, p_data: fv(form, "data") });
        } catch (e) {
          if (e.sessaoExpirada) return true;
          return formError(form, e.message);
        }
        try { await carregar(); } catch (e) { console.error(e); }
        renderShell();
        toast("Banco de horas ajustado.");
        return true;
      },
    });
  }

  /* ----------------------------------------------------------------------
     Senha
     ---------------------------------------------------------------------- */

  function abrirSenha() {
    const campo = (name, label, auto) => `
      <div class="field">
        <label class="field__label" for="s-${name}">${label}</label>
        <input class="input" id="s-${name}" name="${name}" type="password" maxlength="72" autocomplete="${auto}">
      </div>`;
    openModal({
      title: "Alterar minha senha",
      body: campo("atual", "Senha atual", "current-password") + campo("nova", "Nova senha", "new-password") +
        campo("conf", "Repita a nova senha", "new-password") +
        `<span class="field__hint" style="margin-top:-8px">Mínimo de 6 caracteres. As outras sessões abertas com o seu nome serão encerradas.</span>`,
      submitLabel: `<i data-lucide="key-round"></i> Alterar senha`,
      onSubmit: async (form) => {
        const atual = fv(form, "atual");
        const nova = fv(form, "nova");
        if (!atual) return fieldError(form, "atual", "Digite a sua senha atual.");
        if (nova.length < 6) return fieldError(form, "nova", "A nova senha precisa ter pelo menos 6 caracteres.");
        if (nova !== fv(form, "conf")) return fieldError(form, "conf", "As duas senhas não estão iguais.");
        try {
          await rpc("bh_alterar_senha", { p_atual: atual, p_nova: nova });
        } catch (e) {
          if (e.sessaoExpirada) return true;
          if (/atual/i.test(e.message)) return fieldError(form, "atual", e.message);
          return fieldError(form, "nova", e.message);
        }
        toast("Senha alterada.");
        return true;
      },
    });
  }

  function reiniciarDemo() {
    confirmar({
      title: "Reiniciar demonstração?",
      body: `<p>Os dados de exemplo voltam ao início e tudo o que foi feito na demonstração é apagado deste navegador.</p>`,
      label: "Reiniciar",
      onOk: async () => {
        api.reiniciar();
        limparSessao();
        renderLogin();
        toast("Demonstração reiniciada.");
        return true;
      },
    });
  }

  /* ----------------------------------------------------------------------
     Planilha Excel (administrador)
     ---------------------------------------------------------------------- */

  function abrirExportar() {
    const opcoes = [
      ["30", "Últimos 30 dias"],
      ["mes", "Este mês"],
      ["90", "Últimos 90 dias"],
      ["365", "Último ano"],
      ["todos", "Todo o período"],
    ];
    openModal({
      title: "Baixar planilha",
      subtitle: "Arquivo Excel com o saldo de cada colaborador e os lançamentos do período.",
      body: `
        <div class="choice-list" role="radiogroup" aria-label="Período">
          ${opcoes.map(([v, l], i) => `
            <label class="choice">
              <input type="radio" name="periodo" value="${v}" ${i === 0 ? "checked" : ""}>
              <div><strong>${l}</strong><span>${v === "todos" ? "Todos os lançamentos registrados" : "Lançamentos com data dentro do período"}</span></div>
            </label>`).join("")}
        </div>
        <div class="callout"><i data-lucide="info"></i><div>A aba <strong>Saldos</strong> sempre mostra o saldo atual completo, independente do período.</div></div>`,
      submitLabel: `<i data-lucide="download"></i> Baixar planilha`,
      onSubmit: (form) => exportarExcel(fv(form, "periodo")),
    });
  }

  function exportarExcel(periodo) {
    if (!window.XLSX) {
      toast("Não foi possível carregar o gerador de planilhas. Verifique a internet.", "error");
      return false;
    }
    const horasDec = (m) => Math.round((m / 60) * 100) / 100;
    const fmtHoras = (m, sinal) => fmtHorasTela(m, sinal).replace("−", "-"); // sinal comum no Excel
    const saldos = [...state.usuarios].sort(cmpNome)
      .filter((u) => u.papel === "colaborador" || lancsDe(u.id).length)
      .map((u) => {
        const ls = lancsDe(u.id);
        const s = somaAprovado(ls);
        const p = pendentesDe(ls);
        const sp = p.reduce((x, l) => x + l.minutos, 0);
        return {
          "Colaborador": u.nome,
          "Cargo": u.cargo,
          "Jornada diária": fmtHoras(u.jornada_minutos, false),
          "Saldo aprovado": fmtHoras(s),
          "Saldo aprovado (horas decimais)": horasDec(s),
          "Pendentes (quantidade)": p.length,
          "Pendentes (horas)": fmtHoras(sp),
          "Acesso": u.ativo ? "Liberado" : "Suspenso",
        };
      });
    const ls = state.lancamentos.filter((l) => noPeriodo(l, periodo))
      .sort((a, b) => a.data.localeCompare(b.data) || a.criado_em.localeCompare(b.criado_em));
    const linhas = ls.map((l) => {
      const u = getUsuario(l.usuario_id);
      return {
        "Data": fmtDia(l.data),
        "Colaborador": nomeDe(l.usuario_id),
        "Tipo": (TIPOS[l.tipo] || TIPOS.ajuste).longo,
        "Como foi informado": detalheForma(l, u && u.jornada_minutos).texto,
        "Horas": fmtHoras(l.minutos),
        "Horas (decimais)": horasDec(l.minutos),
        "Status": (STATUS[l.status] || STATUS.pendente).label,
        "Explicação": l.descricao,
        "Observação do administrador": l.observacao_admin,
        "Analisado por": l.analisado_por_nome || "",
        "Analisado em": l.analisado_em ? fmtDataHora(l.analisado_em) : "",
        "Lançado por": l.criado_por_nome || "",
        "Lançado em": fmtDataHora(l.criado_em),
      };
    });
    const wb = XLSX.utils.book_new();
    const ws1 = XLSX.utils.json_to_sheet(saldos.length ? saldos : [{ "Colaborador": "Nenhum colaborador cadastrado" }]);
    ws1["!cols"] = [{ wch: 30 }, { wch: 24 }, { wch: 14 }, { wch: 15 }, { wch: 18 }, { wch: 14 }, { wch: 15 }, { wch: 10 }];
    XLSX.utils.book_append_sheet(wb, ws1, "Saldos");
    const ws2 = XLSX.utils.json_to_sheet(linhas.length ? linhas : [{ "Data": "Nenhum lançamento no período" }]);
    ws2["!cols"] = [{ wch: 11 }, { wch: 28 }, { wch: 22 }, { wch: 30 }, { wch: 9 }, { wch: 10 }, { wch: 10 }, { wch: 60 }, { wch: 45 }, { wch: 26 }, { wch: 20 }, { wch: 26 }, { wch: 20 }];
    XLSX.utils.book_append_sheet(wb, ws2, "Lançamentos");
    XLSX.writeFile(wb, `banco-de-horas-marketing-sapion-${hoje()}.xlsx`);
    toast("Planilha gerada.");
    return true;
  }

  /* ======================================================================
     Eventos globais
     ====================================================================== */

  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-action]");
    if (!el || el.closest(".menu")) return;
    const { action, id } = el.dataset;
    switch (action) {
      case "ver-senha": {
        const input = el.parentElement.querySelector("input");
        const mostrar = input.type === "password";
        input.type = mostrar ? "text" : "password";
        el.setAttribute("aria-label", mostrar ? "Esconder senha" : "Mostrar senha");
        el.innerHTML = `<i data-lucide="${mostrar ? "eye-off" : "eye"}"></i>`;
        icons();
        break;
      }
      case "tab":
        state.tab = el.dataset.tab;
        renderView();
        break;
      case "novo-lancamento": abrirLancamento(); break;
      case "editar-lanc": {
        const l = state.meus.find((x) => x.id === id);
        if (l) abrirLancamento({ lanc: l });
        break;
      }
      case "excluir-lanc": excluirMeuLanc(id); break;
      case "aprovar": abrirAnalise([id], "aprovado"); break;
      case "recusar": abrirAnalise([id], "recusado"); break;
      case "aprovar-sel": abrirAnalise(pendentesFiltrados().filter((l) => state.selecionados.has(l.id)).map((l) => l.id), "aprovado"); break;
      case "recusar-sel": abrirAnalise(pendentesFiltrados().filter((l) => state.selecionados.has(l.id)).map((l) => l.id), "recusado"); break;
      case "selecionar":
        if (el.checked) state.selecionados.add(id);
        else state.selecionados.delete(id);
        renderAprovLista();
        break;
      case "selecionar-todos": {
        const ls = pendentesFiltrados();
        if (el.checked) ls.forEach((l) => state.selecionados.add(l.id));
        else ls.forEach((l) => state.selecionados.delete(l.id));
        renderAprovLista();
        break;
      }
      case "menu-lanc": toggleMenu(el, menuLanc(id)); break;
      case "menu-colab": toggleMenu(el, menuColab(id)); break;
      case "menu-usuario": {
        const u = state.usuario;
        toggleMenu(el, menuUsuario(), `<div class="menu__head"><strong>${esc(u.nome)}</strong><span>${u.papel === "admin" ? "Administrador" : esc(u.cargo || "Colaborador")}</span></div>`);
        break;
      }
      case "novo-colab": abrirColaborador(); break;
      case "ajustar": abrirAjuste(id); break;
      case "exportar": abrirExportar(); break;
      case "mais":
        state.limite += 30;
        renderMinhaLista();
        break;
      case "mais-adm":
        state.limiteAdm += 50;
        renderTodosLista();
        break;
      case "limpar-filtros":
        state.filtros = { busca: "", usuario: "", status: "", tipo: "", periodo: "todos" };
        renderView();
        break;
    }
  });

  document.addEventListener("input", (e) => {
    const t = e.target;
    if (t.id === "busca-colab") {
      state.buscaColab = t.value;
      renderColabTabela();
    } else if (t.id === "f-busca") {
      state.filtros.busca = t.value;
      state.limiteAdm = 50;
      renderTodosLista();
    }
  });

  document.addEventListener("change", (e) => {
    const t = e.target;
    if (t.name === "f-status") {
      state.filtroStatus = t.value;
      state.limite = 30;
      renderMinhaLista();
    } else if (t.id === "f-periodo") {
      state.periodo = t.value;
      state.limite = 30;
      renderMinhaLista();
    } else if (t.id === "f-aprov-usuario") {
      state.filtroAprov = t.value;
      renderAprovLista();
    } else {
      const mapa = { "f-usuario": "usuario", "f-status": "status", "f-tipo": "tipo", "f-periodo-adm": "periodo" };
      if (mapa[t.id]) {
        state.filtros[mapa[t.id]] = t.value;
        state.limiteAdm = 50;
        renderTodosLista();
      }
    }
  });

  document.addEventListener("mousedown", (e) => {
    if (menuAtual && !menuAtual.m.contains(e.target) && !menuAtual.anchor.contains(e.target)) closeMenu();
  });
  window.addEventListener("resize", closeMenu);
  window.addEventListener("scroll", closeMenu, true);

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (menuAtual) {
      const a = menuAtual.anchor;
      closeMenu();
      a.focus();
    } else if (modalAtual) {
      closeModal();
    }
  });

  /* Atualiza os dados ao voltar para a aba e a cada minuto (se ninguém estiver digitando). */
  async function atualizarRemoto() {
    if (!api || !state.token || modalAtual || menuAtual || !$("#view")) return;
    const ativo = document.activeElement;
    if (ativo && ativo.matches && ativo.matches("input, select, textarea")) return;
    try {
      await carregar();
      renderView();
    } catch (e) {
      console.error(e);
    }
  }
  window.addEventListener("focus", atualizarRemoto);
  setInterval(atualizarRemoto, 60000);

  /* ======================================================================
     Início
     ====================================================================== */

  async function iniciar() {
    try {
      api = Api.create(CONFIG);
      await api.init();
    } catch (e) {
      console.error(e);
      app.innerHTML = `
        <main class="container">
          <div class="card empty">
            <div class="empty__icon"><i data-lucide="database"></i></div>
            <h3>Não conseguimos conectar ao banco de dados</h3>
            <p>${esc(e.message || e)}</p>
            <p>Confira a configuração em <strong>js/config.js</strong> e a sua conexão com a internet.</p>
            <button class="btn" type="button" onclick="location.reload()"><i data-lucide="refresh-cw"></i> Tentar de novo</button>
          </div>
        </main>`;
      icons();
      return;
    }
    const token = getToken();
    if (token) {
      try {
        state.token = token;
        state.usuario = await api.call("bh_sessao", { p_token: token });
        await entrar();
        return;
      } catch (e) {
        limparSessao();
      }
    }
    renderLogin();
  }

  iniciar();
})();
