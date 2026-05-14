create extension if not exists "pgcrypto";

create table if not exists public.addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  full_name text not null,
  phone text not null,
  alternate_phone text,
  pincode text not null,
  state text not null,
  city text not null,
  area text not null,
  house_no text not null,
  landmark text,
  address_type text not null default 'Home' check (address_type in ('Home', 'Work', 'Other')),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists addresses_user_id_idx on public.addresses(user_id);
create index if not exists addresses_user_default_idx on public.addresses(user_id, is_default desc);

alter table public.addresses
drop constraint if exists addresses_address_type_check;

alter table public.addresses
add constraint addresses_address_type_check
check (address_type in ('Home', 'Work', 'Other'));

create unique index if not exists one_default_address_per_user
on public.addresses(user_id)
where is_default = true;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_addresses_updated_at on public.addresses;
create trigger set_addresses_updated_at
before update on public.addresses
for each row execute function public.set_updated_at();

alter table public.addresses enable row level security;

drop policy if exists "Users can read own addresses" on public.addresses;
create policy "Users can read own addresses"
on public.addresses for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert own addresses" on public.addresses;
create policy "Users can insert own addresses"
on public.addresses for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update own addresses" on public.addresses;
create policy "Users can update own addresses"
on public.addresses for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete own addresses" on public.addresses;
create policy "Users can delete own addresses"
on public.addresses for delete
using (auth.uid() = user_id);
