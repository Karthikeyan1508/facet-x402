// Mints the four wallets Facet needs and prints .env-ready lines.
// Fund the BUYER account with testnet ALGO + USDC (ASA 10458941) at
// https://bank.testnet.algorand.network and https://dispenser.testnet.aws.algodev.network
import algosdk from "algosdk";

const roles = [
  ["FACET_BUYER", "pays for every unlock — THIS ONE NEEDS FUNDING (ALGO + testnet USDC)"],
  ["FACET_MODELLER", "receives payment for the draft + production meshes"],
  ["FACET_MATERIAL", "receives payment for the PBR material set"],
  ["FACET_RIGHTS", "receives payment for the commercial licence"],
];

console.log("\n# --- paste into .env ---\n");
for (const [role, note] of roles) {
  const acct = algosdk.generateAccount();
  const mnemonic = algosdk.secretKeyToMnemonic(acct.sk);
  console.log(`# ${role}: ${note}`);
  console.log(`# address: ${acct.addr}`);
  if (role === "FACET_BUYER") console.log(`${role}_PRIVATE_KEY="${mnemonic}"`);
  else console.log(`${role}_ADDRESS=${acct.addr}`);
  console.log("");
}
console.log("# Receiving accounts must opt in to testnet USDC (ASA 10458941) before they can be paid.\n");
