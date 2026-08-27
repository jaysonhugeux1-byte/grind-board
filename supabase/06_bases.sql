-- Deux bases de données par compte, et la conservation des données.
--
-- À exécuter après 05_solveur.sql, dans l'éditeur SQL de Supabase.
--
-- ---------------------------------------------------------------------------
-- CE QUE FAIT CE FICHIER, ET CE QU'IL NE FAIT PAS
-- ---------------------------------------------------------------------------
--
-- Il AJOUTE une colonne `base` à chaque table de données, refait les clés
-- primaires pour qu'une même main puisse exister dans les deux bases, et pose
-- les droits : la base 2 ne se lit et ne s'écrit qu'avec un accès `base2` en
-- cours.
--
-- Il PRÉPARE la purge des données mais NE L'ARME PAS. La fonction est écrite,
-- testable à blanc, et rien ne l'appelle : c'est à toi de programmer son
-- exécution quand tu auras décidé que la politique de conservation est celle
-- que tu veux. Une suppression automatique de données clients est
-- irréversible ; elle ne doit pas démarrer parce qu'un fichier a été exécuté.
--
-- Toutes les lignes existantes reçoivent `base = 1`. Rien n'est déplacé,
-- rien n'est effacé par ce fichier.

-- ---------------------------------------------------------------------------
-- 1. LA COLONNE, SUR CHAQUE TABLE DE DONNÉES
-- ---------------------------------------------------------------------------

alter table public.hands            add column if not exists base smallint not null default 1;
alter table public.hand_raw         add column if not exists base smallint not null default 1;
alter table public.entries          add column if not exists base smallint not null default 1;
alter table public.spin_tournaments add column if not exists base smallint not null default 1;
alter table public.spin_hands       add column if not exists base smallint not null default 1;
alter table public.spin_hand_raw    add column if not exists base smallint not null default 1;

-- Deux bases, pas davantage. La contrainte est là pour qu'un défaut du client
-- ne puisse pas créer une base 7 que rien n'afficherait jamais.
do $$
declare t text;
begin
  foreach t in array array['hands','hand_raw','entries','spin_tournaments','spin_hands','spin_hand_raw']
  loop
    execute format('alter table public.%I drop constraint if exists %I', t, t || '_base_valide');
    execute format('alter table public.%I add constraint %I check (base in (1,2))', t, t || '_base_valide');
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2. LES CLÉS PRIMAIRES
-- ---------------------------------------------------------------------------
--
-- Sans ce changement, une main importée dans la base 1 empêcherait la même
-- main d'exister dans la base 2. Or c'est précisément l'usage : rejouer un
-- historique dans une base d'essai sans toucher à la vraie.

alter table public.hands            drop constraint if exists hands_pkey;
alter table public.hands            add primary key (user_id, base, hand_id);
alter table public.hand_raw         drop constraint if exists hand_raw_pkey;
alter table public.hand_raw         add primary key (user_id, base, hand_id);
alter table public.spin_tournaments drop constraint if exists spin_tournaments_pkey;
alter table public.spin_tournaments add primary key (user_id, base, tourney_id);
alter table public.spin_hands       drop constraint if exists spin_hands_pkey;
alter table public.spin_hands       add primary key (user_id, base, hand_id);
alter table public.spin_hand_raw    drop constraint if exists spin_hand_raw_pkey;
alter table public.spin_hand_raw    add primary key (user_id, base, hand_id);

-- `entries` garde sa clé technique : ses lignes n'ont pas d'identifiant
-- naturel qui pourrait entrer en collision.

create index if not exists hands_user_base_idx            on public.hands (user_id, base, ts);
create index if not exists spin_tournaments_user_base_idx on public.spin_tournaments (user_id, base, ts);
create index if not exists spin_hands_user_base_idx       on public.spin_hands (user_id, base, ts);
create index if not exists entries_user_base_idx          on public.entries (user_id, base);

