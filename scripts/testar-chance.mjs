// Testa a chance de virada (public/modelo.js) com o 2º turno de 2022, reapurado cidade a cidade
// com o 1º turno de 2022 como referência (o mesmo papel do 1º turno de 2026 no domingo).
//   node scripts/testar-chance.mjs
// Corridas: presidente no Brasil e em cada estado, e governador nos 12 estados com 2º turno.
// Ordens de apuração: parecida com 2022 (Sul e Sudeste primeiro), aleatória e Nordeste primeiro.
import fs from "node:fs";
import { chancePorCidades, aleatorio, normal, PERFIS } from "../public/modelo.js";

const pasta = new URL("../public/dados2022/", import.meta.url);
const ler = (n) => JSON.parse(fs.readFileSync(new URL(n, pasta)));
const REGIAO = {
  AC: "N", AM: "N", AP: "N", PA: "N", RO: "N", RR: "N", TO: "N", AL: "NE", BA: "NE", CE: "NE", MA: "NE", PB: "NE", PE: "NE",
  PI: "NE", RN: "NE", SE: "NE", DF: "CO", GO: "CO", MS: "CO", MT: "CO", ES: "SE", MG: "SE", RJ: "SE", SP: "SE", PR: "S",
  RS: "S", SC: "S", ZZ: "EX",
};
const ORDENS = {
  "como 2022": { S: 0, SE: 0.04, CO: 0.06, N: 0.16, NE: 0.2, EX: 0.3 },
  aleatória: { S: 0, SE: 0, CO: 0, N: 0, NE: 0, EX: 0 },
  "Nordeste primeiro": { NE: 0, N: 0.04, CO: 0.1, SE: 0.16, S: 0.2, EX: 0.3 },
};

/** Cidades de uma corrida: 1º e 2º turno (votos de A e B, válidos) por cidade. */
function montar(cargo, ufs, A, B) {
  const out = {};
  for (const uf of ufs) {
    let t1, t2;
    try { t1 = ler(`${cargo}-t1-${uf.toLowerCase()}.json`).cidades; t2 = ler(`${cargo}-t2-${uf.toLowerCase()}.json`).cidades; } catch { continue; }
    out[uf] = [];
    for (const [cod, r2] of Object.entries(t2)) {
      const r1 = t1[cod];
      if (!r1) continue;
      const a1 = r1[5][A] || 0, b1 = r1[5][B] || 0;
      out[uf].push({ cod, v1: r1[4], p1: a1 + b1 ? a1 / (a1 + b1) : 0.5, a2: r2[5][A] || 0, b2: r2[5][B] || 0 });
    }
  }
  return out;
}

/** Momento t da apuração: fração apurada de cada cidade (cidades maiores demoram mais). */
function momento(cidades, ordem, t, semente) {
  const estados = [];
  for (const [uf, cs] of Object.entries(cidades)) {
    const maior = Math.max(...cs.map((c) => c.v1));
    let a = 0, b = 0;
    const lista = cs.map((c) => {
      const r = aleatorio(semente * 7919 + Number(c.cod) * 31 + uf.charCodeAt(0));
      const atraso = ordem[REGIAO[uf]] + r() * 0.25 + 0.12 * Math.sqrt(c.v1 / maior);
      const f = Math.max(0, Math.min(1, (t - atraso) * (1.4 + r() * 0.8)));
      // as urnas apuradas de uma cidade não são uma amostra perfeita dela
      const desvio = f > 0 && f < 1 ? normal(r) * 0.03 * (1 - f) : 0;
      const s = Math.min(1, Math.max(0, c.a2 / (c.a2 + c.b2 || 1) + desvio));
      const n = (c.a2 + c.b2) * f;
      a += n * s; b += n * (1 - s);
      return { f, v: c.v1, p: c.p1 };
    });
    estados.push({ uf, a, b, cidades: lista });
  }
  return estados;
}

