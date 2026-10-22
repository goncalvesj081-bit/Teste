import { UFS, REGIOES, CARGOS, TseSource, DemoSource, aggregate } from "./data.js?v=4";

const $ = (s) => document.querySelector(s);
const fmt = new Intl.NumberFormat("pt-BR");
const pctFmt = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ppFmt = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const pct = (a, b) => (b ? (a / b) * 100 : 0);
const pctStr = (a, b) => pctFmt.format(pct(a, b)) + "%";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const delta = (d) => `<span class="delta">${d >= 0.05 ? "▲ +" : d <= -0.05 ? "▼ −" : ""}${ppFmt.format(Math.abs(d))} p.p.</span>`;
const hora = (d) => d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

const REFRESH_MS = 30_000;

// ------------------------------------------------------------- configuração

// Códigos do TSE das eleições de 2026, por turno e cargo
const TURNOS = {
  1: { "0001": "6257", "0003": "6259" },
  2: { "0001": "6258", "0003": "6260" },
};
const NOME_TURNO = { 1: "1º turno", 2: "2º turno" };
const params = new URLSearchParams(location.search);

function loadConfig() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem("painel-config") || "{}"); } catch {}
  const c = { fonte: "tse", turno: "2", cargo: "0001", recorte: "", ...saved };
  for (const k of ["fonte", "turno", "cargo", "recorte"]) if (params.has(k)) c[k] = params.get(k);
  if (!["1", "2"].includes(c.turno)) c.turno = "2";
  if (!CARGOS[c.cargo]) c.cargo = "0001";
  if (!["tse", "demo"].includes(c.fonte)) c.fonte = "tse";
  if (c.recorte && !UFS[c.recorte] && !REGIOES.includes(c.recorte.slice(2))) c.recorte = "";
  return c;
}

let cfg = loadConfig();
// código de eleição avulso só pela URL (?eleicao=6258&ano=2026)
const ELEICAO_URL = params.get("eleicao");
const ANO = params.get("ano") || "2026";

function saveConfig() {
  try { localStorage.setItem("painel-config", JSON.stringify(cfg)); } catch {}
}

// Servido pelo server.js -> usa o proxy "tse/"; hospedado só com arquivos estáticos
// (GitHub Pages) ou aberto como arquivo -> acessa o TSE direto.
let TSE_BASE = params.get("base") || "https://resultados.tse.jus.br";

async function detectarProxy() {
  if (params.get("base") || !location.protocol.startsWith("http")) return;
  try {
    const r = await fetch("tse/status", { cache: "no-store" });
    if (r.ok && (await r.text()) === "ok") TSE_BASE = "tse";
  } catch {}
}

// ------------------------------------------------------------- dados (cache por fonte, eleição e cargo)

const cache = new Map();

function conjunto(fonte, turno, cargo) {
  const codigo = turno === cfg.turno && ELEICAO_URL ? ELEICAO_URL : TURNOS[turno][cargo];
  const chave = `${fonte}|${codigo}|${cargo}`;
  if (!cache.has(chave)) {
    cache.set(chave, {
      chave,
      turno,
      cargo,
      fonte: fonte === "demo" ? new DemoSource(turno) : new TseSource({ base: TSE_BASE, ano: ANO, eleicao: codigo, cargo }),
      brasil: null,
      estados: {},
      cidades: {},
      carregado: false,
      lido: null,
      erro: null,
      emCurso: null,
      cidadesEmCurso: {},
    });
  }
  return cache.get(chave);
}

const atual = () => conjunto(cfg.fonte, cfg.turno, cfg.cargo);
const primeiroTurno = () => (cfg.turno === "2" ? conjunto(cfg.fonte, "1", cfg.cargo) : null);
const completo = (r) => !!r && r.secoes > 0 && r.apuradas === r.secoes;
const governador = () => cfg.cargo === "0003";

function carregarEstados(d) {
  if (d.emCurso) return d.emCurso;
  d.emCurso = (async () => {
    const ufs = Object.keys(UFS);
    let erroBr = null;
    const [br, ...est] = await Promise.all([
      d.fonte.brasil().catch((e) => ((erroBr = e), null)),
      ...ufs.map((uf) => d.fonte.estado(uf).catch(() => null)),
    ]);
    ufs.forEach((uf, i) => (d.estados[uf] = est[i]));
    d.brasil = br || (est.some(Boolean) ? aggregate(est) : null);
    d.carregado = true;
    d.lido = new Date();
    d.erro = d.brasil ? null : erroBr?.semAcesso ? erroBr.message : "semdados";
  })().finally(() => (d.emCurso = null));
  return d.emCurso;
}

async function pool(items, fn, n) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const item = items[i++];
        try { await fn(item); } catch {}
      }
    }),
  );
}

/**
 * Votos por cidade. O TSE tem um arquivo por cidade; o índice do estado (andamentoCidades)
 * diz quantas urnas cada cidade já apurou, então só baixamos de novo as que mudaram.
 */
function carregarCidades(d, uf, ativo) {
  if (d.cidadesEmCurso[uf]) return d.cidadesEmCurso[uf];
  d.cidadesEmCurso[uf] = (async () => {
    const lista = (await d.fonte.listaMunicipios())[uf] || [];
    const anterior = new Map((d.cidades[uf] || []).map((m) => [m.codigo, m.r]));
    const cidades = lista.map((m) => ({ ...m, r: anterior.get(m.codigo) || null }));
    d.cidades[uf] = cidades;
    let alvo = cidades;
    if (d.fonte.andamentoCidades) {
      try {
        const andamento = await d.fonte.andamentoCidades(uf);
        alvo = cidades.filter((m) => !m.r || andamento.get(m.codigo) !== m.r.apuradas);
      } catch {}
    }
    await pool(
      alvo,
      async (m) => {
        if (!ativo()) return;
        m.r = await d.fonte.municipio(uf, m.codigo);
        agendarRender();
      },
      24,
    );
  })().finally(() => delete d.cidadesEmCurso[uf]);
  return d.cidadesEmCurso[uf];
}

// ------------------------------------------------------------- recorte

const ehUF = (rec) => !!rec && !rec.startsWith("R:");
const ufsDoRecorte = (rec) =>
  !rec ? Object.keys(UFS) : rec.startsWith("R:") ? Object.keys(UFS).filter((uf) => UFS[uf][1] === rec.slice(2)) : [rec];
const nomeRecorte = (rec) => (!rec ? "Brasil" : rec.startsWith("R:") ? `Região ${rec.slice(2)}` : UFS[rec][0]);

