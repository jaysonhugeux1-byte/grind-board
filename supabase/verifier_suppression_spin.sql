-- Pourquoi la suppression des données de spin ne fait rien.
--
-- À exécuter dans l'éditeur SQL de Supabase. La première requête DIAGNOSTIQUE,
-- la seconde RÉPARE. Lis le résultat de la première avant de lancer la seconde.
--
-- Le piège que ce fichier existe pour lever : quand la sécurité au niveau des
-- lignes refuse une suppression, PostgREST ne renvoie AUCUNE erreur. Il efface
-- zéro ligne, en silence, et l'application croit avoir réussi.

-- ---------------------------------------------------------------------------
-- 1. DIAGNOSTIC : est-ce que la règle de suppression existe ?
-- ---------------------------------------------------------------------------
--
-- Tu dois voir TROIS lignes, une par table. S'il en manque une seule, c'est
-- la cause : l'application n'a pas le droit d'effacer, et ne le sait pas.

select tablename, policyname, cmd
  from pg_policies
 where schemaname = 'public'
   and tablename in ('spin_tournaments', 'spin_hands', 'spin_hand_raw')
   and cmd = 'DELETE'
 order by tablename;

-- ---------------------------------------------------------------------------
-- 2. RÉPARATION : reposer la règle sur les trois tables
-- ---------------------------------------------------------------------------
--
-- Sans danger à rejouer même si les règles sont déjà là : on les retire et on
-- les remet à l'identique.
--
-- CE DROIT NE DÉPEND PAS DE L'ABONNEMENT, et c'est voulu. Lire et écrire
-- demandent un accès en cours ; EFFACER ce qu'on a soi-même déposé doit rester
-- possible même quand l'abonnement a expiré. L'inverse reviendrait à retenir
-- les données de quelqu'un qui ne paie plus.

do $$
declare
  t text;
begin
  foreach t in array array['spin_tournaments', 'spin_hands', 'spin_hand_raw']
  loop
    execute format('drop policy if exists "spin: suppression des siens" on public.%I', t);
    execute format(
      'create policy "spin: suppression des siens" on public.%I '
      'for delete using (auth.uid() = user_id)', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 3. CONTRÔLE : combien de lignes te restent-il vraiment ?
-- ---------------------------------------------------------------------------
--
-- Remplace l'identifiant par le tien (Authentication → Users → ton compte).

-- select
--   (select count(*) from public.spin_tournaments where user_id = 'TON-UUID') as tournois,
--   (select count(*) from public.spin_hands       where user_id = 'TON-UUID') as mains,
--   (select count(*) from public.spin_hand_raw    where user_id = 'TON-UUID') as textes;
