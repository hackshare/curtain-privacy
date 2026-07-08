import { createGuard, ChatGuard } from "../dist/index.js";
if (typeof createGuard !== "function") throw new Error("createGuard missing from dist");
const guard = await createGuard({ heuristicsOnly: true });
if (!(guard instanceof ChatGuard)) throw new Error("createGuard did not return a ChatGuard");
console.log("dist smoke ok");
