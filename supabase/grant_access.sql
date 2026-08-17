-- Crédit d'accès après paiement — à exécuter dans l'éditeur SQL, après schema.sql.
--
-- Passe par une fonction plutôt qu'une lecture suivie d'une écriture depuis la
-- fonction de paiement : l'opération devient atomique. Deux notifications
-- traitées en même temps ne peuvent pas se marcher dessus et faire perdre un
-- mois à l'utilisateur.
--
-- Un rachat anticipé s'ajoute au temps restant au lieu de l'écraser.
create or replace function public.grant_access(
  p_user     uuid,
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
  insert into public.access as a (user_id, access_until, provider, updated_at)
  values (p_user, now() + make_interval(months => p_months), p_provider, now())
  on conflict (user_id) do update
    set access_until = greatest(a.access_until, now()) + make_interval(months => p_months),
        provider     = excluded.provider,
        updated_at   = now()
  returning a.access_until into v_until;

  return v_until;
end;
$$;

-- Personne d'autre que le serveur ne doit pouvoir s'octroyer un accès.
revoke all on function public.grant_access(uuid, int, text) from public, anon, authenticated;

-- Journal des paiements traités : sert de garde-fou contre les notifications
-- rejouées (NOWPayments les renvoie plusieurs fois). Aucune politique RLS n'est
-- définie — seule la clé de service, qui les contourne, y accède.
create table if not exists public.crypto_orders (
  order_id   text primary key,
  user_id    uuid not null references auth.users on delete cascade,
  plan_id    text not null,
  months     int  not null,
  amount     numeric not null,
  status     text not null default 'created',
  payment_id text,
  created_at timestamptz not null default now(),
  paid_at    timestamptz
);

alter table public.crypto_orders enable row level security;

create table if not exists public.crypto_events (
  payment_id  text primary key,
  order_id    text not null,
  received_at timestamptz not null default now()
);

alter table public.crypto_events enable row level security;
