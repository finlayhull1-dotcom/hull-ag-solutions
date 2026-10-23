HULL AG SOLUTIONS V36 — CLOUDFLARE PAGES + SENTINEL-2 NDVI

This is the migrated V36 app. The NDVI endpoint is a Cloudflare Pages Function at /api/ndvi.

IMPORTANT: The Copernicus credentials are not included. Do not put secrets in HTML or upload them in this ZIP.

RECOMMENDED DEPLOYMENT (Git repository):
1. Make a private GitHub repository and upload this folder’s CONTENTS to its root (including functions/api/ndvi.js).
2. In Cloudflare dashboard > Workers & Pages > Create > Pages > Connect to Git, select the repo.
3. Framework preset: None; build command: leave blank; output directory: / (or use the root directory as specified by Cloudflare UI).
4. After creating project, go to Settings > Variables and Secrets. Add SENTINEL_CLIENT_ID and SENTINEL_CLIENT_SECRET, selecting Encrypt for each. Add to Production (and Preview if testing previews).
5. Redeploy to apply secrets, then open Farm Map > Satellite NDVI.

ALTERNATIVE DEPLOYMENT (Wrangler CLI; recommended if not using Git):
Install Node.js first. From this folder run:
  npx wrangler login
  npx wrangler pages project create hull-ag-solutions
  npx wrangler pages secret put SENTINEL_CLIENT_ID --project-name hull-ag-solutions
  npx wrangler pages secret put SENTINEL_CLIENT_SECRET --project-name hull-ag-solutions
  npx wrangler pages deploy . --project-name hull-ag-solutions
The commands prompt for the secret values; never share them in chat or source code.

LOCAL DEVELOPMENT WITH FUNCTIONS:
Create a file named .dev.vars (NEVER UPLOAD OR COMMIT IT) containing the two secret variables.
Run: npx wrangler pages dev .
Use the local URL Wrangler prints. A plain python3 http.server will serve the interface but NOT the NDVI endpoint.

DATA WARNING: Paddocks and records are stored in browser localStorage. Changing from Netlify to Cloudflare does not automatically migrate records. Export a farm backup on the old site and import it on the new one.

NOTES: NDVI image is rendered over the selected paddock BOUNDING BOX; nearby fields may also be shown. Cloud/missing pixels are transparent. Live satellite retrieval is untested without your Copernicus credentials. The site has no user authentication; protect it before using with confidential real farm records.