function resultadoRecorte(d, rec = cfg.recorte) {
  if (!d) return null;
  if (!rec) return d.brasil;
  if (ehUF(rec)) return d.estados[rec] || null;
  const rs = ufsDoRecorte(rec).map((uf) => d.estados[uf]).filter(Boolean);
  return rs.length ? aggregate(rs) : null;
}

// candidatos somados entre estados só fazem sentido para presidente
const mostraCandidatos = () => !governador() || ehUF(cfg.recorte);

/** Unidades dentro do recorte: estados (Brasil/região) ou cidades (estado, quando carregadas). */
function unidades(d, rec = cfg.recorte) {
  if (ehUF(rec)) {
    const lista = d.cidades[rec];
    return lista?.some((m) => m.r) ? lista.filter((m) => m.r).map((m) => ({ id: m.codigo, nome: m.nome, r: m.r, cidade: true })) : null;
  }
  return ufsDoRecorte(rec)
    .filter((uf) => d.estados[uf])
    .map((uf) => ({ id: uf, nome: UFS[uf][0], r: d.estados[uf] }));
}

// ------------------------------------------------------------- cores

// cor por partido (dois primeiros dígitos do número): PT vermelho, PL azul; os demais na ordem da paleta
const RESERVADAS = { 13: 8, 22: 1 };
const LIVRES = [2, 3, 4, 5, 6, 7];
const slots = new Map();

function slot(numero) {
  const p = String(numero).slice(0, 2);
  if (RESERVADAS[p]) return RESERVADAS[p];
  if (!slots.has(p)) {
    const usados = new Set(slots.values());
    slots.set(p, LIVRES.find((s) => !usados.has(s)) || 0);
  }
  return slots.get(p);
}
const cor = (numero) => (slot(numero) ? `var(--series-${slot(numero)})` : "var(--series-other)");
const sw = (c) => `<i class="swatch" style="background:${cor(c.numero)}"></i>`;
const porSlot = (a, b) => (slot(a.numero) || 99) - (slot(b.numero) || 99);

function fixarCores(d) {
  // os mais votados ganham as cores primeiro
  if (d.brasil) [...d.brasil.candidatos].sort((a, b) => b.votos - a.votos).forEach((c) => slot(c.numero));
}

// ------------------------------------------------------------- utilidades de desenho

const nomeCurto = (c) => (c.nome.length > 24 ? c.nome.slice(0, 23) + "…" : c.nome);
const votosDe = (r, numero) => r?.candidatos.find((x) => x.numero === numero)?.votos || 0;
const margem = (r) => (r?.validos ? pct((r.candidatos[0]?.votos || 0) - (r.candidatos[1]?.votos || 0), r.validos) : 0);

function progress(r) {
  const p = pct(r.apuradas, r.secoes);
  return `<div class="progress-cell"><div class="progress"><i style="width:${p}%"></i></div><span class="r">${pctFmt.format(p)}%</span></div>`;
}

function stack(r) {
  if (!r.validos) return `<div class="stack" data-tipkey="1"></div>`;
  const segs = [...r.candidatos]
    .sort(porSlot)
    .filter((c) => c.votos > 0)
    .map((c) => `<i style="width:${pct(c.votos, r.validos)}%;background:${cor(c.numero)}"></i>`)
    .join("");
  return `<div class="stack" data-tipkey="1">${segs}</div>`;
}

/** Votos válidos que ainda faltam apurar numa unidade (estimativa). */
function restanteEstimado(r, ref) {
  const faltam = r.secoes - r.apuradas;
  if (faltam <= 0) return 0;
  if (r.apuradas > 0) return (r.validos * faltam) / r.apuradas;
  if (ref?.validos && ref.secoes) return (ref.validos * faltam) / ref.secoes; // usa o 1º turno como base
  return r.eleitorado * (faltam / r.secoes) * 0.75;
}

/** Projeção simples: as urnas que faltam em cada unidade votam como as já apuradas nela. */
function projetar(us, d1) {
  const geral = aggregate(us.map((u) => u.r));
  const total = new Map();
  let restante = 0;
  for (const u of us) {
    const rest = restanteEstimado(u.r, !u.cidade ? d1?.estados[u.id] : null);
    restante += rest;
    for (const c of geral.candidatos) {
      const v = votosDe(u.r, c.numero);
      const share = u.r.validos ? v / u.r.validos : geral.validos ? c.votos / geral.validos : 0;
      total.set(c.numero, (total.get(c.numero) || 0) + v + rest * share);
    }
  }
  return {
    restante,
    validosAtual: geral.validos,
    validos: geral.validos + restante,
    candidatos: geral.candidatos.map((c) => ({ ...c, projetado: total.get(c.numero) || 0 })).sort((a, b) => b.projetado - a.projetado),
  };
}

// ------------------------------------------------------------- tooltip

const tip = $("#tooltip");
const tipData = new WeakMap();
const bindTip = (el, r, titulo) => el && r && tipData.set(el, { r, titulo });

document.addEventListener("pointermove", (ev) => {
  const el = ev.target.closest?.("[data-tipkey]");
  const d = el && tipData.get(el);
  if (!d) { tip.hidden = true; return; }
  const { r, titulo } = d;
  const linhas = r.candidatos
    .slice(0, 4)
    .map((c) => `<div><span>${sw(c)} ${esc(nomeCurto(c))}</span><span><b>${pctStr(c.votos, r.validos)}</b></span></div>`)
    .join("");
  tip.innerHTML =
    `<strong>${esc(titulo)}</strong>${linhas}` +
    `<div class="t-sub"><span>Urnas apuradas</span><span>${pctStr(r.apuradas, r.secoes)}</span></div>`;
  tip.hidden = false;
  const x = Math.min(ev.clientX + 14, innerWidth - tip.offsetWidth - 8);
  const y = Math.min(ev.clientY + 14, innerHeight - tip.offsetHeight - 8);
  tip.style.left = Math.max(8, x) + "px";
  tip.style.top = Math.max(8, y) + "px";
});

// ------------------------------------------------------------- topo

let carregandoAgora = false;

