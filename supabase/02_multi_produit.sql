-- Passage à deux produits : cash game et spin.
-- À exécuter dans l'éditeur SQL, après schema.sql et grant_access.sql.
--
-- L'accès devient PAR PRODUIT. La ligne existante est migrée en 'cash' : ton
-- accès actuel est conservé tel quel, avec sa date d'expiration.
--
-- Le script est réexécutable sans dommage : chaque étape vérifie son état avant
-- d'agir.

-- ---------------------------------------------------------------------------
-- 1. L'accès devient (utilisateur, produit)
-- ---------------------------------------------------------------------------

alter table public.access
  add column if not exists product text not null default 'cash';

alter table public.access
  drop constraint if exists access_product_valide;
alter table public.access
  add constraint access_product_valide check (product in ('cash', 'spin'));

-- La clé primaire passe de (user_id) à (user_id, product) : un même utilisateur
-- peut détenir les deux accès, avec des échéances indépendantes.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'access_pkey'
      and conrelid = 'public.access'::regclass
      and array_length(conkey, 1) = 2
  ) then
    alter table public.access drop constraint if exists access_pkey;
    alter table public.access add primary key (user_id, product);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Retirer les politiques qui dépendent de l'ancienne fonction
-- ---------------------------------------------------------------------------
--
-- Postgres refuse de supprimer une fonction encore référencée par une politique.
-- Il faut donc les retirer AVANT, puis les recréer plus bas avec la nouvelle
-- signature.

drop policy if exists "mains: ajout si abonne"        on public.hands;
drop policy if exists "mains: modification si abonne" on public.hands;
drop policy if exists "brut: ajout si abonne"         on public.hand_raw;
drop policy if exists "brut: modification si abonne"  on public.hand_raw;
drop policy if exists "mouvements: ajout si abonne"        on public.entries;
drop policy if exists "mouvements: modification si abonne" on public.entries;
drop policy if exists "reglages: ecriture si abonne"  on public.settings;

-- ---------------------------------------------------------------------------
-- 3. Vérification d'accès, par produit
-- ---------------------------------------------------------------------------

-- L'ancienne signature ne peut plus répondre correctement maintenant qu'un
-- utilisateur peut avoir l'un des produits, l'autre, ou les deux.
drop function if exists public.has_access(uuid);

create or replace function public.has_access(uid uuid, p_product text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.access
    where user_id = uid
      and product = p_product
      and access_until > now()
  );
$$;

-- ---------------------------------------------------------------------------
-- 4. Crédit d'accès, par produit
-- ---------------------------------------------------------------------------

drop function if exists public.grant_access(uuid, int, text);

-- Reste atomique : deux notifications de paiement simultanées ne peuvent pas se
-- marcher dessus. Un rachat anticipé s'ajoute au temps restant.
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
  if p_product not in ('cash', 'spin') then
    raise exception 'Produit inconnu : %', p_product;
  end if;

  insert into public.access as a (user_id, product, access_until, provider, updated_at)
  values (p_user, p_product, now() + make_interval(months => p_months), p_provider, now())
  on conflict (user_id, product) do update
    set access_until = greatest(a.access_until, now()) + make_interval(months => p_months),
        provider     = excluded.provider,
        updated_at   = now()
  returning a.access_until into v_until;

  return v_until;
end;
$$;

revoke all on function public.grant_access(uuid, text, int, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Recréer les politiques, en visant explicitement le produit
-- ---------------------------------------------------------------------------

create policy "mains: ajout si abonne"
  on public.hands for insert
  with check (auth.uid() = user_id and public.has_access(auth.uid(), 'cash'));

create policy "mains: modification si abonne"
  on public.hands for update
  using (auth.uid() = user_id and public.has_access(auth.uid(), 'cash'))
  with check (auth.uid() = user_id);

create policy "brut: ajout si abonne"
  on public.hand_raw for insert
  with check (auth.uid() = user_id and public.has_access(auth.uid(), 'cash'));

create policy "brut: modification si abonne"
  on public.hand_raw for update
  using (auth.uid() = user_id and public.has_access(auth.uid(), 'cash'))
  with check (auth.uid() = user_id);

-- Les mouvements de bankroll et les réglages restent communs aux deux produits :
-- ils décrivent l'utilisateur, pas un format de jeu. Un accès à l'un ou l'autre
-- suffit donc.
create policy "mouvements: ajout si abonne"
  on public.entries for insert
  with check (
    auth.uid() = user_id
    and (public.has_access(auth.uid(), 'cash') or public.has_access(auth.uid(), 'spin'))
  );

create policy "mouvements: modification si abonne"
  on public.entries for update
  using (
    auth.uid() = user_id
    and (public.has_access(auth.uid(), 'cash') or public.has_access(auth.uid(), 'spin'))
  )
  with check (auth.uid() = user_id);

create policy "reglages: ecriture si abonne"
  on public.settings for all
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and (public.has_access(auth.uid(), 'cash') or public.has_access(auth.uid(), 'spin'))
  );
