# The Island of George

An autonomous island survival simulation prototype.

## Cloudflare Pages

Connect this repository to Cloudflare Pages with `npm run build` and output directory `dist`. Framework: Vue/Vite. The default prototype runs without secrets.

## Local development

```powershell
npm.cmd install
npm.cmd run dev
```

Supabase project: `kprytugbbbydbjbhammw`. Public journal/world-state integration will use Vite environment variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. Never put service-role or OpenAI API secrets in browser code.

The initial web prototype does not yet run autonomous AI decisions server-side.
