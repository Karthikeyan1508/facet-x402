// The whole of Facet as one Express app.
//
// It plays BOTH roles:
//   seller  — /api/asset/:id/:tier are x402-gated resources that return 402 until paid
//   buyer   — /api/unlock/:tier holds the wallet, pays the seller, returns the payload
//
// They stay genuinely separate over the network: the buyer makes a real outbound HTTPS
// request to the seller's public URL and settles a real payment, exactly as an unrelated
// third party would. Running them in one deployment is a packaging decision, not a
// shortcut around the protocol.

import express from "express";
import cors from "cors";
import { paymentMiddleware } from "@x402/express";
import { x402ResourceServer, HTTPFacilitatorClient } from "@x402/core/server";
import { ExactAvmScheme } from "@x402/avm/exact/server";
import { USDC_TESTNET_ASA_ID } from "@x402/avm";
import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { ExactAvmScheme as ClientExactAvmScheme, toClientAvmSigner } from "@x402/avm";
import algosdk from "algosdk";

import { buildWheel, PBR_MATERIAL, TIERS } from "./geometry.js";
import { ASSET_ID, ASSET_NAME, ALGORAND_TESTNET, PAYEES, CATALOGUE, TIER_BY_KEY } from "./catalogue.js";

export function log(level, msg, extra = {}) {
    console.log(JSON.stringify({ t: new Date().toISOString(), svc: "facet", level, msg, ...extra }));
}

function sendProblem(res, status, title, detail) {
    res.status(status).type("application/problem+json").json({ type: "about:blank", title, status, detail });
}

// The buyer pays whichever origin served this request, so the same code works on
// localhost and on a Vercel deployment with no configuration at all.
function selfOrigin(req) {
    if (process.env.ASSET_SERVER_URL) return process.env.ASSET_SERVER_URL;
    const proto = req.headers["x-forwarded-proto"] || (req.socket?.encrypted ? "https" : "http");
    const host = req.headers["x-forwarded-host"] || req.headers.host;
    return `${proto}://${host}`;
}

// --- SELLER ------------------------------------------------------------------

const FACILITATOR_URL = process.env.FACILITATOR_URL || "https://facilitator.goplausible.xyz";

const routes = {};
for (const item of CATALOGUE) {
    routes[`POST ${item.route}`] = {
        accepts: {
            scheme: "exact",
            network: ALGORAND_TESTNET,
            payTo: PAYEES[item.payeeRole],
            price: item.price,
            extra: { asset: USDC_TESTNET_ASA_ID },
        },
        description: `${ASSET_NAME} — ${item.label}`,
    };
}

const facilitatorClient = new HTTPFacilitatorClient({ url: FACILITATOR_URL });
const resourceServer = new x402ResourceServer(facilitatorClient);
resourceServer.register("algorand:*", new ExactAvmScheme());

// --- BUYER -------------------------------------------------------------------

let cachedClient = null;
function buildBuyerClient() {
    if (cachedClient) return cachedClient;
    const pk = process.env.FACET_BUYER_PRIVATE_KEY;
    if (!pk) throw new Error("FACET_BUYER_PRIVATE_KEY is not set");
    let base64 = pk.trim();
    if (base64.includes(" ")) base64 = Buffer.from(algosdk.mnemonicToSecretKey(base64).sk).toString("base64");
    const client = new x402Client();
    client.register("algorand:*", new ClientExactAvmScheme(toClientAvmSigner(base64)));
    cachedClient = client;
    return client;
}

async function payAndFetch(url) {
    const fetchWithPay = wrapFetchWithPayment(fetch, buildBuyerClient());
    const started = Date.now();
    const response = await fetchWithPay(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
    });

    if (!response.ok) {
        const required = response.headers.get("payment-required");
        if (required) {
            try {
                log("error", "payment required details", {
                    decoded: JSON.parse(Buffer.from(required, "base64").toString("utf-8")),
                });
            } catch { }
        }
        throw new Error(`Seller returned HTTP ${response.status}`);
    }

    let txId;
    const paymentResponse = response.headers.get("payment-response");
    if (paymentResponse) {
        try {
            txId = JSON.parse(Buffer.from(paymentResponse, "base64").toString("utf-8")).transaction;
        } catch {
            txId = paymentResponse;
        }
    }
    return { payload: await response.json(), txId, latencyMs: Date.now() - started };
}

// A crude but real brake on wallet drain. The deployment is public and unauthenticated,
// so a loop against /api/unlock would otherwise spend until the wallet is empty. This is
// per warm instance, so it is a speed bump rather than a guarantee — the actual control is
// keeping only a small balance in the buyer wallet. See the README.
const SPEND_WINDOW_MS = 60_000;
const MAX_UNLOCKS_PER_WINDOW = Number(process.env.MAX_UNLOCKS_PER_MINUTE) || 15;
const recentUnlocks = [];

function throttled() {
    const now = Date.now();
    while (recentUnlocks.length && now - recentUnlocks[0] > SPEND_WINDOW_MS) recentUnlocks.shift();
    if (recentUnlocks.length >= MAX_UNLOCKS_PER_WINDOW) return true;
    recentUnlocks.push(now);
    return false;
}

