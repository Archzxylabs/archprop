-- ARCHPROP initial schema, storage provisioning, and least-privilege policies.
-- BE-001. Idempotent: every statement is safe to re-run.
--
-- Scope notes:
--   * This database is cache/presentation only. Nothing here authorizes a chain
--     transition, token issuance, offering economics, balances, or claims.
--     `ArchpropRegistry` and `OfferingEscrow` remain authoritative on-chain.
--   * All hex values (asset ids, hashes, tx hashes, addresses) are stored as
--     lowercase `0x`-prefixed text and enforced by CHECK constraints so the
--     database cannot drift from the canonical on-chain representation.
--   * All economic values are exact whole-unit demo amounts (mIDR / AVNUSA use
--     0 decimals) and are stored in numeric(78,0), which is wide enough for any
--     uint256 without precision loss. No float or double columns exist.

-- ---------------------------------------------------------------------------
-- 0. Schema privileges
-- ---------------------------------------------------------------------------

grant usage on schema public to postgres, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1. users
-- ---------------------------------------------------------------------------

create table if not exists public.users (
  id             uuid primary key references auth.users (id) on delete cascade,
  email          text,
  wallet_address text,
  role           text not null default 'OWNER',
  created_at     timestamptz not null default now(),
  constraint users_wallet_address_format
    check (wallet_address is null or wallet_address ~ '^0x[0-9a-f]{40}$'),
  constraint users_role_allowed
    check (role in ('OWNER', 'VERIFIER', 'INVESTOR', 'ADMIN'))
);

-- Wallet address is a normalized identity anchor, so it is unique. Postgres
-- unique indexes permit multiple NULLs, which keeps wallet-less users valid.
create unique index if not exists users_wallet_address_key
  on public.users (wallet_address);

comment on column public.users.role is
  'Demo role only. ON-CHAIN authorization is never derived from this column.';

-- ---------------------------------------------------------------------------
-- 2. properties
-- ---------------------------------------------------------------------------

