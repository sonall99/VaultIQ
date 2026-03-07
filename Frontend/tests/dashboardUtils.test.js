import test from "node:test";
import assert from "node:assert/strict";
import {
  parseQuestions,
  suggestRunName,
  resolveCitationDoc,
} from "../src/lib/dashboardUtils.js";

test("parseQuestions extracts numbered lines", () => {
  const rows = parseQuestions("1. Hello?\n2) World?\nNope");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].num, 1);
  assert.equal(rows[1].text, "World?");
});

test("suggestRunName uses first numbered question", () => {
  const name = suggestRunName("Intro\n1. What controls exist?\n2. Another");
  assert.match(name, /What controls exist/);
});

test("resolveCitationDoc matches similar titles", () => {
  const docs = [
    { id: "1", title: "VaultIQ Security & Encryption Policy" },
    { id: "2", title: "VaultIQ SLA" },
  ];
  const match = resolveCitationDoc("VaultIQ Security Policy", docs);
  assert.ok(match);
  assert.equal(match.id, "1");
});
