// Regenerates ONLY the three payee accounts, leaving the buyer untouched.
//
// Use this if your .env has payee addresses but no payee mnemonics — an Algorand account
// must sign its own opt-in before it can receive USDC, so a payee whose key you do not
// have can never be paid.
import algosdk from "algosdk";

const roles = [
    ["FACET_MODELLER", "receives payment for the draft + production meshes"],
    ["FACET_MATERIAL", "receives payment for the PBR material set"],
    ["FACET_RIGHTS", "receives payment for the commercial licence"],
];

console.log("\n# Replace the three payee blocks in .env with these.");
console.log("# Leave FACET_BUYER_PRIVATE_KEY exactly as it is.\n");

for (const [role, note] of roles) {
    const acct = algosdk.generateAccount();
    console.log(`# ${role} — ${note}`);
    console.log(`${role}_ADDRESS=${acct.addr.toString()}`);
    console.log(`${role}_MNEMONIC="${algosdk.secretKeyToMnemonic(acct.sk)}"`);
    console.log("");
}

console.log(`# Then: fund each of the three with ~1 ALGO, run \`npm run optin\`,
# and only after that fund the BUYER with USDC.
`);