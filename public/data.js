// Camada de dados: lê os JSON públicos do TSE (resultados.tse.jus.br) ou gera
// uma simulação, e devolve tudo num formato único:
//
//   { secoes, apuradas, eleitores, comparecimento, abstencao, brancos, nulos,
//     validos, atualizadoEm, candidatos: [{ numero, nome, partido, votos, situacao }] }

export const UFS = {
  AC: ["Acre", "Norte"], AM: ["Amazonas", "Norte"], AP: ["Amapá", "Norte"], PA: ["Pará", "Norte"],
  RO: ["Rondônia", "Norte"], RR: ["Roraima", "Norte"], TO: ["Tocantins", "Norte"],
  AL: ["Alagoas", "Nordeste"], BA: ["Bahia", "Nordeste"], CE: ["Ceará", "Nordeste"], MA: ["Maranhão", "Nordeste"],
  PB: ["Paraíba", "Nordeste"], PE: ["Pernambuco", "Nordeste"], PI: ["Piauí", "Nordeste"],
  RN: ["Rio Grande do Norte", "Nordeste"], SE: ["Sergipe", "Nordeste"],
  DF: ["Distrito Federal", "Centro-Oeste"], GO: ["Goiás", "Centro-Oeste"], MS: ["Mato Grosso do Sul", "Centro-Oeste"],
  MT: ["Mato Grosso", "Centro-Oeste"],
  ES: ["Espírito Santo", "Sudeste"], MG: ["Minas Gerais", "Sudeste"], RJ: ["Rio de Janeiro", "Sudeste"], SP: ["São Paulo", "Sudeste"],
  PR: ["Paraná", "Sul"], RS: ["Rio Grande do Sul", "Sul"], SC: ["Santa Catarina", "Sul"],
  ZZ: ["Exterior", "Exterior"],
};

export const REGIOES = ["Norte", "Nordeste", "Centro-Oeste", "Sudeste", "Sul", "Exterior"];

export const CARGOS = { "0001": "Presidente", "0003": "Governador" };

const int = (v) => Number.parseInt(String(v ?? "0").replace(/\D/g, ""), 10) || 0;

export function emptyResult() {
  return { secoes: 0, apuradas: 0, eleitores: 0, comparecimento: 0, abstencao: 0, brancos: 0, nulos: 0, validos: 0, atualizadoEm: "", candidatos: [] };
}

/** Soma vários resultados (usado para regiões e, se faltar o arquivo BR, para o país). */
export function aggregate(results) {
  const out = emptyResult();
  const cands = new Map();
  for (const r of results) {
    if (!r) continue;
    for (const k of ["secoes", "apuradas", "eleitores", "comparecimento", "abstencao", "brancos", "nulos", "validos"]) out[k] += r[k];
    if (r.atualizadoEm > out.atualizadoEm) out.atualizadoEm = r.atualizadoEm;
    for (const c of r.candidatos) {
      const acc = cands.get(c.numero) || { ...c, votos: 0 };
      acc.votos += c.votos;
      cands.set(c.numero, acc);
    }
  }
  out.candidatos = [...cands.values()].sort((a, b) => b.votos - a.votos);
  return out;
}

// ---------------------------------------------------------------- TSE

function parseTse(j) {
  return {
    secoes: int(j.s),
    apuradas: int(j.st),
    eleitores: int(j.e),
    comparecimento: int(j.c),
    abstencao: int(j.a),
    brancos: int(j.vb),
    nulos: int(j.tvn ?? j.vn),
    validos: int(j.vv),
    atualizadoEm: j.dt && j.ht ? `${j.dt.split("/").reverse().join("-")} ${j.ht}` : "",
    candidatos: (j.cand || [])
      .map((c) => ({ numero: String(c.n), nome: c.nm, partido: c.cc || "", votos: int(c.vap), situacao: c.st || "" }))
      .sort((a, b) => b.votos - a.votos),
  };
}

