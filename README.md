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

Trocar o cargo entre Presidente e Governador troca o código sozinho. O botão **?** lista as
eleições publicadas no TSE. A configuração fica salva no navegador e também pode ir pela URL:
`?fonte=tse&ano=2026&eleicao=6258&cargo=0001`.

## Arquivos do TSE usados

| Nível | Caminho |
|---|---|
| Lista de eleições | `/oficial/comum/config/ele-c.json` |
| Brasil | `/oficial/ele{ano}/{eleicao}/dados/br/br-c{cargo}-e{eleicao}-u.json` |
| Estado | `.../dados/{uf}/{uf}-c{cargo}-e{eleicao}-u.json` |
| Cidade | `.../dados/{uf}/{uf}{codmun}-c{cargo}-e{eleicao}-u.json` |
| Lista de cidades | `/oficial/ele{ano}/{eleicao}/config/mun-e{eleicao}-cm.json` |

`{eleicao}` vai com 6 dígitos nos nomes de arquivo (ex.: `006258`) e `{cargo}` com 4 (`0001` = Presidente,
`0003` = Governador). Campos: `s.ts` seções, `s.st` seções totalizadas, `e.te` eleitorado, `e.c`
comparecimento, `e.a` abstenção, `v.vb` brancos, `v.tvn` nulos, `v.vv` válidos e os candidatos em
`carg[].agr[].par[].cand[]` (`nmu` nome de urna, `vap` votos).
