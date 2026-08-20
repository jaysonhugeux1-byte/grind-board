-- Ouvre un accès Expert — cash game, spin ET solveur.
-- À exécuter dans l'éditeur SQL de Supabase.
--
-- POURQUOI TROIS PRODUITS ET NON « expert ». « Expert » est une FORMULE, pas un
-- produit : c'est un nom de tarif, qui n'existe que dans la table des prix de
-- l'Edge Function. La table des accès, elle, ne connaît que ce qui s'ouvre —
-- « cash », « spin », « solveur » — et c'est bien ce qu'Expert crédite. Écrire
-- « expert » dans product ferait échouer la contrainte, et pour une bonne raison.
--
-- ORDRE IMPORTANT : la personne doit s'être connectée UNE FOIS avec Google,
-- dans l'application ou sur le site, AVANT que ce script puisse marcher. Un
-- compte Supabase n'existe qu'à partir de la première connexion — avant, il n'y
-- a rien à créditer, et le script te le dira franchement plutôt que d'échouer
-- sans explication.
--
-- Le crédit s'AJOUTE à ce qui reste : relancer ce script prolonge, il n'écrase
-- jamais. Aucun risque à le rejouer.

do $$
declare
  -- ------------------------------------------------------------------ RÉGLAGES
  v_email    text := 'jayson.hugeux1@gmail.com';
  v_mois     int  := 12;
  -- Les trois accès que donne la formule Expert.
  v_produits text[] := array['cash', 'spin', 'solveur'];
  -- ---------------------------------------------------------------------------
  v_user     uuid;
  v_produit  text;
  v_fin      timestamptz;
begin
  select id into v_user from auth.users where lower(email) = lower(v_email);

  if v_user is null then
    raise exception
      E'Aucun compte pour %.\n'
      '  → Connecte-toi une fois avec Google, dans l''application ou sur '
      'https://jaysonhugeux1-byte.github.io/grind-board/, puis relance ce script.',
      v_email;
  end if;

  foreach v_produit in array v_produits
  loop
    v_fin := public.grant_access(v_user, v_produit, v_mois, 'offert');
    raise notice 'Accès % ouvert jusqu''au %', v_produit, v_fin;
  end loop;
end $$;

-- Vérification : trois lignes, avec leur date d'expiration.
select u.email, a.product, a.access_until, a.provider
from public.access a
join auth.users u on u.id = a.user_id
where lower(u.email) = lower('jayson.hugeux1@gmail.com')
order by a.product;
