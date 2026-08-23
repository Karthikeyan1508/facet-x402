import express from "express";
const app = express();
app.use(express.json());
app.get("/supported", (_req, res) => {
  res.json({
    kinds: [{ x402Version: 2, scheme: "exact", network: "algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=" }],
    extensions: [],
    signers: {},
  });
});
app.listen(4099, () => console.log("stub facilitator on :4099"));
