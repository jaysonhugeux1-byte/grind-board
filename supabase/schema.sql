-- Schéma GrindBoard pour Supabase (Postgres).
-- À exécuter une fois dans l'éditeur SQL du projet Supabase.
--
-- Choix de conception : chaque main est stockée dans une colonne `data` de type
-- jsonb, avec exactement la forme que l'application manipule déjà. Ce n'est pas
-- un raccourci — l'application est un outil d'analyse qui charge l'intégralité
-- de l'historique en mémoire et filtre côté client : elle n'interroge jamais le
-- serveur par position, par notation ou par gain. Éclater la main en trente
-- colonnes n'apporterait donc rien, et obligerait à réécrire le parseur, les
-- statistiques et toutes les pages.
-- Seuls les champs réellement utilisés pour trier ou filtrer côté serveur
-- (l'horodatage) sont extraits en colonnes propres.

-- ---------------------------------------------------------------------------
-- Abonnement
-- ---------------------------------------------------------------------------

-- Accès prépayé, écrit uniquement par l'Edge Function de paiement (via la clé
-- de service, qui contourne RLS). Aucune politique d'écriture n'est définie :
-- un client ne peut donc jamais s'octroyer un accès.
create table if not exists public.access (
  user_id      uuid primary key references auth.users on delete cascade,
  access_until timestamptz not null,
  provider     text,
  updated_at   timestamptz not null default now()
);

-- Vérifie qu'un utilisateur a un accès non expiré.
--
-- security definer : la fonction lit `access` avec les droits de son
-- propriétaire, ce qui permet de la consulter depuis les politiques des autres
-- tables sans ouvrir `access` en lecture directe.
-- search_path figé : sans cela, un utilisateur pourrait créer une table
-- `access` dans un schéma prioritaire et détourner la vérification.
create or replace function public.has_access(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.access
    where user_id = uid and access_until > now()
  );
$$;

-- ---------------------------------------------------------------------------
-- Données de jeu
-- ---------------------------------------------------------------------------

-- Une main = une ligne. `hand_id` est l'identifiant CoinPoker : la clé primaire
-- composite dédoublonne donc automatiquement les réimports, comme le faisait
-- l'identifiant de document côté Firestore.
create table if not exists public.hands (
  user_id uuid not null references auth.users on delete cascade,
  hand_id text not null,
  ts      timestamptz not null,
  data    jsonb not null,
  primary key (user_id, hand_id)
);

create index if not exists hands_user_ts_idx on public.hands (user_id, ts);

