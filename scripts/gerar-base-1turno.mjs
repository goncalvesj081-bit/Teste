// Gera a referência do 1º turno de 2026 por cidade, usada pela chance de virada no 2º turno:
//   public/base/presidente-2026-t1.json  (Flávio Bolsonaro e Lula, todas as cidades)
//   public/base/governador-2026-t1.json  (os dois candidatos do 2º turno, nos estados com 2º turno)
//   NODE_USE_ENV_PROXY=1 node scripts/gerar-base-1turno.mjs
// Formato: { ufs: { SP: { candidatos: ["22", "13"], cidades: { "71072": [seções, válidos, votos do 1º, votos do 2º] } } } }
import fs from "node:fs";

const TSE = "https://resultados.tse.jus.br/oficial/ele2026";
const UFS = ["AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT", "PA", "PB", "PE", "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO", "ZZ"];

async function json(url, tentativas = 4) {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return r.json();
      if (r.status === 404) return null;
      throw new Error(r.status);
    } catch (e) {
      if (i >= tentativas) throw e;
      await new Promise((ok) => setTimeout(ok, 1000 * 2 ** i));
    }
  }
}

const candidatosDe = (j) => j.carg[0].agr.flatMap((a) => a.par.flatMap((p) => p.cand.map((c) => [c.n, +c.vap])));

/** eleicao1/cargo: 1º turno a ler; candidatosPorUf: os dois do 2º turno em cada estado. */
async function gerar(saida, eleicao1, cargo, candidatosPorUf) {
  const e6 = eleicao1.padStart(6, "0");
  const tarefas = [];
  const out = { ufs: {} };
  for (const [uf, cands] of Object.entries(candidatosPorUf)) {
    const u = uf.toLowerCase();
    const ab = await json(`${TSE}/${eleicao1}/dados/${u}/${u}-e${e6}-ab.json`);
    out.ufs[uf] = { candidatos: cands, cidades: {} };
    for (const a of ab?.abr || []) if (a.tpabr === "mun") tarefas.push({ uf, cod: a.cdabr, secoes: +a.s.ts });
  }
  let i = 0;
  await Promise.all(Array.from({ length: 16 }, async () => {
    while (i < tarefas.length) {
      const t = tarefas[i++];
      const u = t.uf.toLowerCase();
      const j = await json(`${TSE}/${eleicao1}/dados/${u}/${u}${t.cod}-c${cargo}-e${e6}-u.json`);
      if (!j) continue;
      const votos = Object.fromEntries(candidatosDe(j));
      out.ufs[t.uf].cidades[t.cod] = [t.secoes, +j.v.vv, ...out.ufs[t.uf].candidatos.map((n) => votos[n] || 0)];
    }
  }));
  fs.writeFileSync(new URL(`../public/base/${saida}`, import.meta.url), JSON.stringify(out));
  console.log(saida, tarefas.length, "cidades");
}

// presidente: os dois do 2º turno são os mesmos em todo o país
await gerar("presidente-2026-t1.json", "6257", "0001", Object.fromEntries(UFS.map((uf) => [uf, ["22", "13"]])));

// governador: os dois candidatos de cada estado com 2º turno, lidos dos arquivos do 2º turno
const gov = {};
for (const uf of UFS) {
  const u = uf.toLowerCase();
  const j = await json(`${TSE}/6260/dados/${u}/${u}-c0003-e006260-u.json`);
  if (j) gov[uf] = candidatosDe(j).map(([n]) => n).slice(0, 2);
}
await gerar("governador-2026-t1.json", "6259", "0003", gov);