create table if not exists public.properties (
  id                 uuid primary key default gen_random_uuid(),
  chain_asset_id     text unique,
  owner_user_id      uuid not null references public.users (id) on delete restrict,
  external_id        text not null unique,
  name               text not null,
  slug               text not null unique,
  property_type      text not null,
  location           text not null,
  issuer_name        text not null,
  description        text not null,
  indicative_value   numeric(78, 0) not null check (indicative_value >= 0),
  offering_target    numeric(78, 0) not null check (offering_target >= 0),
  token_supply       numeric(78, 0) not null check (token_supply >= 0),
  token_price        numeric(78, 0) not null check (token_price >= 0),
  economic_rights_bps integer not null
    check (economic_rights_bps between 1 and 10000),
  status_cache       text not null default 'DRAFT',
  token_address      text,
  address_private    text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint properties_chain_asset_id_format
    check (chain_asset_id is null or chain_asset_id ~ '^0x[0-9a-f]{64}$'),
  constraint properties_token_address_format
    check (token_address is null or token_address ~ '^0x[0-9a-f]{40}$'),
  constraint properties_external_id_format
    check (external_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$'),
  constraint properties_slug_format
    check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint properties_status_cache_allowed
    check (status_cache in (
      'DRAFT', 'COMING_SOON', 'VERIFICATION_PENDING',
      'SUBMITTED', 'UNDER_VERIFICATION', 'VERIFIED', 'ISSUANCE_READY',
      'OFFERING', 'FUNDED', 'ACTIVE', 'REJECTED', 'FAILED'
    )),
  -- Frozen invariant from docs/INTERFACES.md: target == supply * price.
  constraint properties_target_invariant
    check (offering_target = token_supply * token_price)
);

create index if not exists properties_owner_user_id_idx
  on public.properties (owner_user_id);
create index if not exists properties_status_cache_idx
  on public.properties (status_cache);
-- Case-insensitive marketplace search over name/location/issuer.
create index if not exists properties_search_idx
  on public.properties
  using gin (to_tsvector('simple', name || ' ' || location || ' ' || issuer_name));

comment on column public.properties.status_cache is
  'CACHE ONLY. Presentation aid for the UI; contract reads are authoritative for every lifecycle and economic display.';
comment on column public.properties.address_private is
  'Never returned by any API route. Column-level grants withhold it from anon/authenticated.';
comment on column public.properties.chain_asset_id is
  'bytes32 asset id, set only after a wallet submits the asset on-chain.';

-- ---------------------------------------------------------------------------
-- 3. property_documents
-- ---------------------------------------------------------------------------

create table if not exists public.property_documents (
  id            uuid primary key default gen_random_uuid(),
  property_id   uuid not null references public.properties (id) on delete cascade,
  document_type text not null,
  storage_path  text not null unique,
  document_hash text not null,
  is_demo       boolean not null default true,
  uploaded_by   uuid references public.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  constraint property_documents_type_allowed
    check (document_type in (
      'LAND_RIGHT', 'APPRAISAL', 'BUILDING_PERMIT', 'ECONOMIC_RIGHTS_AGREEMENT'
    )),
  constraint property_documents_hash_format
    check (document_hash ~ '^0x[0-9a-f]{64}$'),
  -- MVP accepts synthetic demo evidence only.
  constraint property_documents_is_demo_enforced
    check (is_demo),
  -- Storage paths are server-generated and scoped to the owning property.
  constraint property_documents_path_scoped
    check (storage_path like property_id::text || '/%'),
  constraint property_documents_one_per_type
    unique (property_id, document_type)
);

create index if not exists property_documents_property_id_idx
  on public.property_documents (property_id);

comment on column public.property_documents.document_hash is
  'Lowercase 0x-prefixed SHA-256 of the exact uploaded bytes, computed server-side. Never client-supplied.';

-- ---------------------------------------------------------------------------
-- 4. property_images
-- ---------------------------------------------------------------------------

create table if not exists public.property_images (
  id          uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties (id) on delete cascade,
  storage_path text not null unique,
  sort_order  integer not null default 0 check (sort_order >= 0),
  created_at  timestamptz not null default now(),
  constraint property_images_path_scoped
    check (storage_path like property_id::text || '/%')
);

create index if not exists property_images_property_id_idx
  on public.property_images (property_id, sort_order);

-- ---------------------------------------------------------------------------
-- 5. chain_transactions
-- ---------------------------------------------------------------------------

create table if not exists public.chain_transactions (
  id           uuid primary key default gen_random_uuid(),
  property_id  uuid not null references public.properties (id) on delete cascade,
  tx_hash      text not null,
  event_name   text not null,
  block_number bigint check (block_number is null or block_number >= 0),
  log_index    integer not null default 0 check (log_index >= 0),
  created_at   timestamptz not null default now(),
  constraint chain_transactions_tx_hash_format
    check (tx_hash ~ '^0x[0-9a-f]{64}$'),
  -- A transaction may emit the same event more than once; log_index
  -- disambiguates and makes re-recording idempotent.
  constraint chain_transactions_unique_event
    unique (tx_hash, log_index)
);

create index if not exists chain_transactions_property_id_idx
  on public.chain_transactions (property_id);

comment on table public.chain_transactions is
  'Cache/reference index of observed on-chain events. Not authoritative; the chain is.';

-- ---------------------------------------------------------------------------
-- 6. revenue_epochs
-- ---------------------------------------------------------------------------

create table if not exists public.revenue_epochs (
  id                   uuid primary key default gen_random_uuid(),
  property_id          uuid not null references public.properties (id) on delete cascade,
  period               text not null,
  distributable_revenue numeric(78, 0) not null check (distributable_revenue >= 0),
  evidence_hash        text not null,
  chain_tx_hash        text not null,
  chain_epoch_id       numeric(78, 0) check (chain_epoch_id is null or chain_epoch_id >= 0),
  chain_block_number   bigint check (chain_block_number is null or chain_block_number >= 0),
  claim_deadline       bigint check (claim_deadline is null or claim_deadline > 0),
  created_at           timestamptz not null default now(),
  constraint revenue_epochs_period_format
    check (period ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  constraint revenue_epochs_evidence_hash_format
    check (evidence_hash ~ '^0x[0-9a-f]{64}$'),
  constraint revenue_epochs_tx_hash_format
    check (chain_tx_hash ~ '^0x[0-9a-f]{64}$'),
  constraint revenue_epochs_one_per_period
    unique (property_id, period),
  constraint revenue_epochs_one_per_chain_epoch
    unique (property_id, chain_epoch_id)
);

create index if not exists revenue_epochs_property_id_idx
  on public.revenue_epochs (property_id, created_at desc);

create index if not exists revenue_epochs_property_epoch_idx
  on public.revenue_epochs (property_id, chain_epoch_id);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'revenue_epochs_one_per_chain_epoch'
  ) then
    alter table public.revenue_epochs
      add constraint revenue_epochs_one_per_chain_epoch
      unique (property_id, chain_epoch_id);
  end if;
end
$$;

comment on table public.revenue_epochs is
  'Cache/reference record of a revenue epoch already published on-chain. The backend never makes a distribution authoritative off-chain and never performs a wallet write.';

-- ---------------------------------------------------------------------------
-- 7. updated_at maintenance
-- ---------------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists properties_touch_updated_at on public.properties;
create trigger properties_touch_updated_at
  before update on public.properties
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 8. Row level security
-- ---------------------------------------------------------------------------

alter table public.users             enable row level security;
alter table public.properties        enable row level security;
alter table public.property_documents enable row level security;
alter table public.property_images   enable row level security;
alter table public.chain_transactions enable row level security;
alter table public.revenue_epochs    enable row level security;

-- ---- users -----------------------------------------------------------------

-- Users can only SELECT their own mirror row.
-- Role and wallet identity fields are non-self-assignable in this MVP: direct
-- client INSERT, UPDATE, and DELETE are withheld. The mirror row is created
-- exclusively by the handle_new_auth_user trigger running under SECURITY DEFINER.
drop policy if exists users_select_own on public.users;
create policy users_select_own on public.users
  for select to authenticated using (id = auth.uid());

drop policy if exists users_insert_own on public.users;
drop policy if exists users_update_own on public.users;
drop policy if exists users_delete_own on public.users;

-- ---- properties ------------------------------------------------------------

-- Presentation metadata is public. `address_private` is withheld below by
-- column-level grants, so the public read policy cannot expose it.

drop policy if exists properties_select_public on public.properties;
create policy properties_select_public on public.properties
  for select to anon, authenticated using (true);

drop policy if exists properties_insert_own on public.properties;
create policy properties_insert_own on public.properties
  for insert to authenticated with check (owner_user_id = auth.uid());

drop policy if exists properties_update_own on public.properties;
create policy properties_update_own on public.properties
  for update to authenticated
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());

