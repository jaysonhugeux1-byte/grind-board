-- Données du mode spin. À exécuter après 02_multi_produit.sql.
--
-- En spin, l'unité de résultat n'est pas la main mais le TOURNOI : on paie un
-- buy-in, un multiplicateur est tiré au sort, et on repart avec un gain ou rien.
-- Le bb/100 n'a aucun sens ici ; ce qui compte est le ROI, l'ITM et le
-- multiplicateur moyen. D'où une table de tournois distincte, et non un simple
-- drapeau posé sur les mains du cash game.

create table if not exists public.spin_tournaments (
  user_id     uuid not null references auth.users on delete cascade,
  tourney_id  text not null,
  ts          timestamptz not null,
  buy_in      numeric not null,
  -- Multiplicateur du prize pool, tiré avant le début. Il domine tellement la
  -- variance qu'il faut pouvoir l'isoler pour juger le jeu réel.
  multiplier  numeric,
  prize_pool  numeric,
  -- 1, 2 ou 3 : le spin se joue à trois.
  finish      int,
  payout      numeric not null default 0,
  -- Résultat net du tournoi (payout - buy_in), stocké pour éviter de le
  -- recalculer à chaque agrégation.
  net         numeric not null default 0,
  data        jsonb not null default '{}'::jsonb,
  primary key (user_id, tourney_id)
);

create index if not exists spin_tournaments_user_ts_idx
  on public.spin_tournaments (user_id, ts);

-- Mains jouées à l'intérieur des tournois. Même forme que le cash game (objet
-- complet en jsonb), avec le rattachement au tournoi et la profondeur de tapis
-- en grosses blindes — la variable décisive en hyper-turbo.
create table if not exists public.spin_hands (
  user_id     uuid not null references auth.users on delete cascade,
  hand_id     text not null,
  tourney_id  text not null,
  ts          timestamptz not null,
  -- Profondeur de tapis de Hero au début de la main, en grosses blindes.
  -- C'est elle qui détermine les ranges de push/fold, pas le montant en jetons.
  bb_depth    numeric,
  data        jsonb not null,
  primary key (user_id, hand_id)
);

create index if not exists spin_hands_user_ts_idx  on public.spin_hands (user_id, ts);
create index if not exists spin_hands_tourney_idx  on public.spin_hands (user_id, tourney_id);

create table if not exists public.spin_hand_raw (
  user_id uuid not null references auth.users on delete cascade,
  hand_id text not null,
  raw     text not null,
  primary key (user_id, hand_id)
);

-- ---------------------------------------------------------------------------
-- Sécurité : mêmes principes que le cash game, mais conditionnée au produit
-- 'spin'. Lecture toujours permise (un accès expiré ne doit pas donner
-- l'impression que les données ont disparu), écriture réservée aux abonnés.
-- ---------------------------------------------------------------------------

alter table public.spin_tournaments enable row level security;
alter table public.spin_hands       enable row level security;
alter table public.spin_hand_raw    enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['spin_tournaments', 'spin_hands', 'spin_hand_raw']
  loop
    execute format('drop policy if exists "spin: lecture des siens" on public.%I', t);
    execute format(
      'create policy "spin: lecture des siens" on public.%I for select using (auth.uid() = user_id)', t);

    execute format('drop policy if exists "spin: ajout si abonne" on public.%I', t);
    execute format(
      'create policy "spin: ajout si abonne" on public.%I for insert '
      'with check (auth.uid() = user_id and public.has_access(auth.uid(), ''spin''))', t);

    execute format('drop policy if exists "spin: modification si abonne" on public.%I', t);
    execute format(
      'create policy "spin: modification si abonne" on public.%I for update '
      'using (auth.uid() = user_id and public.has_access(auth.uid(), ''spin'')) '
      'with check (auth.uid() = user_id)', t);

    execute format('drop policy if exists "spin: suppression des siens" on public.%I', t);
    execute format(
      'create policy "spin: suppression des siens" on public.%I for delete using (auth.uid() = user_id)', t);
  end loop;
end $$;

alter publication supabase_realtime add table public.spin_tournaments;
alter publication supabase_realtime add table public.spin_hands;
