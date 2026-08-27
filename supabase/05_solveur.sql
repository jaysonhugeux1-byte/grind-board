-- Le solveur devient une option payante, en plus de l'abonnement de base.
--
-- POURQUOI UNE MIGRATION. Le produit est contraint à ('cash', 'spin') à TROIS
-- endroits : la contrainte de la table des accès, la liste blanche de la
-- fonction qui crédite, et la contrainte des commandes crypto. Ajouter un
-- produit côté application sans les élargir ferait échouer le crédit APRÈS le
-- paiement — c'est-à-dire au pire moment possible, une fois l'argent parti.
--
-- L'OPTION N'OUVRE PAS L'APPLICATION. « solveur » donne accès au solveur, pas à
-- GrindBoard : l'entrée reste conditionnée à « cash » ou « spin ». C'est
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
-- ON REPREND LA FONCTION À L'IDENTIQUE, à un mot près : la liste des produits
-- acceptés. Tout le reste — le type de retour, la valeur par défaut du
-- fournisseur, le corps — doit rester rigoureusement le même.
--
--   Le TYPE DE RETOUR d'abord, parce que PostgreSQL refuse de le changer par
--   « create or replace ». Le contourner demanderait de SUPPRIMER la fonction,
--   ce qui emporterait au passage les révocations de droits posées sur elle :
--   la fonction redeviendrait appelable par « anon » et « authenticated », donc
--   par n'importe qui, alors qu'elle crédite des accès payants. Le webhook, lui,
--   ne lit que l'erreur et se moque de la valeur rendue — mais un contrat ne se
--   change pas parce que l'appelant du jour n'en profite pas.
--
--   La VALEUR PAR DÉFAUT du fournisseur ensuite : « nowpayments ». La changer
--   modifierait silencieusement ce qui est enregistré le jour où l'appelant
--   omet l'argument, et on chercherait longtemps d'où vient l'écart.
--
-- La liste blanche est répétée ici volontairement : la fonction est appelée
-- avec les droits du service, et c'est le dernier endroit où un produit
-- inventé peut être arrêté.
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
  if p_product not in ('cash', 'spin', 'solveur') then
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

-- « create or replace » conserve les droits déjà posés ; on les repose quand
-- même, pour que ce fichier suffise à lui seul si la fonction était recréée.
revoke all on function public.grant_access(uuid, text, int, text) from public, anon, authenticated;

-- ------------------------------------------------------ commandes crypto
alter table public.crypto_orders
  drop constraint if exists crypto_orders_products_valides;

alter table public.crypto_orders
  add constraint crypto_orders_products_valides
  check (
    array_length(products, 1) >= 1
    and products <@ array['cash', 'spin', 'solveur']
  );

-- ------------------------------------------------------------------------
-- DÉCISION PRISE : ON N'OFFRE PAS LE SOLVEUR AUX ABONNÉS D'AVANT
-- ------------------------------------------------------------------------
--
-- Ce fichier proposait une requête pour créditer le solveur aux abonnements
-- en cours au moment où il est passé dans la formule Expert. Elle a été
-- ABANDONNÉE le 27 août 2026, sur décision du propriétaire.
--
-- On l'écrit ici plutôt que de supprimer le paragraphe : sans trace, la même
-- question reviendrait au prochain changement de formule, et personne ne
-- saurait qu'elle a déjà été tranchée.
--
-- La requête elle-même n'a pas à survivre : la reconstruire prendrait cinq
-- minutes, alors qu'une requête destructrice qui traîne, commentée, dans un
-- fichier de migration finit toujours par être exécutée par distraction.
