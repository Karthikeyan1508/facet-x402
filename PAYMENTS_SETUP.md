# Facet — Payments & Algorand Setup

A teaching guide for the team. Read it top to bottom once and you will understand what
every wallet is for, what actually happens when someone clicks "Unlock", and how to fix it
when it breaks.

No prior blockchain knowledge assumed. Roughly 20 minutes.

---

## 0. What we are actually building

Facet sells a 3D asset in fidelity tiers. Each tier has a price. When you ask for a tier
without paying, the server replies **HTTP 402 Payment Required** — a status code that has
existed since 1997 and was never used for anything. **x402** is the protocol that finally
gives it meaning: the 402 response carries a machine-readable invoice, the client pays it,
and retries the same request with proof of payment attached.

The money is real USDC moving on the Algorand blockchain. Not simulated, not a database
column. That is the whole point — you can paste any transaction id into a public explorer
and see it.

Why Algorand: transactions finalise in about three seconds and cost a fraction of a cent.
Charging half a cent for an API call only works if the fee to move that half-cent is
negligible. On most payment rails the fee would exceed the payment.

---

## 1. Algorand concepts you need (and only these)

### An account is just a keypair

There is no signup, no server, no company. You generate a keypair locally and that *is* an
account. Three representations of the same thing:

| Form | Looks like | Secret? | Used for |
|---|---|---|---|
| **Address** | `S5MULT73RUKURYXF…PSCHOU` (58 chars) | Public | Receiving money. Safe to publish. |
| **Private key** | 64 raw bytes, usually base64 | **SECRET** | Signing transactions |
| **Mnemonic** | 25 English words | **SECRET** | Human-friendly form of the private key |

The mnemonic and the private key are the same secret in different clothes. Anyone with
either one controls the account completely. The address is derived from them and can be
shared freely.

> Our `.env` holds the buyer's **mnemonic**, and the payees' **addresses**. That asymmetry
> is deliberate: the app needs to *spend* from the buyer, but only needs to *know where to
> send* for the payees.

### ALGO vs. ASA — two different kinds of money

- **ALGO** is Algorand's native coin. It pays transaction fees (0.001 ALGO each) and
  satisfies the minimum balance requirement below. Every account needs some.
- **ASA** (Algorand Standard Asset) is any other token issued on Algorand. **USDC is an
  ASA.** On testnet its asset ID is **`10458941`**, with 6 decimals — so `20000` in a
  transaction means `$0.02`, and `1000000` means `$1.00`.

We price everything in USDC and pay fees in ALGO. An account therefore needs **both**.

### The minimum balance requirement (this is the one that trips everyone up)

An Algorand account must permanently hold a reserve of ALGO or the network rejects its
transactions:

- **0.1 ALGO** base, for existing at all
- **+0.1 ALGO** for every ASA the account holds

So an account that holds USDC must keep **at least 0.2 ALGO** it can never spend, plus a
little more for fees. Fund each account with ~1 ALGO and you will never think about this
again. An account with 0.15 ALGO trying to opt in to USDC will simply fail, and the error
message will not be obvious.

### Opt-in — why a fresh wallet cannot be paid

**An Algorand account cannot receive an ASA it has not opted into.** Sending USDC to an
address that has not opted in does not sit in limbo — the transaction fails.

An opt-in is a zero-amount transfer of that asset to *yourself*, signed by the account
itself. It is the account saying "I consent to hold this token." It costs one transaction
fee and raises the minimum balance by 0.1 ALGO.

This is the single most common reason a payment fails in this project, and it is why
`npm run wallets` prints the payee mnemonics: **each payee must sign its own opt-in.** If
you throw those mnemonics away before running `npm run optin`, those wallets can never be
paid and you have to generate new ones.

It also fixes the order of setup, which is not the order you would guess:

```
   fund with ALGO  →  opt in to USDC  →  fund with USDC
```

