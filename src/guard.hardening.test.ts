// src/guard.hardening.test.ts
import { describe, it, expect } from "vitest";
import { createGuard } from "./guard";

describe("input hardening (recognizer path, no model)", () => {
  it("detects an SSN split by zero-width characters", async () => {
    const guard = await createGuard({ heuristicsOnly: true });
    const { text, placeholders } = await guard.protect("ssn 1​2​3-45-6789");
    expect(placeholders.length).toBe(1);
    expect(text).not.toContain("6789");
  });

  it("detects an email using a Cyrillic homoglyph", async () => {
    const guard = await createGuard({ heuristicsOnly: true });
    const { placeholders } = await guard.protect("mail jоhn@example.com"); // Cyrillic о
    expect(placeholders.length).toBe(1);
  });

  it("detects an SSN written with fullwidth digits", async () => {
    const guard = await createGuard({ heuristicsOnly: true });
    // Fullwidth digits fold to ASCII via NFKC. The raw digit recognizer (\d)
    // matches neither fullwidth digits nor a zero-width-split run, so this and
    // the zero-width test above both fail before the wiring and pass after it.
    const { placeholders } = await guard.protect("ssn １２３-４５-６７８９");
    expect(placeholders.length).toBe(1);
  });

  it("preserves non-PII characters byte-for-byte", async () => {
    const guard = await createGuard({ heuristicsOnly: true });
    const input = "café​: ssn 123-45-6789 ​ok";
    const { text } = await guard.protect(input);
    expect(text.startsWith("café​: ssn ")).toBe(true);
    expect(text.endsWith(" ​ok")).toBe(true);
  });

  it("keeps a planted salted placeholder neutralized in the output", async () => {
    const guard = await createGuard({ heuristicsOnly: true });
    const { text } = await guard.protect("[SSN_1.deadbeef01]");
    expect(text).toContain("［SSN_1.deadbeef01］"); // fullwidth brackets
    expect(text).not.toContain("[SSN_1.deadbeef01]");
  });
});