drop policy if exists properties_delete_own on public.properties;
create policy properties_delete_own on public.properties
  for delete to authenticated using (owner_user_id = auth.uid());

-- ---- property_documents (private evidence: owner only) ---------------------

create or replace function public.owns_property(target_property_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.properties p
    where p.id = target_property_id
      and p.owner_user_id = auth.uid()
  );
$$;

revoke all on function public.owns_property(uuid) from public;
revoke all on function public.owns_property(uuid) from anon;
grant execute on function public.owns_property(uuid) to authenticated, service_role;

drop policy if exists property_documents_select_owner on public.property_documents;
create policy property_documents_select_owner on public.property_documents
  for select to authenticated using (public.owns_property(property_id));

drop policy if exists property_documents_insert_owner on public.property_documents;
create policy property_documents_insert_owner on public.property_documents
  for insert to authenticated
  with check (public.owns_property(property_id) and uploaded_by = auth.uid());

drop policy if exists property_documents_delete_owner on public.property_documents;
create policy property_documents_delete_owner on public.property_documents
  for delete to authenticated using (public.owns_property(property_id));

-- ---- property_images (public marketplace media) ----------------------------

drop policy if exists property_images_select_public on public.property_images;
create policy property_images_select_public on public.property_images
  for select to anon, authenticated using (true);

