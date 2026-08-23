// Vercel serverless entry point.
//
// dotenv is loaded first and unconditionally: lib/app.js reads process.env at module load
// to build the x402 route table, so anything that populates env has to run before it. On
// Vercel there is no .env file and this is a harmless no-op; locally it is what makes the
// serverless path behave identically to `npm run dev`.
//
// Every /api/* request is rewritten here by vercel.json and handed to the same Express
// app that runs locally.
import "dotenv/config";
import { createApp } from "../lib/app.js";

const app = createApp();

export default function handler(req, res) {
  // Depending on how the rewrite fires, req.url may or may not still carry the /api
  // prefix. The x402 middleware matches on the exact path, so normalise it before the
  // app sees it — otherwise the gated routes silently stop being gated.
  if (!req.url.startsWith("/api")) {
    req.url = "/api" + (req.url === "/" ? "" : req.url);
  }
  return app(req, res);
}
