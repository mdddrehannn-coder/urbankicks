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
  locality text,
  address_line text,
  area text not null,
  house_no text not null,
  landmark text,
  address_type text not null default 'Home' check (address_type in ('Home', 'Work', 'Other')),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.addresses add column if not exists locality text;
alter table public.addresses add column if not exists address_line text;
alter table public.addresses add column if not exists area text;
alter table public.addresses add column if not exists house_no text;

update public.addresses
set
  locality = coalesce(nullif(locality, ''), nullif(area, ''), locality),
  address_line = coalesce(nullif(address_line, ''), nullif(house_no, ''), address_line),
  area = coalesce(nullif(area, ''), nullif(locality, ''), area),
  house_no = coalesce(nullif(house_no, ''), nullif(address_line, ''), house_no)
where locality is null or locality = '' or address_line is null or address_line = '' or area is null or area = '' or house_no is null or house_no = '';

create index if not exists addresses_user_id_idx on public.addresses(user_id);
create index if not exists addresses_user_default_idx on public.addresses(user_id, is_default desc);

alter table public.addresses
drop constraint if exists addresses_address_type_check;

alter table public.addresses
add constraint addresses_address_type_check
check (address_type in ('Home', 'Work', 'Other'));

alter table public.addresses
drop constraint if exists addresses_pincode_format_check;

alter table public.addresses
add constraint addresses_pincode_format_check
check (pincode ~ '^[0-9]{6}$');

alter table public.addresses
drop constraint if exists addresses_phone_format_check;

alter table public.addresses
add constraint addresses_phone_format_check
check (phone ~ '^\\+?[0-9]{10,15}$');

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