/** Conta antiga, por estado: o que falta vota como o que já foi apurado no estado. */
function porEstado(estados) {
  let ta = 0, tb = 0;
  for (const e of estados) { ta += e.a; tb += e.b; }
  const pais = ta + tb ? ta / (ta + tb) : 0.5;
  return estados.map((e) => {
    const v = e.cidades.reduce((s, c) => s + c.v, 0), f = e.cidades.reduce((s, c) => s + c.f * c.v, 0) / (v || 1);
    return { a: e.a, b: e.b, cidades: [{ f, v, p: e.a + e.b ? e.a / (e.a + e.b) : pais }] };
  });
}

function avaliar(nome, cidades, ufsCorrida, ordem, semente, registros, perfil) {
  for (let t = 0.02; t < 1.6; t += 0.03) {
    const todos = momento(cidades, ordem, t, semente);
    const est = todos.filter((e) => ufsCorrida.includes(e.uf));
    const a = est.reduce((s, e) => s + e.a, 0), b = est.reduce((s, e) => s + e.b, 0);
    const v1 = est.reduce((s, e) => s + e.cidades.reduce((x, c) => x + c.v, 0), 0);
    const frac = est.reduce((s, e) => s + e.cidades.reduce((x, c) => x + c.f * c.v, 0), 0) / v1;
    if (frac < 0.03) continue;
    if (frac > 0.995) break;
    const novo = chancePorCidades({ a, b, estados: est, paraMudanca: perfil === "governador" ? est : todos, frac, N: 1500, semente: Math.round(t * 1000), erro: PERFIS[perfil] });
    const velho = chancePorCidades({ a, b, estados: porEstado(est), paraMudanca: porEstado(todos), frac, N: 1500, semente: Math.round(t * 1000) });
    registros.push({ nome, frac, lideraA: a > b, novo: novo.probA, velho: velho.probA, media: novo.media });
  }
}

const registros = [];
const corridas = [];
// presidente: Lula (13) × Bolsonaro (22)
const pres = montar("0001", Object.keys(REGIAO), "13", "22");
for (const uf of Object.keys(pres)) for (const c of pres[uf]) c.uf = uf;
const venceA = (cs, ufs) => {
  let a = 0, b = 0;
  for (const uf of ufs) for (const c of cs[uf] || []) { a += c.a2; b += c.b2; }
  return a > b;
};
corridas.push({ nome: "Presidente · Brasil", cidades: pres, ufs: Object.keys(pres) });
for (const uf of Object.keys(pres)) if (uf !== "ZZ") corridas.push({ nome: `Presidente · ${uf}`, cidades: pres, ufs: [uf] });
// governador: os dois partidos do 2º turno em cada estado
const g2 = ler("0003-t2.json");
for (const uf of Object.keys(g2.estados)) {
  const [A, B] = Object.keys(g2.estados[uf][5]);
  const cs = montar("0003", [uf], A, B);
  for (const c of cs[uf] || []) c.uf = uf;
  corridas.push({ nome: `Governador · ${uf}`, cidades: cs, ufs: [uf] });
}

for (const [nomeOrdem, ordem] of Object.entries(ORDENS)) {
  for (const semente of [1, 2]) {
    for (const c of corridas) {
      const antes = registros.length;
      avaliar(c.nome, c.cidades, c.ufs, ordem, semente, registros, c.nome.startsWith("Governador") ? "governador" : "presidente");
      const ganhaA = venceA(c.cidades, c.ufs);
      for (let i = antes; i < registros.length; i++) Object.assign(registros[i], { ordem: nomeOrdem, ganhaA, semente });
    }
  }
}

