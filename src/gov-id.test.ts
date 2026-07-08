import { expect, test } from "vitest";
import { detectGovernmentIds } from "./gov-id";

const ids = (text: string) => detectGovernmentIds(text).map((s) => s.text);

test("catches cued government/agency IDs, and only them, in their real contexts", () => {
  const cases: [string, string][] = [
    ["emp id:EMP-334455 dept:Finance", "EMP-334455"],
    ["My government ID is NIN-998877 and", "NIN-998877"],
    ["My state-issued ID number is GV9876543.", "GV9876543"],
    ["My state agency number is AGN-776655.", "AGN-776655"],
    ["staff badge:STF-990011 name:Aaron Wu", "STF-990011"],
    ["Resident ID: RSN-224466, issued to", "RSN-224466"],
    ["Claimant Rita Vega, ID BEN-443322, SSN", "BEN-443322"],
    ["needs access, government ID GOV-223344, to the", "GOV-223344"],
  ];
  for (const [text, id] of cases) {
    // toEqual, not toContain: a positive case must not also emit false-positive spans.
    expect(ids(text), text).toEqual([id]);
  }
});

test("rejects '#'-prefixed order codes even with a cue nearby, with or without a space", () => {
  expect(ids("employee case:#CAL-2290 filed today")).toEqual([]);
  expect(ids("employee case: # CAL-2290 filed today")).toEqual([]);
  expect(ids("incident report #INC-0077 opened")).toEqual([]);
  expect(ids("order #ORD-8821045 to ship")).toEqual([]);
});

test("rejects bare reference codes with no identity cue", () => {
  expect(ids("routing:021000021 acct:456789012345 amt:$2,000.00 ref:WIRE-20260502")).toEqual([]);
  expect(ids("payment routing:081000210 acct:223344556677 ref:INV-9988 $450.00")).toEqual([]);
});

test("a cue does not bleed across a prior candidate onto a following look-alike", () => {
  // "government ID" belongs to EMP-334455; REF-556677 that follows must not inherit it.
  expect(ids("government ID EMP-334455 ref:REF-556677")).toEqual(["EMP-334455"]);
});

test("rejects a prefixed code with no cue in its window", () => {
  expect(ids("the code is ABC-123456 for the widget")).toEqual([]);
});

test("cue must fall inside the 48-char window", () => {
  // "government" is 10 chars; pad with spaces so the code (preceded by a space,
  // giving the word boundary the candidate needs) starts at exactly 48 or 49.
  const near = `government${" ".repeat(38)}AB-123456`; // code at index 48 -> cue in window
  const far = `government${" ".repeat(39)}AB-123456`; // code at index 49 -> cue just outside
  expect(ids(near)).toEqual(["AB-123456"]);
  expect(ids(far)).toEqual([]);
});

test("does not fire on state+ZIP, times, or mixed-case words", () => {
  expect(ids("government office Dallas TX 75201 today")).toEqual([]);
  expect(ids("staff clearance:Level 2 site:Portland")).toEqual([]);
  expect(ids("government meeting at 10:30 today")).toEqual([]);
});

test("catches prefixed IDs under additional international identity cues", () => {
  expect(ids("social insurance ABC-99881 on record")).toEqual(["ABC-99881"]);
  expect(ids("aadhaar AAD-123456 verified")).toEqual(["AAD-123456"]);
  expect(ids("citizen number CIT-778812 valid")).toEqual(["CIT-778812"]);
});

test("catches a prefixed ID under the social security cue", () => {
  expect(ids("social security XYZ-44821 filed")).toEqual(["XYZ-44821"]);
});
