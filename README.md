# MatriMap API

Express 5 + TypeScript API with MongoDB, Better Auth, Stripe Checkout and ImgBB.

## Run locally

```bash
cp .env.example .env        # Windows: Copy-Item .env.example .env
npm install
npm run dev                 # tsx watch — http://localhost:4000
```

Requires Node 20+ and a reachable MongoDB cluster. The supplied Atlas SRV URI is
stored in `.env`; make sure this machine's public IP is allowed in Atlas
**Network Access**.

Scripts:

| Command | Purpose |
| --- | --- |
| `npm run dev` | Watch mode via `tsx` |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run the compiled server |
| `npm run typecheck` | Type-check without emitting |

## Environment variables

| Variable | Default | Notes |
| --- | --- | --- |
| `NODE_ENV` | `development` | — |
| `PORT` | `4000` | — |
| `MONGODB_URI` | `mongodb://127.0.0.1:27017` | Atlas SRV URI configured in `.env` |
| `DB_NAME` | `matrimap` | — |
| `MONGODB_ENABLE_TRANSACTIONS` | `false` | `true` in `.env` (Atlas replica set) |
| `BETTER_AUTH_SECRET` | dev-only fallback | Supplied value is in `.env` |
| `BETTER_AUTH_URL` | `http://localhost:4000` | Next.js origin in `.env`; the proxy forwards auth requests here |
| `CLIENT_URL` | `http://localhost:3000` | Allowed CORS origin; comma-separated for multiple |
| `GOOGLE_CLIENT_ID` | empty | Supplied Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | empty | Supplied Google OAuth client secret |
| `IMGBB_API_KEY` | empty | Supplied key is configured in `.env` |
| `STRIPE_SECRET_KEY` | empty | Must be a test-mode `sk_test_…` key; live keys are rejected |
| `STRIPE_PUBLISHABLE_KEY` | empty | Stored server-side; hosted Checkout does not require exposing it to the client |
| `STRIPE_WEBHOOK_SECRET` | empty | From `stripe listen` or the Stripe dashboard |
| `STRIPE_SUCCESS_AMOUNT` | `999` | Legacy customer premium checkout amount in cents; vendor plan prices are configured in code |

