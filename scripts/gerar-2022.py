"""Resume os resultados de 2022 (presidente e governador, 1º e 2º turno) para o painel.

Fonte: portal de dados abertos do TSE (cdn.tse.jus.br/estatistica/sead/odsele/):
  votacao_partido_munzona_2022.zip  -> votacao_partido_munzona_2022_BRASIL.csv
  detalhe_votacao_munzona_2022.zip  -> detalhe_votacao_munzona_2022_BRASIL.csv

  python3 scripts/gerar-2022.py <pasta com os dois CSV> public/dados2022

Em presidente e governador cada partido tem um só candidato, então os votos do partido são
os votos do candidato. Saída:
  {cargo}-t{turno}.json        { br: R, estados: { UF: R }, siglas: { "13": "PT", ... } }
  {cargo}-t{turno}-{uf}.json   { cidades: { codigo TSE: R } }
  R = [aptos, comparecimento, brancos, nulos, validos, { "13": votos, ... }]
"""
import csv
import json
import os
import sys
from collections import defaultdict

src, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)

CARGOS = {"1": "0001", "3": "0003"}  # código do cargo no CSV -> código usado pelo painel


def novo():
    return [0, 0, 0, 0, 0, defaultdict(int)]


# chave: (cargo, turno, uf, municipio)
mun = defaultdict(novo)
siglas = {}


def ler(nome):
    with open(os.path.join(src, nome), encoding="latin-1", newline="") as f:
        yield from csv.DictReader(f, delimiter=";")


for l in ler("detalhe_votacao_munzona_2022_BRASIL.csv"):
    cargo = CARGOS.get(l["CD_CARGO"])
    if not cargo:
        continue
    r = mun[(cargo, l["NR_TURNO"], l["SG_UF"], l["CD_MUNICIPIO"].zfill(5))]
    r[0] += int(l["QT_APTOS"])
    r[1] += int(l["QT_COMPARECIMENTO"])
    r[2] += int(l["QT_VOTOS_BRANCOS"])
    r[3] += int(l["QT_TOTAL_VOTOS_NULOS"])
    r[4] += int(l["QT_TOTAL_VOTOS_VALIDOS"])

for l in ler("votacao_partido_munzona_2022_BRASIL.csv"):
    cargo = CARGOS.get(l["CD_CARGO"])
    if not cargo:
        continue
    siglas[l["NR_PARTIDO"]] = l["SG_PARTIDO"]
    votos = int(l["QT_VOTOS_NOMINAIS_VALIDOS"])
    if votos:
        mun[(cargo, l["NR_TURNO"], l["SG_UF"], l["CD_MUNICIPIO"].zfill(5))][5][l["NR_PARTIDO"]] += votos


def somar(rs):
    t = novo()
    for r in rs:
        for i in range(5):
            t[i] += r[i]
        for p, v in r[5].items():
            t[5][p] += v
    return t


def compacto(r):
    return r[:5] + [dict(sorted(r[5].items(), key=lambda x: -x[1]))]


grupos = defaultdict(lambda: defaultdict(dict))  # (cargo, turno) -> uf -> mun -> R
for (cargo, turno, uf, cd), r in mun.items():
    grupos[(cargo, turno)][uf][cd] = r

for (cargo, turno), ufs in sorted(grupos.items()):
    estados = {uf: somar(ms.values()) for uf, ms in ufs.items()}
    # só entram na saída os lugares com votos (no 2º turno de governador, os estados com disputa)
    estados = {uf: r for uf, r in estados.items() if r[4]}
    base = f"{cargo}-t{turno}"
    with open(os.path.join(out, base + ".json"), "w") as f:
        usados = {p for r in estados.values() for p in r[5]}
        json.dump(
            {
                "br": compacto(somar(estados.values())),
                "estados": {uf: compacto(r) for uf, r in sorted(estados.items())},
                "siglas": {p: siglas[p] for p in sorted(usados, key=int)},
            },
            f,
            separators=(",", ":"),
        )
    for uf in estados:
        with open(os.path.join(out, f"{base}-{uf.lower()}.json"), "w") as f:
            json.dump({"cidades": {cd: compacto(r) for cd, r in sorted(ufs[uf].items()) if r[4]}}, f, separators=(",", ":"))
    print(base, len(estados), "estados", sum(len(ufs[u]) for u in estados), "cidades")
