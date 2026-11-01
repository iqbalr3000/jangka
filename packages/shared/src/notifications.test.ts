import { describe, expect, it } from "vitest";
import { bodyParts, mentionsIn, mentionToken, plainBody } from "./notifications";

const ADA = "01890a5d-ac96-774b-bcce-b302099a8057";
const BOB = "01890a5d-ac96-774b-bcce-b302099a8058";

describe("mention tokens", () => {
  it("splits text and mentions, keeping markup as text", () => {
    expect(bodyParts(`Hi @[Ada L](user:${ADA}), see <b>this</b> @[Bob](user:${BOB})`)).toEqual([
      { text: "Hi " },
      { mention: { id: ADA, name: "Ada L" } },
      { text: ", see <b>this</b> " },
      { mention: { id: BOB, name: "Bob" } },
    ]);
  });

  it("lists each mentioned id once, in order", () => {
    expect(
      mentionsIn(`@[Bob](user:${BOB}) and @[Ada](user:${ADA}) and @[Bobby](user:${BOB})`),
    ).toEqual([BOB, ADA]);
  });

  it("leaves malformed tokens as text", () => {
    const body = `@[Ada](user:not-an-id) @Ada [Ada](user:${ADA}) @[](user:${ADA}) @[Ada](user:${ADA}`;
    expect(mentionsIn(body)).toEqual([]);
    expect(bodyParts(body)).toEqual([{ text: body }]);
  });

  it("parses ids of users that may not exist (the server decides)", () => {
    expect(mentionsIn(`@[Ghost](user:${ADA.toUpperCase()})`)).toEqual([ADA]);
  });

  it("builds tokens that parse back, dropping brackets from names", () => {
    const token = mentionToken({ id: ADA, name: "Ada [ops]" });
    expect(token).toBe(`@[Ada ops](user:${ADA})`);
    expect(mentionsIn(`x ${token} y`)).toEqual([ADA]);
  });

  it("renders the readable body", () => {
    expect(plainBody(`Ping @[Ada](user:${ADA}) please`)).toBe("Ping @Ada please");
  });
});