You cannot receive USDC before opting in, and you cannot opt in without ALGO to pay the
fee and cover the raised minimum balance. This applies to the buyer too, not just the
payees.

### Testnet vs. mainnet

Testnet is a full, real, public Algorand network that uses valueless tokens. Same code,
same explorers, same protocol — the money just is not worth anything. Everything in this
project is testnet. **Never put a mainnet key in a `.env` file.**

---

## 2. The four wallets and why there are four

| Wallet | Role | Holds what | Needs funding |
|---|---|---|---|
| **Buyer** | Pays for every unlock | ALGO + USDC | **Yes — both** |
| **Modeller** | Paid for tiers 1 & 2 (the meshes) | ALGO + receives USDC | ~1 ALGO, then opt in |
| **Material** | Paid for tier 3 (PBR materials) | ALGO + receives USDC | ~1 ALGO, then opt in |
| **Rights** | Paid for tier 4 (commercial licence) | ALGO + receives USDC | ~1 ALGO, then opt in |

**Why three payees instead of one?** Because it is the product argument, not a technical
one. A 3D asset has a supply chain — someone modelled it, someone authored its materials,
someone owns the rights. Today they are paid once, up front, opaquely, no matter how often
the asset is later used. Facet pays each of them separately, per use, and the split is
visible on chain. One wallet would collapse the whole idea into "a paywall."

---

## 3. Setup runbook

Follow in order. Each step has a verification.

### Step 1 — Generate the wallets

```bash
npm run wallets
```

Paste the whole block into `.env`. It contains the buyer's mnemonic plus each payee's
address **and** mnemonic.

> Keep the payee mnemonics until step 3 is done. They are only used locally, by the opt-in
> script, and never go into Vercel.

### Step 2 — Fund ALL FOUR accounts with ALGO

> **Order matters.** ALGO first, then opt-in, then USDC. An account cannot receive USDC
> until it has opted in, and it cannot opt in without ALGO. Doing this out of order gets
> you a failed transaction and a confusing error.

Easiest option is **Lora**, which is also the explorer you will use later:
<https://lora.algokit.io/testnet/fund> → *Fund an existing TestNet account with ALGO*.
Paste an address, set the amount, click **Fund**. Repeat for each of the four.

The dispenser gives you a limited quota (10 ALGO at a time). Split it like this:

| Account | ALGO | Why |
|---|---|---|
| buyer | 4 | Pays a transaction fee on every single unlock |
| modeller | 1 | Minimum balance + its own opt-in fee |
| material | 1 | Same |
| rights | 1 | Same |

That leaves headroom, and Lora has a *Refund unused TestNet ALGO* section to give back what
you do not use. The alternative dispenser is <https://bank.testnet.algorand.network>.

Get the four addresses by running `npm run wallets:status` — it prints them all, even for
accounts that are not funded yet — or just read them out of `.env`.

### Step 3 — Opt every account in to USDC

```bash
npm run optin
```

This signs and submits a zero-amount USDC transfer from each account to itself. It skips
accounts that are already opted in and tells you which ones are short on ALGO.

**All four accounts need this, including the buyer** — the buyer *holds* USDC, so it must
opt in before it can be funded with any.

### Step 4 — Now fund the buyer with USDC

Two options:

- **Lora** — <https://lora.algokit.io/testnet/fund> → *Fund an existing TestNet account
  with USDC*. Same page, bottom section.
- **Circle** — <https://faucet.circle.com>, choose **USDC** and **Algorand testnet**.
  20 USDC per address every 2 hours, no account needed.

Only the **buyer** needs USDC. The three payees start at zero and earn it.

> A full click-through of all four tiers costs $0.105, so even 5 USDC is ~47 full runs.
> **Do not over-fund.** See the security note in section 6 — on the deployed version this
> balance is the only real cap on what a stranger can spend.

### Step 5 — Verify before you touch the app

```bash
npm run wallets:status
```

