import { UFS, REGIOES, CARGOS, TseSource, DemoSource, aggregate } from "./data.js";

const $ = (s) => document.querySelector(s);
const fmt = new Intl.NumberFormat("pt-BR");
const pctFmt = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (a, b) => (b ? (a / b) * 100 : 0);
const pctStr = (a, b) => pctFmt.format(pct(a, b)) + "%";
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const REFRESH_MS = 30_000;
const CONCORRENCIA = 8;

// ------------------------------------------------------------- configuração

const DEFAULTS = { fonte: "demo", ano: "2026", eleicao: "", cargo: "0001", auto: true };

function loadConfig() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem("painel-config") || "{}"); } catch {}
  const params = Object.fromEntries(new URLSearchParams(location.search));
  const cfg = { ...DEFAULTS, ...saved, ...params };
  cfg.auto = cfg.auto === true || cfg.auto === "true" || cfg.auto === "1";
  return cfg;
}

function saveConfig(cfg) {
  try { localStorage.setItem("painel-config", JSON.stringify(cfg)); } catch {}
}

// Servido pelo server.js -> usa o proxy /tse; aberto como arquivo -> acessa o TSE direto.
const params = new URLSearchParams(location.search);
const TSE_BASE = params.get("base") || (location.protocol.startsWith("http") ? "/tse" : "https://resultados.tse.jus.br");

let cfg = loadConfig();
let source;
let timer;

const state = {
  brasil: null,
  estados: {}, // UF -> resultado | null (sem dados)
  cidades: {}, // UF -> [{ codigo, nome, capital, r }]
  aba: "regioes",
  cores: new Map(), // número do candidato -> slot de cor fixo
};

function buildSource() {
  source = cfg.fonte === "demo" ? new DemoSource() : new TseSource({ base: TSE_BASE, ano: cfg.ano, eleicao: cfg.eleicao, cargo: cfg.cargo });
  state.brasil = null;
  state.estados = {};
  state.cidades = {};
  state.cores = new Map();
}

// ------------------------------------------------------------- utilidades

async function pool(items, fn, n = CONCORRENCIA) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        try { out[idx] = await fn(items[idx]); } catch { out[idx] = null; }
      }
    }),
  );
  return out;
}

function cor(numero) {
  if (!state.cores.has(numero)) state.cores.set(numero, state.cores.size);
  const slot = state.cores.get(numero);
  return slot < 8 ? `var(--series-${slot + 1})` : "var(--series-other)";
}

function nomeCurto(c) {
  return c.nome.length > 22 ? c.nome.slice(0, 21) + "…" : c.nome;
}

function progress(r) {
  const p = pct(r.apuradas, r.secoes);
  return `<div class="progress-cell"><div class="progress"><i style="width:${p}%"></i></div><span class="num">${pctFmt.format(p)}%</span></div>`;
}

function stack(r, extra = "") {
  if (!r.validos) return `<div class="stack" ${extra}></div>`;
  // ordem fixa por candidato (não por quem lidera), para dar pra comparar linhas
  const segs = [...r.candidatos]
    .sort((a, b) => cor(a.numero).localeCompare(cor(b.numero), undefined, { numeric: true }))
    .filter((c) => c.votos > 0)
    .map((c) => `<i style="width:${pct(c.votos, r.validos)}%;background:${cor(c.numero)}"></i>`)
    .join("");
  return `<div class="stack" ${extra}>${segs}</div>`;
}

// ------------------------------------------------------------- tooltip

const tip = $("#tooltip");
const tipData = new WeakMap();

function bindTip(el, r, titulo) {
  tipData.set(el, { r, titulo });
}

document.addEventListener("pointermove", (ev) => {
  const el = ev.target.closest?.("[data-tipkey]");
  const d = el && tipData.get(el);
  if (!d) { tip.hidden = true; return; }
  const { r, titulo } = d;
  tip.innerHTML =
    `<strong>${esc(titulo)}</strong>` +
    `<div><span>Urnas apuradas</span><span>${pctStr(r.apuradas, r.secoes)}</span></div>` +
    r.candidatos.map((c) => `<div><span><i class="swatch" style="background:${cor(c.numero)}"></i> ${esc(nomeCurto(c))}</span><span>${pctStr(c.votos, r.validos)} · ${fmt.format(c.votos)}</span></div>`).join("");
  tip.hidden = false;
  const x = Math.min(ev.clientX + 14, innerWidth - tip.offsetWidth - 8);
  const y = Math.min(ev.clientY + 14, innerHeight - tip.offsetHeight - 8);
  tip.style.left = x + "px";
  tip.style.top = y + "px";
});

