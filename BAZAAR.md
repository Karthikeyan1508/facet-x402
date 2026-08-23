# Facet on the x402 Bazaar

The Bazaar is the public catalogue an x402 facilitator maintains of every priced resource
it knows about. Registering there is what turns Facet from "a shop you have to be told
about" into "a shop an agent can find on its own".

This is built and working. It is **off by default** — set `BAZAAR_ENABLED=1` to turn it on.

---

## What is built

**The seller advertises itself.** With `BAZAAR_ENABLED=1`, every paid route attaches two
things to its 402 challenge:

- **`tags`** — `3d-asset`, `mesh`, `low-poly`, `pbr`, `licence` and so on, deliberately
  generic. An agent searching for `3d-asset` should find Facet without knowing Facet
  exists.
- **`extensions.bazaar`** — a `declareDiscoveryExtension` payload describing exactly how to
  call the route and what comes back, including a worked example of the response.

Together those make the resource self-describing: an agent can decide whether Facet does
what it needs *before* paying anything.

**The buyer discovers instead of being told.** `agent/discover.js` is the same agent as
`agent/demo.js` with the hardcoded URL removed. It expresses its task as tags, queries the
Bazaar, scores every match on price, and pays the winner.

```
Facet discovering agent
task        : Render a 512px product thumbnail for a parts-catalogue listing
bazaar      : http://localhost:4099
known seller: (none — nothing is hardcoded)

Queried the Bazaar: 7 resources catalogued.

Need [3d-asset + low-poly] → 2 matching resource(s)
        1000  RivalStudio   https://rival.example.com/cheap-lowpoly
        5000  Facet         http://localhost:4020/api/asset/wheel-rt5/draft
  selected: https://rival.example.com/cheap-lowpoly  (cheapest of 2)
  unreachable — fetch failed
  falling back to next-cheapest: http://localhost:4020/api/asset/wheel-rt5/draft
  settled in 3418ms · 3,760 tris

Spent $0.005 across 1 on-chain payments,
with no seller URL supplied to this agent.
1 cheaper listing(s) were unreachable and skipped.
```

Two things are proved there, and both matter more than the payment itself.

**Selection is real.** A cheaper competitor advertised the same capability and the agent
switched to it without being told to. Nothing about the choice is hardcoded.

**Failure is survivable.** The `--rival` listing points at a host that does not exist, on
purpose. Discovery is an open network: a listing may be offline, moved, or fictional, so
unreachable sellers are normal rather than exceptional. The agent falls through the
ranking until something delivers, and reports how many cheaper listings it skipped.
Picking the cheapest and giving up when it fails is not agent behaviour, it is a script.

---

## Turning it on

Locally, with the offline stub. **Three terminals** — and note the `FACILITATOR_URL`
override in the third: without it the scripts read `.env` and query the *real* facilitator,
which will not know about your localhost deployment.

```powershell
# terminal 1 - the stub Bazaar
npm run stub-facilitator -- --bazaar --rival

# terminal 2 - Facet, advertising itself
$env:FACILITATOR_URL="http://localhost:4099"
$env:BAZAAR_ENABLED="1"
npm run dev

# terminal 3 - the client side
$env:FACILITATOR_URL="http://localhost:4099"
npm run bazaar:list -- --mine http://localhost:4020 --tag 3d-asset
npm run agent:discover -- thumbnail
```

Close those terminals or run `Remove-Item Env:FACILITATOR_URL` afterwards, so you do not
leave a shell pointed at the stub.

On a real deployment, set `BAZAAR_ENABLED=1` in the Vercel environment and redeploy. Then:

```bash
npm run bazaar:list -- --mine https://your-app.vercel.app
```

**Registration is not instant.** A facilitator catalogues a resource when it sees that
resource advertise its payment requirements, so hit each tier once, unpaid, before
expecting it to appear:

```bash
for t in draft production pbr license; do
  curl -s -o /dev/null -X POST https://your-app.vercel.app/api/asset/wheel-rt5/$t \
    -H "Content-Type: application/json" -d '{}'
done
```

**Facilitators skip loopback addresses.** A localhost deployment will never be catalogued
publicly, which is why the offline stub exists.

---

## Verifying it worked

`npm run bazaar:list` reports the catalogue size, the most common tags in use, everything
matching a tag you care about, and specifically whether *your* host appears. If it does
not, it tells you the three things to check in order.

You can also read a 402 challenge directly and confirm the extension is attached:

```bash
curl -si -X POST https://your-app.vercel.app/api/asset/wheel-rt5/production \
     -H "Content-Type: application/json" -d '{}' \
  | grep -i '^payment-required' | sed 's/^[^:]*: //' | tr -d '\r' | base64 -d
```

You should see `tags` on the resource and an `extensions.bazaar` block carrying the input
and output schema.

---

## What is not built yet

**Selection is price-only.** Candidates are ranked on price alone. A production version
folds in observed success rate and latency — the same shape as
`score = price × (2 − successRate) + latency × 0.01`. The fall-through already records
which sellers failed within a single run; nothing persists that across runs, so an agent
re-learns the same dead listing every time.

**One seller per deployment.** Payees are global environment variables and there is one
asset slot. Multi-tenancy — per-asset payees, an asset registry, upload auth — is the real
remaining work, and it is what turns this from a shop into a marketplace.

**No capability negotiation.** The agent matches on tags. It does not read the declared
input/output schema and reason about whether the response shape fits its pipeline, which is
what the `extensions.bazaar` payload actually enables.

**Reputation is not persisted.** Nothing remembers that a seller failed to deliver last
time.

---

## What the real Bazaar looks like today

Querying GoPlausible's live catalogue in August 2026:

```
  catalogued resources : 1,527
  Resources tagged "3d-asset": 0
```

**Not one of the resources in the Bazaar is a 3D asset.** They are APIs, data feeds and
tools. That is worth saying out loud, because it is the clearest evidence that the gap
Facet addresses is real rather than assumed: agents can already buy weather data and
translation by the call, and cannot buy a 3D model at all.

It also means the tags Facet advertises — `3d-asset`, `mesh`, `pbr` — are unclaimed. The
first seller to register defines what an agent searching for 3D geometry finds.

---

## Why this is the interesting direction

The endgame is not one large Facet marketplace taking a cut. It is many independent Facet
instances — each a studio owning its own keys and its own revenue — all discoverable
through one shared catalogue. An agent that needs a brake caliper finds whoever offers it
at the fidelity it needs, pays that studio directly, and no platform sits in between.

The single-seller limitation is a starting point for that, not a gap in it.