```
  role       ALGO      USDC      opted in   address
  ------------------------------------------------------------------------
  buyer      4.998     20.000    yes        GTCQ72D3GENUNPBVFEJ23DD2K…
  modeller   0.999     0.000     yes        S5MULT73RUKURYXFNDU6ZEHA7…
  material   0.999     0.000     yes        MBNJVHQIU4UYNGUUTWITSLORV…
  rights     0.999     0.000     yes        4DS5FLXS3757PDPEKYMHPLCUM…

  All four wallets are funded and opted in. Payments should work.
```

Every row must say **yes** under "opted in". If any says NO, that tier's payment will fail.

### Step 6 — Run the app

```bash
npm run dev
```

Open <http://localhost:4020>, click **Unlock — $0.005**, and watch the ledger. Re-run
`npm run wallets:status` afterwards: the buyer's USDC should have dropped by 0.005 and the
modeller's risen by the same amount.

**That round trip is the thing to show your team.** Money left one account and arrived in
another because someone clicked a button on a web page.

---

## 4. What actually happens when someone clicks Unlock

Six steps. This is the entire protocol.

```
1.  BUYER  → SELLER
    POST /api/asset/wheel-rt5/production
    (no payment attached — the buyer does not yet know the price)

2.  SELLER → BUYER
    HTTP 402 Payment Required
    PAYMENT-REQUIRED header, base64-encoded JSON:
      { scheme:  "exact",
        network: "algorand:SGO1GKSz…OiI=",   ← testnet genesis hash
        amount:  "20000",                     ← $0.02, in USDC micro-units
        asset:   "10458941",                  ← testnet USDC
        payTo:   "S5MULT73RUK…"  }            ← the modeller's address

    This is a machine-readable invoice. No human read it, no account was created,
    no API key was exchanged.

3.  BUYER (locally)
    Builds an Algorand transaction for exactly that amount, to exactly that address,
    and signs it with the buyer's private key. Retries the IDENTICAL request with an
    X-PAYMENT header carrying the signed payment.

4.  SELLER → FACILITATOR
    Hands the X-PAYMENT header to the GoPlausible facilitator, which verifies the
    signature and submits the transaction to Algorand. ~3 seconds later it is final.

5.  SELLER (only now)
    The route handler runs for the FIRST time. Until this moment the geometry was
    never generated — it is not withheld by a flag, it does not exist yet.
    Returns 200 with the payload, plus a payment-response header carrying the
    settled transaction id.

6.  BUYER → BROWSER
    Decodes the transaction id and returns it with the payload. The UI renders the
    new mesh and a ledger row linking to the explorer.
```

### Two things people get wrong about this

**The facilitator never holds your money.** It is a verification-and-submission service,
not a custodian or an escrow. The payment is a normal Algorand transaction signed by the
buyer's key, going directly from the buyer's account to the payee's account. If the
facilitator disappeared mid-flight, the worst case is a payment that settled without the
response coming back — not lost custody.

**Nothing here needs an account with anybody.** No API key, no signup, no contract, no
KYC between buyer and seller. That is precisely why an autonomous agent can use it: an
agent cannot fill in a signup form, but it can read a 402 and sign a transaction. Run
`npm run agent -- campaign` to watch a program do exactly that with no human involved.

---

## 5. Reading the proof

Every settled payment gets a transaction id. Paste it into **Lora**, the Algorand explorer:

```
https://lora.algokit.io/testnet/transaction/<TXID>
```

What to check when you want to prove it is real:

