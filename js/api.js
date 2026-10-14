/* =========================================================================
   Camada de dados — Banco de Horas do Marketing Sapion

   Dois modos, com a mesma interface:
   - SupabaseApi: o sistema de verdade. Chama as funções "bh_..." criadas pelo
     arquivo banco-de-horas.sql. Todas as regras (senhas, permissões, aprovação)
     ficam no banco.
   - DemoApi: modo demonstração, sem configurar nada. Imita as mesmas funções
     com dados de exemplo salvos só neste navegador.

   Interface:
     await api.init()
     await api.call("bh_nome_da_funcao", { parametros })  -> resultado
     (erros chegam como Error com a mensagem pronta para mostrar)
   ========================================================================= */

window.Api = (() => {
  "use strict";

  const SUPABASE_CDN = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js";
  const SESSAO_EXPIRADA = "SESSAO_EXPIRADA";

  const pad = (n) => String(n).padStart(2, "0");
  const hojeIso = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  function falha(msg) {
    throw new Error(msg);
  }

  function minutosDoHorario(hhmm) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || "").trim());
    if (!m) return null;
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h > 23 || min > 59) return null;
    return h * 60 + min;
  }

  /* Valida um lançamento e calcula os minutos com sinal.
     Mesmas regras da função bh__montar do banco. */
  function montar(d, jornada, admin) {
    const tipo = String(d.tipo || "");
    let forma = String(d.forma || "");
    const descricao = String(d.descricao || "").trim();
    const data = String(d.data || "");
    const dt = /^\d{4}-\d{2}-\d{2}$/.test(data) ? new Date(data + "T12:00:00") : null;
    if (!data) falha("Informe a data do lançamento.");
    if (!dt || isNaN(dt) || hojeIso(dt) !== data) falha("Informe uma data válida.");
    const limite = new Date();
    limite.setDate(limite.getDate() + 366);
    if (data < "2000-01-01" || data > hojeIso(limite)) falha("Informe uma data válida.");
    if (descricao.length < 3) falha("Explique o lançamento. Esse campo é obrigatório.");
    if (descricao.length > 1000) falha("A explicação pode ter no máximo 1000 caracteres.");

    let minutos;
    let inicio = null;
    let fim = null;
    if (tipo === "ajuste") {
      if (!admin) falha("Tipo de lançamento inválido.");
      forma = "ajuste";
      minutos = Math.trunc(Number(d.minutos) || 0);
      if (!minutos) falha("Informe a quantidade de horas do ajuste.");
    } else if (tipo === "credito" || tipo === "debito") {
      if (forma === "horario") {
        const a = minutosDoHorario(d.hora_inicio);
        const b = minutosDoHorario(d.hora_fim);
        if (a == null || b == null) falha("Informe o horário de início e de fim.");
        if (a === b) falha("O horário de início e o de fim não podem ser iguais.");
        minutos = b - a;
        if (minutos < 0) minutos += 1440; // terminou depois da meia-noite
        inicio = `${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
        fim = `${pad(Math.floor(b / 60))}:${pad(b % 60)}`;
      } else if (forma === "duracao") {
        minutos = Math.abs(Math.trunc(Number(d.minutos) || 0));
        if (!minutos) falha("Informe quantas horas.");
        if (minutos > 1440) falha("Um lançamento pode ter no máximo 24 horas.");
      } else if (forma === "dia") {
        minutos = jornada;
      } else {
        falha("Escolha como informar as horas.");
      }
      if (tipo === "debito") minutos = -minutos;
    } else {
      falha("Escolha se foram horas a mais ou a menos.");
    }
    return { data, tipo, forma, hora_inicio: inicio, hora_fim: fim, minutos, descricao };
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error("Não foi possível carregar " + src));
      document.head.appendChild(s);
    });
  }

  /* ---------------------------------------------------------------------- */

  class SupabaseApi {
    constructor(url, key) {
      this.mode = "supabase";
      this.url = url;
      this.key = key;
    }

    async init() {
      if (!window.supabase) await loadScript(SUPABASE_CDN);
      this.client = window.supabase.createClient(this.url, this.key, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
    }

    async call(nome, params = {}) {
      let resp;
      try {
        resp = await this.client.rpc(nome, params);
      } catch (e) {
        throw new Error("Sem conexão com o banco de dados. Verifique a internet e tente de novo.");
      }
      const { data, error } = resp;
      if (error) {
        const msg = String(error.message || "");
        if (msg.includes(SESSAO_EXPIRADA)) {
          const e = new Error("Sua sessão expirou. Entre de novo.");
          e.sessaoExpirada = true;
          throw e;
        }
        if (error.code === "PGRST202" || /Could not find the function/i.test(msg)) {
          throw new Error("O banco de dados ainda não foi preparado. Rode o arquivo banco-de-horas.sql no Supabase (veja o tutorial).");
        }
        if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) {
          throw new Error("Sem conexão com o banco de dados. Verifique a internet e tente de novo.");
        }
        if (/Invalid API key|JWT|apikey/i.test(msg)) {
          throw new Error("A chave do Supabase em js/config.js não foi aceita. Confira se copiou a chave publishable (ou anon public) completa.");
        }
        throw new Error(msg || "Erro desconhecido no banco de dados.");
      }
      return data;
    }
  }

  /* ----------------------------------------------------------------------
     Modo demonstração (dados de exemplo, só neste navegador)
     ---------------------------------------------------------------------- */

  const DEMO_KEY = "sapion-banco-horas-demo-v1";
  const DEMO_SENHA = "demo123";

  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }

  // Hash simples, suficiente para a demonstração (no Supabase as senhas usam bcrypt).
  function demoHash(id, senha) {
    let h = 2166136261;
    const s = id + ":" + senha;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16);
  }

  function diasAtras(n) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return hojeIso(d);
  }

  function demoSeed() {
    const agora = new Date().toISOString();
    const usuarios = [
      { nome: "Felipe Cherque de Marchi", cargo: "Coordenador de Marketing", papel: "admin" },
      { nome: "Ana Souza", cargo: "Designer", papel: "colaborador" },
      { nome: "Bruno Lima", cargo: "Social media", papel: "colaborador" },
      { nome: "Carla Mendes", cargo: "Analista de conteúdo", papel: "colaborador", jornada_minutos: 360 },
    ].map((u) => {
      const id = uid();
      return {
        id, jornada_minutos: 480, ativo: true, criado_em: agora, ...u,
        senha_hash: demoHash(id, DEMO_SENHA), tentativas_falhas: 0, bloqueado_ate: null,
      };
    });
    const [felipe, ana, bruno, carla] = usuarios;
    const L = (u, dias, extra) => {
      const criado = new Date(Date.now() - dias * 86400000 - 3600000 * 2).toISOString();
      const base = {
        id: uid(), usuario_id: u.id, data: diasAtras(dias), hora_inicio: null, hora_fim: null,
        status: "pendente", observacao_admin: "", analisado_por_nome: null, analisado_em: null,
        criado_por_nome: u.nome, criado_pelo_admin: false, editado_por_nome: null,
        criado_em: criado, atualizado_em: criado,
      };
      const l = { ...base, ...extra };
      if (l.status !== "pendente") {
        l.analisado_por_nome = felipe.nome;
        l.analisado_em = new Date(new Date(criado).getTime() + 86400000).toISOString();
      }
      return l;
    };
    const ap = { status: "aprovado" };
    const lancamentos = [
      L(ana, 40, { tipo: "ajuste", forma: "ajuste", minutos: 210, descricao: "Saldo inicial do banco de horas", criado_por_nome: felipe.nome, criado_pelo_admin: true, ...ap }),
      L(ana, 12, { tipo: "credito", forma: "horario", hora_inicio: "18:00", hora_fim: "21:00", minutos: 180, descricao: "Cobertura do Sapion Summit: montagem do estande e fotos.", ...ap, observacao_admin: "Confirmado com a produção do evento." }),
      L(ana, 6, { tipo: "debito", forma: "duracao", minutos: -90, descricao: "Saí mais cedo para consulta médica.", ...ap }),
      L(ana, 1, { tipo: "credito", forma: "horario", hora_inicio: "17:30", hora_fim: "19:45", minutos: 135, descricao: "Ajustes finais nas artes da campanha de matrículas." }),
      L(bruno, 20, { tipo: "credito", forma: "duracao", minutos: 240, descricao: "Gravação de conteúdo no sábado de manhã.", ...ap }),
      L(bruno, 9, { tipo: "debito", forma: "dia", minutos: -480, descricao: "Folga compensatória pelas horas do sábado.", ...ap }),
      L(bruno, 3, { tipo: "credito", forma: "horario", hora_inicio: "07:00", hora_fim: "08:00", minutos: 60, descricao: "Cheguei mais cedo para publicar os stories do evento.", status: "recusado", observacao_admin: "Essa publicação estava agendada, não precisava vir antes." }),
      L(bruno, 0, { tipo: "debito", forma: "duracao", minutos: -30, descricao: "Atraso por causa do trânsito na ponte." }),
      L(carla, 15, { tipo: "credito", forma: "horario", hora_inicio: "16:00", hora_fim: "18:30", minutos: 150, descricao: "Revisão dos e-mails para a base de cursistas.", ...ap }),
      L(carla, 2, { tipo: "debito", forma: "dia", minutos: -360, descricao: "Folga para resolver assuntos pessoais." }),
    ];
    return { usuarios, sessoes: [], lancamentos };
  }

  class DemoApi {
    constructor() {
      this.mode = "demo";
    }

    async init() {
      try {
        localStorage.setItem(DEMO_KEY + "-teste", "1");
        localStorage.removeItem(DEMO_KEY + "-teste");
        this.temStorage = true;
      } catch (e) {
        this.temStorage = false;
      }
      this.db = this.ler() || demoSeed();
      this.gravar();
    }

    ler() {
      if (!this.temStorage) return this.db || null;
      try {
        const raw = localStorage.getItem(DEMO_KEY);
        return raw ? JSON.parse(raw) : null;
      } catch (e) {
        return null;
      }
    }

    gravar() {
      if (!this.temStorage) return;
      try {
        localStorage.setItem(DEMO_KEY, JSON.stringify(this.db));
      } catch (e) {
        /* sem espaço: segue só na memória */
      }
    }

    reiniciar() {
      this.db = demoSeed();
      this.gravar();
    }

    json(u) {
      const { id, nome, cargo, papel, jornada_minutos, ativo, criado_em } = u;
      return { id, nome, cargo, papel, jornada_minutos, ativo, criado_em };
    }

    usuario(token) {
      const s = this.db.sessoes.find((x) => x.token === token && new Date(x.expira_em) > new Date());
      const u = s && this.db.usuarios.find((x) => x.id === s.usuario_id && x.ativo);
      if (!u) {
        const e = new Error("Sua sessão expirou. Entre de novo.");
        e.sessaoExpirada = true;
        throw e;
      }
      return u;
    }

    admin(token) {
      const u = this.usuario(token);
      if (u.papel !== "admin") falha("Acesso restrito ao administrador.");
      return u;
    }

    ordenar(ls) {
      return [...ls].sort((a, b) => b.data.localeCompare(a.data) || b.criado_em.localeCompare(a.criado_em));
    }

    async call(nome, p = {}) {
      this.db = this.ler() || this.db;
      const fn = this["f_" + nome];
      if (!fn) falha("Função desconhecida: " + nome);
      const r = fn.call(this, p);
      this.gravar();
      // devolve uma cópia, como viria da rede
      return r === undefined ? null : JSON.parse(JSON.stringify(r));
    }

    f_bh_listar_nomes() {
      return this.db.usuarios
        .filter((u) => u.ativo)
        .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"))
        .map((u) => ({ id: u.id, nome: u.nome }));
    }

    f_bh_login({ p_usuario_id, p_senha }) {
      const u = this.db.usuarios.find((x) => x.id === p_usuario_id && x.ativo);
      if (!u) return { ok: false, erro: "Usuário não encontrado. Atualize a página e tente de novo." };
      if (u.bloqueado_ate && new Date(u.bloqueado_ate) > new Date()) {
        const min = Math.max(1, Math.ceil((new Date(u.bloqueado_ate) - new Date()) / 60000));
        return { ok: false, erro: `Muitas tentativas com senha errada. Tente de novo em ${min} min.` };
      }
      if (u.senha_hash !== demoHash(u.id, p_senha || "")) {
        u.tentativas_falhas += 1;
        if (u.tentativas_falhas >= 5) {
          u.tentativas_falhas = 0;
          u.bloqueado_ate = new Date(Date.now() + 5 * 60000).toISOString();
          return { ok: false, erro: "Senha incorreta. Por segurança, este acesso ficou bloqueado por 5 minutos." };
        }
        return { ok: false, erro: "Senha incorreta. Tente de novo." };
      }
      u.tentativas_falhas = 0;
      u.bloqueado_ate = null;
      this.db.sessoes = this.db.sessoes.filter((s) => new Date(s.expira_em) > new Date());
      const token = uid().replace(/-/g, "") + uid().replace(/-/g, "");
      this.db.sessoes.push({ token, usuario_id: u.id, expira_em: new Date(Date.now() + 12 * 3600000).toISOString() });
      return { ok: true, token, usuario: this.json(u) };
    }

    f_bh_sessao({ p_token }) {
      return this.json(this.usuario(p_token));
    }

    f_bh_logout({ p_token }) {
      this.db.sessoes = this.db.sessoes.filter((s) => s.token !== p_token);
      return true;
    }

    f_bh_alterar_senha({ p_token, p_atual, p_nova }) {
      const u = this.usuario(p_token);
      if (u.senha_hash !== demoHash(u.id, p_atual || "")) falha("A senha atual está incorreta.");
      if (String(p_nova || "").length < 6) falha("A nova senha precisa ter pelo menos 6 caracteres.");
      if (String(p_nova).length > 72) falha("A nova senha pode ter no máximo 72 caracteres.");
      u.senha_hash = demoHash(u.id, p_nova);
      this.db.sessoes = this.db.sessoes.filter((s) => s.usuario_id !== u.id || s.token === p_token);
      return true;
    }

    f_bh_meus_dados({ p_token }) {
      const u = this.usuario(p_token);
      return { usuario: this.json(u), lancamentos: this.ordenar(this.db.lancamentos.filter((l) => l.usuario_id === u.id)) };
    }

    f_bh_salvar_lancamento({ p_token, p_dados }) {
      const u = this.usuario(p_token);
      if (u.papel === "admin") falha("O administrador lança horas pela área de administração.");
      const r = montar(p_dados, u.jornada_minutos, false);
      const agora = new Date().toISOString();
      if (!p_dados.id) {
        const l = {
          id: uid(), usuario_id: u.id, ...r, status: "pendente", observacao_admin: "",
          analisado_por_nome: null, analisado_em: null, criado_por_nome: u.nome, criado_pelo_admin: false,
          editado_por_nome: null, criado_em: agora, atualizado_em: agora,
        };
        this.db.lancamentos.push(l);
        return l;
      }
      const l = this.db.lancamentos.find((x) => x.id === p_dados.id && x.usuario_id === u.id);
      if (!l) falha("Lançamento não encontrado.");
      if (l.status !== "pendente") falha("Só dá para editar lançamentos que ainda estão pendentes.");
      Object.assign(l, r, { atualizado_em: agora });
      return l;
    }

    f_bh_excluir_lancamento({ p_token, p_id }) {
      const u = this.usuario(p_token);
      const l = this.db.lancamentos.find((x) => x.id === p_id && x.usuario_id === u.id);
      if (!l) falha("Lançamento não encontrado.");
      if (l.status !== "pendente") falha("Só dá para excluir lançamentos que ainda estão pendentes.");
      this.db.lancamentos = this.db.lancamentos.filter((x) => x.id !== p_id);
      return true;
    }

    f_bh_admin_dados({ p_token }) {
      const a = this.admin(p_token);
      return {
        usuario: this.json(a),
        usuarios: [...this.db.usuarios].sort((x, y) => x.nome.localeCompare(y.nome, "pt-BR")).map((u) => this.json(u)),
        lancamentos: this.ordenar(this.db.lancamentos),
      };
    }

    outroAdminAtivo(id) {
      return this.db.usuarios.some((x) => x.papel === "admin" && x.ativo && x.id !== id);
    }

    f_bh_admin_salvar_usuario({ p_token, p_dados: p }) {
      const a = this.admin(p_token);
      const id = p.id || null;
      const nome = String(p.nome || "").trim().replace(/\s+/g, " ");
      const cargo = String(p.cargo || "").trim();
      const papel = p.papel || "colaborador";
      const jornada = p.jornada_minutos == null || p.jornada_minutos === "" ? 480 : Math.trunc(Number(p.jornada_minutos));
      const ativo = p.ativo == null ? true : !!p.ativo;
      const senha = String(p.senha || "");
      const saldo = Math.trunc(Number(p.saldo_inicial_minutos) || 0);
      if (nome.length < 2 || nome.length > 80) falha("Informe o nome completo (de 2 a 80 caracteres).");
      if (cargo.length > 80) falha("O cargo pode ter no máximo 80 caracteres.");
      if (!["admin", "colaborador"].includes(papel)) falha("Perfil inválido.");
      if (!(jornada >= 60 && jornada <= 720)) falha("A jornada diária precisa ficar entre 1h e 12h.");
      if ((!id || senha) && senha.length < 6) falha("A senha precisa ter pelo menos 6 caracteres.");
      if (senha.length > 72) falha("A senha pode ter no máximo 72 caracteres.");
      if (this.db.usuarios.some((x) => x.nome.toLowerCase() === nome.toLowerCase() && x.id !== id)) falha("Já existe um usuário com esse nome.");
      const agora = new Date().toISOString();
      if (!id) {
        const nid = uid();
        const u = {
          id: nid, nome, cargo, papel, jornada_minutos: jornada, ativo, criado_em: agora,
          senha_hash: demoHash(nid, senha), tentativas_falhas: 0, bloqueado_ate: null,
        };
        this.db.usuarios.push(u);
        if (saldo) {
          this.db.lancamentos.push({
            id: uid(), usuario_id: nid, data: hojeIso(), tipo: "ajuste", forma: "ajuste", hora_inicio: null, hora_fim: null,
            minutos: saldo, descricao: "Saldo inicial do banco de horas", status: "aprovado", observacao_admin: "",
            analisado_por_nome: a.nome, analisado_em: agora, criado_por_nome: a.nome, criado_pelo_admin: true,
            editado_por_nome: null, criado_em: agora, atualizado_em: agora,
          });
        }
        return this.json(u);
      }
      const u = this.db.usuarios.find((x) => x.id === id);
      if (!u) falha("Usuário não encontrado.");
      if (u.id === a.id && (papel !== "admin" || !ativo)) falha("Você não pode tirar o seu próprio acesso de administrador.");
      if (u.papel === "admin" && (papel !== "admin" || !ativo) && !this.outroAdminAtivo(u.id)) falha("O sistema precisa de pelo menos um administrador ativo.");
      Object.assign(u, { nome, cargo, papel, jornada_minutos: jornada, ativo });
      if (senha) Object.assign(u, { senha_hash: demoHash(u.id, senha), tentativas_falhas: 0, bloqueado_ate: null });
      if (u.id !== a.id && (senha || !ativo)) this.db.sessoes = this.db.sessoes.filter((s) => s.usuario_id !== u.id);
      return this.json(u);
    }

    f_bh_admin_excluir_usuario({ p_token, p_id }) {
      const a = this.admin(p_token);
      const u = this.db.usuarios.find((x) => x.id === p_id);
      if (!u) falha("Usuário não encontrado.");
      if (u.id === a.id) falha("Você não pode excluir o seu próprio usuário.");
      if (u.papel === "admin" && !this.outroAdminAtivo(u.id)) falha("O sistema precisa de pelo menos um administrador ativo.");
      this.db.usuarios = this.db.usuarios.filter((x) => x.id !== p_id);
      this.db.lancamentos = this.db.lancamentos.filter((x) => x.usuario_id !== p_id);
      this.db.sessoes = this.db.sessoes.filter((x) => x.usuario_id !== p_id);
      return true;
    }

    f_bh_admin_salvar_lancamento({ p_token, p_dados: p }) {
      const a = this.admin(p_token);
      const u = this.db.usuarios.find((x) => x.id === p.usuario_id);
      if (!u) falha("Escolha o colaborador.");
      const status = p.status || "aprovado";
      const obs = String(p.observacao_admin || "").trim();
      if (!["pendente", "aprovado", "recusado"].includes(status)) falha("Status inválido.");
      if (obs.length > 1000) falha("As observações podem ter no máximo 1000 caracteres.");
      const r = montar(p, u.jornada_minutos, true);
      const agora = new Date().toISOString();
      if (!p.id) {
        const l = {
          id: uid(), usuario_id: u.id, ...r, status, observacao_admin: obs,
          analisado_por_nome: status !== "pendente" ? a.nome : null,
          analisado_em: status !== "pendente" ? agora : null,
          criado_por_nome: a.nome, criado_pelo_admin: true, editado_por_nome: null,
          criado_em: agora, atualizado_em: agora,
        };
        this.db.lancamentos.push(l);
        return l;
      }
      const l = this.db.lancamentos.find((x) => x.id === p.id);
      if (!l) falha("Lançamento não encontrado.");
      const mudou = status !== l.status;
      Object.assign(l, r, {
        usuario_id: u.id,
        status,
        observacao_admin: obs,
        analisado_por_nome: status === "pendente" ? null : mudou ? a.nome : l.analisado_por_nome || a.nome,
        analisado_em: status === "pendente" ? null : mudou ? agora : l.analisado_em || agora,
        editado_por_nome: a.nome,
        atualizado_em: agora,
      });
      return l;
    }

    f_bh_admin_excluir_lancamento({ p_token, p_id }) {
      this.admin(p_token);
      if (!this.db.lancamentos.some((x) => x.id === p_id)) falha("Lançamento não encontrado.");
      this.db.lancamentos = this.db.lancamentos.filter((x) => x.id !== p_id);
      return true;
    }

    f_bh_admin_analisar({ p_token, p_ids, p_status, p_obs }) {
      const a = this.admin(p_token);
      const obs = String(p_obs || "").trim();
      if (!["pendente", "aprovado", "recusado"].includes(p_status)) falha("Status inválido.");
      if (obs.length > 1000) falha("As observações podem ter no máximo 1000 caracteres.");
      const ids = new Set(p_ids || []);
      const agora = new Date().toISOString();
      let n = 0;
      for (const l of this.db.lancamentos) {
        if (!ids.has(l.id)) continue;
        n++;
        Object.assign(l, {
          status: p_status,
          observacao_admin: p_status === "pendente" ? "" : obs,
          analisado_por_nome: p_status === "pendente" ? null : a.nome,
          analisado_em: p_status === "pendente" ? null : agora,
          atualizado_em: agora,
        });
      }
      if (!n) falha("Nenhum lançamento encontrado.");
      return n;
    }

    f_bh_admin_ajustar_saldo({ p_token, p_usuario_id, p_modo, p_minutos, p_descricao, p_data }) {
      const a = this.admin(p_token);
      const u = this.db.usuarios.find((x) => x.id === p_usuario_id);
      if (!u) falha("Colaborador não encontrado.");
      if (!["definir", "somar"].includes(p_modo) || p_minutos == null) falha("Informe o ajuste.");
      const desc = String(p_descricao || "").trim();
      if (desc.length < 3) falha("Explique o motivo do ajuste. Esse campo é obrigatório.");
      if (desc.length > 1000) falha("A explicação pode ter no máximo 1000 caracteres.");
      const saldo = this.db.lancamentos
        .filter((l) => l.usuario_id === u.id && l.status === "aprovado")
        .reduce((s, l) => s + l.minutos, 0);
      const delta = p_modo === "definir" ? p_minutos - saldo : p_minutos;
      if (!delta) falha("Esse ajuste não muda o saldo.");
      const agora = new Date().toISOString();
      const l = {
        id: uid(), usuario_id: u.id, data: p_data || hojeIso(), tipo: "ajuste", forma: "ajuste",
        hora_inicio: null, hora_fim: null, minutos: delta, descricao: desc, status: "aprovado",
        observacao_admin: "", analisado_por_nome: a.nome, analisado_em: agora,
        criado_por_nome: a.nome, criado_pelo_admin: true, editado_por_nome: null,
        criado_em: agora, atualizado_em: agora,
      };
      this.db.lancamentos.push(l);
      return l;
    }
  }

  /* Aceita o endereço do projeto em qualquer formato copiado do painel do Supabase
     (com /rest/v1/, barra no final ou sem https://) e mantém só https://xxxx.supabase.co */
  function limparUrl(url) {
    let s = String(url).trim().replace(/^["']|["']$/g, "");
    if (!/^https?:\/\//i.test(s)) s = "https://" + s;
    try {
      return new URL(s).origin;
    } catch (e) {
      return s.replace(/\/+$/, "");
    }
  }

  function create(config) {
    if (config && config.supabaseUrl && config.supabaseAnonKey) {
      const chave = String(config.supabaseAnonKey).trim().replace(/^["']|["']$/g, "");
      return new SupabaseApi(limparUrl(config.supabaseUrl), chave);
    }
    return new DemoApi();
  }

  return { create, montar, hojeIso, minutosDoHorario, DEMO_SENHA };
})();