// ------------------------------------------------------------- render

function renderKpis() {
  const r = state.brasil;
  if (!r) { $("#kpis").innerHTML = ""; return; }
  const lider = r.candidatos[0];
  const segundo = r.candidatos[1];
  $("#kpis").innerHTML = `
    <div class="kpi hero"><div class="label">Urnas apuradas</div><div class="value">${pctStr(r.apuradas, r.secoes)}</div>
      <div class="sub">${fmt.format(r.apuradas)} de ${fmt.format(r.secoes)} seções</div></div>
    <div class="kpi"><div class="label">Comparecimento</div><div class="value">${pctStr(r.comparecimento, r.eleitores)}</div>
      <div class="sub">${fmt.format(r.comparecimento)} eleitores</div></div>
    <div class="kpi"><div class="label">Abstenção</div><div class="value">${pctStr(r.abstencao, r.eleitores)}</div>
      <div class="sub">${fmt.format(r.abstencao)} eleitores</div></div>
    <div class="kpi"><div class="label">Brancos / nulos</div><div class="value">${pctStr(r.brancos + r.nulos, r.comparecimento)}</div>
      <div class="sub">${fmt.format(r.brancos)} brancos · ${fmt.format(r.nulos)} nulos</div></div>
    ${lider && segundo ? `<div class="kpi"><div class="label">Diferença 1º – 2º</div><div class="value">${fmt.format(lider.votos - segundo.votos)}</div>
      <div class="sub">${pctFmt.format(pct(lider.votos, r.validos) - pct(segundo.votos, r.validos))} p.p. dos válidos</div></div>` : ""}`;
}

function renderBrasil() {
  const r = state.brasil;
  if (!r) { $("#brasil-bars").innerHTML = `<p class="muted">Sem dados.</p>`; $("#legend").innerHTML = ""; return; }
  $("#legend").innerHTML = r.candidatos
    .map((c) => `<span><i class="swatch" style="background:${cor(c.numero)}"></i>${esc(c.numero)} · ${esc(nomeCurto(c))}</span>`)
    .join("");
  const max = Math.max(...r.candidatos.map((c) => c.votos), 1);
  $("#brasil-bars").innerHTML = r.candidatos
    .map((c) => `
      <div class="cand-row">
        <div><div class="nome">${esc(c.nome)}${c.situacao && c.situacao !== "Não eleito" ? `<span class="tag">${esc(c.situacao)}</span>` : ""}</div>
          <div class="partido">${esc(c.numero)} · ${esc(c.partido)}</div></div>
        <div class="bar"><i style="width:${(c.votos / max) * 100}%;background:${cor(c.numero)}"></i></div>
        <div class="pct"><b>${pctStr(c.votos, r.validos)}</b><small>${fmt.format(c.votos)} votos</small></div>
      </div>`)
    .join("");
}

function renderRegioes() {
  const el = $("#regioes");
  el.innerHTML = "";
  for (const reg of REGIOES) {
    const ufs = Object.keys(UFS).filter((uf) => UFS[uf][1] === reg && state.estados[uf]);
    if (!ufs.length) continue;
    const r = aggregate(ufs.map((uf) => state.estados[uf]));
    const card = document.createElement("div");
    card.className = "regiao";
    card.innerHTML = `
      <h3>${reg} <span class="muted">(${ufs.join(", ")})</span></h3>
      <div class="linha"><span>Urnas apuradas</span><span>${fmt.format(r.apuradas)} / ${fmt.format(r.secoes)}</span></div>
      ${progress(r)}
      <div class="linha"><span>Votos válidos</span><span></span></div>
      ${stack(r, 'data-tipkey="1"')}
      ${r.candidatos.map((c) => `<div class="linha"><span><i class="swatch" style="background:${cor(c.numero)}"></i> ${esc(nomeCurto(c))}</span><span>${pctStr(c.votos, r.validos)}</span></div>`).join("")}`;
    bindTip(card.querySelector("[data-tipkey]"), r, reg);
    el.append(card);
  }
  if (!el.children.length) el.innerHTML = `<p class="muted">Sem dados por estado.</p>`;
}

