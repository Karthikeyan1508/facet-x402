// One-time setup: opt every Facet account in to testnet USDC.
//
// On Algorand an account cannot receive an ASA it has not opted into — a payment to a
// non-opted-in address fails outright. An opt-in is just a zero-amount transfer of that
// asset to yourself, signed by the account itself. That is why the payee mnemonics are
// needed here and nowhere else.
//
//   npm run optin
import "dotenv/config";
import algosdk from "algosdk";

const USDC_ASA = Number(process.env.USDC_ASA_ID) || 10458941;
const ALGOD_URL = process.env.ALGOD_URL || "https://testnet-api.algonode.cloud";
const MIN_ALGO_NEEDED = 300_000; // 0.1 base MBR + 0.1 per ASA + fees, with headroom

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

const accounts = [
    ["buyer", process.env.FACET_BUYER_PRIVATE_KEY],
    ["modeller", process.env.FACET_MODELLER_MNEMONIC],
    ["material", process.env.FACET_MATERIAL_MNEMONIC],
    ["rights", process.env.FACET_RIGHTS_MNEMONIC],
];

function toAccount(secret) {
    const s = String(secret).trim();
    if (s.includes(" ")) return algosdk.mnemonicToSecretKey(s);
    const sk = Buffer.from(s, "base64");
    return { sk: new Uint8Array(sk), addr: algosdk.encodeAddress(sk.slice(32)) };
}

async function optIn(role, secret) {
    if (!secret) {
        console.log(`  ${role.padEnd(9)} \x1b[33mskipped\x1b[0m — no mnemonic in .env`);
        return;
    }

    const acct = toAccount(secret);
    const address = acct.addr.toString();

    let info;
    try {
        info = await algod.accountInformation(address).do();
    } catch (err) {
        console.log(`  ${role.padEnd(9)} \x1b[31mfailed\x1b[0m — could not read account: ${err.message}`);
        return;
    }

    const micro = Number(info.amount);
    const already = (info.assets ?? []).some((a) => Number(a.assetId ?? a["asset-id"]) === USDC_ASA);

    if (already) {
        console.log(`  ${role.padEnd(9)} \x1b[32malready opted in\x1b[0m  ${address.slice(0, 8)}…  ${(micro / 1e6).toFixed(3)} ALGO`);
        return;
    }
    if (micro < MIN_ALGO_NEEDED) {
        console.log(
            `  ${role.padEnd(9)} \x1b[31mneeds ALGO\x1b[0m  ${address}\n` +
            `             has ${(micro / 1e6).toFixed(3)} ALGO, needs at least ${(MIN_ALGO_NEEDED / 1e6).toFixed(1)}.\n` +
            `             Fund it at https://bank.testnet.algorand.network then re-run.`
        );
        return;
    }

    try {
        const suggestedParams = await algod.getTransactionParams().do();
        const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
            sender: address,
            receiver: address,
            amount: 0,
            assetIndex: USDC_ASA,
            suggestedParams,
        });
        const { txid } = await algod.sendRawTransaction(txn.signTxn(acct.sk)).do();
        await algosdk.waitForConfirmation(algod, txid, 6);
        console.log(`  ${role.padEnd(9)} \x1b[32mopted in\x1b[0m  ${address.slice(0, 8)}…  tx ${txid}`);
    } catch (err) {
        console.log(`  ${role.padEnd(9)} \x1b[31mfailed\x1b[0m — ${err.message}`);
    }
}

console.log(`\nOpting Facet accounts in to USDC (ASA ${USDC_ASA}) on ${ALGOD_URL}\n`);
for (const [role, secret] of accounts) await optIn(role, secret);
console.log(`\nDone. Run \x1b[1mnpm run wallets:status\x1b[0m to confirm balances.\n`);