export class TseSource {
  /** @param {{base: string, ano: string, eleicao: string, cargo: string}} cfg */
  constructor(cfg) {
    this.cfg = cfg;
    this.municipios = null;
  }

  get root() {
    return `${this.cfg.base}/oficial/ele${this.cfg.ano}/${this.cfg.eleicao}`;
  }

  async json(url) {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error(`${r.status} em ${url}`);
    return r.json();
  }

  file(abr) {
    const e = this.cfg.eleicao.padStart(6, "0");
    return `${this.root}/dados-simplificados/${abr.slice(0, 2)}/${abr}-c${this.cfg.cargo}-e${e}-r.json`;
  }

  async brasil() {
    return parseTse(await this.json(this.file("br")));
  }

  async estado(uf) {
    return parseTse(await this.json(this.file(uf.toLowerCase())));
  }

  /** Lista de municípios por UF: { SP: [{ codigo, nome, capital }] } */
  async listaMunicipios() {
    if (this.municipios) return this.municipios;
    const e = this.cfg.eleicao.padStart(6, "0");
    const j = await this.json(`${this.root}/config/mun-e${e}-cm.json`);
    this.municipios = {};
    for (const abr of j.abr || []) {
      this.municipios[abr.cd] = (abr.mu || []).map((m) => ({ codigo: m.cd, nome: m.nm, capital: m.c === "S" }));
    }
    return this.municipios;
  }

  async municipio(uf, codigo) {
    return parseTse(await this.json(this.file(uf.toLowerCase() + codigo)));
  }

  /** Tenta listar as eleições publicadas no ano (para descobrir o código). */
  static async descobrirEleicoes(base, ano) {
    const r = await fetch(`${base}/oficial/comum/config/ele-c.json`, { cache: "no-store" });
    if (!r.ok) throw new Error(`${r.status} ao ler a lista de eleições`);
    const found = [];
    const walk = (node, ciclo) => {
      if (Array.isArray(node)) return node.forEach((n) => walk(n, ciclo));
      if (!node || typeof node !== "object") return;
      const c = node.cdpr || node.cdp || ciclo;
      if (node.cd && node.nm && /^\d+$/.test(String(node.cd))) {
        found.push({ codigo: String(Number(node.cd)), nome: node.nm, data: node.dt || "", ciclo: c || "" });
      }
      Object.values(node).forEach((v) => walk(v, c));
    };
    walk(await r.json());
    return found.filter((x) => !ano || String(x.ciclo).includes(ano) || String(x.data).includes(ano) || x.nome.includes(ano));
  }
}

// ---------------------------------------------------------------- simulação

