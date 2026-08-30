-- Répare la clé primaire de la table `access`.
--
-- À exécuter dans l'éditeur SQL de Supabase. Ce fichier ne supprime aucune
-- donnée.
--
-- COLLE TOUT ET LANCE. L'éditeur de Supabase n'affiche que le résultat de la
-- DERNIÈRE requête : c'est la vérification finale que tu verras, et elle suffit
-- à conclure. Les sections 1 et 2 ne servent qu'à documenter le diagnostic.
--
-- ---------------------------------------------------------------------------
-- LE SYMPTÔME
-- ---------------------------------------------------------------------------
--
--   there is no unique or exclusion constraint matching the ON CONFLICT
--   specification
--
-- Il apparaît en ouvrant un accès — script d'invitation, script Expert, ou
-- crédit après un paiement.
--
-- ---------------------------------------------------------------------------
-- LA CAUSE
-- ---------------------------------------------------------------------------
--
-- `grant_access` termine par :
--
--     on conflict (user_id, product) do update ...
--
-- PostgreSQL exige, pour cette écriture, une contrainte d'unicité portant
-- exactement sur ces deux colonnes. Elle est créée par 02_multi_produit.sql,
-- qui n'a pas été exécuté sur cette base — alors que 05_solveur.sql et
-- 06_bases.sql l'ont été. La fonction récente est donc en place, mais pas la
-- clé qu'elle suppose.
--
-- ---------------------------------------------------------------------------
-- POURQUOI NE PAS SIMPLEMENT REJOUER 02_multi_produit.sql
-- ---------------------------------------------------------------------------
--
-- PARCE QU'IL FERAIT RECULER LA BASE. Ce fichier date d'une époque où seuls
-- « cash » et « spin » existaient. Le rejouer aujourd'hui :
--
--   — remettrait check (product in ('cash', 'spin')), ce qui interdirait
--     « solveur » et « base2 » — donc les formules Expert et le supplément
--     seconde base, qui deviendraient invendables ;
--   — remplacerait `grant_access` par sa version d'alors.
--
-- On ne reprend donc que le bloc qui manque : la clé primaire.

-- ---------------------------------------------------------------------------
-- 1. CONSTAT, AVANT DE TOUCHER À QUOI QUE CE SOIT
-- ---------------------------------------------------------------------------
--
-- Une ligne par colonne de la clé primaire actuelle. On attend `user_id` ET
-- `product` ; s'il n'y a que `user_id`, c'est bien le défaut décrit ci-dessus.

select
  c.conname                        as contrainte,
  a.attname                        as colonne,
  array_length(c.conkey::smallint[], 1)        as nb_colonnes
from pg_constraint c
-- `conkey` est un int2vector : on le convertit en tableau pour unnest.
join unnest(c.conkey::smallint[]) as k(num) on true
join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.num
where c.conrelid = 'public.access'::regclass
  and c.contype = 'p';

-- ---------------------------------------------------------------------------
-- 2. LES DOUBLONS QUI EMPÊCHERAIENT LA RÉPARATION
-- ---------------------------------------------------------------------------
--
-- Créer une clé primaire échoue si deux lignes portent déjà le même couple.
-- Le cas est normalement impossible — la clé actuelle sur `user_id` seul
-- l'interdit — mais si la contrainte avait été retirée à la main, il faut le
-- savoir AVANT plutôt que de lire un message d'erreur obscur.
--
-- Aucune ligne : on peut réparer.

select user_id, product, count(*) as lignes
from public.access
group by user_id, product
having count(*) > 1;

-- ---------------------------------------------------------------------------
-- 3. LA RÉPARATION
-- ---------------------------------------------------------------------------
--
-- Idempotente : si la clé est déjà correcte, ce bloc ne fait rien. Il ne
-- touche ni aux lignes, ni aux contraintes de produit, ni aux fonctions.

do $$
declare
  v_produits_nuls int;
  v_nom           text;
  v_colonnes      int;
begin
  -- Une clé primaire refuse les valeurs nulles. Si des lignes anciennes ont un
  -- `product` vide — possible avant que la colonne existe — il faut les
  -- remplir d'abord, sinon la création échoue sans dire laquelle est fautive.
  select count(*) into v_produits_nuls from public.access where product is null;
  if v_produits_nuls > 0 then
    raise notice '% ligne(s) sans produit : elles reçoivent « cash », valeur d''origine.', v_produits_nuls;
    update public.access set product = 'cash' where product is null;
  end if;

  -- ON CHERCHE LA CLÉ PAR SON RÔLE, PAS PAR SON NOM. Supposer qu'elle
  -- s'appelle « access_pkey » suffit dans le cas courant, mais une clé créée à
  -- la main peut porter un autre nom : le `drop` ne l'atteindrait pas, et
  -- l'ajout échouerait sur « multiple primary keys », message qui n'aide
  -- personne.
  select conname, array_length(conkey::smallint[], 1)
    into v_nom, v_colonnes
  from pg_constraint
  where conrelid = 'public.access'::regclass and contype = 'p';

  if v_colonnes = 2 then
    raise notice 'La clé porte déjà sur deux colonnes : rien à faire.';
  else
    if v_nom is not null then
      execute format('alter table public.access drop constraint %I', v_nom);
    end if;
    alter table public.access add primary key (user_id, product);
    raise notice 'Clé primaire refaite sur (user_id, product).';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. VÉRIFICATION
-- ---------------------------------------------------------------------------
--
-- `nb_colonnes` doit valoir 2, sur deux lignes : user_id et product.
-- Le script d'invitation peut alors être relancé.

select
  c.conname                 as contrainte,
  a.attname                 as colonne,
  array_length(c.conkey::smallint[], 1) as nb_colonnes
from pg_constraint c
-- `conkey` est un int2vector : on le convertit en tableau pour unnest.
join unnest(c.conkey::smallint[]) as k(num) on true
join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.num
where c.conrelid = 'public.access'::regclass
  and c.contype = 'p';