// --------- resultados
const pVenc = (r, k) => (r.ganhaA ? r[k] : 1 - r[k]);
const faixa = (f) => (f < 0.2 ? "até 20%" : f < 0.4 ? "20–40%" : f < 0.6 ? "40–60%" : f < 0.8 ? "60–80%" : "80–100%");
const brier = (rs, k) => rs.reduce((s, r) => s + (1 - pVenc(r, k)) ** 2, 0) / rs.length;
console.log(`\n${registros.length} momentos avaliados em ${corridas.length} corridas × 3 ordens × 2 sorteios\n`);
console.log("Erro médio (Brier, menor é melhor) por % apurado:");
console.log("faixa      | conta nova | conta por estado | só quem lidera");
for (const fx of ["até 20%", "20–40%", "40–60%", "60–80%", "80–100%"]) {
  const rs = registros.filter((r) => faixa(r.frac) === fx);
  const lider = rs.reduce((s, r) => s + (r.lideraA === r.ganhaA ? 0 : 1), 0) / rs.length;
  console.log(`${fx.padEnd(10)} | ${brier(rs, "novo").toFixed(3).padStart(10)} | ${brier(rs, "velho").toFixed(3).padStart(16)} | ${lider.toFixed(3).padStart(14)}`);
}
const viradas = registros.filter((r) => r.lideraA !== r.ganhaA);
console.log(`\nMomentos em que quem lidera ainda vai perder: ${viradas.length}`);
console.log(`  chance média dada a quem vai virar: conta nova ${(viradas.reduce((s, r) => s + pVenc(r, "novo"), 0) / viradas.length * 100).toFixed(0)}% · por estado ${(viradas.reduce((s, r) => s + pVenc(r, "velho"), 0) / viradas.length * 100).toFixed(0)}%`);
for (const lim of [0.1, 0.05, 0.01]) {
  const n = registros.filter((r) => pVenc(r, "novo") < lim).length, v = registros.filter((r) => pVenc(r, "velho") < lim).length;
  console.log(`  vezes que deu menos de ${lim * 100}% a quem venceu: conta nova ${n} (${(n / registros.length * 100).toFixed(2)}%) · por estado ${v} (${(v / registros.length * 100).toFixed(2)}%)`);
}
// calibração: quando a conta diz X%, o favorito vence X% das vezes?
console.log("\nCalibração da conta nova (chance dada ao favorito → quantas vezes o favorito venceu):");
for (const [lo, hi] of [[0.5, 0.6], [0.6, 0.7], [0.7, 0.8], [0.8, 0.9], [0.9, 0.97], [0.97, 1.01]]) {
  const rs = registros.filter((r) => { const p = Math.max(r.novo, 1 - r.novo); return p >= lo && p < hi; });
  if (!rs.length) continue;
  const acerto = rs.filter((r) => (r.novo >= 0.5) === r.ganhaA).length / rs.length;
  console.log(`  ${(lo * 100).toFixed(0)}–${Math.min(100, hi * 100).toFixed(0)}%: ${rs.length} momentos, favorito venceu ${(acerto * 100).toFixed(0)}%`);
}
console.log("\nPresidente · Brasil, ordem como 2022 (Lula = A):");
console.log("apurado | quem lidera   | chance do Lula (nova) | (por estado) | margem final estimada do Lula");
for (const r of registros.filter((x) => x.nome === "Presidente · Brasil" && x.ordem === "como 2022" && x.semente !== 2).slice(0, 40)) {
  console.log(`${(r.frac * 100).toFixed(0).padStart(5)}%  | ${r.lideraA ? "Lula      " : "Bolsonaro "}    | ${(r.novo * 100).toFixed(0).padStart(20)}% | ${(r.velho * 100).toFixed(0).padStart(11)}% | ${r.media >= 0 ? "+" : ""}${r.media.toFixed(2)} p.p.`);
}

if (process.argv.includes("--erros")) {
  console.log("\nErros confiantes (menos de 5% a quem venceu):");
  const rs = registros.filter((r) => pVenc(r, "novo") < 0.05);
  const porCorrida = {};
  for (const r of rs) (porCorrida[`${r.nome} · ${r.ordem}`] ||= []).push(`${(r.frac * 100).toFixed(0)}%:${(pVenc(r, "novo") * 100).toFixed(1)}% (margem ${r.media.toFixed(1)})`);
  for (const [k, v] of Object.entries(porCorrida)) console.log(" ", k, "→", v.join(", "));
}