function renderTopo(d) {
  const r = resultadoRecorte(d);
  $("#recorte").value = cfg.recorte;
  $("#fonte").value = cfg.fonte;
  document.querySelectorAll("#seg-turno button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === cfg.turno)));
  document.querySelectorAll("#seg-cargo button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === cfg.cargo)));
  $("#btn-atualizar").classList.toggle("girando", carregandoAgora);

  const status = $("#status");
  let estado = "carregando", txt = "Carregando…";
  if (d.erro && d.erro !== "semdados") { estado = "erro"; txt = "Sem conexão com o TSE"; }
  else if (d.brasil) {
    if (completo(d.brasil)) { estado = "encerrado"; txt = "Apuração encerrada"; }
    else if (!d.brasil.apuradas) { estado = "aguardando"; txt = "Aguardando o início da apuração"; }
    else { estado = "aovivo"; txt = "Ao vivo"; }
  } else if (d.carregado) { estado = "aguardando"; txt = "Sem resultados publicados"; }
  if (cfg.fonte === "demo") txt += " · simulação";
  status.dataset.estado = estado;
  $("#status-txt").textContent = txt;

  const p = r ? pct(r.apuradas, r.secoes) : 0;
  $("#pg-valor").textContent = r ? pctFmt.format(p) + "%" : "—";
  $("#pg-fill").style.width = p + "%";
  $("#pg-sub").textContent = r
    ? `${fmt.format(r.apuradas)} de ${fmt.format(r.secoes)} seções${r === d.brasil ? "" : " · " + nomeRecorte(cfg.recorte)}` +
      (d.lido ? ` · lido às ${hora(d.lido)}` : "")
    : "";

  const aviso = $("#aviso");
  aviso.classList.toggle("erro", !!d.erro && d.erro !== "semdados");
  if (d.erro === "semdados") {
    aviso.textContent = `O TSE ainda não publicou resultados de ${CARGOS[cfg.cargo]} no ${NOME_TURNO[cfg.turno]}.`;
  } else if (d.erro) {
    aviso.textContent = d.erro;
  }
  aviso.hidden = !d.erro;

  $("#eyebrow").textContent = `${CARGOS[cfg.cargo]} · ${NOME_TURNO[cfg.turno]}`;
  $("#titulo-recorte").textContent = nomeRecorte(cfg.recorte);
  $("#voltar").hidden = !cfg.recorte;
}

// ------------------------------------------------------------- placar

function renderPlacar(d) {
  const el = $("#placar");
  const r = resultadoRecorte(d);
  if (!r) {
    el.innerHTML = `<p class="muted">${d.carregado ? `Sem dados para ${esc(nomeRecorte(cfg.recorte))} neste turno e cargo.` : "Carregando…"}</p>`;
    return;
  }
  if (!mostraCandidatos()) return renderPlacarGovernadores(d, el);
  if (r.candidatos.length === 2) return renderDuelo(r, el);

  const lider = r.candidatos[0];
  const max = Math.max(lider?.votos || 0, 1);
  const linha = (c, pequeno) => `
    <div class="cand ${c === lider && r.validos ? "lider" : ""} ${pequeno ? "pequeno" : ""}">
      <div class="nome">${sw(c)}<span class="txt">${esc(c.nome)}</span>${c.situacao && c.situacao !== "Não eleito" ? `<span class="tag">${esc(c.situacao)}</span>` : ""}</div>
      <div class="pct">${r.validos ? pctStr(c.votos, r.validos) : "—"}</div>
      <div class="bar"><i style="width:${(c.votos / max) * 100}%;background:${cor(c.numero)}"></i></div>
      ${pequeno ? "" : `<div class="votos">${esc(c.numero)} · ${esc(c.partido)} · ${fmt.format(c.votos)} votos</div>`}
    </div>`;
  const principais = r.candidatos.slice(0, 4);
  const outros = r.candidatos.slice(4);
  const somaOutros = outros.reduce((s, c) => s + c.votos, 0);
  el.innerHTML =
    `<div class="lista-cand">${principais.map((c) => linha(c, false)).join("")}</div>` +
    (outros.length
      ? `<details class="outros"><summary>Outros ${outros.length} candidatos · ${pctStr(somaOutros, r.validos)} dos válidos</summary>
         <div class="lista-cand">${outros.map((c) => linha(c, true)).join("")}</div></details>`
      : "");
}

function renderDuelo(r, el) {
  // lados fixos pela cor, para não trocarem quando a liderança muda
  const [x, y] = [...r.candidatos].sort(porSlot);
  const [a, b] = r.candidatos;
  const lado = (c, dir) => `
    <div class="lado ${dir ? "dir" : ""}">
      <div class="nome">${dir ? "" : sw(c)}${esc(c.nome)}${dir ? sw(c) : ""}</div>
      <div class="partido">${esc(c.numero)} · ${esc(c.partido)}</div>
      <div class="grande">${r.validos ? pctFmt.format(pct(c.votos, r.validos)) + "%" : "—"}</div>
      <div class="votos">${fmt.format(c.votos)} votos</div>
    </div>`;
  const dif = r.validos
    ? `<p class="dif">${sw(a)} <b>${esc(a.nome)}</b> ${completo(r) ? "venceu" : "está à frente"} por <b>${fmt.format(a.votos - b.votos)}</b> votos (${pctFmt.format(margem(r))} p.p.).</p>`
    : `<p class="dif">Aguardando as primeiras urnas.</p>`;
  el.innerHTML = `
    <div class="duelo">${lado(x, false)}${lado(y, true)}</div>
    <div class="split" data-tipkey="1">
      <i style="width:${r.validos ? pct(x.votos, r.validos) : 0}%;background:${cor(x.numero)}"></i>
      <i style="width:${r.validos ? pct(y.votos, r.validos) : 0}%;background:${cor(y.numero)}"></i>
      <span class="meio"></span>
    </div>
    <div class="split-legenda"><span>50%</span></div>
    ${dif}`;
  bindTip(el.querySelector(".split"), r, nomeRecorte(cfg.recorte));
}

/** Governador fora de um estado: um resumo por estado (cada um tem seus candidatos). */
function renderPlacarGovernadores(d, el) {
  const ufs = ufsDoRecorte(cfg.recorte).filter((uf) => d.estados[uf]);
  if (!ufs.length) {
    el.innerHTML = `<p class="muted">Sem disputa para governador aqui neste turno.</p>`;
    return;
  }
  el.innerHTML =
    `<p class="nota">Cada estado tem os seus candidatos. Clique num estado para ver a disputa.</p><div class="lista-cand">` +
    ufs
      .map((uf) => {
        const r = d.estados[uf];
        const [a] = r.candidatos;
        return `<div class="cand pequeno" data-uf="${uf}" style="cursor:pointer">
          <div class="nome"><b>${uf}</b><span class="txt">${a && r.validos ? `${sw(a)} ${esc(a.nome)} <span class="partido">${esc(a.partido)}</span>` : `<span class="muted">${esc(UFS[uf][0])}</span>`}</span></div>
          <div class="pct">${a && r.validos ? pctStr(a.votos, r.validos) : pctStr(r.apuradas, r.secoes) + " apurado"}</div>
          <div class="bar"><i style="width:${pct(r.apuradas, r.secoes)}%;background:var(--progress)"></i></div>
        </div>`;
      })
      .join("") +
    `</div>`;
}

function renderMini(d) {
  const r = resultadoRecorte(d);
  $("#mini").innerHTML = r
    ? `<div><dt>Comparecimento</dt><dd>${pctStr(r.comparecimento, r.eleitores)}<small>${fmt.format(r.comparecimento)} eleitores</small></dd></div>
       <div><dt>Abstenção</dt><dd>${pctStr(r.abstencao, r.eleitores)}<small>${fmt.format(r.abstencao)} eleitores</small></dd></div>
       <div><dt>Brancos</dt><dd>${pctStr(r.brancos, r.comparecimento)}<small>${fmt.format(r.brancos)} votos</small></dd></div>
       <div><dt>Nulos</dt><dd>${pctStr(r.nulos, r.comparecimento)}<small>${fmt.format(r.nulos)} votos</small></dd></div>`
    : "";
}

// ------------------------------------------------------------- mapa

const mapas = new Map(); // "br" ou uf -> Promise<{ viewBox, ufs | mun }>
let modoMapa = "lider";
let mapaSeq = 0;

function carregarMapa(nome) {
  if (!mapas.has(nome)) {
    const p = fetch(`mapas/${nome}.json`).then((r) => {
      if (!r.ok) throw new Error(`mapa ${nome}: ${r.status}`);
      return r.json();
    });
    p.catch(() => mapas.delete(nome));
    mapas.set(nome, p);
  }
  return mapas.get(nome);
}

/** Cor de uma área: quem lidera (mais forte = vantagem maior) ou % de urnas apuradas. */
function corMapa(r) {
  if (!r || !r.secoes) return "var(--track)";
  if (modoMapa === "apuradas") {
    const p = pct(r.apuradas, r.secoes);
    return p ? `color-mix(in srgb, var(--progress) ${Math.round(15 + p * 0.85)}%, var(--track))` : "var(--track)";
  }
  const a = r.candidatos[0];
  if (!a || !r.validos) return "var(--track)";
  const m = Math.min(margem(r), 30);
  return `color-mix(in srgb, ${cor(a.numero)} ${Math.round(38 + (m / 30) * 62)}%, var(--track))`;
}

function renderLegendaMapa(areas, carregandoCidades) {
  const el = $("#mapa-legenda");
  if (carregandoCidades) {
    el.innerHTML = `<span>Carregando as cidades…</span>`;
    return;
  }
  if (modoMapa === "apuradas") {
    el.innerHTML = `<span>0%<i class="grad" style="background:linear-gradient(90deg, var(--track), var(--progress));margin:0 6px"></i>100% das urnas apuradas</span>`;
    return;
  }
  const lideres = new Map();
  for (const u of areas) {
    const a = u.r?.validos && u.r.candidatos[0];
    if (a && !u.fora) lideres.set(a.numero, a);
  }
  // governador no mapa do Brasil: cada estado tem seus candidatos, então a legenda é por partido
  const rotulo = (c) => esc(governador() && !ehUF(cfg.recorte) ? c.partido : nomeCurto(c));
  const itens = [...lideres.values()]
    .sort(porSlot)
    .map((c) => `<span><i class="grad" style="background:linear-gradient(90deg, color-mix(in srgb, ${cor(c.numero)} 38%, var(--track)), ${cor(c.numero)})"></i>${rotulo(c)}</span>`);
  el.innerHTML = itens.length
    ? itens.join("") + `<span class="muted">cor mais forte = vantagem maior</span>`
    : `<span>O mapa ganha cor conforme as urnas são apuradas.</span>`;
}

async function renderMapa(d) {
  const rec = cfg.recorte;
  const el = $("#mapa");
  const seq = ++mapaSeq;
  const nome = ehUF(rec) && rec !== "ZZ" ? rec.toLowerCase() : "br";
  $("#chip-exterior").hidden = nome !== "br" || !d.estados.ZZ;
  let geo;
  try {
    geo = await carregarMapa(nome);
  } catch {
    el.innerHTML = `<p class="carregando">Não foi possível carregar o mapa.</p>`;
    return;
  }
  if (seq !== mapaSeq) return;

  const areas = [];
  if (nome === "br") {
    const foco = new Set(ufsDoRecorte(rec));
    for (const [uf, path] of Object.entries(geo.ufs)) {
      // apaga o que está fora do recorte e os estados sem disputa (ex.: governador no 2º turno)
      areas.push({ chave: uf, path, r: d.estados[uf], titulo: UFS[uf][0], fora: (!!rec && !foco.has(uf)) || (d.carregado && !d.estados[uf]) });
    }
  } else {
    const lista = d.cidades[rec] || [];
    const porCdi = new Map(lista.filter((m) => m.cdi).map((m) => [String(m.cdi), m]));
    // na simulação as cidades não têm código IBGE: distribui as cidades fictícias pelos contornos
    const semCodigo = lista.length > 0 && porCdi.size === 0;
    Object.entries(geo.mun).forEach(([cdi, path], i) => {
      const m = porCdi.get(cdi) || (semCodigo ? lista[i % lista.length] : null);
      areas.push({ chave: cdi, path, r: m?.r, titulo: m ? m.nome : "" });
    });
  }
  el.classList.toggle("cidades", nome !== "br");
  el.innerHTML =
    `<svg viewBox="${geo.viewBox}" role="img" aria-label="Mapa de ${esc(nomeRecorte(rec))}">` +
    areas.map((u) => `<path data-tipkey="1" data-chave="${u.chave}"${u.fora ? ' class="fora"' : ""} d="${u.path}" style="fill:${corMapa(u.r)}"></path>`).join("") +
    `</svg>`;
  el.querySelectorAll("path").forEach((p, i) => bindTip(p, areas[i].r, areas[i].titulo));

  // região: aproxima o mapa nos estados do recorte
  if (nome === "br" && rec && rec !== "ZZ") {
    const focos = [...el.querySelectorAll("path:not(.fora)")];
    if (focos.length) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const p of focos) {
        const b = p.getBBox();
        x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.width); y1 = Math.max(y1, b.y + b.height);
      }
      const pad = Math.max(x1 - x0, y1 - y0) * 0.06;
      el.querySelector("svg").setAttribute("viewBox", `${x0 - pad} ${y0 - pad} ${x1 - x0 + 2 * pad} ${y1 - y0 + 2 * pad}`);
    }
  }
  renderLegendaMapa(areas, nome !== "br" && !d.cidades[rec]?.some((m) => m.r));
}

