// Mints the four accounts Facet needs and prints .env-ready lines.
//
// Every account's mnemonic is printed, including the three payees. That is deliberate:
// on Algorand an account must SIGN its own opt-in before it can receive an ASA, so if you
// throw the payee mnemonics away those wallets can never be paid. Keep them somewhere safe
// until you have run `npm run optin`; after that the app itself only ever needs the
// addresses.
import algosdk from "algosdk";

const roles = [
  ["FACET_BUYER", "pays for every unlock — THIS ONE NEEDS FUNDING (ALGO + testnet USDC)"],
  ["FACET_MODELLER", "receives payment for the draft + production meshes"],
  ["FACET_MATERIAL", "receives payment for the PBR material set"],
  ["FACET_RIGHTS", "receives payment for the commercial licence"],
];

console.log("\n# ============ paste into .env ============\n");

for (const [role, note] of roles) {
  const acct = algosdk.generateAccount();
  const address = acct.addr.toString();
  const mnemonic = algosdk.secretKeyToMnemonic(acct.sk);

  console.log(`# ${role} — ${note}`);
  if (role === "FACET_BUYER") {
    console.log(`# address: ${address}`);
    console.log(`FACET_BUYER_PRIVATE_KEY="${mnemonic}"`);
  } else {
    console.log(`${role}_ADDRESS=${address}`);
    // Needed once, by `npm run optin`, so this account can receive USDC.
    console.log(`${role}_MNEMONIC="${mnemonic}"`);
  }
  console.log("");
}

console.log(`# =========================================
#
# Next steps:
#   1. Paste the block above into .env
#   2. Fund the BUYER with testnet ALGO : https://bank.testnet.algorand.network
#      Fund the BUYER with testnet USDC : https://faucet.circle.com  (pick Algorand testnet)
#   3. Send ~1 ALGO to each of the three payee addresses (they need it for the
#      minimum balance requirement and the opt-in fee)
#   4. Run: npm run optin        — opts every account in to USDC (ASA 10458941)
#   5. Run: npm run wallets:status — confirms everything is funded and opted in
#
# Only the *_ADDRESS values and FACET_BUYER_PRIVATE_KEY are needed at runtime.
# The payee mnemonics are only used by step 4 and never leave your machine.
`);