drop policy if exists property_images_insert_owner on public.property_images;
create policy property_images_insert_owner on public.property_images
  for insert to authenticated with check (public.owns_property(property_id));

drop policy if exists property_images_delete_owner on public.property_images;
create policy property_images_delete_owner on public.property_images
  for delete to authenticated using (public.owns_property(property_id));

-- ---- chain_transactions (public cache of on-chain events) ------------------
-- The blockchain is authoritative for transactions and economic events.
-- Neither anon nor authenticated may directly create, update, or delete cache entries.
-- Writes are performed exclusively by server-side service role upon verified on-chain events.

drop policy if exists chain_transactions_select_public on public.chain_transactions;
create policy chain_transactions_select_public on public.chain_transactions
  for select to anon, authenticated using (true);

drop policy if exists chain_transactions_insert_owner on public.chain_transactions;
drop policy if exists chain_transactions_update_owner on public.chain_transactions;
drop policy if exists chain_transactions_delete_owner on public.chain_transactions;

-- ---- revenue_epochs (public cache of published epochs) ---------------------
-- The blockchain is authoritative for revenue epochs.
-- Neither anon nor authenticated may directly create, update, or delete cache entries.
-- Writes are performed exclusively by server-side service role in POST /api/demo/revenue
-- after verifying receipt, chain ID, matching distributor event, and owner authorization.

drop policy if exists revenue_epochs_select_public on public.revenue_epochs;
create policy revenue_epochs_select_public on public.revenue_epochs
  for select to anon, authenticated using (true);

drop policy if exists revenue_epochs_insert_owner on public.revenue_epochs;
drop policy if exists revenue_epochs_update_owner on public.revenue_epochs;
drop policy if exists revenue_epochs_delete_owner on public.revenue_epochs;

-- ---------------------------------------------------------------------------
-- 9. Column-level grants (least privilege; RLS alone cannot hide a column)
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.users from anon;
    revoke all on public.properties from anon;
    revoke all on public.property_documents from anon;
    revoke all on public.chain_transactions from anon;
    revoke all on public.revenue_epochs from anon;
    revoke all on public.property_images from anon;

    -- Public presentation columns only. `address_private` and `owner_user_id`
    -- are withheld from anon.
    grant select (
      id, chain_asset_id, external_id, name, slug, property_type, location,
      issuer_name, description, indicative_value, offering_target, token_supply,
      token_price, economic_rights_bps, status_cache, token_address, created_at
    ) on public.properties to anon;
    grant select on public.property_images to anon;
    grant select on public.chain_transactions to anon;
    grant select on public.revenue_epochs to anon;
  end if;

  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on public.users from authenticated;
    revoke all on public.properties from authenticated;
    revoke all on public.property_documents from authenticated;
    revoke all on public.chain_transactions from authenticated;
    revoke all on public.revenue_epochs from authenticated;
    revoke all on public.property_images from authenticated;

    -- Public presentation columns only. `address_private`, `owner_user_id`,
    -- and the private document table stay unreachable.
    grant select (
      id, chain_asset_id, external_id, name, slug, property_type, location,
      issuer_name, description, indicative_value, offering_target, token_supply,
      token_price, economic_rights_bps, status_cache, token_address, created_at
    ) on public.properties to authenticated;

    -- Property creation by authenticated owners. Grants only the exact columns
    -- inserted by POST /api/properties. RLS enforces owner_user_id = auth.uid().
    grant insert (
      owner_user_id, external_id, name, slug, property_type, location,
      issuer_name, description, indicative_value, offering_target, token_supply,
      token_price, economic_rights_bps, status_cache
    ) on public.properties to authenticated;

    -- Users table: authenticated callers may only SELECT their own mirror row.
    -- Role and wallet identity fields are non-self-assignable in this MVP:
    -- INSERT, UPDATE, and DELETE are strictly withheld.
    grant select on public.users to authenticated;
    grant select, insert, update, delete on public.property_images to authenticated;

    -- On-chain transaction and revenue cache tables: public presentation only.
    -- Blockchain is authoritative; direct INSERT, UPDATE, and DELETE by client roles
    -- (anon and authenticated) are strictly withheld to close write-bypass vulnerabilities.
    grant select on public.chain_transactions to authenticated;
    grant select on public.revenue_epochs to authenticated;
    grant select, insert, delete on public.property_documents to authenticated;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 11. Sync auth.users -> public.users
