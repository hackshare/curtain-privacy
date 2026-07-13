import { expect, test } from "vitest";
import { ChatGuard } from "./guard.ts";
import type { Span } from "./types.ts";

function allOffsets(text: string, needle: string): number[] {
  const out: number[] = [];
  let i = text.indexOf(needle);
  while (i !== -1) {
    out.push(i);
    i = text.indexOf(needle, i + 1);
  }
  return out;
}

test("propagation redacts every repeat of a name the model caught once", async () => {
  const text =
    "Johnny Kimball hit Timmy Johnson and Timmy fell over but Johnny had to hit Timmy because Timmy was going to hit Johnny";
  // The model tags only the first occurrence of each name (the observed failure).
  const first = (needle: string, label: Span["label"]): Span => {
    const start = text.indexOf(needle);
    return { start, end: start + needle.length, label, score: 0.9, source: "ner", text: needle };
  };
  const ner = async (): Promise<Span[]> => [
    first("Johnny", "GIVEN_NAME"),
    first("Kimball", "SURNAME"),
    first("Timmy", "GIVEN_NAME"),
    first("Johnson", "SURNAME"),
  ];
  const guard = new ChatGuard({ ner, noPrefilter: true });
  const spans = await guard.detectRedactions(text);
  const covered = (i: number, len: number) => spans.some((sp) => sp.start <= i && sp.end >= i + len);
  for (const name of ["Johnny", "Kimball", "Timmy", "Johnson"]) {
    for (const off of allOffsets(text, name)) {
      expect(covered(off, name.length)).toBe(true);
    }
  }
});

test("a subword name tag is snapped to the whole word before redaction", async () => {
  const text = "Maria Tanaka fell over";
  const ner = async (): Promise<Span[]> => {
    const mariaAt = text.indexOf("Maria");
    const akaAt = text.indexOf("aka");
    return [
      { start: mariaAt, end: mariaAt + 5, label: "GIVEN_NAME", score: 0.9, source: "ner", text: "Maria" },
      { start: akaAt, end: akaAt + 3, label: "SURNAME", score: 0.4, source: "ner", text: "aka" },
    ];
  };
  const guard = new ChatGuard({ ner, noPrefilter: true });
  const { text: scrubbed } = await guard.protect(text);
  expect(scrubbed).not.toContain("Maria");
  expect(scrubbed).not.toContain("Tan"); // no dangling fragment of Tanaka
  expect(scrubbed).not.toContain("aka");
});
