-- Ouvre douze mois d'accès aux deux produits pour un compte donné.
-- À exécuter dans l'éditeur SQL de Supabase.
--
-- Sert à se donner un accès de développement ou de test sans passer par un
-- paiement. Le crédit s'AJOUTE à ce qui reste : relancer ce script deux fois
-- donne vingt-quatre mois, il n'écrase rien.
--
-- Remplace l'adresse ci-dessous si le compte n'est pas le tien.

do $$
declare
  v_email   text := 'jayson.hugeux1@gmail.com';
  v_mois    int  := 12;
  v_user    uuid;
  v_produit text;
  v_fin     timestamptz;
begin
  select id into v_user from auth.users where lower(email) = lower(v_email);

  if v_user is null then
    raise exception
      'Aucun compte pour %. Connecte-toi une fois dans l''application ou sur le site : le compte n''existe qu''après la première connexion Google.',
      v_email;
  end if;

  foreach v_produit in array array['cash', 'spin']
  loop
    v_fin := public.grant_access(v_user, v_produit, v_mois, 'manuel');
    raise notice 'Accès % ouvert jusqu''au %', v_produit, v_fin;
  end loop;
end $$;

-- Vérification : doit renvoyer deux lignes, cash et spin.
select product, access_until, provider
from public.access
where user_id = (select id from auth.users where lower(email) = lower('jayson.hugeux1@gmail.com'))
order by product;