-- Texte brut des mains, séparé : il pèse lourd et n'est chargé qu'à la demande
-- (affichage d'une main, analyse IA), jamais avec la liste complète.
create table if not exists public.hand_raw (
  user_id uuid not null references auth.users on delete cascade,
  hand_id text not null,
  raw     text not null,
  primary key (user_id, hand_id)
);

-- Dépôts, retraits, rakeback.
create table if not exists public.entries (
  id      uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  ts      timestamptz not null,
  data    jsonb not null
);

create index if not exists entries_user_ts_idx on public.entries (user_id, ts);

-- Réglages divers (objectif de bankroll, etc.), une ligne par clé.
create table if not exists public.settings (
  user_id uuid not null references auth.users on delete cascade,
  key     text not null,
  data    jsonb not null,
  primary key (user_id, key)
);

-- ---------------------------------------------------------------------------
-- Sécurité au niveau des lignes
-- ---------------------------------------------------------------------------
--
-- Même principe que les règles Firestore précédentes : lecture de ses propres
-- données toujours autorisée (un abonnement expiré ne doit jamais donner
-- l'impression que les mains ont disparu), écriture conditionnée à un accès
-- actif.
--
-- Avantage sur Firestore : has_access() est une sous-requête SQL ordinaire.
-- Elle n'est ni facturée à la lecture, ni soumise à la limite de 20 lectures
-- par requête multi-documents qui rendait impossible la vérification par
-- document lors d'un import par lots.

alter table public.access   enable row level security;
alter table public.hands    enable row level security;
alter table public.hand_raw enable row level security;
alter table public.entries  enable row level security;
alter table public.settings enable row level security;

-- access : lecture seule. L'écriture passe exclusivement par l'Edge Function.
drop policy if exists "acces: lecture de son propre acces" on public.access;
create policy "acces: lecture de son propre acces"
  on public.access for select
  using (auth.uid() = user_id);

-- hands
drop policy if exists "mains: lecture des siennes" on public.hands;
create policy "mains: lecture des siennes"
  on public.hands for select
  using (auth.uid() = user_id);

drop policy if exists "mains: ajout si abonne" on public.hands;
create policy "mains: ajout si abonne"
  on public.hands for insert
  with check (auth.uid() = user_id and public.has_access(auth.uid()));

drop policy if exists "mains: modification si abonne" on public.hands;
create policy "mains: modification si abonne"
  on public.hands for update
  using (auth.uid() = user_id and public.has_access(auth.uid()))
  with check (auth.uid() = user_id);

-- La suppression reste ouverte au propriétaire même sans abonnement : on ne
-- retient pas quelqu'un en otage de ses propres données.
drop policy if exists "mains: suppression des siennes" on public.hands;
create policy "mains: suppression des siennes"
  on public.hands for delete
  using (auth.uid() = user_id);

-- hand_raw
drop policy if exists "brut: lecture des siens" on public.hand_raw;
create policy "brut: lecture des siens"
  on public.hand_raw for select
  using (auth.uid() = user_id);

drop policy if exists "brut: ajout si abonne" on public.hand_raw;
create policy "brut: ajout si abonne"
  on public.hand_raw for insert
  with check (auth.uid() = user_id and public.has_access(auth.uid()));

drop policy if exists "brut: modification si abonne" on public.hand_raw;
create policy "brut: modification si abonne"
  on public.hand_raw for update
  using (auth.uid() = user_id and public.has_access(auth.uid()))
  with check (auth.uid() = user_id);

drop policy if exists "brut: suppression des siens" on public.hand_raw;
create policy "brut: suppression des siens"
  on public.hand_raw for delete
  using (auth.uid() = user_id);

-- entries
drop policy if exists "mouvements: lecture des siens" on public.entries;
create policy "mouvements: lecture des siens"
  on public.entries for select
  using (auth.uid() = user_id);

drop policy if exists "mouvements: ajout si abonne" on public.entries;
create policy "mouvements: ajout si abonne"
  on public.entries for insert
  with check (auth.uid() = user_id and public.has_access(auth.uid()));

drop policy if exists "mouvements: modification si abonne" on public.entries;
create policy "mouvements: modification si abonne"
  on public.entries for update
  using (auth.uid() = user_id and public.has_access(auth.uid()))
  with check (auth.uid() = user_id);

drop policy if exists "mouvements: suppression des siens" on public.entries;
create policy "mouvements: suppression des siens"
  on public.entries for delete
  using (auth.uid() = user_id);

-- settings
drop policy if exists "reglages: lecture des siens" on public.settings;
create policy "reglages: lecture des siens"
  on public.settings for select
  using (auth.uid() = user_id);

drop policy if exists "reglages: ecriture si abonne" on public.settings;
create policy "reglages: ecriture si abonne"
  on public.settings for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id and public.has_access(auth.uid()));

-- ---------------------------------------------------------------------------
-- Temps réel
-- ---------------------------------------------------------------------------
-- Permet aux clients de recevoir les changements en direct, comme onSnapshot.
-- L'abonnement temps réel respecte les politiques RLS ci-dessus.

alter publication supabase_realtime add table public.hands;
alter publication supabase_realtime add table public.entries;
alter publication supabase_realtime add table public.access;
