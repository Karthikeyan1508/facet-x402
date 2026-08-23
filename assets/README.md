Ingested asset tiers land here as `tiers.json`, written by `npm run ingest -- model.glb`.

The file is not committed — it is generated from whatever GLB you point the ingester at.
With no `tiers.json` present, Facet serves its built-in procedural wheel instead, so a
fresh clone works with no asset file at all.

If you want a deployment to serve an ingested asset, commit the generated `tiers.json`
(remove the ignore rule below) — Vercel has no writable disk, so it must be in the repo.
