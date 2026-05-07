create extension if not exists "pgcrypto";

create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default 'Urban Kicks Member',
  email text,
  mobile text,
  role text not null default 'customer' check (role in ('customer', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, name, email, mobile, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', 'Urban Kicks Member'),
    new.email,
    coalesce(new.phone, new.raw_user_meta_data->>'mobile', ''),
    'customer'
  )
  on conflict (id) do update set
    name = excluded.name,
    email = excluded.email,
    mobile = excluded.mobile,
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

create policy "Anyone can read products" on public.products for select using (true);
create policy "Authenticated users can manage products" on public.products for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create policy "Users can read own profile" on public.users for select using (auth.uid() = id);
create policy "Users can insert own profile" on public.users for insert with check (auth.uid() = id);
create policy "Users can update own profile" on public.users for update using (auth.uid() = id) with check (auth.uid() = id);

create policy "Users can read own wishlist" on public.wishlist for select using (auth.uid() = user_id);
create policy "Users can insert own wishlist" on public.wishlist for insert with check (auth.uid() = user_id);
create policy "Users can delete own wishlist" on public.wishlist for delete using (auth.uid() = user_id);

create policy "Users can read own orders" on public.orders for select using (auth.uid() = user_id or user_id is null);
create policy "Users can create own orders" on public.orders for insert with check (auth.uid() = user_id or user_id is null);
create policy "Authenticated users can update orders" on public.orders for update using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create policy "Users can read own transactions" on public.transactions for select using (auth.uid() = user_id or user_id is null);
create policy "Users can create own transactions" on public.transactions for insert with check (auth.uid() = user_id or user_id is null);