-- ---------------------------------------------------------------------------

-- The API resolves the caller from the Supabase JWT; a mirror row keeps
-- property ownership referentially sound without the client ever writing
-- public.users directly. SECURITY DEFINER is required because the trigger runs
-- during sign-up, before any user role can be granted on public.users.

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email, role)
  values (new.id, new.email, 'OWNER')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- ---------------------------------------------------------------------------
-- 12. Storage buckets
-- ---------------------------------------------------------------------------

-- Private evidence bucket. 10 MiB matches the API upload ceiling, and the
-- bucket is non-public so no object is reachable without an explicit grant.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('property-documents', 'property-documents', false, 10485760, array['application/pdf'])
on conflict (id) do update set
  public              = false,
  file_size_limit     = excluded.file_size_limit,
  allowed_mime_types  = excluded.allowed_mime_types;

-- Public marketplace image bucket.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('property-images', 'property-images', true, 5242880,
        array['image/png', 'image/jpeg', 'image/webp', 'image/avif'])
on conflict (id) do update set
  public              = true,
  file_size_limit     = excluded.file_size_limit,
  allowed_mime_types  = excluded.allowed_mime_types;

alter table storage.objects enable row level security;

-- Extracts the leading property UUID from a server-generated storage path.
-- Returns NULL (never raises) for anything else, so policies fail closed.
create or replace function public.storage_property_id(object_name text)
returns uuid
language plpgsql
immutable
security invoker
set search_path = public
as $$
begin
  if object_name ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/' then
    return split_part(object_name, '/', 1)::uuid;
  end if;
  return null;
exception
  when others then
    return null;
end;
$$;

-- ---- private bucket: property owner only -----------------------------------
-- Deliberately no policy grants `anon` any access, and no policy grants
-- `authenticated` blanket read. Evidence stays private.

drop policy if exists property_documents_storage_select on storage.objects;
create policy property_documents_storage_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'property-documents'
    and public.storage_property_id(name) is not null
    and public.owns_property(public.storage_property_id(name))
  );

drop policy if exists property_documents_storage_insert on storage.objects;
create policy property_documents_storage_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'property-documents'
    and public.storage_property_id(name) is not null
    and public.owns_property(public.storage_property_id(name))
  );

drop policy if exists property_documents_storage_update on storage.objects;
create policy property_documents_storage_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'property-documents'
    and public.storage_property_id(name) is not null
    and public.owns_property(public.storage_property_id(name))
  )
  with check (
    bucket_id = 'property-documents'
    and public.storage_property_id(name) is not null
    and public.owns_property(public.storage_property_id(name))
  );

drop policy if exists property_documents_storage_delete on storage.objects;
create policy property_documents_storage_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'property-documents'
    and public.storage_property_id(name) is not null
    and public.owns_property(public.storage_property_id(name))
  );

-- ---- public bucket: everyone reads, owners write ---------------------------

drop policy if exists property_images_storage_select on storage.objects;
create policy property_images_storage_select on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'property-images');

drop policy if exists property_images_storage_insert on storage.objects;
create policy property_images_storage_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'property-images'
    and public.storage_property_id(name) is not null
    and public.owns_property(public.storage_property_id(name))
  );

drop policy if exists property_images_storage_update on storage.objects;
create policy property_images_storage_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'property-images'
    and public.storage_property_id(name) is not null
    and public.owns_property(public.storage_property_id(name))
  )
  with check (
    bucket_id = 'property-images'
    and public.storage_property_id(name) is not null
    and public.owns_property(public.storage_property_id(name))
  );

drop policy if exists property_images_storage_delete on storage.objects;
create policy property_images_storage_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'property-images'
    and public.storage_property_id(name) is not null
    and public.owns_property(public.storage_property_id(name))
  );
