# MatriMap Server

The MatriMap server is the Express API and authentication service for the
MatriMap web application. It handles sessions, profiles, service listings,
bookings, vendor plans, Stripe Checkout, image uploads, and admin operations.

## Technology

- Node.js, Express 5, and TypeScript
- MongoDB through the native driver and Mongoose
- Better Auth with the MongoDB adapter
- Stripe hosted Checkout and signed webhooks
- ImgBB for uploaded images

## Requirements

- Node.js 20 or newer and npm
- A reachable MongoDB instance (local MongoDB or MongoDB Atlas)
- Stripe test-mode credentials to create Checkout sessions

## Run locally

From this directory, create a local environment file, configure MongoDB, and
start the API:

```powershell
Copy-Item .env.example .env
npm install
npm run dev
```

On macOS or Linux, use `cp .env.example .env` instead of `Copy-Item`.

The API listens on [http://localhost:4000](http://localhost:4000) by default.
Start the client separately; see the
[client guide](../matrimap-client/README.md).

## Environment configuration

Set values in `.env`; do not commit this file or put server secrets in the
client's environment. `.env.example` contains placeholders rather than usable
credentials.

| Variable | Local example/default | Purpose |
| --- | --- | --- |
| `NODE_ENV` | `development` | Runtime environment |
| `PORT` | `4000` | HTTP port |
| `MONGODB_URI` | `mongodb://127.0.0.1:27017` | MongoDB connection string |
| `DB_NAME` | `matrimap` | Database name |
| `MONGODB_ENABLE_TRANSACTIONS` | `false` in the schema; example sets `true` | Enables transaction support for the Better Auth MongoDB adapter; the deployment must support MongoDB transactions. |
| `BETTER_AUTH_SECRET` | Local development fallback | Use a unique random value of at least 32 characters outside local development. |
| `BETTER_AUTH_URL` | `http://localhost:3000` in the example | Canonical client origin for Better Auth. Align it with the Next.js app origin. |
| `CLIENT_URL` | `http://localhost:3000` | Allowed client origin(s); separate multiple origins with commas. |
| `GOOGLE_CLIENT_ID` | Empty | Optional Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Empty | Optional Google OAuth client secret; Google is enabled only when both OAuth values are set. |
| `IMGBB_API_KEY` | Empty | Optional ImgBB image-upload key |
| `STRIPE_SECRET_KEY` | Empty | Stripe test secret key. Checkout requires a key beginning with `sk_test_`; live mode is not enabled. |
| `STRIPE_PUBLISHABLE_KEY` | Empty | Not used by the current hosted Checkout flow. |
| `STRIPE_WEBHOOK_SECRET` | Empty | Signing secret from the Stripe CLI or dashboard for webhook verification. |
| `STRIPE_SUCCESS_AMOUNT` | `999` cents | Amount for the generic one-time checkout; vendor plan prices are configured in server code. |

For Google sign-in, register
`http://localhost:3000/api/auth/callback/google` as an authorized redirect URI.
Keep the frontend origin consistent across `BETTER_AUTH_URL`, `CLIENT_URL`,
and the client's `NEXT_PUBLIC_SERVER_URL`.

## API overview

All protected routes require a valid Better Auth session cookie. Role-specific
routes also enforce permissions on the server. An authenticated request checks
the current account's blocked status before reaching protected API features.

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| `GET` | `/health` | Public | Liveness endpoint |
| `*` | `/api/auth/*` | Better Auth | Sign-up, sign-in, sign-out, session, and OAuth |
| `GET` | `/api/me` | Signed-in account | Return the current session |
| `GET` | `/api/profiles` | Public | List recent profiles |
| `GET` | `/api/profiles/me` | Signed-in account | Read the current user's profile |
| `POST` | `/api/profiles` | Signed-in account | Create or update the current user's profile |
| `POST` | `/api/upload/image` | Signed-in account | Upload an image to ImgBB; multipart field `image`, maximum 5 MB |
| `GET` | `/api/services` | Public; vendors are denied | List approved services |
| `GET` | `/api/services/:id` | Public; vendors are denied | Read an approved service |
| `GET` | `/api/services/vendor/me` | Vendor | List the signed-in vendor's services |
| `GET` | `/api/services/:id/manage` | Owning vendor | Read an owned service for editing |
| `POST` | `/api/services` | Vendor | Create a service, subject to plan limit and admin approval |
| `PUT` | `/api/services/:id` | Owning vendor | Update a service and resubmit it for review |
| `DELETE` | `/api/services/:id` | Owning vendor | Delete a service |
| `POST` | `/api/services/seed` | Admin | Add sample services when the collection is empty |
| `POST` | `/api/bookings` | Customer | Request a booking for an available service |
| `GET` | `/api/bookings/me` | Customer | List the signed-in customer's bookings |
| `GET` | `/api/bookings/vendor/me` | Vendor | List requests for the signed-in vendor |
| `POST` | `/api/bookings/:id/accept` | Owning vendor | Accept a booking request |
| `POST` | `/api/bookings/:id/decline` | Owning vendor | Decline a booking request |
| `GET` | `/api/payments/me` | Vendor | Read the vendor plan, service count, and plan catalog |
| `POST` | `/api/payments/checkout` | Customer or vendor | Create a one-time Stripe Checkout session; vendors send `{ "plan": "basic" }` or `{ "plan": "max" }`. |
| `GET` | `/api/payments/session/:id` | Session owner | Verify a Checkout session and synchronize payment status |
| `POST` | `/api/payments/cancel` | Vendor | Switch to Free and delete stored plan transactions; does not refund payment |
| `POST` | `/api/payments/webhook` | Valid Stripe signature | Receive verified Stripe Checkout events |
| `GET` | `/api/admin/services` | Admin | List and moderate services |
| `GET` | `/api/admin/users` | Admin | List customer and vendor accounts |
| `POST` | `/api/admin/users/:id/block` | Admin | Block a customer or vendor account |
| `POST` | `/api/admin/users/:id/unblock` | Admin | Restore account access |
| `GET` | `/api/admin/payments` | Admin | List vendor plan transactions |

Admin service moderation also includes `POST /api/admin/services/:id/approve`,
`POST /api/admin/services/:id/decline`, and
`PATCH /api/admin/services/:id/availability`.

## Authorization and data rules

- Sign-up allows Customer or Vendor roles only. New OAuth accounts choose a
  role during onboarding. Server-side validation prevents changing an assigned
  role through the regular account-update endpoint.
- Admin routes require the `admin` role. Grant this role only to trusted users
  through a controlled database operation; it is not available during sign-up.
- Service and booking endpoints enforce customer/vendor roles and verify
  ownership before vendor actions.
- Blocked accounts are denied protected authenticated API requests. Public
  discovery endpoints remain public.
- New services require admin approval. Editing a service sends it back for
  review; only approved and available services can be booked.

Application data uses Mongoose models for profiles, services, bookings,
vendor plans, and payment transactions. Better Auth stores users, sessions,
and accounts in MongoDB using its adapter.

## Vendor plans and payments

Plan limits and one-time prices are server-defined:

| Plan | Service limit | Price |
| --- | ---: | ---: |
| Free | 3 | Free |
| Basic | 10 | USD 11.11 |
| Max | 25 | USD 19.99 |

Service creation reserves a plan slot on the server. A paid plan activates
after a verified Stripe webhook or authenticated Checkout-session verification.
Transaction records include vendor, plan, amount, currency, Stripe session and
subscription IDs, status, and creation time. Plans use one-time payments, so a
Stripe subscription ID is normally absent.

Cancellation changes the plan to Free and deletes the vendor's stored plan
transactions. It does not issue a Stripe refund.

To receive local webhooks, install the Stripe CLI, then run:

```bash
stripe listen --forward-to http://localhost:4000/api/payments/webhook
```

Copy the `whsec_…` value printed by the CLI into `STRIPE_WEBHOOK_SECRET`.
The authenticated Checkout-session endpoint can reconcile session status when
a webhook is unavailable; configure webhooks for reliable asynchronous updates.

## Development commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Run the API with `tsx` watch mode |
| `npm run typecheck` | Type-check without emitting files |
| `npm run build` | Compile TypeScript into `dist/` |
| `npm start` | Run the compiled server |

## Project layout

```text
src/
├── app.ts          Express middleware and route mounting
├── server.ts       Database startup, HTTP listener, and shutdown
├── config/         Environment validation and MongoDB connections
├── lib/            Better Auth, Stripe, ImgBB, plans, and errors
├── middleware/     Authentication, role checks, and error handling
├── models/         Mongoose application-data models
└── routes/         Profiles, services, bookings, payments, admin, and upload
```

## Operational notes

- Better Auth is mounted before JSON body parsing. Stripe webhooks are also
  mounted with a raw body parser so signatures can be verified.
- The server starts its HTTP listener even if MongoDB is temporarily
  unavailable; database-backed requests will fail until the connection returns.
- Use HTTPS, a strong `BETTER_AUTH_SECRET`, an explicit `CLIENT_URL` allowlist,
  and protected environment variables in deployed environments.
- The current Stripe integration is restricted to test mode. Do not treat it
  as production payment processing.
