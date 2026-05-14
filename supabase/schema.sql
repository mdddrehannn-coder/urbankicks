create extension if not exists "pgcrypto";

create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default 'Urban Kicks Member',
  full_name text not null default 'Urban Kicks Member',
  email text,
  mobile text,
  phone_number text,
  profile_image text,
  role text not null default 'customer' check (role in ('customer', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.users add column if not exists full_name text not null default 'Urban Kicks Member';
alter table public.users add column if not exists phone_number text;
alter table public.users add column if not exists profile_image text;

update public.users
set
  full_name = coalesce(nullif(full_name, ''), nullif(name, ''), 'Urban Kicks Member'),
  phone_number = coalesce(nullif(phone_number, ''), nullif(mobile, ''), '')
where full_name is null or full_name = '' or phone_number is null;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, name, full_name, email, mobile, phone_number, profile_image, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', 'Urban Kicks Member'),
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', 'Urban Kicks Member'),
    new.email,
    coalesce(new.phone, new.raw_user_meta_data->>'phone_number', new.raw_user_meta_data->>'mobile', ''),
    coalesce(new.phone, new.raw_user_meta_data->>'phone_number', new.raw_user_meta_data->>'mobile', ''),
    coalesce(new.raw_user_meta_data->>'profile_image', ''),
    'customer'
  )
  on conflict (id) do update set
    name = excluded.name,
    full_name = excluded.full_name,
    email = excluded.email,
    mobile = excluded.mobile,
    phone_number = excluded.phone_number,
    profile_image = excluded.profile_image,
    updated_at = now();

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  brand text not null,
  category text not null,
  price numeric(12, 2) not null check (price >= 0),
  discount_percent numeric(5, 2) not null default 0 check (discount_percent >= 0 and discount_percent <= 90),
  image text not null,
  image_url text not null,
  gallery text[] not null default '{}',
  description text not null,
  sizes text[] not null default '{}',
  colors text[] not null default '{}',
  color text not null default '',
  material text not null default '',
  stock integer not null default 0 check (stock >= 0),
  rating numeric(3, 2) not null default 4.60 check (rating >= 0 and rating <= 5),
  review_count integer not null default 0 check (review_count >= 0),
  delivery_estimate text not null default '2-5 business days',
  cod_available boolean not null default true,
  featured boolean not null default false,
  trending boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.wishlist (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, product_id)
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  customer jsonb not null,
  items jsonb not null,
  subtotal numeric(12, 2) not null,
  shipping numeric(12, 2) not null default 0,
  total numeric(12, 2) not null,
  payment_method text not null default 'Cash on Delivery' check (payment_method = 'Cash on Delivery'),
  payment_reference text not null default '',
  status text not null default 'Pending' check (status in ('Pending', 'Confirmed', 'Shipped', 'Delivered', 'Cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.orders(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  amount numeric(12, 2) not null,
  payment_method text not null default 'Cash on Delivery' check (payment_method = 'Cash on Delivery'),
  status text not null default 'pending' check (status in ('pending', 'paid', 'failed', 'refunded')),
  reference text not null default '',
  created_at timestamptz not null default now()
);

alter table public.users enable row level security;
alter table public.products enable row level security;
alter table public.wishlist enable row level security;
alter table public.orders enable row level security;
alter table public.transactions enable row level security;

drop policy if exists "Anyone can read products" on public.products;
create policy "Anyone can read products" on public.products for select using (true);
drop policy if exists "Authenticated users can manage products" on public.products;
create policy "Authenticated users can manage products" on public.products for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "Users can read own profile" on public.users;
create policy "Users can read own profile" on public.users for select using (auth.uid() = id);
drop policy if exists "Users can insert own profile" on public.users;
create policy "Users can insert own profile" on public.users for insert with check (auth.uid() = id);
drop policy if exists "Users can update own profile" on public.users;
create policy "Users can update own profile" on public.users for update using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "Users can read own wishlist" on public.wishlist;
create policy "Users can read own wishlist" on public.wishlist for select using (auth.uid() = user_id);
drop policy if exists "Users can insert own wishlist" on public.wishlist;
create policy "Users can insert own wishlist" on public.wishlist for insert with check (auth.uid() = user_id);
drop policy if exists "Users can delete own wishlist" on public.wishlist;
create policy "Users can delete own wishlist" on public.wishlist for delete using (auth.uid() = user_id);

drop policy if exists "Users can read own orders" on public.orders;
create policy "Users can read own orders" on public.orders for select using (auth.uid() = user_id);
drop policy if exists "Users can create own orders" on public.orders;
create policy "Users can create own orders" on public.orders for insert with check (auth.uid() = user_id);
drop policy if exists "Authenticated users can update orders" on public.orders;
create policy "Authenticated users can update orders" on public.orders for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users can read own transactions" on public.transactions;
create policy "Users can read own transactions" on public.transactions for select using (auth.uid() = user_id);
drop policy if exists "Users can create own transactions" on public.transactions;
create policy "Users can create own transactions" on public.transactions for insert with check (auth.uid() = user_id);

-- Urban Kicks connected ecommerce core
-- Run this full file in Supabase SQL Editor. It keeps legacy storefront columns while adding
-- normalized profile, address, cart, order, and order item tables for dashboard visibility.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  email text,
  phone text,
  created_at timestamp default now()
);

alter table public.profiles enable row level security;

drop policy if exists "Users can read own profile row" on public.profiles;
create policy "Users can read own profile row"
on public.profiles for select
using (auth.uid() = id);

drop policy if exists "Users can insert own profile row" on public.profiles;
create policy "Users can insert own profile row"
on public.profiles for insert
with check (auth.uid() = id);

drop policy if exists "Users can update own profile row" on public.profiles;
create policy "Users can update own profile row"
on public.profiles for update
using (auth.uid() = id)
with check (auth.uid() = id);

create table if not exists public.addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  full_name text not null,
  phone text not null,
  state text not null,
  city text not null,
  pincode text not null,
  locality text,
  address_line text,
  landmark text,
  is_default boolean default false,
  created_at timestamp default now()
);

