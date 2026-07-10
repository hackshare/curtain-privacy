# Design Brief: curtain-privacy demo

## What you are designing

A visual layer for a single-page, client-side browser app that demonstrates PII redaction in a simulated chat. The functional skeleton already exists. Your output is self-contained CSS (plus any minimal HTML attribute or class additions you need) layered onto the existing DOM structure. You must not rename, remove, or restructure any element that carries a `data-role` attribute. You must not change any JavaScript behavior.

## Product one-liner

curtain-privacy redacts names, email addresses, and other identifiers from a chat message before any model sees it, then restores them in the reply, entirely in the browser, after a one-time model download.

## Honest tone

State the on-device guarantee precisely: nothing leaves the device after the models have downloaded. The demo never sends user input to a server. Avoid marketing superlatives. The iOS frame (described below) is a stylized visual cue that the same approach is intended for native use; it is not a claim that this web page runs as a native iOS app.

---

## Aesthetic direction

Primary visual reference: poke.com. Match its calm editorial feel: a warm off-white paper background with faint grain, one large transitional serif for the display heading, a clean sans for everything else, monochrome grey chat bubbles rather than iMessage blue, and a single restrained accent used sparingly. The phone floats on a soft, slightly cool shadow the way poke's does.

The scheme is light-first. Dark mode (required below) is the adjusted variant, not an equal-effort second design.

### Palette (light-first)

- Background: warm eggshell, around `#F6F4EC`, with a faint paper grain.
- Phone screen: near-white, `#FFFFFF` to `#FBFAF6`.
- Text: warm near-black `#1A1A18` primary, warm grey `#6B6B66` secondary.
- User bubble (right): medium warm grey, white text. Assistant bubble (left): light warm grey, dark text.
- Single accent: a calm blue around `#3B6FE0`, only for the on-device badge, links, and the verify panel's emphasis. Do not tint the chat bubbles with it.
- Error: a muted warm red around `#C0492F`, not a harsh pure red.

Dark mode: warm charcoal around `#1A1917`, not pure black, off-white text, accent lightened slightly.

### Placeholder tokens are the hero

The verify panel is the proof of privacy. Treat it as an evidence card and emphasize the value-to-placeholder mappings. Give the placeholder tokens (the `[GIVEN_NAME_1.a3f9]` strings in the redacted line and the mapping list) a signature look: monospace on a subtle accent-tinted chip, so "what the assistant saw" reads as protected and visibly differs from the real values beside it.

### Motion

Subtle, poke-like, never loud:

- Bubbles enter with a short slide-up plus fade on a soft ease, you then assistant in sequence.
- The status line cross-fades on text change and gets a gentle pulse during the busy state.
- The badge fades or scales when the mode resolves.
- Verify rows stagger in as they populate.
- Honor `prefers-reduced-motion` by dropping transforms and keeping opacity only.

### Type

No remote fonts or CDNs (see Output constraints). Use a system serif stack for the display heading (`ui-serif, Georgia, "Times New Roman", serif`) and `system-ui` / `-apple-system` for body. To get closer to poke's serif, embed one open serif subset (for example Fraunces or Newsreader) as a base64 woff2 for headings only.

---

## Layout: one screen, two regions

The page has one screen and two side-by-side regions. On narrow viewports the verify panel moves below the phone.

### Region 1: phone (primary)

A stylized iPhone shell that contains the entire chat interface. It signals that the redaction approach is designed for native, on-device use. The shell is decorative; it does not need to be interactive or pixel-perfect. A rounded rectangle with a notch or dynamic-island cutout at the top is sufficient.

Target: `[data-role="phone"]`

Inside the phone, top to bottom:

| Element | Selector | Content / role |
|---|---|---|
| Mode badge | `[data-role="badge"]` | Short text: `mode: on-device LLM` or `mode: scripted reply`. Style as a small pill or chip near the top of the phone. |
| Status line | `[data-role="status"]` | Single line of status text. Changes with app state (see States). |
| Message list | `[data-role="messages"]`, a `<ul>` | Scrollable list of `<li>` chat bubbles. Each `<li>` has `data-who="you"` (user) or `data-who="assistant"`. |
| Composer | `[data-role="composer"]`, a `<form>` | Fixed at the bottom of the phone. Contains a text input (`[data-role="input"]`) and a Send button (no data-role). |

### Region 2: verify panel (secondary)

An aside to the right of the phone on wide viewports, below the phone on narrow viewports. It reveals what the assistant actually received: the redacted message and a table mapping each placeholder back to the original value.

Target: `[data-role="verify"]` (an `<aside>` element)

Inside the verify panel:

