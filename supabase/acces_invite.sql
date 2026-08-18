-- Ouvre un accès à quelqu'un d'autre, pour un test ou une période d'essai.
-- À exécuter dans l'éditeur SQL de Supabase.
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
  v_email   text := 'adresse.de.ton.ami@gmail.com';
  v_mois    int  := 1;                          -- durée de l'essai
  v_produits text[] := array['cash', 'spin'];   -- ou array['spin'] pour le spin seul
  -- ---------------------------------------------------------------------------
  v_user    uuid;
  v_produit text;
  v_fin     timestamptz;
begin
  select id into v_user from auth.users where lower(email) = lower(v_email);

  if v_user is null then
    raise exception
      E'Aucun compte pour %.\n'
      '  → Demande-lui de se connecter une fois avec Google, dans l''application '
      'ou sur https://jaysonhugeux1-byte.github.io/grind-board/, puis relance ce script.',
      v_email;
  end if;

  foreach v_produit in array v_produits
  loop
    v_fin := public.grant_access(v_user, v_produit, v_mois, 'invitation');
    raise notice 'Accès % ouvert jusqu''au %', v_produit, v_fin;
  end loop;
end $$;

-- Vérification : une ligne par produit, avec la date d'expiration.
select u.email, a.product, a.access_until, a.provider
from public.access a
join auth.users u on u.id = a.user_id
where lower(u.email) = lower('adresse.de.ton.ami@gmail.com')
order by a.product;
