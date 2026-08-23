// Read-only health check for all four Facet wallets: ALGO balance, USDC opt-in state and
// USDC balance. Run this first whenever a payment fails — it catches the two most common
// causes (payee not opted in, buyer out of funds) in one shot.
//
//   npm run wallets:status
import "dotenv/config";
import algosdk from "algosdk";

const USDC_ASA = Number(process.env.USDC_ASA_ID) || 10458941;
const ALGOD_URL = process.env.ALGOD_URL || "https://testnet-api.algonode.cloud";
// algosdk's Algodv2 constructor drops a port embedded in the URL unless it is passed
// separately, which silently breaks any local node (e.g. AlgoKit LocalNet on :4001).
// Split it out explicitly.
function makeAlgod(url, token = "") {
    const parsed = new URL(url);
    const port = parsed.port;
    const base = `${parsed.protocol}//${parsed.hostname}`;
    return new algosdk.Algodv2(token, base, port);
}

const algod = makeAlgod(ALGOD_URL, process.env.ALGOD_TOKEN || "");

function addressOf(role) {
    if (role === "buyer") {
        const pk = process.env.FACET_BUYER_PRIVATE_KEY;
        if (!pk) return null;
        const s = pk.trim();
        if (s.includes(" ")) return algosdk.mnemonicToSecretKey(s).addr.toString();
        return algosdk.encodeAddress(Buffer.from(s, "base64").slice(32));
    }
    return process.env[`FACET_${role.toUpperCase()}_ADDRESS`] || null;
}

const ROLES = [
    ["buyer", "pays for every unlock"],
    ["modeller", "receives draft + production"],
    ["material", "receives PBR"],
    ["rights", "receives licence"],
];

console.log(`\nFacet wallet status — USDC ASA ${USDC_ASA} on ${ALGOD_URL}\n`);
console.log("  role       ALGO      USDC      opted in   address");
console.log("  " + "-".repeat(84));

let problems = [];

for (const [role, note] of ROLES) {
    const address = addressOf(role);
    if (!address) {
        console.log(`  ${role.padEnd(10)} \x1b[33mnot configured in .env\x1b[0m`);
        problems.push(`${role}: missing from .env`);
        continue;
    }
    try {
        const info = await algod.accountInformation(address).do();
        const algo = Number(info.amount) / 1e6;
        const holding = (info.assets ?? []).find((a) => Number(a.assetId ?? a["asset-id"]) === USDC_ASA);
        const usdc = holding ? Number(holding.amount ?? 0) / 1e6 : 0;
        const opted = Boolean(holding);

        console.log(
            `  ${role.padEnd(10)} ${algo.toFixed(3).padEnd(9)} ${usdc.toFixed(3).padEnd(9)} ` +
            `${(opted ? "\x1b[32myes\x1b[0m" : "\x1b[31mNO \x1b[0m").padEnd(19)} ${address}`
        );

        if (!opted) problems.push(`${role} has not opted in to USDC — it cannot be paid. Run: npm run optin`);
        if (algo < 0.21) problems.push(`${role} has ${algo.toFixed(3)} ALGO — below the minimum balance needed to hold an ASA.`);
        if (role === "buyer" && usdc <= 0) problems.push(`buyer holds no USDC — fund it at https://faucet.circle.com (Algorand testnet).`);
    } catch (err) {
        // A never-funded account may not exist on chain yet. Still show the address —
        // this is precisely the moment you need it, to paste into a dispenser.
        const notFunded = /404|not found|no accounts found|does not exist/i.test(err.message);
        if (notFunded) {
            console.log(`  ${role.padEnd(10)} ${"0.000".padEnd(9)} ${"0.000".padEnd(9)} ${"\x1b[31mNO \x1b[0m".padEnd(19)} ${address}`);
            problems.push(`${role} is not funded yet — send it ALGO, then run: npm run optin`);
        } else {
            console.log(`  ${role.padEnd(10)} \x1b[31merror\x1b[0m ${err.message}\n             ${address}`);
            problems.push(`${role}: ${err.message}`);
        }
    }
}

console.log("");
if (problems.length) {
    console.log("\x1b[31mProblems found:\x1b[0m");
    for (const p of problems) console.log(`  · ${p}`);
    console.log("\n  Fix them in this order: fund ALGO → npm run optin → fund the buyer with USDC.");
    console.log("  USDC cannot be received by an account that has not opted in first.\n");
    process.exitCode = 1;
} else {
    console.log("\x1b[32mAll four wallets are funded and opted in. Payments should work.\x1b[0m\n");
}