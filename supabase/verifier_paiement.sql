-- Vérifier qu'un paiement a traversé toute la chaîne.
--
-- À exécuter dans l'éditeur SQL de Supabase, APRÈS un paiement d'essai.
-- Aucune de ces requêtes ne modifie quoi que ce soit : elles lisent.
--
-- LA CHAÎNE COMPTE QUATRE MAILLONS, et chacun peut céder seul :
--
--   1. l'application demande un paiement      → une commande est créée
--   2. SumUp encaisse                          → le checkout passe à PAID
--   3. SumUp sonne chez nous                   → un verrou est posé
--   4. on relit, on vérifie, on crédite        → la commande passe à finished
--                                                et l'accès est prolongé
--
-- Les requêtes ci-dessous les inspectent dans cet ordre. La première qui ne
-- rend pas ce qu'on attend désigne le maillon fautif — c'est tout l'intérêt de
-- les séparer plutôt que de chercher « pourquoi ça ne marche pas ».

-- ---------------------------------------------------------------------------
-- 0. LA CHAÎNE EN UNE SEULE REQUÊTE
-- ---------------------------------------------------------------------------
--
-- L'éditeur SQL de Supabase n'affiche que le résultat de la DERNIÈRE requête
-- d'un fichier : lancer les quatre blocs d'un coup n'en montre qu'un, et l'on
-- croit avoir tout regardé. Celle-ci les réunit, une ligne par commande, du
-- plus récent au plus ancien.
--
-- La colonne `ou_ca_bloque` désigne le maillon fautif. C'est la seule qu'il
-- faut lire.

select
  o.created_at,
  o.plan_id,
  o.amount,
  o.status,
  (e.payment_id is not null)                       as notification_recue,
  (a.access_until is not null and a.access_until > now()) as acces_actif,
  a.provider,
  case
    when o.status = 'finished'   then 'rien : tout est passé'
    when e.payment_id is null    then 'SumUp n''a pas sonné — webhook non déployé, ou déployé sans --no-verify-jwt'
    else 'la notification est arrivée mais le crédit a échoué — voir les journaux de sumup-webhook'
  end as ou_ca_bloque
from public.crypto_orders o
left join public.crypto_events e on e.order_id = o.order_id
left join public.access a
       on a.user_id = o.user_id and a.product = o.products[1]
order by o.created_at desc
limit 10;

-- ---------------------------------------------------------------------------
-- 1. LA COMMANDE A-T-ELLE ÉTÉ CRÉÉE ?
-- ---------------------------------------------------------------------------
--
-- Si rien ne sort : le bouton n'a pas appelé la fonction, ou la fonction a
-- refusé avant d'enregistrer. Regarder les journaux de `create-sumup-payment`.

select
  order_id,
  plan_id,
  amount,
  currency,
  products,
  status,          -- « waiting » juste après le clic, « finished » une fois payé
  payment_id,      -- l'identifiant du checkout SumUp
  created_at,
  paid_at
from public.crypto_orders
order by created_at desc
limit 5;

-- ---------------------------------------------------------------------------
-- 2. LA NOTIFICATION EST-ELLE ARRIVÉE ?
-- ---------------------------------------------------------------------------
--
-- Une ligne ici signifie que SumUp a bien sonné et qu'on a posé le verrou.
--
-- Rien, alors que le paiement est passé chez SumUp ? Trois causes, dans
-- l'ordre de fréquence :
--   — la fonction a été déployée SANS `--no-verify-jwt` : SumUp appelle sans
--     jeton Supabase, et chaque notification est rejetée avant d'être lue ;
--   — l'adresse `return_url` n'a pas été acceptée par SumUp ;
--   — la fonction n'est pas déployée du tout.

select payment_id, order_id, received_at
from public.crypto_events
order by received_at desc
limit 5;

-- ---------------------------------------------------------------------------
-- 3. L'ACCÈS A-T-IL ÉTÉ CRÉDITÉ ?
-- ---------------------------------------------------------------------------
--
-- `provider` doit valoir « sumup » sur la ligne qui vient d'être créditée.
-- S'il vaut encore « nowpayments », c'est une ancienne ligne : le paiement
-- d'essai n'a pas abouti.

select
  user_id,
  product,
  access_until,
  access_until > now() as encore_valable,
  provider,
  updated_at
from public.access
order by updated_at desc
limit 10;

-- ---------------------------------------------------------------------------
-- 4. LE CAS QUI TROMPE : verrou posé, commande NON finie
-- ---------------------------------------------------------------------------
--
-- C'est la situation à repérer en priorité. Elle signifie que la notification
-- est bien arrivée, mais que le crédit a échoué APRÈS. Le paiement est
-- encaissé et le client n'a rien.
--
-- La cause la plus probable est une contrainte de produit : `base2` n'était
-- pas accepté avant l'exécution de 06_bases.sql. Regarder les journaux de
-- `sumup-webhook`, ligne « Crédit d'accès impossible ».
--
-- Le verrou est normalement relâché tout seul dans ce cas, pour que SumUp
-- puisse réessayer. S'il reste, le supprimer à la main relance le processus.

select
  e.payment_id,
  e.order_id,
  o.status,
  o.products,
  e.received_at
from public.crypto_events e
left join public.crypto_orders o on o.order_id = e.order_id
where o.status is distinct from 'finished'
order by e.received_at desc;

-- ---------------------------------------------------------------------------
-- 5. RATTRAPAGE MANUEL, en dernier recours
-- ---------------------------------------------------------------------------
--
-- Si un paiement est encaissé chez SumUp et que l'accès n'a pas suivi, on peut
-- créditer à la main. À n'utiliser qu'après avoir VU le paiement dans le
-- tableau de bord SumUp : cette fonction ne vérifie rien, elle donne.
--
-- Remplacer l'identifiant, le produit et la durée, puis décommenter.

-- select public.grant_access(
--   'IDENTIFIANT-DU-COMPTE'::uuid,
--   'spin',        -- cash · spin · solveur · base2
--   1,             -- nombre de mois
--   'manuel'
-- );
