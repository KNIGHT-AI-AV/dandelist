import assert from "node:assert/strict";
import { test } from "node:test";
import { parseHelpArgs } from "./help-args";

test("a six-character code is a code, digits or letters, any case (review of #140, H7)", () => {
  assert.deepEqual(parseHelpArgs(["123456"]), { code: "123456", count: null });
  assert.deepEqual(parseHelpArgs(["ABCDEF"]), { code: "abcdef", count: null });
  assert.deepEqual(parseHelpArgs(["aBc123"]), { code: "abc123", count: null });
});

test("a count says so, and stays between 1 and 50", () => {
  assert.deepEqual(parseHelpArgs([]), { code: null, count: 5 });
  assert.deepEqual(parseHelpArgs(["--count", "20"]), { code: null, count: 20 });
  assert.deepEqual(parseHelpArgs(["--count=7"]), { code: null, count: 7 });
  assert.deepEqual(parseHelpArgs(["-n", "3"]), { code: null, count: 3 });
  assert.deepEqual(parseHelpArgs(["--count", "50"]), { code: null, count: 50 });
});

test("anything else is refused with the usage, never guessed at", () => {
  for (const bad of [["20"], ["12345"], ["1234567"], ["XYZ123"], ["--count"], ["--count", "0"], ["--count", "51"], ["--count", "abc"], ["ABCDEF", "extra"], ["-n", "-1"]]) {
    assert.ok("error" in parseHelpArgs(bad), JSON.stringify(bad));
  }
});