function candidatosRef() {
  // colunas da tabela: candidatos na ordem do resultado nacional (ou do 1º estado com dados)
  const ref = state.brasil || Object.values(state.estados).find(Boolean);
  return ref ? ref.candidatos.slice(0, 4) : [];
}

function celulasCandidatos(r, cands) {
  return cands
    .map((c) => {
      const v = r.candidatos.find((x) => x.numero === c.numero)?.votos || 0;
      return `<td class="r"><span class="cand-pct">${pctStr(v, r.validos)}</span></td>`;
    })
    .join("");
}

function liderCell(r) {
  const [a, b] = r.candidatos;
  if (!a || !r.validos) return "<td>—</td>";
  const margem = pct(a.votos - (b?.votos || 0), r.validos);
  return `<td><span class="cand-pct"><i class="swatch" style="background:${cor(a.numero)}"></i>${esc(nomeCurto(a))} <span class="muted">+${pctFmt.format(margem)}</span></span></td>`;
}

function ordenar(rows, ordem) {
  const key = {
    eleitores: (x) => -x.r.eleitores - x.r.secoes,
    apuradas: (x) => -pct(x.r.apuradas, x.r.secoes),
    nome: (x) => x.nome,
    lider: (x) => -(x.r.validos ? (x.r.candidatos[0]?.votos - (x.r.candidatos[1]?.votos || 0)) / x.r.validos : 0),
  }[ordem];
  return rows.sort((a, b) => {
    const ka = key(a), kb = key(b);
    return typeof ka === "string" ? ka.localeCompare(kb, "pt-BR") : ka - kb;
  });
}

function cabecalho(primeira, cands) {
  return `<thead><tr><th>${primeira}</th><th>Urnas apuradas</th><th class="r">Seções</th>
    ${cands.map((c) => `<th class="r"><span class="cand-pct"><i class="swatch" style="background:${cor(c.numero)}"></i>${esc(nomeCurto(c))}</span></th>`).join("")}
    <th>Votos válidos</th><th>Liderando</th></tr></thead>`;
}

function renderEstados() {
  const filtroReg = $("#filtro-regiao").value;
  const cands = candidatosRef();
  const rows = Object.keys(UFS)
    .filter((uf) => state.estados[uf] && (!filtroReg || UFS[uf][1] === filtroReg))
    .map((uf) => ({ uf, nome: UFS[uf][0], r: state.estados[uf] }));
  ordenar(rows, $("#ordem-estados").value);
  const t = $("#tabela-estados");
  t.innerHTML =
    cabecalho("Estado", cands) +
    "<tbody>" +
    rows
      .map((x) => `<tr class="clicavel" data-uf="${x.uf}"><td><b>${x.uf}</b> <span class="muted">${esc(x.nome)}</span></td>
        <td>${progress(x.r)}</td><td class="r">${fmt.format(x.r.apuradas)}/${fmt.format(x.r.secoes)}</td>
        ${celulasCandidatos(x.r, cands)}<td style="min-width:140px">${stack(x.r, 'data-tipkey="1"')}</td>${liderCell(x.r)}</tr>`)
      .join("") +
    "</tbody>";
  t.querySelectorAll("tr[data-uf]").forEach((tr) => bindTip(tr.querySelector("[data-tipkey]"), state.estados[tr.dataset.uf], UFS[tr.dataset.uf][0]));
  if (!rows.length) t.innerHTML = `<tr><td class="muted">Sem dados por estado para este cargo/eleição.</td></tr>`;
}

