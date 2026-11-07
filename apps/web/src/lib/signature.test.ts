import { expect, test } from "bun:test";
import { withSignature } from "@/lib/signature";
test("signatures preserve draft HTML and escape plain text", () => {
  expect(withSignature("<p>Draft</p>", "A <B>\r\nTeam")).toBe("<p>Draft</p><p><br></p><p>A &lt;B&gt;<br>Team</p>");
  expect(withSignature("<p>Draft</p>", "")).toBe("<p>Draft</p>");
  expect(withSignature("", 'A & "B"')).toBe("<p><br></p><p>A &amp; &quot;B&quot;</p>");
});
