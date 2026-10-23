import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createLogger } from "../src/logger";

function capture() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(String(chunk));
      callback();
    },
  });
  return { lines, logger: createLogger({ level: "info", pretty: false }, stream) };
}

describe("logger redaction", () => {
  it("redacts secret fields at the top level and one level deep", () => {
    const { lines, logger } = capture();
    logger.info(
      { apiKey: "sk-top", provider: { apiKey: "sk-nested", password: "pw", token: "tok" } },
      "x",
    );
    const output = lines.join("");
    for (const secret of ["sk-top", "sk-nested", "pw", "tok"]) {
      expect(output).not.toContain(`"${secret}"`);
    }
    expect(output.match(/\[Redacted\]/g)).toHaveLength(4);
  });

  it("redacts cookie and authorization request headers", () => {
    const { lines, logger } = capture();
    logger.info(
      { req: { headers: { cookie: "session=abc", authorization: "Bearer xyz", accept: "*/*" } } },
      "x",
    );
    const output = lines.join("");
    expect(output).not.toContain("session=abc");
    expect(output).not.toContain("Bearer xyz");
    expect(output).toContain("*/*");
  });
});