// ------------------------------------------------------------- análises

function renderResumo(d, d1) {
  const rec = cfg.recorte;
  const r = resultadoRecorte(d);
  const t1r = d1 ? resultadoRecorte(d1) : null;
  const itens = [];
  if (!r || !r.secoes) {
    $("#resumo").innerHTML = `<li>${d.carregado ? `Sem dados para ${esc(nomeRecorte(rec))} neste turno e cargo.` : "Carregando…"}</li>`;
    return;
  }
  const fim = completo(r);
  if (!r.apuradas) itens.push("A apuração ainda não começou aqui.");
  else itens.push(`<b>${pctStr(r.apuradas, r.secoes)}</b> das urnas apuradas (${fmt.format(r.apuradas)} de ${fmt.format(r.secoes)} seções).`);

  const [a, b] = r.candidatos;
  if (r.apuradas && mostraCandidatos() && a && b) {
    const dif = a.votos - b.votos;
    itens.push(
      `${sw(a)} <b>${esc(a.nome)}</b> ${fim ? "terminou em 1º" : "lidera"} com <b>${pctStr(a.votos, r.validos)}</b> dos votos válidos, ` +
        `<b>${fmt.format(dif)}</b> votos à frente de ${sw(b)} <b>${esc(b.nome)}</b> (${pctFmt.format(margem(r))} p.p.).`,
    );
    const disputaPrincipal = governador() ? ehUF(rec) : !rec;
    if (cfg.turno === "1" && disputaPrincipal) {
      itens.push(
        pct(a.votos, r.validos) > 50
          ? `${esc(a.nome)} tem mais da metade dos votos válidos: ${fim ? "venceu" : "venceria"} sem 2º turno.`
          : `Ninguém passou de 50% dos válidos: ${esc(a.nome)} e ${esc(b.nome)} ${fim ? "foram" : "estão indo"} para o 2º turno.`,
      );
    }
    const us = unidades(d);
    if (!fim && us?.length) {
      const proj = projetar(us, d1);
      if (dif > proj.restante) {
        itens.push(`A vantagem de ${esc(a.nome)} já é maior que todos os votos válidos que ainda faltam apurar (estimativa: ~${fmt.format(Math.round(proj.restante))}).`);
      } else {
        const precisa = (proj.restante + dif) / (2 * proj.restante);
        itens.push(
          `Faltam cerca de <b>${fmt.format(Math.round(proj.restante))}</b> votos válidos. Para virar, ${esc(b.nome)} precisaria de ` +
            `<b>${pctFmt.format(precisa * 100)}%</b> deles na disputa direta com ${esc(a.nome)}.`,
        );
      }
    }
  }

  if (r.eleitores) {
    let txt = `Comparecimento de <b>${pctStr(r.comparecimento, r.eleitores)}</b> nas seções apuradas.`;
    if (t1r?.eleitores) txt += ` No 1º turno foi ${pctStr(t1r.comparecimento, t1r.eleitores)} (${delta(pct(r.comparecimento, r.eleitores) - pct(t1r.comparecimento, t1r.eleitores))}).`;
    itens.push(txt);
  }

  // para onde foram os votos de quem ficou de fora
  if (t1r?.validos && r.validos && mostraCandidatos() && a && b) {
    const p1a = pct(votosDe(t1r, a.numero), t1r.validos), p2a = pct(a.votos, r.validos);
    const p1b = pct(votosDe(t1r, b.numero), t1r.validos), p2b = pct(b.votos, r.validos);
    itens.push(`${sw(a)} ${esc(a.nome)}: ${pctFmt.format(p1a)}% no 1º turno → ${pctFmt.format(p2a)}% agora (${delta(p2a - p1a)}).`);
    itens.push(`${sw(b)} ${esc(b.nome)}: ${pctFmt.format(p1b)}% no 1º turno → ${pctFmt.format(p2b)}% agora (${delta(p2b - p1b)}).`);
    const outros = 100 - p1a - p1b;
    const ga = p2a - p1a, gb = p2b - p1b;
    if (outros > 0.5 && ga >= 0 && gb >= 0 && ga + gb > 0) {
      itens.push(
        `Os outros candidatos somaram ${pctFmt.format(outros)}% dos válidos no 1º turno. ` +
          `Desse espaço, ${esc(a.nome)} ficou com cerca de <b>${pctFmt.format((ga / (ga + gb)) * 100)}%</b> e ${esc(b.nome)} com <b>${pctFmt.format((gb / (ga + gb)) * 100)}%</b>.`,
      );
    }
  }
  $("#resumo").innerHTML = itens.map((t) => `<li>${t}</li>`).join("");
}