function rng(seed) {
  let s = 0;
  for (const ch of String(seed)) s = (s * 31 + ch.charCodeAt(0)) >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ELEITORES_UF = {
  SP: 34.6, MG: 16.3, RJ: 12.8, BA: 11.3, RS: 8.6, PR: 8.5, PE: 7.0, CE: 6.8, PA: 6.1, MA: 5.0, SC: 5.5, GO: 4.9,
  PB: 3.0, ES: 2.9, AM: 2.6, RN: 2.6, AL: 2.4, PI: 2.6, MT: 2.5, DF: 2.2, MS: 2.0, SE: 1.7, RO: 1.2, TO: 1.1,
  AC: 0.6, AP: 0.6, RR: 0.4, ZZ: 0.7,
}; // milhões (aprox.)

const CAPITAIS = {
  AC: "Rio Branco", AM: "Manaus", AP: "Macapá", PA: "Belém", RO: "Porto Velho", RR: "Boa Vista", TO: "Palmas",
  AL: "Maceió", BA: "Salvador", CE: "Fortaleza", MA: "São Luís", PB: "João Pessoa", PE: "Recife", PI: "Teresina",
  RN: "Natal", SE: "Aracaju", DF: "Brasília", GO: "Goiânia", MS: "Campo Grande", MT: "Cuiabá", ES: "Vitória",
  MG: "Belo Horizonte", RJ: "Rio de Janeiro", SP: "São Paulo", PR: "Curitiba", RS: "Porto Alegre", SC: "Florianópolis",
  ZZ: "Exterior",
};

const DEMO_CANDS = [
  { numero: "10", nome: "CANDIDATO A", partido: "PARTIDO A" },
  { numero: "20", nome: "CANDIDATO B", partido: "PARTIDO B" },
];

/** Simulação: a apuração avança sozinha (~100% em 6 min) para testar o painel antes de domingo. */
export class DemoSource {
  constructor() {
    this.inicio = Date.now() - 90_000; // começa com parte das urnas já apuradas
    this.municipiosCache = null;
  }

  sim(key, eleitores, lean) {
    const r = rng(key);
    const atraso = r() * 0.25; // algumas regiões começam a apurar depois
    const ritmo = 0.7 + r() * 0.6;
    const t = (Date.now() - this.inicio) / 360_000; // 0..1 em 6 minutos
    const frac = Math.max(0, Math.min(1, (t - atraso) * ritmo * 1.4));
    const secoes = Math.max(1, Math.round(eleitores / 330));
    const apuradas = Math.round(secoes * frac);
    const e = Math.round(eleitores * (apuradas / secoes));
    const comparecimento = Math.round(e * (0.76 + r() * 0.08));
    const brancos = Math.round(comparecimento * (0.01 + r() * 0.02));
    const nulos = Math.round(comparecimento * (0.02 + r() * 0.03));
    const validos = comparecimento - brancos - nulos;
    const shareA = Math.max(0.15, Math.min(0.85, 0.5 + lean + (r() - 0.5) * 0.12));
    const a = Math.round(validos * shareA);
    const d = new Date();
    return {
      secoes, apuradas, eleitores: e, comparecimento, abstencao: e - comparecimento, brancos, nulos, validos,
      atualizadoEm: `${d.toISOString().slice(0, 10)} ${d.toTimeString().slice(0, 8)}`,
      candidatos: [
        { ...DEMO_CANDS[0], votos: a, situacao: "" },
        { ...DEMO_CANDS[1], votos: validos - a, situacao: "" },
      ].sort((x, y) => y.votos - x.votos),
    };
  }

  leanUf(uf) {
    const base = { Norte: 0.04, Nordeste: 0.14, "Centro-Oeste": -0.1, Sudeste: -0.03, Sul: -0.12, Exterior: -0.05 }[UFS[uf][1]];
    return base + (rng("lean" + uf)() - 0.5) * 0.08;
  }

  async listaMunicipios() {
    if (this.municipiosCache) return this.municipiosCache;
    this.municipiosCache = {};
    for (const uf of Object.keys(UFS)) {
      const n = uf === "ZZ" ? 6 : Math.max(8, Math.round(ELEITORES_UF[uf] * 6));
      this.municipiosCache[uf] = Array.from({ length: n }, (_, i) => ({
        codigo: String(i + 1).padStart(5, "0"),
        nome: i === 0 ? CAPITAIS[uf] : `Município ${uf}-${String(i + 1).padStart(3, "0")}`,
        capital: i === 0,
      }));
    }
    return this.municipiosCache;
  }

  async municipio(uf, codigo) {
    const lista = (await this.listaMunicipios())[uf];
    // a capital concentra ~20% do eleitorado; o resto é dividido com peso decrescente
    const i = Number(codigo) - 1;
    const pesoCap = 0.2;
    const resto = lista.length - 1;
    const w = i === 0 ? pesoCap : ((1 - pesoCap) * 2 * (resto - i + 1)) / (resto * (resto + 1));
    return this.sim(uf + codigo, ELEITORES_UF[uf] * 1e6 * w, this.leanUf(uf) + (i === 0 ? -0.06 : 0.02));
  }

  async estado(uf) {
    const lista = (await this.listaMunicipios())[uf];
    return aggregate(await Promise.all(lista.map((m) => this.municipio(uf, m.codigo))));
  }

  async brasil() {
    return aggregate(await Promise.all(Object.keys(UFS).map((uf) => this.estado(uf))));
  }
}
