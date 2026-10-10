# Vercel deployment

Import `Archzxylabs/archprop` and deploy the `main` branch with these settings:

| Setting | Value |
| --- | --- |
| Framework Preset | Next.js |
| Root Directory | `apps/web` |
| Include source files outside the Root Directory in the Build Step | Enabled |
| Node.js Version | `24.x` |
| Output Directory | Framework default (`.next`) |
| Environment variable | `ENABLE_EXPERIMENTAL_COREPACK=1` |

`apps/web/vercel.json` installs from the workspace root using the committed
lockfile, then builds the Next.js app with Webpack (`pnpm build`). The build
runs full TypeScript checks using the pinned TypeScript 5.9 compiler API.
Corepack uses the existing root
`packageManager` pin (`pnpm@12.9.1`). The Next.js configuration includes
`packages/chain` and `packages/shared` outside the app directory when building
and tracing server files.

The workspace records build-script approvals for the pinned native dependencies
in `pnpm-workspace.yaml`. Keep these approvals committed: pnpm rejects unreviewed
dependency build scripts during the Vercel install step.

The landing page `/` renders without RPC or Supabase credentials. To enable
chain reads and backend features, configure the existing variables from
`.env.example` in Vercel. `NEXT_PUBLIC_*` values must be present at build time;
redeploy after changing them. Keep `SUPABASE_SERVICE_ROLE_KEY` server-only.

After deployment, open `/` and confirm the hero, property cards, and footer load.
For a submission, use a deployment URL that visitors can open without signing
in to Vercel.

References: [Vercel monorepo settings](https://vercel.com/docs/monorepos/monorepo-faq),
[package manager selection](https://vercel.com/docs/package-managers).