alter table public.addresses add column if not exists alternate_phone text;
alter table public.addresses add column if not exists locality text;
alter table public.addresses add column if not exists address_line text;
alter table public.addresses add column if not exists area text;
alter table public.addresses add column if not exists house_no text;
alter table public.addresses add column if not exists address_type text not null default 'Home';
alter table public.addresses add column if not exists updated_at timestamptz not null default now();

update public.addresses
set
  locality = coalesce(nullif(locality, ''), nullif(area, ''), locality),
  address_line = coalesce(nullif(address_line, ''), nullif(house_no, ''), address_line),
  area = coalesce(nullif(area, ''), nullif(locality, ''), area),
  house_no = coalesce(nullif(house_no, ''), nullif(address_line, ''), house_no)
where locality is null or locality = '' or address_line is null or address_line = '' or area is null or area = '' or house_no is null or house_no = '';

alter table public.addresses alter column area set default '';
alter table public.addresses alter column house_no set default '';

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

create index if not exists addresses_user_id_idx on public.addresses(user_id);
create index if not exists addresses_user_default_idx on public.addresses(user_id, is_default desc);
create unique index if not exists one_default_address_per_user
on public.addresses(user_id)
where is_default = true;

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

create table if not exists public.cart_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id text not null,
  product_name text not null,
  brand text,
  size text default '',
  color text default '',
  quantity integer default 1 check (quantity > 0),
  price numeric not null,
  original_price numeric,
  image_url text,
  created_at timestamp default now()
);

create index if not exists cart_items_user_id_idx on public.cart_items(user_id);
create unique index if not exists cart_items_user_product_variant_idx
on public.cart_items(user_id, product_id, coalesce(size, ''), coalesce(color, ''));

alter table public.cart_items enable row level security;

drop policy if exists "Users can read own cart items" on public.cart_items;
create policy "Users can read own cart items"
on public.cart_items for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert own cart items" on public.cart_items;
create policy "Users can insert own cart items"
on public.cart_items for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update own cart items" on public.cart_items;
create policy "Users can update own cart items"
on public.cart_items for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete own cart items" on public.cart_items;
create policy "Users can delete own cart items"
on public.cart_items for delete
using (auth.uid() = user_id);

alter table public.orders add column if not exists address_id uuid references public.addresses(id) on delete set null;
alter table public.orders add column if not exists total_amount numeric;
alter table public.orders add column if not exists payment_status text default 'pending';
alter table public.orders add column if not exists order_status text default 'placed';

update public.orders
set total_amount = coalesce(total_amount, total)
where total_amount is null;

alter table public.orders
drop constraint if exists orders_payment_method_check;
alter table public.orders
alter column payment_method set default 'UPI';
alter table public.orders
add constraint orders_payment_method_check
check (payment_method in ('UPI', 'COD', 'Cash on Delivery'));

drop policy if exists "Users can read own orders" on public.orders;
drop policy if exists "Users can create own orders" on public.orders;
drop policy if exists "Authenticated users can update orders" on public.orders;

create policy "Users can read own orders"
on public.orders for select
using (auth.uid() = user_id);

create policy "Users can create own orders"
on public.orders for insert
with check (auth.uid() = user_id);

create policy "Users can update own orders"
on public.orders for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id text not null,
  product_name text not null,
  size text,
  color text,
  quantity integer not null check (quantity > 0),
  price numeric not null,
  image_url text
);

create index if not exists order_items_order_id_idx on public.order_items(order_id);

alter table public.order_items enable row level security;

drop policy if exists "Users can read own order items" on public.order_items;
create policy "Users can read own order items"
on public.order_items for select
using (
  exists (
    select 1 from public.orders
    where orders.id = order_items.order_id
    and orders.user_id = auth.uid()
  )
);

drop policy if exists "Users can insert own order items" on public.order_items;
create policy "Users can insert own order items"
on public.order_items for insert
with check (
  exists (
    select 1 from public.orders
    where orders.id = order_items.order_id
    and orders.user_id = auth.uid()
  )
);

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, name, full_name, email, mobile, phone_number, profile_image, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', 'Urban Kicks Member'),
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', 'Urban Kicks Member'),
    new.email,
    coalesce(new.phone, new.raw_user_meta_data->>'phone_number', new.raw_user_meta_data->>'mobile', ''),
    coalesce(new.phone, new.raw_user_meta_data->>'phone_number', new.raw_user_meta_data->>'mobile', ''),
    coalesce(new.raw_user_meta_data->>'profile_image', ''),
    'customer'
  )
  on conflict (id) do update set
    name = excluded.name,
    full_name = excluded.full_name,
    email = excluded.email,
    mobile = excluded.mobile,
    phone_number = excluded.phone_number,
    profile_image = excluded.profile_image,
    updated_at = now();

  insert into public.profiles (id, full_name, email, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', 'Urban Kicks Member'),
    new.email,
    coalesce(new.phone, new.raw_user_meta_data->>'phone_number', new.raw_user_meta_data->>'mobile', '')
  )
  on conflict (id) do update set
    full_name = excluded.full_name,
    email = excluded.email,
    phone = excluded.phone;

  return new;
end;
$$;