-- ---------------------------------------------------------------------------
-- 3. LES DROITS
-- ---------------------------------------------------------------------------
--
-- La base 1 suit les règles déjà en place. La base 2 exige en plus un accès
-- `base2` EN COURS — c'est ce qui la rend inaccessible dès que le paiement
-- n'est pas renouvelé, sans que rien ne soit supprimé pour autant.
--
-- LA SUPPRESSION RESTE TOUJOURS PERMISE, sur les deux bases. Quelqu'un dont
-- l'accès a expiré doit pouvoir retirer ce qu'il a déposé : lui interdire
-- reviendrait à retenir ses données pour le forcer à payer.

do $$
declare t text;
begin
  foreach t in array array['hands','hand_raw','entries','spin_tournaments','spin_hands','spin_hand_raw']
  loop
    execute format('drop policy if exists "base2: lecture si abonne" on public.%I', t);
    execute format(
      'create policy "base2: lecture si abonne" on public.%I for select '
      'using (auth.uid() = user_id and (base = 1 or public.has_access(auth.uid(), ''base2'')))', t);

    execute format('drop policy if exists "base2: ecriture si abonne" on public.%I', t);
    execute format(
      'create policy "base2: ecriture si abonne" on public.%I for insert '
      'with check (auth.uid() = user_id and (base = 1 or public.has_access(auth.uid(), ''base2'')))', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 3 bis. LE PRODUIT « base2 » DOIT ÊTRE ACCEPTÉ
-- ---------------------------------------------------------------------------
--
-- Sans ces deux lignes, le supplément ne peut pas se vendre : la commande est
-- refusée à l'insertion, et l'accès refusé au moment de le créditer. Le bouton
-- existait, le paiement échouait — un défaut qui ne se voit qu'en essayant
-- d'acheter, c'est-à-dire au pire moment.
--
-- On reprend chaque contrainte à l'identique en ajoutant UN mot. Les recréer
-- autrement casserait ce qu'elles protègent déjà.

alter table public.access
  drop constraint if exists access_product_valide;
alter table public.access
  add constraint access_product_valide
  check (product in ('cash', 'spin', 'solveur', 'base2'));

alter table public.crypto_orders
  drop constraint if exists crypto_orders_products_valides;
alter table public.crypto_orders
  add constraint crypto_orders_products_valides
  check (
    array_length(products, 1) >= 1
    and products <@ array['cash', 'spin', 'solveur', 'base2']
  );

-- La fonction qui crédite un accès porte la même liste. On la reprend elle
-- aussi À L'IDENTIQUE — type de retour, valeur par défaut, corps — car
-- PostgreSQL refuse de changer un type de retour, et la remplacer par un
-- DROP suivi d'un CREATE ferait tomber les droits posés dessus.
create or replace function public.grant_access(
  p_user     uuid,
  p_product  text,
  p_months   int,
  p_provider text default 'nowpayments'
)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_until timestamptz;
begin
  if p_product not in ('cash', 'spin', 'solveur', 'base2') then
    raise exception 'Produit inconnu : %', p_product;
  end if;

  insert into public.access as a (user_id, product, access_until, provider, updated_at)
  values (p_user, p_product, now() + make_interval(months => p_months), p_provider, now())
  on conflict (user_id, product) do update
    -- Un rachat anticipé s'ajoute au temps restant plutôt que de l'écraser.
    set access_until = greatest(a.access_until, now()) + make_interval(months => p_months),
        provider     = excluded.provider,
        updated_at   = now()
  returning a.access_until into v_until;

  return v_until;
end;
$$;

revoke all on function public.grant_access(uuid, text, int, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. LA CONSERVATION — ÉCRITE, PAS ARMÉE
-- ---------------------------------------------------------------------------
--
-- Politique demandée :
--   base 2  : inaccessible dès l'expiration, données gardées 15 jours, puis
--             supprimées.
--   base 1  : données supprimées 30 jours après l'expiration du dernier accès.
--
-- `simulation` à true (le défaut) ne supprime RIEN : la fonction rend ce
-- qu'elle supprimerait. C'est volontaire. Une purge qu'on ne peut pas essayer
-- à blanc avant de l'armer est une purge qu'on arme en espérant.
--
-- ATTENTION. Cette fonction est destructrice quand on l'appelle avec
-- `simulation => false`. Elle n'est appelée par rien : aucun déclencheur,
-- aucune tâche programmée. Voir la section 5.

create or replace function public.purger_donnees(
  simulation boolean default true,
  jours_base2 int default 15,
  jours_base1 int default 30
)
returns table (user_id uuid, base smallint, motif text, lignes bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  n bigint;
begin
  -- ---- base 2 : quinze jours après l'expiration de l'accès `base2`
  for r in
    select a.user_id, max(a.access_until) as fin
      from public.access a
     where a.product = 'base2'
     group by a.user_id
    having max(a.access_until) < now() - make_interval(days => jours_base2)
  loop
    n := 0;
    if simulation then
      select count(*) into n from public.spin_hands h where h.user_id = r.user_id and h.base = 2;
    else
      delete from public.spin_hand_raw    where spin_hand_raw.user_id = r.user_id    and spin_hand_raw.base = 2;
      delete from public.spin_hands       where spin_hands.user_id = r.user_id       and spin_hands.base = 2;
      delete from public.spin_tournaments where spin_tournaments.user_id = r.user_id and spin_tournaments.base = 2;
      delete from public.hand_raw         where hand_raw.user_id = r.user_id         and hand_raw.base = 2;
      delete from public.hands            where hands.user_id = r.user_id            and hands.base = 2;
      get diagnostics n = row_count;
      delete from public.entries          where entries.user_id = r.user_id          and entries.base = 2;
    end if;
    user_id := r.user_id; base := 2::smallint;
    motif := format('accès base2 expiré depuis plus de %s jours (%s)', jours_base2, r.fin::date);
    lignes := n;
    return next;
  end loop;

  -- ---- base 1 : trente jours après l'expiration de TOUT accès
  --
  -- « tout accès » et non « un accès » : quelqu'un dont l'abonnement spin a
  -- expiré mais qui paie encore le cash game n'est pas un compte abandonné.
  for r in
    select a.user_id, max(a.access_until) as fin
      from public.access a
     where a.product <> 'base2'
     group by a.user_id
    having max(a.access_until) < now() - make_interval(days => jours_base1)
  loop
    n := 0;
    if simulation then
      select count(*) into n from public.spin_hands h where h.user_id = r.user_id;
    else
      delete from public.spin_hand_raw    where spin_hand_raw.user_id = r.user_id;
      delete from public.spin_hands       where spin_hands.user_id = r.user_id;
      delete from public.spin_tournaments where spin_tournaments.user_id = r.user_id;
      delete from public.hand_raw         where hand_raw.user_id = r.user_id;
      delete from public.hands            where hands.user_id = r.user_id;
      get diagnostics n = row_count;
      delete from public.entries          where entries.user_id = r.user_id;
    end if;
    user_id := r.user_id; base := 1::smallint;
    motif := format('aucun accès depuis plus de %s jours (%s)', jours_base1, r.fin::date);
    lignes := n;
    return next;
  end loop;
end $$;

revoke all on function public.purger_donnees(boolean, int, int) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. COMMENT L'ARMER, LE JOUR OÙ TU LE DÉCIDERAS
-- ---------------------------------------------------------------------------
--
-- D'ABORD, essayer à blanc. Cette requête ne supprime rien :
--
--   select * from public.purger_donnees();
--
-- Elle rend une ligne par compte concerné, avec le motif et le nombre de
-- lignes que la purge toucherait. Regarde-la plusieurs fois, à plusieurs jours
-- d'intervalle, avant d'aller plus loin.
--
-- ENSUITE seulement, si le résultat est celui que tu attends :
--
--   select cron.schedule(
--     'purge-donnees', '0 4 * * *',
--     $cron$ select public.purger_donnees(simulation => false) $cron$
--   );
--
-- (l'extension pg_cron doit être activée dans Database → Extensions)
--
-- TROIS CHOSES À RÉGLER AVANT, et elles ne sont pas techniques :
--
--   1. Une politique de conservation doit figurer dans tes conditions
--      d'utilisation. Supprimer les données d'un ancien client sans l'avoir
--      annoncé est un problème, même si le délai est raisonnable.
--   2. Prévenir. Un courriel à J-7 coûte peu et évite tout.
--   3. Une sauvegarde. Supabase en garde, mais leur durée dépend de ton
--      offre : vérifie-la avant d'armer quoi que ce soit.
