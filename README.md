# Urban Kicks

Urban Kicks is an online shoe selling ecommerce website powered by Node.js, Express, Supabase Auth, Supabase Database, and a responsive JavaScript storefront.

## Stack

- Node.js + Express backend
- Supabase Auth for signup, login, logout, and persistent sessions
- Supabase database tables for profiles, addresses, cart items, orders, order items, wishlist, products, and transactions
- Mobile-first HTML/CSS/JavaScript SPA frontend
- Cash on Delivery checkout only

## Setup

1. Install dependencies:

```bash
npm install
```

The project declares `@supabase/supabase-js`; the current backend uses Supabase REST/Auth endpoints directly so the app can run without import errors.

2. Environment config is already created in `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=qvpkiusazqthlxwvesjk
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_xSR_T86GWskZwc6gejMSyw_ZOqg4XYb
```

3. Create the Supabase tables:

Open your Supabase project SQL editor and run:

```text
supabase/schema.sql
```

4. Seed product data:

```bash
npm run seed
```

5. Start the development server:

```bash
npm run dev
```

Open `http://localhost:5000`.

## Routes

- `GET /api/products` lists products and supports `brand`, `category`, and `q` filters.
- `GET /api/products/:id` gets product detail.
- `POST /api/products`, `PUT /api/products/:id`, `DELETE /api/products/:id` manage products.
- `POST /api/auth/signup` is disabled; the storefront uses browser Email OTP auth only.
- `POST /api/auth/login` is disabled; the storefront uses browser Email OTP auth only.
- `POST /api/auth/logout` logs out.
- `POST /api/auth/refresh` refreshes persistent sessions.
- `GET /api/auth/status` checks auth wiring.
- `GET /api/auth/me` reads the current Supabase user.
- Frontend auth uses the official browser Supabase client methods:
  - `supabase.auth.signUp()` for account creation and signup OTP
  - `supabase.auth.signInWithPassword()` for normal login
  - `supabase.auth.resetPasswordForEmail()` for recovery OTP
  - `supabase.auth.verifyOtp()` for manual signup/recovery code verification
  - `supabase.auth.signOut()`
  - `supabase.auth.getSession()`
  - `supabase.auth.onAuthStateChange()`
- Supabase email templates must show `{{ .Token }}` only and must not include clickable authentication URLs. See `supabase/email-otp-template.md`.
- Supabase Auth must allow new user signups for OTP signup to work. If Supabase returns `Signup not allowed for OTP`, enable signups/email OTP in the Supabase Authentication settings.
- `GET /api/wishlist`, `POST /api/wishlist`, `DELETE /api/wishlist/:productId` sync wishlist.
- `GET /api/cart`, `POST /api/cart`, `PATCH /api/cart/:id`, `DELETE /api/cart/:id` sync logged-in user cart rows.
- `POST /api/orders` creates a Cash on Delivery order from the logged-in user's Supabase cart, writes related `order_items`, clears `cart_items`, and creates a transaction record.
- `GET /api/orders/mine` shows user order history.
- `GET /api/transactions` shows user transaction records.

## Database

The required tables are defined in `supabase/schema.sql`:

- `users`
- `profiles`
- `products`
- `wishlist`
- `addresses`
- `cart_items`
- `orders`
- `order_items`
- `transactions`

The schema includes an auth trigger that creates a matching `public.users` profile whenever Supabase Auth creates a new account. Run the latest `supabase/schema.sql` in Supabase SQL Editor after auth changes.

## Supabase Auth Checklist

In Supabase Dashboard:

1. Open `Authentication -> Providers -> Email`.
2. Make sure Email provider is enabled.
3. If email confirmation is enabled, users must confirm their email before login.
4. Add these redirect URLs under `Authentication -> URL Configuration`:

```text
http://localhost:5000
http://localhost:5000/
http://localhost:5000/#/auth
https://your-production-domain.com
https://your-production-domain.com/#/auth
```

## Admin

Open `http://localhost:5000/#/admin`.

The admin panel can add, edit, delete products, upload images, manage stock, view orders, and update order status. Use Supabase row-level security policies and authenticated accounts before production launch.
