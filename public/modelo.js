// Chance de virada no 2º turno, pelo que falta apurar em cada cidade.
//
// Referência: o 1º turno, cidade por cidade (mesmos candidatos, mesmas seções). Em cada estado,
// compara o que já foi apurado no 2º turno com o que essas mesmas cidades deram no 1º: a diferença
// é a "mudança" do estado, já descontando quais cidades foram contadas primeiro (capital antes do
// interior, por exemplo). Essa mudança é aplicada às cidades que faltam. Estado com pouco apurado
// puxa a mudança para a média do país. Por fim, sorteia milhares de finais com margem de erro
// (uma parte comum a todos os estados e outra própria de cada um) que encolhe com a apuração.
//
// Módulo sem tela: usado pelo painel (app.js) e pelo teste com 2022 (scripts/testar-chance.mjs).

export function aleatorio(semente) {
  let s = semente >>> 0 || 1;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

export function normal(rnd) {
  const u = Math.max(rnd(), 1e-12), v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const restringir = (x, a = 0.02, b = 0.98) => Math.min(b, Math.max(a, x));

/**
 * Margens de erro dos sorteios, por cargo (calibradas com 2022, ver scripts/testar-chance.mjs).
 * Presidente: em 2022 a mudança do 1º para o 2º turno foi parecida em todos os estados (média −1,8
 * p.p., desvio de 0,5 entre estados), então há uma incerteza comum grande no começo, que some quando
 * o país já tem votos apurados, e uma pequena própria de cada estado. Governador: cada estado é uma
 * disputa à parte e a mudança pode ser grande (de −10 a +10 p.p. em 2022).
 */
export const PERFIS = {
  presidente: { pais: 0.03, encolhePais: 300_000, estado: 0.008, encolheEstado: 50_000, puxa: 150_000, piso: 0.002 },
  governador: { pais: 0.07, encolhePais: 40_000, estado: 0, encolheEstado: 1, puxa: 0, piso: 0.003 },
};
export const ERRO = PERFIS.presidente;

/**
 * @param {object} o
 * @param {number} o.a votos já apurados de A (no recorte)
 * @param {number} o.b votos já apurados de B
 * @param {Array<{a:number,b:number,cidades:Array<{f:number,v:number,p:number}>}>} o.estados
 *   por estado: votos apurados de A e B no 2º turno e, por cidade, a fração apurada (f), os votos
 *   válidos no 1º turno (v) e a parcela de A entre A e B no 1º turno (p)
 * @param {Array<{a:number,b:number,cidades:Array}>} [o.paraMudanca] estados usados só para a média
 *   do país (ex.: todos os estados, quando o recorte é um só)
 * @param {number} o.frac fração apurada do recorte (0 a 1)
 * @param {object} [o.erro] perfil de margem de erro (PERFIS.presidente ou PERFIS.governador)
 * @returns {{probA:number, media:number, baixo:number, alto:number, restante:number, porEstado:Array}}
 *   probA = chance de A terminar à frente; margens (A − B) em p.p. dos votos de A+B no fim;
 *   porEstado[i] (na ordem de o.estados) = { resto, saldo }: votos que faltam e quanto A deve
 *   ganhar (ou perder, se negativo) de vantagem ali, além de cidades[j] = { resto, saldo }
 */
export function chancePorCidades({ a, b, estados, paraMudanca = estados, frac, N = 4000, semente = 1, erro = ERRO }) {
  const resumo = (e) => {
    let cv = 0, cvp = 0, rv = 0, rvp = 0;
    for (const c of e.cidades) {
      const f = Math.min(1, Math.max(0, c.f));
      cv += f * c.v; cvp += f * c.v * c.p;
      rv += (1 - f) * c.v; rvp += (1 - f) * c.v * c.p;
    }
    const obs = e.a + e.b;
    return {
      apurado: obs,
      restante1t: rv,
      pResto: rv ? rvp / rv : 0.5,
      // mudança: parcela de A apurada agora menos a que as mesmas cidades deram no 1º turno
      mudanca: cv > 0 && obs > 0 ? restringir(e.a / obs - cvp / cv, -0.3, 0.3) : null,
      // quanto do eleitorado do 1º turno está votando nos dois agora (comparecimento, brancos, nulos)
      razao: cv > 0 && obs > 0 ? obs / cv : null,
    };
  };

  // média do país, ponderada pelos votos já apurados
  let sm = 0, sr = 0, peso = 0, apuradoPais = 0;
  for (const e of paraMudanca.map(resumo)) {
    apuradoPais += e.apurado;
    if (e.mudanca === null) continue;
    sm += e.mudanca * e.apurado; sr += e.razao * e.apurado; peso += e.apurado;
  }
  const mudancaPais = peso ? sm / peso : 0;
  const razaoPais = peso ? sr / peso : 1;

  const itens = [];
  const porEstado = estados.map((original, i) => {
    const e = resumo(original);
    if (e.restante1t <= 0) return { resto: 0, saldo: 0, cidades: original.cidades.map(() => ({ resto: 0, saldo: 0 })) };
    const w = e.mudanca === null ? 0 : e.apurado / (e.apurado + erro.puxa || 1);
    const mudanca = w * (e.mudanca ?? 0) + (1 - w) * mudancaPais;
    const razao = w * (e.razao ?? razaoPais) + (1 - w) * razaoPais;
    const it = {
      resto: e.restante1t * razao,
      media: restringir(e.pResto + mudanca),
      desvio: erro.estado * Math.sqrt(erro.encolheEstado / (erro.encolheEstado + e.apurado)),
    };
    itens.push(it);
    // o mesmo raciocínio, cidade a cidade, para dizer onde estão os votos que decidem
    const cidades = original.cidades.map((c) => {
      const resto = (1 - Math.min(1, Math.max(0, c.f))) * c.v * razao;
      return { resto, saldo: resto * (2 * restringir(c.p + mudanca) - 1) };
    });
    return { resto: it.resto, saldo: it.resto * (2 * it.media - 1), cidades };
  });

  const desvioPais = erro.pais * Math.sqrt(erro.encolhePais / (erro.encolhePais + apuradoPais)) + erro.piso;
  const rnd = aleatorio(semente);
  const margens = new Float64Array(N);
  let restante = 0;
  for (const it of itens) restante += it.resto;
  const total = a + b + restante;
  let vitoriasA = 0;
  for (let k = 0; k < N; k++) {
    const comum = normal(rnd) * desvioPais;
    let m = a - b;
    for (const it of itens) m += it.resto * (2 * restringir(it.media + comum + normal(rnd) * it.desvio) - 1);
    margens[k] = m;
    if (m > 0) vitoriasA++;
  }
  margens.sort();
  const pp = (x) => (total ? (x / total) * 100 : 0);
  return {
    probA: vitoriasA / N,
    media: pp(margens[N >> 1]),
    baixo: pp(margens[Math.floor(N * 0.05)]),
    alto: pp(margens[Math.floor(N * 0.95)]),
    restante,
    porEstado,
  };
}