function renderRegioes(d) {
  const bloco = $("#bloco-regioes");
  bloco.hidden = ehUF(cfg.recorte);
  if (bloco.hidden) return;
  const resultados = {};
  const el = $("#regioes");
  el.innerHTML = REGIOES.filter((reg) => reg !== "Exterior")
    .map((reg) => {
      const ufs = Object.keys(UFS).filter((uf) => UFS[uf][1] === reg && d.estados[uf]);
      if (!ufs.length) return "";
      const r = (resultados[reg] = aggregate(ufs.map((uf) => d.estados[uf])));
      const [a] = r.candidatos;
      const lider = !governador() && a && r.validos ? `<div class="linha"><span>${sw(a)} ${esc(nomeCurto(a))}</span><b>${pctStr(a.votos, r.validos)}</b></div>` : "";
      return `<button type="button" class="regiao" data-regiao="${reg}">
        <h4>${reg}</h4>${lider}
        ${!governador() ? stack(r) : ""}
        <div class="linha"><span>Urnas apuradas</span><b>${pctStr(r.apuradas, r.secoes)}</b></div>
        <div class="progress"><i style="width:${pct(r.apuradas, r.secoes)}%"></i></div>
      </button>`;
    })
    .join("");
  el.querySelectorAll(".regiao").forEach((b) => bindTip(b.querySelector("[data-tipkey]"), resultados[b.dataset.regiao], b.dataset.regiao));
}

