// Shared product definitions — used by the seller routes, the public price list, and the
// autonomous agent. One source of truth so prices and payees cannot drift apart.

import { ASSET_NAME as RESOLVED_NAME, triangleCountFor } from "./asset.js";

// The route segment stays fixed no matter which asset is loaded — the x402 route table is
// keyed on these paths, so changing them per asset would change what is being paid for.
export const ASSET_ID = "wheel-rt5";
export const ASSET_NAME = RESOLVED_NAME;
export const ALGORAND_TESTNET = "algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=";

// Each tier pays a different wallet on purpose: a 3D asset has a supply chain (modeller,
// material artist, rights holder) and each is paid independently, per use.
export const PAYEES = {
  modeller: process.env.FACET_MODELLER_ADDRESS ?? "",
  material: process.env.FACET_MATERIAL_ADDRESS ?? "",
  rights: process.env.FACET_RIGHTS_ADDRESS ?? "",
};

export const CATALOGUE = [
  {
    tier: 1,
    key: "draft",
    route: `/api/asset/${ASSET_ID}/draft`,
    label: "Draft mesh",
    price: "$0.005",
    payeeRole: "modeller",
    triangles: triangleCountFor(1),
    suitableFor: ["thumbnail", "icon", "search-result", "low-res-preview"],
    description:
      "Silhouette-accurate low-poly mesh. Good enough for a product thumbnail or a listing tile.",
  },
  {
    tier: 2,
    key: "production",
    route: `/api/asset/${ASSET_ID}/production`,
    label: "Production mesh",
    price: "$0.02",
    payeeRole: "modeller",
    triangles: triangleCountFor(2),
    suitableFor: ["configurator", "web-3d", "ar", "product-page"],
    description:
      "Full-density mesh with smooth silhouette and spoke detail. The tier a real 3D configurator ships.",
  },
  {
    tier: 3,
    key: "pbr",
    route: `/api/asset/${ASSET_ID}/pbr`,
    label: "PBR material set",
    price: "$0.03",
    payeeRole: "material",
    triangles: triangleCountFor(2),
    suitableFor: ["photoreal", "ar", "hero-render", "showroom"],
    description:
      "Physically-based materials: diamond-cut alloy with clearcoat, and the tyre compound. Turns grey clay into a real wheel.",
  },
  {
    tier: 4,
    key: "license",
    route: `/api/asset/${ASSET_ID}/license`,
    label: "Commercial licence",
    price: "$0.05",
    payeeRole: "rights",
    triangles: triangleCountFor(2),
    suitableFor: ["commercial-use", "redistribution", "print", "campaign"],
    description:
      "Commercial-use licence for the asset. The settled Algorand transaction IS the licence receipt.",
  },
];

export const TIER_BY_KEY = Object.fromEntries(CATALOGUE.map((c) => [c.key, c]));
