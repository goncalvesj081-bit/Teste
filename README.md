# Painel de Apuração — Eleições 2026

Painel para acompanhar a apuração em tempo real com os dados públicos do TSE
(`resultados.tse.jus.br`), publicado no GitHub Pages.

- **Topo fixo** com o andamento (urnas apuradas), turno (1º/2º), cargo (Presidente/Governador)
  e o recorte **Brasil, região ou estado**, que filtra a página inteira.
- **Placar**: no 2º turno, frente a frente; no 1º, os quatro primeiros e os demais agrupados.
- **Mapa** do Brasil por estado ou, num estado, por cidade: cor de quem lidera (mais forte =
  vantagem maior) ou % de urnas apuradas. Clique num estado para abrir as cidades dele.
- **Chance de virada**: estima, pelo que falta apurar em cada estado (ou cidade), a chance de o
  2º colocado passar o 1º e a faixa da margem final. Nos lugares com pouco apurado, usa também o
  resultado de 2022 do lugar, corrigido pela mudança já vista no país. Milhares de sorteios com
  margem de erro que encolhe com a apuração. Estimativa simples, não é previsão oficial.
- **Linha do tempo** (% dos válidos × % de urnas apuradas), **ritmo** (seções por minuto e hora
  estimada para 100%) e **avisos** de virada, marcos de apuração e estados que terminaram. As
  leituras ficam guardadas no navegador enquanto o painel está aberto.
- **Análises**: resumo automático, regiões, projeção com as urnas que faltam, comparação com o
  1º turno de 2026 ou com o mesmo turno de 2022 (mapas lado a lado, viradas e tabela), disputas mais
  apertadas, maiores vantagens e onde faltam mais votos.
- **Compartilhar**: link que abre no mesmo turno, cargo, recorte, modo do mapa e aba.
- **Estados** e **Cidades** em tabelas com ordenação e busca.
- Atualiza sozinho a cada 30 s. Os dados ficam em cache por turno e cargo, e as cidades só são
  baixadas de novo quando têm urnas novas (o índice `{uf}-e{eleicao}-ab.json` do TSE diz quais mudaram).
- No rodapé, **Simulação** (dados fictícios) e **Replay do 2º turno de 2022** (resultado real com
  ritmo simulado: Sul e Sudeste contam primeiro, Norte e Nordeste depois). No replay dá para ver a
  virada de 2022 e a chance de virada subindo antes dela; `?duracao=90` acelera (segundos).

## Como rodar

Requer Node.js 18 ou mais novo, sem dependências.

```bash
node server.js
# abra http://localhost:8080
```

O `server.js` serve o painel e repassa as requisições `/tse/...` para o TSE
(com cache de 15 s), o que evita bloqueio de CORS no navegador.

## Hospedar no GitHub Pages

O workflow `.github/workflows/pages.yml` publica a pasta `public/` a cada push.
Para ativar (uma vez só):

1. O repositório precisa ser **público** (Pages em repositório privado exige plano pago).
2. **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Rode o workflow em **Actions → Publicar no GitHub Pages → Run workflow** (ou faça um push).
   O link sai como `https://<usuario>.github.io/<repositorio>/`.

No Pages não existe o `server.js`, então o navegador busca os dados direto em
`resultados.tse.jus.br`, que libera esse acesso (CORS) para sites do `github.io`.

## Configurando para domingo (25/10/2026)

O painel já abre configurado para o 2º turno de Presidente. Códigos do TSE:

| Eleição | Código | Cargo |
|---|---|---|
| 2º turno federal | `6258` | Presidente |
| 2º turno estadual | `6260` | Governador (AC, AM, DF, ES, RN, TO) |
| 1º turno federal (04/10) | `6257` | Presidente |
| 1º turno estadual (04/10) | `6259` | Governador |

Os botões de turno e cargo escolhem o código sozinhos. A escolha fica salva no navegador e
também pode ir pela URL, por exemplo `?turno=1&cargo=0003&recorte=MG`. Para outra eleição,
use `?eleicao=<código>&ano=<ano>`.

## Arquivos do TSE usados

| Nível | Caminho |
|---|---|
| Lista de eleições | `/oficial/comum/config/ele-c.json` |
| Brasil | `/oficial/ele{ano}/{eleicao}/dados/br/br-c{cargo}-e{eleicao}-u.json` |
| Estado | `.../dados/{uf}/{uf}-c{cargo}-e{eleicao}-u.json` |
| Cidade | `.../dados/{uf}/{uf}{codmun}-c{cargo}-e{eleicao}-u.json` |
| Lista de cidades | `/oficial/ele{ano}/{eleicao}/config/mun-e{eleicao}-cm.json` |
| Andamento de todas as cidades do estado | `.../dados/{uf}/{uf}-e{eleicao}-ab.json` |

`{eleicao}` vai com 6 dígitos nos nomes de arquivo (ex.: `006258`) e `{cargo}` com 4 (`0001` = Presidente,
`0003` = Governador). Campos: `s.ts` seções, `s.st` seções totalizadas, `e.te` eleitorado, `e.c`
comparecimento, `e.a` abstenção, `v.vb` brancos, `v.tvn` nulos, `v.vv` válidos e os candidatos em
`carg[].agr[].par[].cand[]` (`nmu` nome de urna, `vap` votos).

## Mapas

`public/mapas/` tem os contornos já convertidos em SVG: `br.json` (estados) e um arquivo por estado
com as cidades, ligadas ao resultado pelo código IBGE (`cdi` na lista de cidades do TSE). Foram gerados
com `scripts/gerar-mapas.js` a partir das malhas municipais do IBGE (pacote npm `ibge-cidades-com-poligonos`).

## Dados de 2022

`public/dados2022/` tem o resultado de 2022 de presidente e governador (1º e 2º turno), por estado e
por cidade, gerado com `scripts/gerar-2022.py` a partir do portal de dados abertos do TSE
(`votacao_partido_munzona_2022.zip` e `detalhe_votacao_munzona_2022.zip`). Como nesses cargos cada
partido tem um só candidato, a comparação com 2026 é feita pelo número do partido.