function renderProjecao(d, d1) {
  const r = resultadoRecorte(d);
  const us = unidades(d);
  const bloco = $("#bloco-projecao");
  // sem votos ainda, ou apuração encerrada: a projeção não acrescenta nada
  bloco.hidden = !r || !mostraCandidatos() || !r.apuradas || completo(r) || !us?.length;
  if (bloco.hidden) return;
  const proj = projetar(us, d1);
  const porQue = us[0].cidade ? "cidade" : "estado";
  $("#projecao-nota").textContent =
    `Estimativa simples, não é previsão oficial: supõe que as urnas que faltam em cada ${porQue} votam como as já apuradas no mesmo ${porQue}. ` +
    `Faltam cerca de ${fmt.format(Math.round(proj.restante))} votos válidos.`;
  const max = Math.max(...proj.candidatos.flatMap((c) => [pct(c.votos, proj.validosAtual), pct(c.projetado, proj.validos)]), 1);
  $("#projecao").innerHTML =
    `<div class="legenda-proj"><span><i></i>Agora</span><span><i class="proj"></i>Projetado</span></div>` +
    proj.candidatos
      .slice(0, 5)
      .map((c) => {
        const agora = pct(c.votos, proj.validosAtual), final = pct(c.projetado, proj.validos);
        return `<div class="proj-row">
          <div>${sw(c)} <b>${esc(nomeCurto(c))}</b></div>
          <div class="barras">
            <div class="bar"><i style="width:${(agora / max) * 100}%;background:${cor(c.numero)}"></i></div>
            <div class="bar proj"><i style="width:${(final / max) * 100}%;background:${cor(c.numero)}"></i></div>
          </div>
          <div class="vals">${pctFmt.format(agora)}% → <b>${pctFmt.format(final)}%</b><br>${delta(final - agora)}</div>
        </div>`;
      })
      .join("");
}

function renderComparacao(d, d1) {
  const bloco = $("#bloco-comparacao");
  const rec = cfg.recorte;
  bloco.hidden = !d1?.carregado || !d1.brasil;
  if (bloco.hidden) return;
  const ufs = ufsDoRecorte(rec).filter((uf) => d.estados[uf] && d1.estados[uf]);
  const nacional = !governador() ? resultadoRecorte(d) : null;
  const linhas = ufs.map((uf) => ({ nome: UFS[uf][0], uf, r2: d.estados[uf], r1: d1.estados[uf] }));
  if (ufs.length > 1 && !governador()) linhas.push({ nome: `Total · ${nomeRecorte(rec)}`, uf: "", r2: resultadoRecorte(d), r1: resultadoRecorte(d1), total: true });
  if (!linhas.length || (nacional && nacional.candidatos.length < 2)) {
    bloco.hidden = true;
    return;
  }
  $("#comparacao-nota").textContent =
    "Percentual dos votos válidos de cada candidato no 1º turno e no 2º (até agora). Clique num estado para filtrar.";
  const celula = (r1, r2, c) => {
    if (!c) return "<td></td><td></td>";
    const p1 = pct(votosDe(r1, c.numero), r1.validos), p2 = pct(votosDe(r2, c.numero), r2.validos);
    const nome = governador() ? `${sw(c)} ${esc(nomeCurto(c))}<br>` : "";
    if (!r2.validos) return `<td class="r">${nome}${pctFmt.format(p1)}% → <span class="muted">aguardando</span></td><td class="r">—</td>`;
    return `<td class="r">${nome}${pctFmt.format(p1)}% → <b>${pctFmt.format(p2)}%</b></td><td class="r">${delta(p2 - p1)}</td>`;
  };
  const cab = nacional
    ? nacional.candidatos.slice(0, 2).map((c) => `<th class="r"><span class="cel-cand">${sw(c)} ${esc(nomeCurto(c))}</span></th><th class="r">Variação</th>`).join("")
    : `<th class="r">1º colocado</th><th class="r">Variação</th><th class="r">2º colocado</th><th class="r">Variação</th>`;
  $("#tabela-comparacao").innerHTML =
    `<thead><tr><th>Estado</th>${cab}<th class="r">Comparecimento</th></tr></thead><tbody>` +
    linhas
      .map((l) => {
        const cands = (nacional || l.r2).candidatos.slice(0, 2);
        const c1 = pct(l.r1.comparecimento, l.r1.eleitores), c2 = pct(l.r2.comparecimento, l.r2.eleitores);
        return `<tr class="${l.uf ? "clicavel" : ""} ${l.uf && l.uf === rec ? "sel" : ""}" ${l.uf ? `data-uf="${l.uf}"` : ""}>
          <td>${l.total ? `<b>${esc(l.nome)}</b>` : `<b>${l.uf}</b> <span class="muted">${esc(l.nome)}</span>`}</td>
          ${celula(l.r1, l.r2, cands[0])}${celula(l.r1, l.r2, cands[1])}
          <td class="r">${l.r2.eleitores ? `${pctFmt.format(c2)}% ${delta(c2 - c1)}` : "—"}</td></tr>`;
      })
      .join("") +
    "</tbody>";
}

function itemRanking(u, extra) {
  const [a] = u.r.candidatos;
  return `<li><div class="linha"><b>${esc(u.nome)}</b>
    <span>${a ? `${sw(a)} ${esc(nomeCurto(a))} <b>+${pctFmt.format(margem(u.r))} p.p.</b>` : "—"}</span></div>
    <div class="linha sub"><span>${pctStr(u.r.apuradas, u.r.secoes)} apurado</span><span>${extra}</span></div>
    ${stack(u.r)}</li>`;
}

function renderRankings(d, d1) {
  const rec = cfg.recorte;
  const todas = unidades(d) || [];
  const us = todas.filter((u) => u.r.validos);
  const tipo = ehUF(rec) ? "cidades" : "estados";
  $("#titulo-apertadas").textContent = `Disputas mais apertadas · ${tipo}`;
  $("#titulo-folgadas").textContent = `Maiores vantagens · ${tipo}`;
  $("#titulo-faltam").textContent = `Onde faltam mais votos · ${tipo}`;
  const vazio = `<li class="vazio">${ehUF(rec) && !d.cidades[rec]?.some((m) => m.r) ? "Carregando as cidades…" : "Sem votos apurados ainda."}</li>`;
  const porMargem = [...us].sort((x, y) => margem(x.r) - margem(y.r));
  // nas cidades, ignora as muito pequenas para o ranking de apertadas não virar só lugarejo
  const minimo = ehUF(rec) ? 2000 : 0;
  const apertadas = porMargem.filter((u) => u.r.validos >= minimo).slice(0, 6);
  const folgadas = porMargem.slice(-6).reverse();
  const faltam = todas
    .map((u) => ({ ...u, rest: restanteEstimado(u.r, !u.cidade ? d1?.estados[u.id] : null) }))
    .filter((u) => u.rest > 0)
    .sort((x, y) => y.rest - x.rest)
    .slice(0, 6);
  const preencher = (el, lista, extra, msgVazio = vazio) => {
    el.innerHTML = lista.length ? lista.map((u) => itemRanking(u, extra(u))).join("") : msgVazio;
    el.querySelectorAll("li").forEach((li, i) => lista[i] && bindTip(li.querySelector("[data-tipkey]"), lista[i].r, lista[i].nome));
  };
  preencher($("#apertadas"), apertadas, (u) => `${fmt.format(u.r.validos)} válidos`);
  preencher($("#folgadas"), folgadas, (u) => `${fmt.format(u.r.validos)} válidos`);
  preencher($("#faltam"), faltam, (u) => `faltam ~${fmt.format(Math.round(u.rest))} válidos`, vazio);
  // com tudo apurado, a lista de "onde faltam votos" não tem o que mostrar
  $("#bloco-faltam").hidden = !faltam.length && todas.length > 0;
}

