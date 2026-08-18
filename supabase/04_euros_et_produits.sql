-- Prix en euros, et rattrapage du crédit d'accès multi-produit.
-- À exécuter après 03_spin.sql.
--
-- Deux corrections indépendantes réunies parce qu'elles touchent la même table.
--
-- 1. La devise passe du dollar à l'euro. Elle est désormais conservée sur la
--    commande : la notification de paiement doit pouvoir vérifier que le
--    montant reçu est bien dans la devise facturée, pas seulement qu'il a la
--    bonne valeur numérique.
--
-- 2. Surtout : la commande ne disait pas QUELS produits elle ouvrait. Le
--    modèle multi-produit a fait passer grant_access de trois à quatre
--    arguments, mais la notification appelait toujours l'ancienne signature —
--    un paiement réel n'aurait donc rien crédité du tout. Comme aucun paiement
--    n'a encore abouti, le défaut n'était jamais apparu.

alter table public.crypto_orders
  add column if not exists products text[] not null default array['cash'];

alter table public.crypto_orders
  add column if not exists currency text not null default 'eur';

-- Rattrapage des commandes déjà enregistrées : l'identifiant de formule porte
-- le produit en préfixe (cash_m3, spin_m12, duo_m1…).
update public.crypto_orders
set products = case
      when plan_id like 'duo\_%'  then array['cash', 'spin']
      when plan_id like 'spin\_%' then array['spin']
      else array['cash']
    end
where products = array['cash']
  and plan_id like '%\_%';

-- Une commande doit ouvrir au moins un produit, et uniquement des produits
-- connus : un tableau vide crediterait un paiement sans rien donner en retour.
alter table public.crypto_orders
  drop constraint if exists crypto_orders_products_valides;
alter table public.crypto_orders
  add constraint crypto_orders_products_valides
  check (
    array_length(products, 1) >= 1
    and products <@ array['cash', 'spin']
  );
