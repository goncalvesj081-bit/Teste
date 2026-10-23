-- Contagem de acessos do painel de apuração (anônima).
-- Como usar: no Supabase, abra SQL Editor, cole tudo, escreva a senha do painel de admin na linha
-- marcada com "SENHA DO ADMIN" (mais abaixo) e clique em Run. Pode rodar de novo sem problema
-- (para trocar a senha, por exemplo).
--
-- O que é guardado: um código aleatório por navegador (gerado no próprio navegador, não identifica
-- a pessoa), o tipo de aparelho, o que está sendo visto (Brasil, região ou estado) e quando.
-- Ninguém lê nem grava as tabelas direto: o site só chama registrar_acesso, e as estatísticas só
-- saem por estatisticas_acessos, com a senha.

create extension if not exists pgcrypto;

create table if not exists public.acessos (
  id uuid primary key,
  primeira timestamptz not null default now(),
  ultima timestamptz not null default now(),
  aparelho text not null default 'computador',
  vendo text not null default '',
  visitas int not null default 1
);

-- presença em faixas de 5 minutos, para o gráfico de pessoas online ao longo do dia
create table if not exists public.presenca (
  faixa timestamptz not null,
  id uuid not null,
  primary key (faixa, id)
);

create table if not exists public.admin_acessos (
  unica boolean primary key default true check (unica),
  senha_hash text not null
);

alter table public.acessos enable row level security;
alter table public.presenca enable row level security;
alter table public.admin_acessos enable row level security;
revoke all on public.acessos, public.presenca, public.admin_acessos from anon, authenticated;

-- senha do painel de admin (guardada só como hash)
insert into public.admin_acessos (unica, senha_hash)
values (true, crypt('TROQUE-PELA-SUA-SENHA', gen_salt('bf')))  -- SENHA DO ADMIN: troque o texto entre aspas
on conflict (unica) do update set senha_hash = excluded.senha_hash;

-- chamado pelo site a cada minuto enquanto a página está aberta
create or replace function public.registrar_acesso(p_id uuid, p_aparelho text, p_vendo text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  insert into acessos (id, aparelho, vendo)
  values (p_id, case when p_aparelho = 'celular' then 'celular' else 'computador' end, left(coalesce(p_vendo, ''), 40))
  on conflict (id) do update set
    -- conta uma visita nova quando a pessoa volta depois de 30 minutos fora
    visitas = acessos.visitas + case when acessos.ultima < now() - interval '30 minutes' then 1 else 0 end,
    ultima = now(),
    aparelho = excluded.aparelho,
    vendo = excluded.vendo;
  insert into presenca (faixa, id)
  values (date_bin('5 minutes', now(), timestamptz '2000-01-01'), p_id)
  on conflict do nothing;
end;
$$;

-- números do painel de admin; só responde com a senha certa
create or replace function public.estatisticas_acessos(p_senha text)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  inicio_dia timestamptz := date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
  resultado json;
begin
  if not exists (select 1 from admin_acessos where senha_hash = crypt(p_senha, senha_hash)) then
    raise exception 'senha incorreta' using errcode = '28P01';
  end if;
  select json_build_object(
    'agora', (select count(*) from acessos where ultima > now() - interval '2 minutes'),
    'ultimos15', (select count(*) from acessos where ultima > now() - interval '15 minutes'),
    'hoje', (select count(*) from acessos where ultima >= inicio_dia),
    'total', (select count(*) from acessos),
    'visitas', (select coalesce(sum(visitas), 0) from acessos),
    'aparelhos', (select coalesce(json_object_agg(aparelho, n), '{}') from (
        select aparelho, count(*) n from acessos where ultima > now() - interval '2 minutes' group by aparelho) a),
    'vendo', (select coalesce(json_agg(json_build_object('vendo', vendo, 'n', n) order by n desc), '[]') from (
        select vendo, count(*) n from acessos where ultima > now() - interval '2 minutes' group by vendo order by n desc limit 12) v),
    'serie', (select coalesce(json_agg(json_build_object('t', faixa, 'n', n) order by faixa), '[]') from (
        select faixa, count(*) n from presenca where faixa > now() - interval '24 hours' group by faixa) s),
    'agora_em', now()
  ) into resultado;
  return resultado;
end;
$$;

revoke all on function public.registrar_acesso(uuid, text, text) from public;
revoke all on function public.estatisticas_acessos(text) from public;
grant execute on function public.registrar_acesso(uuid, text, text) to anon, authenticated;
grant execute on function public.estatisticas_acessos(text) to anon, authenticated;