// --- APP ---------------------------------------------------------------------

export function createApp() {
    const app = express();
    app.use(cors());
    app.use(express.json({ limit: "1mb" }));

    // Free: the machine-readable price list. This is how an agent discovers what is for sale.
    app.get("/api/catalog", (_req, res) => {
        res.json({
            assetId: ASSET_ID,
            assetName: ASSET_NAME,
            network: ALGORAND_TESTNET,
            asset: USDC_TESTNET_ASA_ID,
            facilitator: FACILITATOR_URL,
            freePreview: { tier: 0, route: `/api/asset/${ASSET_ID}/preview`, triangles: 764, price: "$0.00" },
            tiers: CATALOGUE.map((c) => ({ ...c, payTo: PAYEES[c.payeeRole] })),
        });
    });

    // Free: the watermarked preview, deliberately unusable for anything real.
    // PREVIEW_TIER / PREVIEW_MATERIAL are local dev aids — never set them in a deployment.
    const PREVIEW_TIER = Number(process.env.PREVIEW_TIER) || 0;
    const PREVIEW_MATERIAL = process.env.PREVIEW_MATERIAL === "1";
    const servePreview = (_req, res) => {
        const mesh = buildWheel(PREVIEW_TIER);
        res.json({
            ...mesh,
            watermark: PREVIEW_TIER === 0,
            paid: false,
            ...(PREVIEW_MATERIAL ? { devMaterial: PBR_MATERIAL } : {}),
        });
    };
    // Both paths serve it directly — a redirect would cost an extra function invocation.
    app.get(`/api/asset/${ASSET_ID}/preview`, servePreview);
    app.get("/api/preview", servePreview);

    app.get("/api/health", async (_req, res) => {
        let facilitatorReachable = null;
        try {
            const r = await fetch(`${FACILITATOR_URL}/supported`, { signal: AbortSignal.timeout(6000) });
            facilitatorReachable = r.ok;
        } catch {
            facilitatorReachable = false;
        }
        res.json({
            ok: true,
            service: "facet",
            facilitator: FACILITATOR_URL,
            facilitatorReachable,
            payeesConfigured: Object.fromEntries(Object.entries(PAYEES).map(([k, v]) => [k, Boolean(v)])),
            buyerConfigured: Boolean(process.env.FACET_BUYER_PRIVATE_KEY),
        });
    });

    // --- x402 gate. Everything below this line costs money. ---
    app.use(paymentMiddleware(routes, resourceServer));

    const paid = (build) => (_req, res) => {
        try {
            res.json(build());
        } catch (err) {
            log("error", "failed to build payload", { err: err.message });
            sendProblem(res, 500, "Internal Server Error", err.message);
        }
    };

    app.post(`/api/asset/${ASSET_ID}/draft`, paid(() => ({ ...buildWheel(1), watermark: false, paid: true })));
    app.post(`/api/asset/${ASSET_ID}/production`, paid(() => ({ ...buildWheel(2), watermark: false, paid: true })));

    // Tier 3 ships no new geometry at all — only the material description. It is the
    // clearest expression of the idea that fidelity, not bytes, is the unit of sale.
    app.post(`/api/asset/${ASSET_ID}/pbr`, paid(() => ({
        tier: 3, tierKey: "pbr", label: TIERS[3].label, material: PBR_MATERIAL, paid: true,
    })));

    app.post(`/api/asset/${ASSET_ID}/license`, paid(() => ({
        tier: 4, tierKey: "license", label: TIERS[4].label,
        licence: {
            assetId: ASSET_ID,
            assetName: ASSET_NAME,
            grant: "Worldwide, non-exclusive, commercial use and redistribution in rendered form.",
            licensee: "bearer of the settling Algorand account",
            issuedAt: new Date().toISOString(),
            proof: "The settled Algorand testnet transaction for this request is the licence receipt.",
        },
        paid: true,
    })));

    // --- BUYER endpoint the browser calls ---
    app.post("/api/unlock/:tierKey", async (req, res) => {
        const item = TIER_BY_KEY[req.params.tierKey];
        if (!item) {
            return sendProblem(res, 400, "Unknown Tier",
                `No such tier "${req.params.tierKey}". Valid tiers: ${Object.keys(TIER_BY_KEY).join(", ")}`);
        }
        if (throttled()) {
            return sendProblem(res, 429, "Too Many Requests",
                "Unlock rate limit reached. This protects the demo wallet from being drained.");
        }

        log("info", "unlocking tier", { tierKey: item.key });
        try {
            const target = `${selfOrigin(req)}${item.route}`;
            const { payload, txId, latencyMs } = await payAndFetch(target);
            log("info", "tier unlocked", { tierKey: item.key, txId, latencyMs });
            res.json({
                ...payload,
                payment: {
                    txId,
                    latencyMs,
                    explorer: txId ? `https://lora.algokit.io/testnet/transaction/${txId}` : null,
                },
            });
        } catch (err) {
            log("error", "unlock failed", { tierKey: item.key, err: err.message });
            sendProblem(res, 502, "Payment Or Delivery Failed", err.message);
        }
    });

    return app;
}