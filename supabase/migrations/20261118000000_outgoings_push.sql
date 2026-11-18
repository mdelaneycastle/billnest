create table public.outgoings_devices (
  id uuid primary key,
  token_hash text not null,
  subscription jsonb not null,
  revision bigint not null default -1,
  last_test timestamptz,
  touched_at timestamptz not null default now()
);

create table public.outgoings_jobs (
  device_id uuid not null references public.outgoings_devices (id) on delete cascade,
  due_at timestamptz not null,
  lease_until timestamptz,
  claim_id uuid,
  sent_at timestamptz,
  primary key (device_id, due_at)
);

create index outgoings_pending on public.outgoings_jobs (due_at) where sent_at is null;
alter table public.outgoings_devices enable row level security;
alter table public.outgoings_jobs enable row level security;
revoke all on public.outgoings_devices, public.outgoings_jobs from public, anon, authenticated;
grant select, insert, update, delete on public.outgoings_devices, public.outgoings_jobs to service_role;

create function public.outgoings_enrol(p_id uuid, p_hash text, p_subscription jsonb)
returns boolean language sql set search_path = '' as $$
  with saved as (
    insert into public.outgoings_devices (id, token_hash, subscription)
    values (p_id, p_hash, p_subscription)
    on conflict (id) do update set subscription = excluded.subscription, touched_at = now()
    where outgoings_devices.token_hash = excluded.token_hash
    returning 1
  )
  select exists (select 1 from saved);
$$;

create function public.outgoings_sync(
  p_id uuid, p_hash text, p_subscription jsonb, p_revision bigint, p_slots timestamptz[]
) returns boolean language plpgsql set search_path = '' as $$
declare
  saved_revision bigint;
begin
  select revision into saved_revision from public.outgoings_devices
  where id = p_id and token_hash = p_hash for update;
  if not found then return false; end if;
  if saved_revision > p_revision then return true; end if;
  update public.outgoings_devices set revision = p_revision, subscription = p_subscription, touched_at = now()
  where id = p_id;

  -- Preserve sent slots and any unchanged slot whose delivery is due or in flight.
  delete from public.outgoings_jobs
  where device_id = p_id and sent_at is null and claim_id is null and due_at > now()
    and not (due_at = any(p_slots));

  insert into public.outgoings_jobs (device_id, due_at)
  select p_id, slot from unnest(p_slots) as slot where slot > now()
  on conflict do nothing;
  return true;
end;
$$;

create function public.outgoings_claim_test(p_id uuid, p_hash text)
returns jsonb language sql set search_path = '' as $$
  update public.outgoings_devices set last_test = now()
  where id = p_id and token_hash = p_hash and (last_test is null or last_test < now() - interval '1 minute')
  returning subscription;
$$;

create function public.outgoings_claim_jobs()
returns table(device_id uuid, due_at timestamptz, claim_id uuid, subscription jsonb)
language sql set search_path = '' as $$
  with candidates as (
    select j.device_id, j.due_at from public.outgoings_jobs j
    where j.sent_at is null and j.due_at <= now() and j.due_at > now() - interval '6 hours'
      and (j.lease_until is null or j.lease_until < now())
    order by j.due_at
    limit 24
    for update skip locked
  ), claimed as (
    update public.outgoings_jobs j set lease_until = now() + interval '2 minutes', claim_id = gen_random_uuid()
    from candidates c where j.device_id = c.device_id and j.due_at = c.due_at
    returning j.device_id, j.due_at, j.claim_id
  )
  select c.device_id, c.due_at, c.claim_id, d.subscription
  from claimed c join public.outgoings_devices d on d.id = c.device_id;
$$;

create function public.outgoings_cleanup()
returns void language sql set search_path = '' as $$
  delete from public.outgoings_jobs where due_at < now() - interval '2 days';
  delete from public.outgoings_devices where touched_at < now() - interval '400 days';
$$;

revoke execute on function public.outgoings_enrol(uuid, text, jsonb),
  public.outgoings_sync(uuid, text, jsonb, bigint, timestamptz[]),
  public.outgoings_claim_test(uuid, text), public.outgoings_claim_jobs(), public.outgoings_cleanup()
from public, anon, authenticated;

grant execute on function public.outgoings_enrol(uuid, text, jsonb),
  public.outgoings_sync(uuid, text, jsonb, bigint, timestamptz[]),
  public.outgoings_claim_test(uuid, text), public.outgoings_claim_jobs(), public.outgoings_cleanup()
to service_role;
