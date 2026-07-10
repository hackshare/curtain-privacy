# curtain-privacy demo

A client-side chat demo that shows the curtain-privacy redaction pipeline in action. Both models (the redaction guard `hackshare/curtain-privacy` and the reply LLM `onnx-community/Qwen2.5-0.5B-Instruct`) load from Hugging Face and run entirely in the browser. Nothing you type leaves the device after the models have downloaded.

On browsers without WebGPU the LLM falls back to a scripted reply; the redaction pipeline runs in either case.

## Running locally

```
cd demo
bun install
bun run dev
```

The dev server starts at `http://localhost:5173`.

## Visual design

The visual layer lives in `styles/curtain-privacy.css`, produced by running `DESIGN_BRIEF.md` through Claude Design and layered onto the skeleton in `src/ui.ts`. It targets the skeleton's `data-role` attributes, which the design does not rename. The stylesheet keys off two optional runtime hooks that `ui.ts` sets: `data-mode="llm"|"scripted"` on the badge, and `data-state="error"` on the phone. Both degrade gracefully if absent. The design is light-scheme only.

`index.html` is the marketing wrapper (header, hero, how-it-works, fine print) around the demo `#app`, which `src/ui.ts` fills at runtime.

The source design project (design decisions, wordmark and icon sheet, and every rendered state) lives at <https://claude.ai/design/p/ccffe3ea-0a94-46b2-a028-e0c2695fe282>. `design/harness.html` is an untracked local previewer that renders the bare DOM against the real stylesheet for any state, for example `design/harness.html?state=error&mode=llm`.

## Cloudflare Pages deployment

Live at <https://curtain.hackshare.com/>.

Redeploy from a local build with the Wrangler CLI:

```
cd demo
bun run build
bunx wrangler pages deploy dist --project-name=curtain-privacy-demo --branch=main
```

The `wrangler.toml` here holds the project name and `pages_build_output_dir = "dist"`.

To switch to auto-deploy on push instead, connect the repo in the Cloudflare Pages
dashboard with root directory `demo`, build command `bun install && bun run build`,
and output directory `demo/dist`.

The site is fully static; the models load from Hugging Face at runtime, so no build
env vars or secrets are needed. WASM runs single-threaded (no cross-origin-isolation
headers), which works everywhere and keeps the cross-origin model fetch working.
