# Arbor Vitae: Where Neurology Meets ENT

Single-page announcement site for the NSIG x ENTIG joint clinical workshop
(PNU, Saturday 5 December 2026). The whole page is one procedurally
stippled tree drawn on `<canvas>`; its branches are the navigation.

## Edit

- **Registration link:** `REGISTER_URL` in `src/content.js`. Until it is a real
  `https://` link the register button reads "registration opens soon".
- **Logos:** drop `nsig-logo.png` and `entig-logo.png` into `public/`. Until then
  a small text badge stands in for each.
- **Station copy:** `src/content.js`.
- **Share URL:** `VITE_SITE_URL` in `.env` (used for absolute Open Graph URLs).

## Run

```sh
npm install
npm run dev      # http://localhost:5173
npm run build    # outputs dist/
```

## Share image

`public/og-image.jpg` is rendered from `scripts/og.html` with the same tree
engine. With the dev server running: `node scripts/make-og.cjs`.

## Deploy

Vercel detects Vite automatically: `npx vercel --prod`.