// ------------------------------------------------------------- tabelas

function ordenar(rows, ordem) {
  const key = {
    eleitorado: (x) => -x.r.eleitorado - x.r.secoes,
    apuradas: (x) => -pct(x.r.apuradas, x.r.secoes),
    nome: (x) => x.nome,
    lider: (x) => -margem(x.r),
  }[ordem];
  return rows.sort((a, b) => {
    const ka = key(a), kb = key(b);
    return typeof ka === "string" ? ka.localeCompare(kb, "pt-BR") : ka - kb;
  });
}

function colunasCandidatos(ref, porLinha) {
  // presidente: uma coluna por candidato (até 4); governador entre estados: 1º e 2º colocado de cada linha
  if (porLinha) {
    return {
      cab: `<th>1º colocado</th><th>2º colocado</th>`,
      cel: (r) => [0, 1].map((i) => {
        const c = r.candidatos[i];
        return c && r.validos ? `<td><span class="cel-cand">${sw(c)}${esc(nomeCurto(c))} <b>${pctStr(c.votos, r.validos)}</b></span></td>` : "<td>—</td>";
      }).join(""),
    };
  }
  const cands = ref ? ref.candidatos.slice(0, 4) : [];
  return {
    cab: cands.map((c) => `<th class="r"><span class="cel-cand">${sw(c)}${esc(nomeCurto(c))}</span></th>`).join(""),
    cel: (r) => cands.map((c) => `<td class="r">${r.validos ? pctStr(votosDe(r, c.numero), r.validos) : "—"}</td>`).join(""),
  };
}

function liderCell(r) {
  const [a] = r.candidatos;
  if (!a || !r.validos) return "<td>—</td>";
  return `<td><span class="cel-cand">${sw(a)}${esc(nomeCurto(a))} <span class="muted">+${pctFmt.format(margem(r))}</span></span></td>`;
}

function renderEstados(d) {
  const rec = cfg.recorte;
  const regiao = !rec ? "" : rec.startsWith("R:") ? rec.slice(2) : UFS[rec][1];
  const filtra = regiao && regiao !== "Exterior";
  $("#titulo-estados").textContent = filtra ? `Estados · Região ${regiao}` : "Estados";
  const rows = Object.keys(UFS)
    .filter((uf) => d.estados[uf] && (!filtra || UFS[uf][1] === regiao))
    .map((uf) => ({ uf, nome: UFS[uf][0], r: d.estados[uf] }));
  ordenar(rows, $("#ordem-estados").value);
  const cols = colunasCandidatos(resultadoRecorte(d, filtra ? `R:${regiao}` : ""), governador());
  const t = $("#tabela-estados");
  if (!rows.length) {
    t.innerHTML = `<tbody><tr><td class="muted">${d.carregado ? "Sem dados por estado neste turno e cargo." : "Carregando…"}</td></tr></tbody>`;
    return;
  }
  t.innerHTML =
    `<thead><tr><th>Estado</th><th>Urnas apuradas</th>${cols.cab}<th>Votos válidos</th><th>Liderando</th></tr></thead><tbody>` +
    rows
      .map((x) => `<tr class="clicavel ${x.uf === rec ? "sel" : ""}" data-uf="${x.uf}">
        <td><b>${x.uf}</b> <span class="muted">${esc(x.nome)}</span></td>
        <td style="min-width:150px">${progress(x.r)}</td>${cols.cel(x.r)}
        <td style="min-width:140px">${stack(x.r)}</td>${liderCell(x.r)}</tr>`)
      .join("") +
    "</tbody>";
  t.querySelectorAll("tr[data-uf]").forEach((tr) => bindTip(tr.querySelector("[data-tipkey]"), d.estados[tr.dataset.uf], UFS[tr.dataset.uf][0]));
}

const semAcento = (s) => s.toLocaleLowerCase("pt-BR").normalize("NFD").replace(/\p{M}/gu, "");

function renderCidades(d) {
  const uf = ufDasCidades();
  $("#cidades-uf").value = uf;
  $("#titulo-cidades").textContent = uf ? `Cidades · ${UFS[uf][0]}` : "Cidades";
  const t = $("#tabela-cidades");
  if (!uf) {
    $("#cidades-status").textContent = "Escolha um estado para ver as cidades.";
    t.innerHTML = "";
    return;
  }
  const lista = d.cidades[uf];
  if (!lista) {
    $("#cidades-status").textContent = "Carregando as cidades…";
    t.innerHTML = "";
    return;
  }
  const busca = semAcento($("#busca-cidade").value.trim());
  const rows = lista.filter((m) => m.r && (!busca || semAcento(m.nome).includes(busca)));
  ordenar(rows, $("#ordem-cidades").value);
  const visiveis = rows.slice(0, 300);
  const cols = colunasCandidatos(d.estados[uf], false);
  t.innerHTML =
    `<thead><tr><th>Cidade</th><th>Urnas apuradas</th>${cols.cab}<th>Votos válidos</th><th>Liderando</th></tr></thead><tbody>` +
    visiveis
      .map((m, i) => `<tr data-i="${i}"><td>${esc(m.nome)}${m.capital ? '<span class="tag">capital</span>' : ""}</td>
        <td style="min-width:150px">${progress(m.r)}</td>${cols.cel(m.r)}
        <td style="min-width:140px">${stack(m.r)}</td>${liderCell(m.r)}</tr>`)
      .join("") +
    "</tbody>";
  t.querySelectorAll("tr[data-i]").forEach((tr) => {
    const m = visiveis[Number(tr.dataset.i)];
    bindTip(tr.querySelector("[data-tipkey]"), m.r, `${m.nome} (${uf})`);
  });
  const carregadas = lista.filter((m) => m.r).length;
  const fim = lista.filter((m) => completo(m.r)).length;
  $("#cidades-status").textContent =
    (carregadas < lista.length ? `Carregando: ${fmt.format(carregadas)} de ${fmt.format(lista.length)} cidades · ` : `${fmt.format(lista.length)} cidades · `) +
    `${fmt.format(fim)} com todas as urnas apuradas` +
    (rows.length > visiveis.length ? ` · mostrando ${visiveis.length} de ${fmt.format(rows.length)} (use a busca)` : "");
}

