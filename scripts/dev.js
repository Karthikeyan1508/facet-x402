// Local development server. Serves the static viewer and the same Express app that runs
// as a serverless function on Vercel, so local and deployed behaviour match.
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import "dotenv/config";
import { createApp } from "../lib/app.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 4020;

const server = express();
server.use(express.static(path.join(__dirname, "..", "public")));
server.use(createApp());

server.listen(PORT, () => {
  console.log(`\n  Facet running at http://localhost:${PORT}\n`);
  console.log(`  catalogue : http://localhost:${PORT}/api/catalog`);
  console.log(`  health    : http://localhost:${PORT}/api/health\n`);
});
