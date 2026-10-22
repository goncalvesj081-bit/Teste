import { UFS, REGIOES, CARGOS, TseSource, DemoSource, aggregate } from "./data.js";

const $ = (s) => document.querySelector(s);
const fmt = new Intl.NumberFormat("pt-BR");
const pctFmt = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ppFmt = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const pct = (a, b) => (b ? (a / b) * 100 : 0);
const pctStr = (a, b) => pctFmt.format(pct(a, b)) + "%";
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const delta = (d) => `<span class="delta">${d >= 0.05 ? "▲ +" : d <= -0.05 ? "▼ −" : ""}${ppFmt.format(Math.abs(d))} p.p.</span>`;

const REFRESH_MS = 30_000;
const CONCORRENCIA = 8;

// ------------------------------------------------------------- configuração

// Códigos do TSE das eleições de 2026, por turno e cargo
const TURNOS = {
  1: { "0001": "6257", "0003": "6259" },
  2: { "0001": "6258", "0003": "6260" },
};
const NOME_TURNO = { 1: "1º turno", 2: "2º turno", outro: "eleição" };
const DEFAULTS = { fonte: "tse", turno: "2", ano: "2026", eleicao: "", cargo: "0001", auto: true, recorte: "" };

function loadConfig() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem("painel-config") || "{}"); } catch {}
  const params = Object.fromEntries(new URLSearchParams(location.search));
  const c = { ...DEFAULTS, ...saved, ...params };
  c.auto = c.auto === true || c.auto === "true" || c.auto === "1";
  // configuração antiga (só com o código): descobre o turno pelo código
  if (!saved.turno && !params.turno && c.eleicao) {
    c.turno = Object.keys(TURNOS).find((t) => TURNOS[t][c.cargo] === c.eleicao) || "outro";
  }
  if (!["1", "2", "outro"].includes(c.turno)) c.turno = "2";
  return c;
}

function saveConfig() {
  try { localStorage.setItem("painel-config", JSON.stringify(cfg)); } catch {}
}

const codigoEleicao = (c) => (c.turno === "outro" ? c.eleicao : TURNOS[c.turno][c.cargo]);

// Servido pelo server.js -> usa o proxy "tse/"; hospedado só com arquivos estáticos
// (GitHub Pages) ou aberto como arquivo -> acessa o TSE direto.
const params = new URLSearchParams(location.search);
const TSE_DIRETO = "https://resultados.tse.jus.br";
let TSE_BASE = params.get("base") || TSE_DIRETO;

async function detectarProxy() {
  if (params.get("base") || !location.protocol.startsWith("http")) return;
  try {
    const r = await fetch("tse/status", { cache: "no-store" });
    if (r.ok && (await r.text()) === "ok") TSE_BASE = "tse";
  } catch {}
}

let cfg = loadConfig();
let source;
let sourceT1; // 1º turno, para comparar quando o painel está no 2º
let timer;

const state = {
  brasil: null,
  estados: {}, // UF -> resultado | null (sem dados)
  cidades: {}, // UF -> [{ codigo, nome, capital, r }]
  t1: null, // { brasil, estados } do 1º turno
  aba: "analises",
  cores: new Map(), // número do candidato -> slot de cor fixo
};

function novaFonte(turno, eleicao) {
  if (cfg.fonte === "demo") return new DemoSource(turno === "1" ? "1" : "2");
  return new TseSource({ base: TSE_BASE, ano: cfg.ano, eleicao, cargo: cfg.cargo });
}

function buildSource() {
  source = novaFonte(cfg.turno, codigoEleicao(cfg));
  sourceT1 = cfg.turno === "2" ? novaFonte("1", TURNOS[1][cfg.cargo]) : null;
  state.brasil = null;
  state.estados = {};
  state.cidades = {};
  state.t1 = null;
  state.cores = new Map();
}

const governador = () => cfg.cargo === "0003";

// ------------------------------------------------------------- recorte

const ehUF = (rec) => !!rec && !rec.startsWith("R:");
const ufsDoRecorte = (rec) =>
  !rec ? Object.keys(UFS) : rec.startsWith("R:") ? Object.keys(UFS).filter((uf) => UFS[uf][1] === rec.slice(2)) : [rec];
const nomeRecorte = (rec) => (!rec ? "Brasil" : rec.startsWith("R:") ? rec.slice(2) : UFS[rec][0]);

function resultadoRecorte(rec, base = state) {
  if (!base) return null;
  if (!rec) return base.brasil;
  if (ehUF(rec)) return base.estados[rec] || null;
  const rs = ufsDoRecorte(rec).map((uf) => base.estados[uf]).filter(Boolean);
  return rs.length ? aggregate(rs) : null;
}

// candidatos somados entre estados só fazem sentido para presidente
const mostraCandidatos = () => !governador() || ehUF(cfg.recorte);