- **Sender** — should be the buyer's address
- **Receiver** — should be the payee for that specific tier (a PBR unlock must land in the
  *material* wallet, not the modeller's)
- **Asset** — `USDC (10458941)`, not ALGO
- **Amount** — `0.02` for a production mesh, and so on
- **Round / confirmation** — proves it is on chain, not pending

You can also query the public indexer directly, which is the most independent check:

```bash
curl https://testnet-idx.algonode.cloud/v2/transactions/<TXID>
```

---

## 6. Key security — what is secret and what is not

| Value | Secret? | Where it lives |
|---|---|---|
| Buyer mnemonic / private key | **Yes** | Local `.env`, and Vercel env vars. Never in git. |
| Payee mnemonics | **Yes** | Local `.env` only, for opt-in. **Never** put these in Vercel. |
| Payee addresses | No | `.env`, Vercel, the public catalogue, this document |
| Transaction ids | No | Public on chain by definition |

Rules for the team:

1. **`.env` is in `.gitignore`. Keep it that way.** If a key is ever committed, treat that
   wallet as compromised, generate a new one, and move the funds.
2. **The payee mnemonics never go to Vercel.** The app only needs their addresses. Adding
   the mnemonics would put spending power over those wallets on a public server for no
   reason at all.
3. **Keep the buyer balance small.** `/api/unlock` is public and unauthenticated on
   purpose — that is what makes it agent-native — so the balance in the buyer wallet is
   the real cap on what a stranger can spend. The rate limiter helps, but each warm
   serverless instance counts separately, so it is a speed bump rather than a guarantee.
   A couple of dollars of testnet USDC is plenty for a demo and bounds the damage.
4. **Testnet only.** These are throwaway keys holding valueless tokens. The moment anyone
   is tempted to reuse this pattern with a mainnet key, stop and design custody properly.

---

## 7. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `receiver error: must optin` | Payee has not opted in to USDC | `npm run optin` |
| `account balance below min` | Account has under 0.2 ALGO and is holding an ASA | Send it ~1 ALGO |
| `overspend` / insufficient funds | Buyer is out of USDC | Top up at faucet.circle.com |
| `FACET_BUYER_PRIVATE_KEY is not set` | `.env` missing, or not loaded | Check `.env` exists; on Vercel check env vars are set for *Production* |
| Every paid tier returns 500 | Facilitator unreachable | `curl /api/health` → if `facilitatorReachable:false`, check network egress |
| Paid tier returns 200 with no payment | Route path mismatch, so the x402 middleware never matched | Confirm the route key in `lib/catalogue.js` matches the Express path exactly |
| `429 Too Many Requests` on unlock | Rate limiter tripped (15/min) | Wait a minute, or raise `MAX_UNLOCKS_PER_MINUTE` |
| Unlock works locally, fails on Vercel | Env vars not set in the Vercel dashboard, or set only for Preview | Add them for the **Production** environment and redeploy |
| Works, but no transaction id in the ledger | Settlement succeeded but the response header was missing | Check the function logs; the payment likely went through — verify on Lora |

**Always start with `npm run wallets:status`.** It catches the two most common failures —
payee not opted in, buyer out of funds — in one command.

---

## 8. Quick reference

```
Testnet USDC asset ID     10458941   (6 decimals: 20000 = $0.02)
Base minimum balance      0.1 ALGO
Per-ASA minimum balance   +0.1 ALGO
Transaction fee           0.001 ALGO
Finality                  ~3 seconds

ALGO faucet     https://bank.testnet.algorand.network
USDC faucet     https://faucet.circle.com          (20 USDC / 2h / address)
Explorer        https://lora.algokit.io/testnet
Indexer         https://testnet-idx.algonode.cloud
Node            https://testnet-api.algonode.cloud
Facilitator     https://facilitator.goplausible.xyz

npm run wallets          generate the four accounts
npm run optin            opt them all in to USDC
npm run wallets:status   verify funding + opt-in state
npm run dev              run the app locally
npm run agent -- campaign   autonomous buyer, no human
```

### Tier → payee map

| Tier | Price | Micro-units | Paid to |
|---|---|---|---|
| Draft mesh | $0.005 | 5000 | modeller |
| Production mesh | $0.02 | 20000 | modeller |
| PBR material set | $0.03 | 30000 | material |
| Commercial licence | $0.05 | 50000 | rights |
