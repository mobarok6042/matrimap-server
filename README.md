# MatriMap API

Express 5 + TypeScript API with MongoDB, Better Auth, Stripe Checkout and ImgBB.

## Run locally

```bash
cp .env.example .env        # Windows: Copy-Item .env.example .env
npm install
npm run dev                 # tsx watch — http://localhost:4000
```

Requires Node 20+ and a MongoDB server. Defaults to `mongodb://127.0.0.1:27017`.

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
| `MONGODB_URI` | `mongodb://127.0.0.1:27017` | Atlas SRV URI also works |
| `DB_NAME` | `matrimap` | — |
| `MONGODB_ENABLE_TRANSACTIONS` | `false` | Set to `true` for a replica set / sharded cluster |
| `BETTER_AUTH_SECRET` | dev-only fallback | Generate with `openssl rand -base64 32`; always set in production |
| `BETTER_AUTH_URL` | `http://localhost:4000` | **This server's** URL |
| `CLIENT_URL` | `http://localhost:3000` | Allowed CORS origin; comma-separated for multiple |
| `IMGBB_API_KEY` | empty | [Get a key](https://api.imgbb.com/) |
| `STRIPE_SECRET_KEY` | empty | [Stripe test keys](https://dashboard.stripe.com/test/apikeys) |
| `STRIPE_WEBHOOK_SECRET` | empty | From `stripe listen` or the Stripe dashboard |
| `STRIPE_SUCCESS_AMOUNT` | `999` | Example checkout amount in cents |

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
| POST | `/api/payments/checkout` | cookie | Creates a Stripe Checkout session, returns `{ id, url }` |
| POST | `/api/payments/webhook` | signature | Stripe webhook; needs raw body |

`GET /api/auth/ok` is a quick way to confirm the Better Auth mount is working.

## Integration notes

- **Better Auth** is mounted before `express.json()` because it needs the raw
  request stream. Express 5 uses the `/api/auth/{*splat}` wildcard. Auth tables
  are created automatically by the MongoDB adapter; no migrations needed.
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
├── models/                Mongoose Profile model
└── routes/                me, profiles, upload, payments
```
