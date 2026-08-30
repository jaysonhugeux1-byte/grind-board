-- Bilan de santé de la base, en une seule requête.
--
-- À exécuter dans l'éditeur SQL de Supabase. NE MODIFIE RIEN : que des lectures.
--
-- ---------------------------------------------------------------------------
-- POURQUOI CE FICHIER EXISTE
-- ---------------------------------------------------------------------------
--
-- Les migrations se sont accumulées, et rien ne garantissait qu'elles avaient
-- toutes été jouées. On l'a appris de la pire façon : en ouvrant un accès à
-- quelqu'un, qui a reçu « there is no unique or exclusion constraint matching
-- the ON CONFLICT specification ». La clé primaire de `access` n'avait jamais
-- été refaite, alors que des fichiers plus récents, eux, l'avaient été.
--
-- Une pièce manquante découverte par accident en annonce d'autres. Cette
-- requête les cherche toutes d'un coup, au lieu d'attendre que chacune se
-- signale par une erreur devant un utilisateur.
--
-- LA COLONNE `verdict` EST LA SEULE À LIRE.
--   OK      : rien à faire.
--   MANQUE  : la migration correspondante n'a pas été jouée. La colonne
--             `remede` dit quoi exécuter.
--
-- « purge : non armée » est un OK. C'est l'état voulu : la fonction existe,
-- rien ne l'appelle, et c'est délibéré tant que la politique de conservation
-- n'est pas décidée.

with controles as (

  -- 1. LA CLÉ PRIMAIRE DE `access`
  -- Celle qui manquait. `grant_access` écrit avec on conflict (user_id,
  -- product) : sans elle, aucun accès ne peut être ouvert ni renouvelé.
  select
    1 as ordre,
    'access : clé primaire sur (user_id, product)' as controle,
    coalesce((
      select array_length(conkey::smallint[], 1) = 2
      from pg_constraint
      where conrelid = 'public.access'::regclass and contype = 'p'
    ), false) as ok,
    'reparer_cle_acces.sql' as remede

  -- 2. LA FONCTION QUI VÉRIFIE UN ACCÈS
  -- Toutes les politiques d'écriture l'appellent. Absente, plus personne
  -- n'importe la moindre main.
  union all select
    2,
    'fonction has_access(uuid, text)',
    exists (
      select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'has_access'
        and pg_get_function_identity_arguments(p.oid) = 'uid uuid, p_product text'
    ),
    '02_multi_produit.sql — section 3 UNIQUEMENT'

  -- 3. LA FONCTION QUI CRÉDITE UN ACCÈS
  union all select
    3,
    'fonction grant_access(uuid, text, int, text)',
    exists (
      select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'grant_access'
        and pg_get_function_identity_arguments(p.oid)
            like 'p_user uuid, p_product text, p_months integer%'
    ),
    '06_bases.sql'

  -- 4 et 5. LES PRODUITS VENDABLES
  -- Une contrainte trop étroite fait échouer le crédit APRÈS l'encaissement :
  -- le client a payé et n'a rien.
  union all select
    4,
    'le produit « solveur » est accepté',
    coalesce((
      select pg_get_constraintdef(oid) like '%solveur%'
      from pg_constraint where conname = 'access_product_valide'
    ), false),
    '05_solveur.sql'

  union all select
    5,
    'le produit « base2 » est accepté',
    coalesce((
      select pg_get_constraintdef(oid) like '%base2%'
      from pg_constraint where conname = 'access_product_valide'
    ), false),
    '06_bases.sql — section 3 bis'

  union all select
    6,
    'les commandes acceptent « base2 »',
    coalesce((
      select pg_get_constraintdef(oid) like '%base2%'
      from pg_constraint where conname = 'crypto_orders_products_valides'
    ), false),
    '06_bases.sql — section 3 bis'

  -- 7. LA SECONDE BASE DE DONNÉES
  -- La colonne doit exister sur les SIX tables. Sur cinq seulement, la
  -- séparation fuit là où elle manque.
  union all select
    7,
    'colonne `base` sur les six tables de données',
    (
      select count(*) = 6 from information_schema.columns
      where table_schema = 'public' and column_name = 'base'
        and table_name in ('hands', 'hand_raw', 'entries',
                           'spin_tournaments', 'spin_hands', 'spin_hand_raw')
    ),
    '06_bases.sql'

  -- 8. LE CLOISONNEMENT
  -- Sans RLS active, les politiques ne s'appliquent pas : n'importe quel compte
  -- lit les données de n'importe quel autre. C'est le contrôle le plus grave
  -- de la liste.
  union all select
    8,
    'RLS active sur toutes les tables de données',
    (
      select bool_and(c.relrowsecurity) from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname in ('hands', 'hand_raw', 'entries', 'settings', 'access',
                          'spin_tournaments', 'spin_hands', 'spin_hand_raw')
    ),
    'ALERTE — schema.sql, et vérifier chaque table'

  -- 9. LA PURGE : ÉCRITE, PAS ARMÉE
  -- Sa présence est normale. Son absence signifie seulement que 06 n'a pas
  -- été joué en entier.
  union all select
    9,
    'purge écrite (et volontairement non armée)',
    exists (
      select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'purger_donnees'
    ),
    '06_bases.sql — section 4'
)

select
  controle,
  case when ok then 'OK' else 'MANQUE' end as verdict,
  case when ok then '' else remede end     as a_executer
from controles
order by
  -- Ce qui manque remonte en haut : s'il n'y a rien à faire, la première
  -- ligne le dit déjà.
  ok, ordre;