// ------------------------------------------------------------- render geral

let aba = "analises";

function renderAll() {
  const d = atual();
  const d1 = primeiroTurno();
  renderTopo(d);
  renderPlacar(d);
  renderMini(d);
  renderMapa(d);
  if (aba === "analises") {
    renderResumo(d, d1);
    renderRegioes(d);
    renderProjecao(d, d1);
    renderComparacao(d, d1);
    renderRankings(d, d1);
  } else if (aba === "estados") {
    renderEstados(d);
  } else {
    renderCidades(d);
  }
}

// enquanto as cidades chegam, redesenha no máximo 2x por segundo
let renderPendente = null;
function agendarRender() {
  if (renderPendente) return;
  renderPendente = setTimeout(() => {
    renderPendente = null;
    renderAll();
  }, 500);
}

// ------------------------------------------------------------- atualização

let geracao = 0;

const ufDasCidades = () => (ehUF(cfg.recorte) && cfg.recorte !== "ZZ" ? cfg.recorte : "");

/**
 * Atualiza o que está na tela. Cada chamada substitui a anterior (nada é ignorado):
 * a tela é redesenhada na hora com o que já está em cache e de novo quando os dados chegam.
 */
async function atualizar({ forcar = false } = {}) {
  const gen = ++geracao;
  const d = atual();
  const d1 = primeiroTurno();
  renderAll();
  const tarefas = [];
  // apuração encerrada não muda mais: não precisa baixar de novo
  if (!d.carregado || forcar || !completo(d.brasil)) tarefas.push(carregarEstados(d));
  if (d1 && !d1.carregado) tarefas.push(carregarEstados(d1));
  if (tarefas.length) {
    carregandoAgora = true;
    renderTopo(d);
    await Promise.all(tarefas.map((p) => p.catch(() => {})));
    if (gen === geracao) carregandoAgora = false;
  }
  if (gen !== geracao) return;
  fixarCores(d);
  renderAll();

  const uf = ufDasCidades();
  if (uf && d.brasil && (!d.cidades[uf] || forcar || !completo(d.estados[uf]) || d.cidades[uf].some((m) => !m.r))) {
    await carregarCidades(d, uf, () => atual() === d && ufDasCidades() === uf).catch(() => {});
    if (atual() === d) renderAll();
  }
}

function escolherRecorte(rec) {
  cfg.recorte = rec;
  saveConfig();
  atualizar();
}

setInterval(() => {
  if (!document.hidden) atualizar();
}, REFRESH_MS);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) atualizar();
});

// ------------------------------------------------------------- eventos

const ufsPorNome = Object.keys(UFS).sort((a, b) => UFS[a][0].localeCompare(UFS[b][0], "pt-BR"));
$("#recorte").innerHTML =
  `<option value="">Brasil</option>` +
  `<optgroup label="Regiões">${REGIOES.filter((r) => r !== "Exterior").map((r) => `<option value="R:${r}">Região ${r}</option>`).join("")}</optgroup>` +
  `<optgroup label="Estados">${ufsPorNome.map((uf) => `<option value="${uf}">${UFS[uf][0]}</option>`).join("")}</optgroup>`;
$("#cidades-uf").innerHTML =
  `<option value="">Escolha um estado</option>` +
  ufsPorNome.filter((uf) => uf !== "ZZ").map((uf) => `<option value="${uf}">${UFS[uf][0]}</option>`).join("");

$("#recorte").addEventListener("change", (ev) => escolherRecorte(ev.target.value));
$("#cidades-uf").addEventListener("change", (ev) => escolherRecorte(ev.target.value));
$("#voltar").addEventListener("click", () => escolherRecorte(""));
$("#chip-exterior").addEventListener("click", () => escolherRecorte("ZZ"));

document.querySelectorAll("#seg-turno button").forEach((b) =>
  b.addEventListener("click", () => {
    cfg.turno = b.dataset.v;
    saveConfig();
    atualizar();
  }),
);
document.querySelectorAll("#seg-cargo button").forEach((b) =>
  b.addEventListener("click", () => {
    cfg.cargo = b.dataset.v;
    saveConfig();
    atualizar();
  }),
);
$("#fonte").addEventListener("change", (ev) => {
  cfg.fonte = ev.target.value;
  saveConfig();
  atualizar();
});
$("#btn-atualizar").addEventListener("click", () => atualizar({ forcar: true }));

document.querySelectorAll("#seg-mapa button").forEach((b) =>
  b.addEventListener("click", () => {
    modoMapa = b.dataset.v;
    document.querySelectorAll("#seg-mapa button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    renderMapa(atual());
  }),
);

// clicar num estado (mapa, tabelas, placar de governador) filtra por ele
$("#mapa").addEventListener("click", (ev) => {
  const p = ev.target.closest("path[data-chave]");
  if (p && UFS[p.dataset.chave] && (!ehUF(cfg.recorte) || cfg.recorte === "ZZ")) escolherRecorte(p.dataset.chave);
});
for (const sel of ["#tabela-estados", "#tabela-comparacao", "#placar"]) {
  $(sel).addEventListener("click", (ev) => {
    const el = ev.target.closest("[data-uf]");
    if (el) escolherRecorte(el.dataset.uf);
  });
}
$("#regioes").addEventListener("click", (ev) => {
  const el = ev.target.closest("[data-regiao]");
  if (el) escolherRecorte("R:" + el.dataset.regiao);
});

document.querySelectorAll(".tabs button").forEach((b) =>
  b.addEventListener("click", () => {
    aba = b.dataset.tab;
    document.querySelectorAll(".tabs button").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
    document.querySelectorAll(".painel").forEach((p) => (p.hidden = p.id !== "tab-" + aba));
    renderAll();
  }),
);
$("#ordem-estados").addEventListener("change", () => renderEstados(atual()));
$("#ordem-cidades").addEventListener("change", () => renderCidades(atual()));
$("#busca-cidade").addEventListener("input", () => renderCidades(atual()));

// ------------------------------------------------------------- início

await detectarProxy();
atualizar();