function renderCidades() {
  const uf = $("#filtro-uf").value;
  const lista = state.cidades[uf];
  const t = $("#tabela-cidades");
  if (!lista) { t.innerHTML = ""; return; }
  const busca = $("#busca-cidade").value.trim().toLocaleLowerCase("pt-BR").normalize("NFD").replace(/\p{M}/gu, "");
  const cands = (state.estados[uf] || state.brasil || { candidatos: [] }).candidatos.slice(0, 4);
  const rows = lista
    .filter((m) => m.r && (!busca || m.nome.toLocaleLowerCase("pt-BR").normalize("NFD").replace(/\p{M}/gu, "").includes(busca)));
  ordenar(rows, $("#ordem-cidades").value);
  const visiveis = rows.slice(0, 500);
  t.innerHTML =
    cabecalho("Cidade", cands) +
    "<tbody>" +
    visiveis
      .map((m, i) => `<tr data-i="${i}"><td>${esc(m.nome)}${m.capital ? '<span class="tag">capital</span>' : ""}</td>
        <td>${progress(m.r)}</td><td class="r">${fmt.format(m.r.apuradas)}/${fmt.format(m.r.secoes)}</td>
        ${celulasCandidatos(m.r, cands)}<td style="min-width:140px">${stack(m.r, 'data-tipkey="1"')}</td>${liderCell(m.r)}</tr>`)
      .join("") +
    "</tbody>";
  t.querySelectorAll("tr[data-i]").forEach((tr) => {
    const m = visiveis[Number(tr.dataset.i)];
    bindTip(tr.querySelector("[data-tipkey]"), m.r, `${m.nome} (${uf})`);
  });
  const apuradas = lista.filter((m) => m.r && m.r.secoes && m.r.apuradas === m.r.secoes).length;
  $("#cidades-status").textContent =
    `${fmt.format(lista.filter((m) => m.r).length)} de ${fmt.format(lista.length)} cidades carregadas · ` +
    `${fmt.format(apuradas)} com 100% das urnas apuradas` + (rows.length > visiveis.length ? ` · mostrando as primeiras ${visiveis.length}` : "");
}

function renderAll() {
  renderKpis();
  renderBrasil();
  renderRegioes();
  renderEstados();
  if (state.aba === "cidades") renderCidades();
}

// ------------------------------------------------------------- carga

function setStatus(msg, erro = false) {
  const el = $("#status");
  el.textContent = msg;
  el.classList.toggle("erro", erro);
}

async function carregarCidades(uf) {
  const lista = (await source.listaMunicipios())[uf] || [];
  const anterior = new Map((state.cidades[uf] || []).map((m) => [m.codigo, m.r]));
  state.cidades[uf] = lista.map((m) => ({ ...m, r: anterior.get(m.codigo) || null }));
  $("#cidades-status").textContent = `Carregando ${lista.length} cidades…`;
  let feitas = 0;
  await pool(state.cidades[uf], async (m) => {
    m.r = await source.municipio(uf, m.codigo);
    if (++feitas % 50 === 0 && state.aba === "cidades" && $("#filtro-uf").value === uf) renderCidades();
  });
  if ($("#filtro-uf").value === uf) renderCidades();
}

let carregando = false;

async function atualizar() {
  if (carregando) return;
  carregando = true;
  const fonte = cfg.fonte === "demo" ? "Simulação" : `TSE · eleição ${cfg.eleicao}`;
  setStatus(`${fonte} · ${CARGOS[cfg.cargo]} · atualizando…`);
  try {
    if (cfg.fonte === "tse" && !cfg.eleicao) throw new Error("Informe o código da eleição (botão “?” procura no TSE) ou use a Simulação.");
    const ufs = Object.keys(UFS);
    const [br, ...estados] = await Promise.all([
      source.brasil().catch(() => null),
      ...ufs.map((uf) => source.estado(uf).catch(() => null)),
    ]);
    ufs.forEach((uf, i) => (state.estados[uf] = estados[i]));
    state.brasil = br || (estados.some(Boolean) ? aggregate(estados) : null);
    if (!state.brasil) throw new Error("Nenhum arquivo de resultado encontrado. Confira ano, código da eleição e cargo.");
    // fixa as cores na ordem dos números dos candidatos, para não mudarem quando a liderança muda
    [...state.brasil.candidatos].sort((a, b) => a.numero.localeCompare(b.numero, undefined, { numeric: true })).forEach((c) => cor(c.numero));
    renderAll();
    const hora = state.brasil.atualizadoEm ? ` · totalização de ${state.brasil.atualizadoEm}` : "";
    setStatus(`${fonte} · ${CARGOS[cfg.cargo]}${hora} · lido às ${new Date().toLocaleTimeString("pt-BR")}`);
    if (state.aba === "cidades") await carregarCidades($("#filtro-uf").value);
  } catch (err) {
    setStatus(err.message, true);
    renderAll();
  } finally {
    carregando = false;
  }
}

