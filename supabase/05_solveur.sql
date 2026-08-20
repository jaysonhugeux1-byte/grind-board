-- Le solveur devient une option payante, en plus de l'abonnement de base.
--
-- POURQUOI UNE MIGRATION. Le produit est contraint à ('cash', 'spin') à TROIS
-- endroits : la contrainte de la table des accès, la liste blanche de la
-- fonction qui crédite, et la contrainte des commandes crypto. Ajouter un
-- produit côté application sans les élargir ferait échouer le crédit APRÈS le
-- paiement — c'est-à-dire au pire moment possible, une fois l'argent parti.
--
-- L'OPTION N'OUVRE PAS L'APPLICATION. « solveur » donne accès au solveur, pas à
-- Grand Livre : l'entrée reste conditionnée à « cash » ou « spin ». C'est
-- garanti côté application (isActive n'en tient pas compte) et il n'y a rien à
-- faire ici pour cela — mais autant l'écrire, parce que la tentation de traiter
-- tous les produits de la même façon viendra.
--
-- À EXÉCUTER dans l'éditeur SQL de Supabase, une fois. Le script est
-- idempotent : le relancer ne casse rien.

-- ---------------------------------------------------------------- les accès
alter table public.access
  drop constraint if exists access_product_valide;

alter table public.access
  add constraint access_product_valide check (product in ('cash', 'spin', 'solveur'));

-- ------------------------------------------------- la fonction qui crédite
--
-- La liste blanche est répétée ici volontairement : la fonction est appelée
-- avec les droits du service, et c'est le dernier endroit où un produit
-- inventé peut être arrêté.
create or replace function public.grant_access(
  p_user     uuid,
  p_product  text,
  p_months   int,
  p_provider text default 'crypto'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_months is null or p_months <= 0 then
    raise exception 'Durée invalide : %', p_months;
  end if;

  if p_product not in ('cash', 'spin', 'solveur') then
    raise exception 'Produit inconnu : %', p_product;
  end if;

  insert into public.access as a (user_id, product, access_until, provider, updated_at)
  values (p_user, p_product, now() + make_interval(months => p_months), p_provider, now())
  on conflict (user_id, product) do update
    -- On prolonge à partir de la date la plus lointaine entre l'échéance en
    -- cours et maintenant : renouveler avant l'échéance ne doit pas faire
    -- perdre les jours restants.
    set access_until = greatest(a.access_until, now()) + make_interval(months => p_months),
        provider     = excluded.provider,
        updated_at   = now();
end;
$$;

-- ------------------------------------------------------ commandes crypto
alter table public.crypto_orders
  drop constraint if exists crypto_orders_products_valides;

alter table public.crypto_orders
  add constraint crypto_orders_products_valides
  check (
    array_length(products, 1) >= 1
    and products <@ array['cash', 'spin', 'solveur']
  );