/** Unidades dentro do recorte: estados (Brasil/região) ou cidades (estado, se carregadas). */
function unidades(rec) {
  if (ehUF(rec)) {
    const lista = state.cidades[rec];
    return lista?.some((m) => m.r) ? lista.filter((m) => m.r).map((m) => ({ id: m.codigo, nome: m.nome, r: m.r, cidade: true })) : null;
  }
  return ufsDoRecorte(rec)
    .filter((uf) => state.estados[uf])
    .map((uf) => ({ id: uf, nome: UFS[uf][0], r: state.estados[uf] }));
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

const sw = (c) => `<i class="swatch" style="background:${cor(c.numero)}"></i>`;

function nomeCurto(c) {
  return c.nome.length > 22 ? c.nome.slice(0, 21) + "…" : c.nome;
}

const votosDe = (r, numero) => r?.candidatos.find((x) => x.numero === numero)?.votos || 0;
const margem = (r) => (r?.validos ? pct((r.candidatos[0]?.votos || 0) - (r.candidatos[1]?.votos || 0), r.validos) : 0);

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

/** Votos válidos que ainda faltam apurar numa unidade (estimativa). */
function restanteEstimado(r, ref) {
  const faltam = r.secoes - r.apuradas;
  if (faltam <= 0) return 0;
  if (r.apuradas > 0) return (r.validos * faltam) / r.apuradas;
  if (ref?.validos && ref.secoes) return (ref.validos * faltam) / ref.secoes; // usa o 1º turno como base
  return r.eleitorado * (faltam / r.secoes) * 0.75;
}

/**
 * Projeção simples: as urnas que faltam em cada unidade votam como as já apuradas nela
 * (se a unidade não tem nada apurado, usa a divisão do recorte inteiro).
 */
function projetar(us) {
  const geral = aggregate(us.map((u) => u.r));
  const total = new Map();
  let restante = 0;
  for (const u of us) {
    const rest = restanteEstimado(u.r, !u.cidade ? state.t1?.estados[u.id] : null);
    restante += rest;
    for (const c of geral.candidatos) {
      const v = votosDe(u.r, c.numero);
      const share = u.r.validos ? v / u.r.validos : geral.validos ? c.votos / geral.validos : 0;
      total.set(c.numero, (total.get(c.numero) || 0) + v + rest * share);
    }
  }
  const validos = geral.validos + restante;
  return {
    restante,
    validosAtual: geral.validos,
    validos,
    candidatos: geral.candidatos.map((c) => ({ ...c, projetado: total.get(c.numero) || 0 })).sort((a, b) => b.projetado - a.projetado),
  };
}

// ------------------------------------------------------------- tooltip

const tip = $("#tooltip");
const tipData = new WeakMap();

function bindTip(el, r, titulo) {
  if (el) tipData.set(el, { r, titulo });
}

document.addEventListener("pointermove", (ev) => {
  const el = ev.target.closest?.("[data-tipkey]");
  const d = el && tipData.get(el);
  if (!d) { tip.hidden = true; return; }
  const { r, titulo } = d;
  tip.innerHTML =
    `<strong>${esc(titulo)}</strong>` +
    `<div><span>Urnas apuradas</span><span>${pctStr(r.apuradas, r.secoes)}</span></div>` +
    r.candidatos.map((c) => `<div><span>${sw(c)} ${esc(nomeCurto(c))}</span><span>${pctStr(c.votos, r.validos)} · ${fmt.format(c.votos)}</span></div>`).join("");
  tip.hidden = false;
  const x = Math.min(ev.clientX + 14, innerWidth - tip.offsetWidth - 8);
  const y = Math.min(ev.clientY + 14, innerHeight - tip.offsetHeight - 8);
  tip.style.left = x + "px";
  tip.style.top = y + "px";
});

// ------------------------------------------------------------- render: topo

function renderKpis() {
  const r = resultadoRecorte(cfg.recorte);
  if (!r) { $("#kpis").innerHTML = ""; return; }
  const [lider, segundo] = r.candidatos;
  $("#kpis").innerHTML = `
    <div class="kpi hero"><div class="label">Urnas apuradas</div><div class="value">${pctStr(r.apuradas, r.secoes)}</div>
      <div class="sub">${fmt.format(r.apuradas)} de ${fmt.format(r.secoes)} seções</div></div>
    <div class="kpi"><div class="label">Comparecimento</div><div class="value">${pctStr(r.comparecimento, r.eleitores)}</div>
      <div class="sub">${fmt.format(r.comparecimento)} eleitores</div></div>
    <div class="kpi"><div class="label">Abstenção</div><div class="value">${pctStr(r.abstencao, r.eleitores)}</div>
      <div class="sub">${fmt.format(r.abstencao)} eleitores</div></div>
    <div class="kpi"><div class="label">Brancos / nulos</div><div class="value">${pctStr(r.brancos + r.nulos, r.comparecimento)}</div>
      <div class="sub">${fmt.format(r.brancos)} brancos · ${fmt.format(r.nulos)} nulos</div></div>
    ${mostraCandidatos() && lider && segundo ? `<div class="kpi"><div class="label">Diferença 1º – 2º</div><div class="value">${fmt.format(lider.votos - segundo.votos)}</div>
      <div class="sub">${pctFmt.format(margem(r))} p.p. dos válidos</div></div>` : ""}`;
}

function renderPrincipal() {
  $("#titulo-recorte").textContent = nomeRecorte(cfg.recorte);
  const r = resultadoRecorte(cfg.recorte);
  if (!r) {
    $("#brasil-bars").innerHTML = `<p class="muted">Sem dados para ${esc(nomeRecorte(cfg.recorte))} nesta eleição e cargo.</p>`;
    $("#legend").innerHTML = "";
    return;
  }
  if (!mostraCandidatos()) {
    $("#legend").innerHTML = "";
    $("#brasil-bars").innerHTML = `<p class="muted">Para governador, cada estado tem os seus candidatos. Escolha um estado em “Ver resultado de” para ver os votos.</p>`;
    return;
  }
  $("#legend").innerHTML = r.candidatos.map((c) => `<span>${sw(c)}${esc(c.numero)} · ${esc(nomeCurto(c))}</span>`).join("");
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

// ------------------------------------------------------------- render: análises

function renderResumo() {
  const rec = cfg.recorte;
  const r = resultadoRecorte(rec);
  const t1r = cfg.turno === "2" ? resultadoRecorte(rec, state.t1) : null;
  const itens = [];
  if (!r || !r.secoes) {
    $("#resumo").innerHTML = `<li>Sem dados para ${esc(nomeRecorte(rec))} nesta eleição e cargo.</li>`;
    return;
  }
  const completo = r.apuradas === r.secoes;
  if (!r.apuradas) itens.push("A apuração ainda não começou aqui.");
  else itens.push(`<b>${pctStr(r.apuradas, r.secoes)}</b> das urnas apuradas (${fmt.format(r.apuradas)} de ${fmt.format(r.secoes)} seções).`);

  const [a, b] = r.candidatos;
  if (r.apuradas && mostraCandidatos() && a && b) {
    const dif = a.votos - b.votos;
    itens.push(
      `${sw(a)} <b>${esc(a.nome)}</b> ${completo ? "terminou em 1º" : "lidera"} com <b>${pctStr(a.votos, r.validos)}</b> dos votos válidos, ` +
        `<b>${fmt.format(dif)}</b> votos à frente de ${sw(b)} <b>${esc(b.nome)}</b> (${pctFmt.format(margem(r))} p.p.).`,
    );

    // regra do 1º turno: mais da metade dos válidos vence direto
    const disputaPrincipal = governador() ? ehUF(rec) : !rec;
    if (cfg.turno === "1" && disputaPrincipal) {
      if (pct(a.votos, r.validos) > 50) {
        itens.push(`${esc(a.nome)} tem mais da metade dos votos válidos: ${completo ? "venceu" : "venceria"} sem 2º turno.`);
      } else {
        itens.push(`Ninguém passou de 50% dos válidos: ${esc(a.nome)} e ${esc(b.nome)} ${completo ? "foram" : "estão indo"} para o 2º turno.`);
      }
    }

    const us = unidades(rec);
    if (!completo && us?.length) {
      const proj = projetar(us);
      if (dif > proj.restante) {
        itens.push(`A vantagem de ${esc(a.nome)} já é maior que todos os votos válidos que ainda faltam apurar (estimativa: ~${fmt.format(Math.round(proj.restante))}).`);
      } else {
        const precisa = (proj.restante + dif) / (2 * proj.restante);
        itens.push(
          `Faltam cerca de <b>${fmt.format(Math.round(proj.restante))}</b> votos válidos. Para virar, ${esc(b.nome)} precisaria de ` +
            `<b>${pctFmt.format(precisa * 100)}%</b> deles na disputa direta com ${esc(a.nome)}.`,
        );
      }
      const [pa, pb] = proj.candidatos;
      itens.push(
        `Se o que falta votar como o que já foi apurado em cada ${us[0].cidade ? "cidade" : "estado"}, ` +
          `${esc(pa.nome)} terminaria com <b>${pctStr(pa.projetado, proj.validos)}</b> e ${esc(pb.nome)} com <b>${pctStr(pb.projetado, proj.validos)}</b>.`,
      );
    }
  }

  if (r.eleitores) {
    let txt = `Comparecimento de <b>${pctStr(r.comparecimento, r.eleitores)}</b> nas seções apuradas (abstenção de ${pctStr(r.abstencao, r.eleitores)}).`;
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

function renderProjecao() {
  const rec = cfg.recorte;
  const r = resultadoRecorte(rec);
  const us = unidades(rec);
  const bloco = $("#bloco-projecao");
  // apuração encerrada: a projeção só repetiria o resultado
  bloco.hidden = !r || !mostraCandidatos() || (r.secoes > 0 && r.apuradas === r.secoes);
  if (bloco.hidden) return;
  if (!r.apuradas) {
    $("#projecao-nota").textContent = "A projeção aparece quando as primeiras urnas forem apuradas.";
    $("#projecao").innerHTML = "";
    return;
  }
  if (!us?.length) {
    $("#projecao-nota").textContent = "Carregando as cidades para projetar…";
    $("#projecao").innerHTML = "";
    return;
  }
  const proj = projetar(us);
  const porQue = us[0].cidade ? "cidade" : "estado";
  $("#projecao-nota").textContent =
    r.apuradas === r.secoes
      ? "Todas as urnas foram apuradas: o resultado projetado é o resultado final."
      : `Estimativa simples, não é previsão oficial: supõe que as urnas que faltam em cada ${porQue} votam como as já apuradas no mesmo ${porQue}. ` +
        `Faltam cerca de ${fmt.format(Math.round(proj.restante))} votos válidos.`;
  const max = Math.max(...proj.candidatos.flatMap((c) => [pct(c.votos, proj.validosAtual), pct(c.projetado, proj.validos)]), 1);
  $("#projecao").innerHTML =
    `<div class="legenda-proj"><span><i></i>Agora</span><span><i class="proj"></i>Projetado</span></div>` +
    proj.candidatos
      .slice(0, 6)
      .map((c) => {
        const agora = pct(c.votos, proj.validosAtual), fim = pct(c.projetado, proj.validos);
        return `<div class="proj-row">
          <div>${sw(c)} <b>${esc(nomeCurto(c))}</b></div>
          <div class="barras">
            <div class="bar"><i style="width:${(agora / max) * 100}%;background:${cor(c.numero)}"></i></div>
            <div class="bar proj"><i style="width:${(fim / max) * 100}%;background:${cor(c.numero)}"></i></div>
          </div>
          <div class="vals">${pctFmt.format(agora)}% → <b>${pctFmt.format(fim)}%</b><br><small>${delta(fim - agora)}</small></div>
        </div>`;
      })
      .join("");
}

function renderComparacao() {
  const bloco = $("#bloco-comparacao");
  const rec = cfg.recorte;
  bloco.hidden = cfg.turno !== "2" || !state.t1;
  if (bloco.hidden) return;
  const ufs = ufsDoRecorte(rec).filter((uf) => state.estados[uf] && state.t1.estados[uf]);
  const nacional = !governador() ? resultadoRecorte(rec) : null;
  const linhas = ufs.map((uf) => ({ nome: UFS[uf][0], uf, r2: state.estados[uf], r1: state.t1.estados[uf] }));
  if (ufs.length > 1 && !governador()) linhas.push({ nome: `Total ${nomeRecorte(rec)}`, uf: "", r2: resultadoRecorte(rec), r1: resultadoRecorte(rec, state.t1), total: true });
  if (!linhas.length) {
    bloco.hidden = true;
    return;
  }
  $("#comparacao-nota").textContent =
    "Percentual dos votos válidos de cada candidato no 1º turno e no 2º (até agora). " +
    "No 2º turno os votos dos outros candidatos se redistribuem, por isso os dois tendem a crescer.";
  const celula = (r1, r2, c) => {
    if (!c) return "<td></td><td></td>";
    const p1 = pct(votosDe(r1, c.numero), r1.validos), p2 = pct(votosDe(r2, c.numero), r2.validos);
    const nome = governador() ? `${sw(c)} ${esc(nomeCurto(c))}<br>` : "";
    if (!r2.validos) return `<td class="r">${nome}${pctFmt.format(p1)}% → <span class="muted">aguardando</span></td><td class="r">—</td>`;
    return `<td class="r">${nome}${pctFmt.format(p1)}% → <b>${pctFmt.format(p2)}%</b></td><td class="r">${delta(p2 - p1)}</td>`;
  };
  const cab = nacional
    ? nacional.candidatos.slice(0, 2).map((c) => `<th class="r">${sw(c)} ${esc(nomeCurto(c))}</th><th class="r">Variação</th>`).join("")
    : `<th class="r">1º colocado</th><th class="r">Variação</th><th class="r">2º colocado</th><th class="r">Variação</th>`;
  $("#tabela-comparacao").innerHTML =
    `<thead><tr><th>Estado</th>${cab}<th class="r">Comparecimento</th></tr></thead><tbody>` +
    linhas
      .map((l) => {
        const cands = (nacional || l.r2).candidatos.slice(0, 2);
        const comp1 = pct(l.r1.comparecimento, l.r1.eleitores), comp2 = pct(l.r2.comparecimento, l.r2.eleitores);
        return `<tr class="${l.uf && l.uf === rec ? "sel" : ""}"><td>${l.total ? `<b>${esc(l.nome)}</b>` : `<b>${l.uf}</b> <span class="muted">${esc(l.nome)}</span>`}</td>
          ${celula(l.r1, l.r2, cands[0])}${celula(l.r1, l.r2, cands[1])}
          <td class="r">${l.r2.eleitores ? `${pctFmt.format(comp2)}% ${delta(comp2 - comp1)}` : "—"}</td></tr>`;
      })
      .join("") +
    "</tbody>";
}

function itemRanking(u, extra = "") {
  const [a] = u.r.candidatos;
  return `<li><div class="linha"><span><b>${esc(u.nome)}</b></span>
    <span>${a ? `${sw(a)} ${esc(nomeCurto(a))} <b>+${pctFmt.format(margem(u.r))} p.p.</b>` : "—"}</span></div>
    <div class="linha muted"><span>${pctStr(u.r.apuradas, u.r.secoes)} apurado</span><span>${extra}</span></div>
    ${stack(u.r, 'data-tipkey="1"')}</li>`;
}

function renderRankings() {
  const rec = cfg.recorte;
  const us = (unidades(rec) || []).filter((u) => u.r.validos);
  const tipo = ehUF(rec) ? "cidades" : "estados";
  $("#titulo-apertadas").textContent = `Disputas mais apertadas (${tipo})`;
  $("#titulo-folgadas").textContent = `Maiores vantagens (${tipo})`;
  const vazio = `<li class="muted">${ehUF(rec) && !state.cidades[rec] ? "Carregando cidades…" : "Sem votos apurados ainda."}</li>`;
  const porMargem = [...us].sort((x, y) => margem(x.r) - margem(y.r));
  // nas cidades, ignora as muito pequenas para o ranking de apertadas não virar só lugarejo
  const minimo = ehUF(rec) ? 2000 : 0;
  const apertadas = porMargem.filter((u) => u.r.validos >= minimo).slice(0, 6);
  const folgadas = porMargem.slice(-6).reverse();
  const preencher = (el, lista) => {
    el.innerHTML = lista.length ? lista.map((u) => itemRanking(u, `${fmt.format(u.r.validos)} válidos`)).join("") : vazio;
    el.querySelectorAll("li").forEach((li, i) => lista[i] && bindTip(li.querySelector("[data-tipkey]"), lista[i].r, lista[i].nome));
  };
  preencher($("#apertadas"), apertadas);
  preencher($("#folgadas"), folgadas);

  const todos = unidades(rec) || [];
  const faltam = todos
    .map((u) => ({ ...u, rest: restanteEstimado(u.r, !u.cidade ? state.t1?.estados[u.id] : null) }))
    .filter((u) => u.rest > 0)
    .sort((x, y) => y.rest - x.rest)
    .slice(0, 6);
  $("#titulo-faltam").textContent = `Onde faltam mais votos (${tipo})`;
  const el = $("#faltam");
  el.innerHTML = faltam.length
    ? faltam.map((u) => itemRanking(u, `faltam ~${fmt.format(Math.round(u.rest))} válidos`)).join("")
    : `<li class="muted">${todos.length ? "Todas as urnas daqui já foram apuradas." : vazio}</li>`;
  el.querySelectorAll("li").forEach((li, i) => faltam[i] && bindTip(li.querySelector("[data-tipkey]"), faltam[i].r, faltam[i].nome));
}

function renderAnalises() {
  renderResumo();
  renderProjecao();
  renderComparacao();
  renderRankings();
}

// ------------------------------------------------------------- render: regiões, estados, cidades

function renderRegioes() {
  const el = $("#regioes");
  el.innerHTML = "";
  for (const reg of REGIOES) {
    const ufs = Object.keys(UFS).filter((uf) => UFS[uf][1] === reg && state.estados[uf]);
    if (!ufs.length) continue;
    const r = aggregate(ufs.map((uf) => state.estados[uf]));
    const card = document.createElement("div");
    card.className = "regiao";
    const cands = !governador()
      ? `<div class="linha"><span>Votos válidos</span><span></span></div>
         ${stack(r, 'data-tipkey="1"')}
         ${r.candidatos.slice(0, 6).map((c) => `<div class="linha"><span>${sw(c)} ${esc(nomeCurto(c))}</span><span>${pctStr(c.votos, r.validos)}</span></div>`).join("")}`
      : "";
    card.innerHTML = `
      <h3>${reg} <span class="muted">(${ufs.join(", ")})</span></h3>
      <div class="linha"><span>Urnas apuradas</span><span>${fmt.format(r.apuradas)} / ${fmt.format(r.secoes)}</span></div>
      ${progress(r)}
      <div class="linha"><span>Comparecimento</span><span>${pctStr(r.comparecimento, r.eleitores)}</span></div>
      ${cands}`;
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

function cabecalho(primeira, cands) {
  const colunas = governador()
    ? `<th>1º colocado</th><th>2º colocado</th>`
    : cands.map((c) => `<th class="r"><span class="cand-pct">${sw(c)}${esc(nomeCurto(c))}</span></th>`).join("");
  return `<thead><tr><th>${primeira}</th><th>Urnas apuradas</th><th class="r">Seções</th>${colunas}<th>Votos válidos</th><th>Liderando</th></tr></thead>`;
}

function celulasCandidatos(r, cands) {
  if (governador()) {
    return [0, 1]
      .map((i) => {
        const c = r.candidatos[i];
        return c ? `<td><span class="cand-pct">${sw(c)}${esc(nomeCurto(c))} <b>${pctStr(c.votos, r.validos)}</b></span></td>` : "<td>—</td>";
      })
      .join("");
  }
  return cands.map((c) => `<td class="r"><span class="cand-pct">${pctStr(votosDe(r, c.numero), r.validos)}</span></td>`).join("");
}

function liderCell(r) {
  const [a] = r.candidatos;
  if (!a || !r.validos) return "<td>—</td>";
  return `<td><span class="cand-pct">${sw(a)}${esc(nomeCurto(a))} <span class="muted">+${pctFmt.format(margem(r))}</span></span></td>`;
}

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
      .map((x) => `<tr class="clicavel ${x.uf === cfg.recorte ? "sel" : ""}" data-uf="${x.uf}"><td><b>${x.uf}</b> <span class="muted">${esc(x.nome)}</span></td>
        <td>${progress(x.r)}</td><td class="r">${fmt.format(x.r.apuradas)}/${fmt.format(x.r.secoes)}</td>
        ${celulasCandidatos(x.r, cands)}<td style="min-width:140px">${stack(x.r, 'data-tipkey="1"')}</td>${liderCell(x.r)}</tr>`)
      .join("") +
    "</tbody>";
  t.querySelectorAll("tr[data-uf]").forEach((tr) => bindTip(tr.querySelector("[data-tipkey]"), state.estados[tr.dataset.uf], UFS[tr.dataset.uf][0]));
  if (!rows.length) t.innerHTML = `<tr><td class="muted">Sem dados por estado para este cargo e turno.</td></tr>`;
}

const semAcento = (s) => s.toLocaleLowerCase("pt-BR").normalize("NFD").replace(/\p{M}/gu, "");

function renderCidades() {
  const uf = $("#filtro-uf").value;
  const lista = state.cidades[uf];
  const t = $("#tabela-cidades");
  if (!lista) { t.innerHTML = ""; return; }
  const busca = semAcento($("#busca-cidade").value.trim());
  const cands = (state.estados[uf] || state.brasil || { candidatos: [] }).candidatos.slice(0, 4);
  const rows = lista.filter((m) => m.r && (!busca || semAcento(m.nome).includes(busca)));
  ordenar(rows, $("#ordem-cidades").value);
  const visiveis = rows.slice(0, 500);
  // cidades usam as colunas do estado, mesmo para governador
  const colunas = cands.map((c) => `<th class="r"><span class="cand-pct">${sw(c)}${esc(nomeCurto(c))}</span></th>`).join("");
  t.innerHTML =
    `<thead><tr><th>Cidade</th><th>Urnas apuradas</th><th class="r">Seções</th>${colunas}<th>Votos válidos</th><th>Liderando</th></tr></thead>` +
    "<tbody>" +
    visiveis
      .map((m, i) => `<tr data-i="${i}"><td>${esc(m.nome)}${m.capital ? '<span class="tag">capital</span>' : ""}</td>
        <td>${progress(m.r)}</td><td class="r">${fmt.format(m.r.apuradas)}/${fmt.format(m.r.secoes)}</td>
        ${cands.map((c) => `<td class="r">${pctStr(votosDe(m.r, c.numero), m.r.validos)}</td>`).join("")}
        <td style="min-width:140px">${stack(m.r, 'data-tipkey="1"')}</td>${liderCell(m.r)}</tr>`)
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
  renderPrincipal();
  renderAnalises();
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

const carregandoCidades = new Map(); // UF -> Promise

function carregarCidades(uf) {
  if (carregandoCidades.has(uf)) return carregandoCidades.get(uf);
  const p = (async () => {
    const lista = (await source.listaMunicipios())[uf] || [];
    const anterior = new Map((state.cidades[uf] || []).map((m) => [m.codigo, m.r]));
    state.cidades[uf] = lista.map((m) => ({ ...m, r: anterior.get(m.codigo) || null }));
    if ($("#filtro-uf").value === uf) $("#cidades-status").textContent = `Carregando ${lista.length} cidades…`;
    let feitas = 0;
    const atualizarTela = () => {
      if (state.aba === "cidades" && $("#filtro-uf").value === uf) renderCidades();
      if (cfg.recorte === uf) renderAnalises();
    };
    await pool(state.cidades[uf], async (m) => {
      m.r = await source.municipio(uf, m.codigo);
      if (++feitas % 60 === 0) atualizarTela();
    });
    atualizarTela();
  })().finally(() => carregandoCidades.delete(uf));
  carregandoCidades.set(uf, p);
  return p;
}

async function carregarT1() {
  if (!sourceT1 || state.t1) return;
  const ufs = Object.keys(UFS);
  const [br, ...estados] = await Promise.all([sourceT1.brasil().catch(() => null), ...ufs.map((uf) => sourceT1.estado(uf).catch(() => null))]);
  if (!br && !estados.some(Boolean)) return;
  state.t1 = { brasil: br || aggregate(estados), estados: Object.fromEntries(ufs.map((uf, i) => [uf, estados[i]])) };
}

let carregando = false;

async function atualizar() {
  if (carregando) return;
  carregando = true;
  const fonte = cfg.fonte === "demo" ? "Simulação" : `TSE · ${NOME_TURNO[cfg.turno]} ${codigoEleicao(cfg)}`;
  setStatus(`${fonte} · ${CARGOS[cfg.cargo]} · atualizando…`);
  try {
    if (cfg.fonte === "tse" && !codigoEleicao(cfg)) throw new Error("Informe o código da eleição (o botão “?” procura no TSE) ou escolha um turno.");
    const ufs = Object.keys(UFS);
    let erroBr = null;
    const [br, ...estados] = await Promise.all([
      source.brasil().catch((e) => ((erroBr = e), null)),
      ...ufs.map((uf) => source.estado(uf).catch(() => null)),
      carregarT1().catch(() => null),
    ]);
    ufs.forEach((uf, i) => (state.estados[uf] = estados[i]));
    state.brasil = br || (estados.slice(0, ufs.length).some(Boolean) ? aggregate(estados.slice(0, ufs.length)) : null);
    if (!state.brasil && erroBr?.semAcesso) throw erroBr;
    if (!state.brasil) {
      throw new Error(
        "O TSE ainda não publicou resultados para esse turno e cargo. No domingo, a apuração começa às 17h (Brasília). " +
          "Para ver o painel funcionando antes disso, use o 1º turno ou a Simulação.",
      );
    }
    // fixa as cores na 1ª leitura (mais votados primeiro; sem votos, pela ordem dos números),
    // para não mudarem quando a liderança muda
    if (!state.cores.size) {
      const temVotos = state.brasil.candidatos.some((c) => c.votos > 0);
      [...state.brasil.candidatos]
        .sort((a, b) => (temVotos ? b.votos - a.votos : a.numero.localeCompare(b.numero, undefined, { numeric: true })))
        .forEach((c) => cor(c.numero));
    }
    renderAll();
    const hora = state.brasil.atualizadoEm ? ` · totalização de ${state.brasil.atualizadoEm}` : "";
    setStatus(`${fonte} · ${CARGOS[cfg.cargo]}${hora} · lido às ${new Date().toLocaleTimeString("pt-BR")}`);
    const ufsCidades = new Set();
    if (ehUF(cfg.recorte)) ufsCidades.add(cfg.recorte);
    if (state.aba === "cidades") ufsCidades.add($("#filtro-uf").value);
    await Promise.all([...ufsCidades].map((uf) => carregarCidades(uf)));
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

function mostrarCampos() {
  const tse = form.elements.fonte.value === "tse";
  if (!tse && form.elements.turno.value === "outro") form.elements.turno.value = "2";
  form.querySelectorAll(".tse-only").forEach((el) => (el.hidden = !tse));
  form.querySelectorAll(".outro-only").forEach((el) => (el.hidden = !tse || form.elements.turno.value !== "outro"));
}

function syncForm() {
  for (const [k, v] of Object.entries(cfg)) {
    const el = form.elements[k];
    if (!el) continue;
    if (el.type === "checkbox") el.checked = v;
    else el.value = v;
  }
  if (cfg.turno === "outro" && !cfg.eleicao) form.elements.eleicao.value = "";
  mostrarCampos();
}

form.addEventListener("change", (ev) => {
  mostrarCampos();
  // mudar fonte, turno ou cargo já recarrega, sem precisar do botão
  if (["fonte", "turno", "cargo"].includes(ev.target.name) && !(ev.target.name === "turno" && ev.target.value === "outro")) {
    form.requestSubmit();
  }
});

form.addEventListener("submit", (ev) => {
  ev.preventDefault();
  const novo = {
    ...cfg,
    fonte: form.elements.fonte.value,
    turno: form.elements.turno.value,
    ano: form.elements.ano.value.trim() || "2026",
    eleicao: form.elements.eleicao.value.trim().replace(/^0+/, ""),
    cargo: form.elements.cargo.value,
    auto: form.elements.auto.checked,
  };
  const mudouFonte = ["fonte", "turno", "ano", "eleicao", "cargo"].some((k) => novo[k] !== cfg[k]);
  cfg = novo;
  saveConfig();
  if (mudouFonte) buildSource();
  agendar();
  atualizar();
});

$("#descobrir").addEventListener("click", async () => {
  const ul = $("#lista-eleicoes");
  ul.innerHTML = "<li>Procurando…</li>";
  $("#dlg-eleicoes").showModal();
  try {
    const lista = (await TseSource.descobrirEleicoes(TSE_BASE, form.elements.ano.value.trim())).filter(
      (e) => e.cargos.includes("Presidente") || e.cargos.includes("Governador"),
    );
    ul.innerHTML = lista.length
      ? lista
          .map((e) => {
            const cargo = e.cargos.includes("Presidente") ? "0001" : "0003";
            return `<li><b>${esc(e.codigo)}</b> — ${esc(e.nome)} (${esc(e.data)}) <button data-cod="${esc(e.codigo)}" data-cargo="${cargo}">usar</button></li>`;
          })
          .join("")
      : "<li>Nenhuma eleição encontrada para esse ano.</li>";
  } catch (err) {
    ul.innerHTML = `<li class="erro">${esc(err.message)}</li>`;
  }
});

$("#lista-eleicoes").addEventListener("click", (ev) => {
  const cod = ev.target.dataset?.cod;
  if (!cod) return;
  form.elements.cargo.value = ev.target.dataset.cargo;
  const turno = Object.keys(TURNOS).find((t) => TURNOS[t][ev.target.dataset.cargo] === cod);
  form.elements.turno.value = turno || "outro";
  form.elements.eleicao.value = cod;
  $("#dlg-eleicoes").close();
  mostrarCampos();
  form.requestSubmit();
});

function abrirAba(aba) {
  state.aba = aba;
  document.querySelectorAll(".tabs button").forEach((x) => x.setAttribute("aria-selected", String(x.dataset.tab === aba)));
  document.querySelectorAll(".tab-panel").forEach((p) => (p.hidden = p.id !== "tab-" + aba));
  if (aba === "cidades") {
    renderCidades();
    const uf = $("#filtro-uf").value;
    if (!state.cidades[uf]) carregarCidades(uf).catch((e) => ($("#cidades-status").textContent = e.message));
  }
}

document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => abrirAba(b.dataset.tab)));

// ---- recorte
const ufsPorNome = Object.keys(UFS).sort((a, b) => UFS[a][0].localeCompare(UFS[b][0], "pt-BR"));
$("#recorte").innerHTML =
  `<option value="">Brasil</option>` +
  `<optgroup label="Regiões">${REGIOES.filter((r) => r !== "Exterior").map((r) => `<option value="R:${r}">${r}</option>`).join("")}</optgroup>` +
  `<optgroup label="Estados">${ufsPorNome.map((uf) => `<option value="${uf}">${UFS[uf][0]} (${uf})</option>`).join("")}</optgroup>`;

function aplicarRecorte() {
  const rec = cfg.recorte;
  $("#recorte").value = rec;
  $("#filtro-regiao").value = !rec ? "" : rec.startsWith("R:") ? rec.slice(2) : UFS[rec][1] === "Exterior" ? "" : UFS[rec][1];
  if (ehUF(rec)) {
    $("#filtro-uf").value = rec;
    $("#recorte-info").textContent = "Análises por cidade deste estado.";
    if (source && !state.cidades[rec]) carregarCidades(rec).catch(() => {});
  } else {
    $("#recorte-info").textContent = "";
  }
}

$("#recorte").addEventListener("change", () => {
  cfg.recorte = $("#recorte").value;
  saveConfig();
  aplicarRecorte();
  renderAll();
});

$("#filtro-regiao").innerHTML += REGIOES.map((r) => `<option>${r}</option>`).join("");
$("#filtro-uf").innerHTML = ufsPorNome.map((uf) => `<option value="${uf}" ${uf === "SP" ? "selected" : ""}>${UFS[uf][0]}</option>`).join("");

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
  abrirAba("cidades");
});

// ------------------------------------------------------------- início

syncForm();
await detectarProxy();
buildSource();
aplicarRecorte();
agendar();
atualizar();