function agendar() {
  clearInterval(timer);
  if (cfg.auto) timer = setInterval(atualizar, REFRESH_MS);
}

// ------------------------------------------------------------- eventos

const form = $("#config");

function syncForm() {
  for (const [k, v] of Object.entries(cfg)) {
    const el = form.elements[k];
    if (!el) continue;
    if (el.type === "checkbox") el.checked = v;
    else el.value = v;
  }
  form.querySelectorAll(".tse-only").forEach((el) => (el.hidden = form.elements.fonte.value !== "tse"));
}

form.addEventListener("change", (ev) => {
  form.querySelectorAll(".tse-only").forEach((el) => (el.hidden = form.elements.fonte.value !== "tse"));
});

form.addEventListener("submit", (ev) => {
  ev.preventDefault();
  const novo = {
    fonte: form.elements.fonte.value,
    ano: form.elements.ano.value.trim(),
    eleicao: form.elements.eleicao.value.trim().replace(/^0+/, ""),
    cargo: form.elements.cargo.value,
    auto: form.elements.auto.checked,
  };
  const mudouFonte = ["fonte", "ano", "eleicao", "cargo"].some((k) => novo[k] !== cfg[k]);
  cfg = novo;
  saveConfig(cfg);
  if (mudouFonte) buildSource();
  agendar();
  atualizar();
});

$("#descobrir").addEventListener("click", async () => {
  const ul = $("#lista-eleicoes");
  ul.innerHTML = "<li>Procurando…</li>";
  $("#dlg-eleicoes").showModal();
  try {
    const lista = await TseSource.descobrirEleicoes(TSE_BASE, form.elements.ano.value.trim());
    ul.innerHTML = lista.length
      ? lista.map((e) => `<li><b>${esc(e.codigo)}</b> — ${esc(e.nome)} ${esc(e.data)} <button data-cod="${esc(e.codigo)}">usar</button></li>`).join("")
      : "<li>Nenhuma eleição encontrada para esse ano.</li>";
  } catch (err) {
    ul.innerHTML = `<li class="erro">${esc(err.message)}</li>`;
  }
});

$("#lista-eleicoes").addEventListener("click", (ev) => {
  const cod = ev.target.dataset?.cod;
  if (!cod) return;
  form.elements.eleicao.value = cod;
  $("#dlg-eleicoes").close();
  form.requestSubmit();
});

document.querySelectorAll(".tabs button").forEach((b) =>
  b.addEventListener("click", () => {
    state.aba = b.dataset.tab;
    document.querySelectorAll(".tabs button").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
    document.querySelectorAll(".tab-panel").forEach((p) => (p.hidden = p.id !== "tab-" + state.aba));
    if (state.aba === "cidades") {
      renderCidades();
      if (!state.cidades[$("#filtro-uf").value]) carregarCidades($("#filtro-uf").value).catch((e) => ($("#cidades-status").textContent = e.message));
    }
  }),
);

$("#filtro-regiao").innerHTML += REGIOES.map((r) => `<option>${r}</option>`).join("");
$("#filtro-uf").innerHTML = Object.keys(UFS)
  .sort((a, b) => UFS[a][0].localeCompare(UFS[b][0], "pt-BR"))
  .map((uf) => `<option value="${uf}" ${uf === "SP" ? "selected" : ""}>${UFS[uf][0]}</option>`)
  .join("");

$("#filtro-regiao").addEventListener("change", renderEstados);
$("#ordem-estados").addEventListener("change", renderEstados);
$("#ordem-cidades").addEventListener("change", renderCidades);
$("#busca-cidade").addEventListener("input", renderCidades);
$("#filtro-uf").addEventListener("change", () => {
  const uf = $("#filtro-uf").value;
  renderCidades();
  if (!state.cidades[uf]) carregarCidades(uf).catch((e) => ($("#cidades-status").textContent = e.message));
});

// clicar num estado abre a aba de cidades daquele estado
$("#tabela-estados").addEventListener("click", (ev) => {
  const tr = ev.target.closest("tr[data-uf]");
  if (!tr) return;
  $("#filtro-uf").value = tr.dataset.uf;
  document.querySelector('.tabs button[data-tab="cidades"]').click();
});

// ------------------------------------------------------------- início

syncForm();
buildSource();
agendar();
atualizar();
