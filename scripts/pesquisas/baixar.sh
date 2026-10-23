#!/bin/sh
# Baixa o texto das páginas de pesquisas do 2º turno (Wikipédia pt e en) para a pasta indicada.
set -e
D=${1:-/tmp/pesquisas}; mkdir -p "$D"
UA="ApuracaoPainel/1.0 (https://goncalvesj081-bit.github.io/apuracao/)"
curl -sf -m 40 -A "$UA" -o "$D/ptp.txt" "https://pt.wikipedia.org/w/index.php?title=Pesquisas_de_opini%C3%A3o_para_a_elei%C3%A7%C3%A3o_presidencial_no_Brasil_em_2026&action=raw"
sleep 2
curl -sf -m 40 -A "$UA" -o "$D/enp.txt" "https://en.wikipedia.org/w/index.php?title=Opinion_polling_for_the_2026_Brazilian_presidential_election&action=raw"