| Element | Selector | Content |
|---|---|---|
| Panel heading | `h2` inside `[data-role="verify"]` | Static heading: "What the assistant actually saw". |
| Panel body | `[data-role="verify-body"]` | Populated after each turn. Contains a `<p>` with the redacted message in a `<code>` element, then a `<p>` label followed by a `<ul><li>` list of placeholder-to-value mappings. Empty before the first turn. |

---

## States to style

All state changes are reflected in existing DOM attributes and element content. Do not add JavaScript.

### 1. First-load / model-download

The app downloads two models from Hugging Face on first visit. During this phase:

- `[data-role="input"]` has `disabled` attribute.
- The Send button has `disabled` attribute.
- `[data-role="status"]` text is one of:
  - `Loading the redaction model...`
  - `Loading redaction model... N%` (progress)
  - `Loading the on-device LLM...`
  - `Loading LLM... N%` (progress)

Style: dim the composer area to indicate it is not yet interactive. Show the status text clearly: it is the only progress indicator the user has.

### 2. Ready

Both models are loaded and the app is waiting for input.

- `[data-role="input"]` and Send button are enabled.
- `[data-role="status"]` text: `Ready. Everything runs in your browser; nothing you type leaves the device.`

Style: the full status message should be legible but unobtrusive.

### 3. Per-turn busy

The user has sent a message and the pipeline is running.

- `[data-role="input"]` has `disabled` attribute.
- Send button has `disabled` attribute.
- `[data-role="status"]` text: `Redacting, generating, revealing...`

Style: same dimming treatment as first-load. Optionally add a subtle animation on the status line.

### 4. Error

The pipeline threw. The composer returns to enabled state.

- `[data-role="input"]` and Send button are enabled.
- `[data-role="status"]` text starts with `Error:` followed by the error message.

Style: display the status text in a visually distinct error color. Do not hide or replace the text.

### 5. Badge: on-device LLM vs. scripted reply

`[data-role="badge"]` text is either `mode: on-device LLM` or `mode: scripted reply`.

- `mode: on-device LLM`: the device has WebGPU and is running `Qwen2.5-0.5B-Instruct` locally.
- `mode: scripted reply`: no WebGPU; the reply is generated from a scripted template. Redaction still runs.

Style the two modes distinctly: a color or icon difference is enough. The badge should be visually subordinate to the chat content.

### 6. Chat bubbles

`li[data-who="you"]`: the user's original, un-redacted message. Align right, typical user-bubble treatment.

`li[data-who="assistant"]`: the assistant's reply with placeholders re-substituted (real values restored). Align left.

---

## Responsive behavior

- Wide (min-width around 768 px): phone and verify panel side by side, phone on the left.
- Narrow: verify panel collapses below the phone. The phone should fill the viewport width with some margin.

---

## Output constraints

1. Deliver one self-contained CSS file (no external CDN, no remote fonts; embed any web-safe fonts or use system-ui).
2. If you need to add a class or wrapper element for layout purposes, add it minimally and document it. Do not alter any `data-role` attribute or remove any element the JavaScript addresses.
3. Do not add or modify any JavaScript.
4. Design light-first (see Aesthetic direction), then account for the dark system color scheme preference (`prefers-color-scheme: dark`) as the adjusted variant.
5. Keep the iPhone shell purely decorative: it does not need scrollbars, native chrome, or interactive chrome elements beyond what the chat already provides.

---

## Reference DOM snapshot

This is the exact structure produced by `demo/src/ui.ts`. Your CSS selectors must match this structure.

```html
<div id="app">
  <div data-role="phone">
    <div data-role="badge"></div>
    <div data-role="status"></div>
    <ul data-role="messages">
      <!-- populated at runtime: -->
      <li data-who="you">Alice wants to meet at 3pm.</li>
      <li data-who="assistant">Sure, I can help with that.</li>
    </ul>
    <form data-role="composer">
      <input data-role="input" placeholder="Type a message with a name, email, or SSN" />
      <button type="submit">Send</button>
    </form>
  </div>
  <aside data-role="verify">
    <h2>What the assistant actually saw</h2>
    <div data-role="verify-body">
      <!-- populated after each turn: -->
      <p>Sent to the assistant (redacted): <code>[GIVEN_NAME_1.a3f9] wants to meet at 3pm.</code></p>
      <p>Detected and kept off the wire:</p>
      <ul>
        <li>GIVEN_NAME: <b>Alice</b> -&gt; <code>[GIVEN_NAME_1.a3f9]</code></li>
      </ul>
    </div>
  </aside>
</div>
```

The `data-who`, `disabled`, and text content of `[data-role="badge"]` and `[data-role="status"]` are set by JavaScript at runtime. Style them with attribute selectors and cascade; do not rely on classes the JavaScript does not set.