## Endpoints

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/health` | public | Liveness check |
| * | `/api/auth/*` | — | Better Auth handler (sign-up, sign-in, session, …) |
| GET | `/api/me` | cookie | Current session |
| GET | `/api/profiles` | public | Latest 50 profiles |
| GET | `/api/profiles/me` | cookie | Current user's profile |
| POST | `/api/profiles` | cookie | Upsert profile (Zod-validated) |
| POST | `/api/upload/image` | cookie | Multipart field `image` → ImgBB (max 5 MB) |
| GET | `/api/payments/me` | vendor cookie | Returns current plan, service usage and plan catalog |
| POST | `/api/payments/checkout` | cookie | Creates a one-time Stripe Checkout session; vendors send `{ "plan": "basic" | "max" }` |
| GET | `/api/payments/session/:id` | owner cookie | Verifies a Stripe session and synchronizes vendor payment status |
| POST | `/api/payments/cancel` | vendor cookie | Switches to Free and deletes the vendor's stored plan transactions; does not refund the Stripe charge |
| POST | `/api/payments/webhook` | signature | Stripe webhook; needs raw body |
| GET | `/api/services` | public (vendors denied) | Lists approved services with active listings first |
| GET | `/api/services/:id` | public (vendors denied) | Returns an approved service, including inactive listings |
| POST | `/api/services` | vendor cookie | Creates a service pending admin approval; blocked vendors are rejected |
| POST | `/api/services/seed` | admin cookie | Loads example listings when the service collection is empty |
| GET | `/api/services/vendor/me` | vendor cookie | Lists the signed-in vendor's services |
| GET | `/api/services/:id/manage` | owning vendor cookie | Loads an owned service for editing |
| PUT | `/api/services/:id` | owning vendor cookie | Updates an owned service and resubmits it for admin review |
| DELETE | `/api/services/:id` | owning vendor cookie | Deletes an owned service |
| POST | `/api/bookings` | customer cookie | Creates a booking for an approved service; blocked customers are rejected |
| GET | `/api/bookings/me` | customer cookie | Lists the signed-in customer's bookings |
| GET | `/api/bookings/vendor/me` | vendor cookie | Lists booking requests for the signed-in vendor |
| GET | `/api/admin/services` | admin cookie | Lists all services and their review/availability status |
| POST | `/api/admin/services/:id/approve` | admin cookie | Approves a pending service for public display |
| POST | `/api/admin/services/:id/decline` | admin cookie | Declines a pending service |
| PATCH | `/api/admin/services/:id/availability` | admin cookie | Activates/deactivates an approved service |
| GET | `/api/admin/users` | admin cookie | Lists customer and vendor accounts |
| GET | `/api/admin/payments` | admin cookie | Lists vendor plan transactions with vendor, plan, amount, Stripe IDs, status and creation date |
| POST | `/api/admin/users/:id/block` | admin cookie | Blocks a customer/vendor from booking or creating services |
| POST | `/api/admin/users/:id/unblock` | admin cookie | Restores booking and service creation access |

`GET /api/auth/ok` is a quick way to confirm the Better Auth mount is working.

## Integration notes

- **Better Auth** is mounted before `express.json()` because it needs the raw
  request stream. Express 5 uses the `/api/auth/{*splat}` wildcard. Auth tables
  are created automatically by the MongoDB adapter; no migrations needed.
- **Google OAuth** is enabled when both Google variables are set. Register
  `http://localhost:3000/api/auth/callback/google` as an authorized redirect
  URI. New Google users get the internal `pending` role and choose Vendor or
  Customer on `/complete-profile`.
- **Password/role validation** runs in a `hooks.before` handler on
  `/sign-up/email`: 6+ characters with upper- and lowercase letters, and a
  `customer` or `vendor` role.
- **Admin access** is granted by setting a trusted Better Auth user's `role` to
  `admin` directly in the database. The sign-up flow does not allow choosing
  the admin role.
- **Service moderation** defaults new services to `pending`. Existing services
  without an approval status are also treated as pending. Public service cards
  include approved active and inactive listings, with active listings first;
  only active listings can be booked. Vendor edits return a listing to pending
  review.
- **Blocked accounts** cannot create, edit, or delete service listings or create
  booking requests.
  Admin block/unblock controls apply only to customer and vendor accounts.
- **Role access** is checked by the Next.js request proxy for protected pages
  and by Express middleware for role-specific API endpoints. Vendor service
  updates and deletions also verify ownership server-side. Vendors use their
  private My Services page instead of the public services catalog.
- **Vendor plans** are Free (3 services), Basic (10 services, USD 11.11 one-time),
  and Max (25 services, USD 19.99 one-time). The service API reserves plan
  capacity before creating each listing; paid limits are activated only by a
  verified `checkout.session.completed` event. Configure `STRIPE_SECRET_KEY`
  and `STRIPE_WEBHOOK_SECRET` in the server environment. Cancellation removes
  paid access and the vendor's stored plan transactions but does not refund
  one-time payments.
- **Stripe webhook** uses `express.raw()` and `stripe.webhooks.constructEvent`.
  For local development: `stripe listen --forward-to localhost:4000/api/payments/webhook`
  and copy the printed `whsec_…` value into `STRIPE_WEBHOOK_SECRET`.
- **ImgBB** receives the image as base64 from `multer.memoryStorage()`; nothing
  is written to disk.
- **Cross-origin cookies** work on localhost because both apps share the
  `localhost` site. For different production domains, configure Better Auth's
  cookie `sameSite: "none"` + `secure: true` and use HTTPS.

## Layout

```
src/
├── app.ts                 Express app (middleware order matters)
├── server.ts              DB connection + HTTP listener + graceful shutdown
├── config/                env validation, MongoDB / Mongoose connections
├── lib/                   auth, Stripe, ImgBB, errors
├── middleware/            requireAuth, 404 + error handlers
├── models/                Mongoose profile, service and booking models
└── routes/                me, profiles, services, bookings, admin, upload, payments
```
