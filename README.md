# Painel de Apuração — Eleições 2026

Painel para acompanhar a apuração em tempo real com os dados públicos do TSE
(`resultados.tse.jus.br`):

- **Brasil** — % de urnas (seções) apuradas, comparecimento, abstenção, brancos/nulos,
  votos e % de cada candidato, diferença entre 1º e 2º.
- **Por região** — Norte, Nordeste, Centro-Oeste, Sudeste, Sul e Exterior (soma dos estados).
- **Por estado** — urnas apuradas, % por candidato e quem lidera; filtro por região e ordenação.
  Clique num estado para abrir as cidades dele.
- **Por cidade** — todas as cidades do estado, com busca, % de urnas apuradas e votos.
- Atualização automática a cada 30 s e modo **Simulação** para testar antes de domingo.

## Como rodar

Requer Node.js 18 ou mais novo, sem dependências.

```bash
node server.js
# abra http://localhost:8080
```

O `server.js` serve o painel e repassa as requisições `/tse/...` para o TSE
(com cache de 15 s), o que evita bloqueio de CORS no navegador.

## Configurando para domingo

1. Em **Fonte**, escolha *TSE (ao vivo)*.
2. **Ano**: `2026`.
3. **Cód. eleição**: o código que o TSE dá para o turno. Clique em **?** para listar as
   eleições publicadas no TSE e escolher. (Referência: em 2022 o 1º turno foi `544` e o 2º, `545`.)
4. **Cargo**: Presidente ou Governador (no 2º turno, governador só existe em alguns estados —
   os que não têm disputa ficam fora das tabelas).

A configuração fica salva no navegador. Também dá para passar pela URL:
`http://localhost:8080/?fonte=tse&ano=2026&eleicao=545&cargo=0001`.

## Arquivos do TSE usados

| Nível | Caminho |
|---|---|
| Brasil | `/oficial/ele{ano}/{eleicao}/dados-simplificados/br/br-c{cargo}-e{eleicao}-r.json` |
| Estado | `.../dados-simplificados/{uf}/{uf}-c{cargo}-e{eleicao}-r.json` |
| Cidade | `.../dados-simplificados/{uf}/{uf}{codmun}-c{cargo}-e{eleicao}-r.json` |
| Lista de cidades | `/oficial/ele{ano}/{eleicao}/config/mun-e{eleicao}-cm.json` |

`{eleicao}` com 6 dígitos nos nomes de arquivo (ex.: `000545`), `{cargo}` com 4 (`0001` = Presidente,
`0003` = Governador). Campos: `s` seções, `st` seções totalizadas, `e` eleitorado, `c` comparecimento,
`a` abstenção, `vb` brancos, `tvn` nulos, `vv` válidos, `cand[].vap` votos do candidato.
