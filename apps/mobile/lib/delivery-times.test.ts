import { describe, expect, it } from "vitest";
import { nextDeliveryTime } from "./delivery-times";

describe("nextDeliveryTime", () => {
  it("suggests the evening beside a morning time", () => {
    expect(nextDeliveryTime([540])).toBe(1140);
  });

  it("suggests midday once the evening is taken", () => {
    expect(nextDeliveryTime([540, 1140])).toBe(720);
  });

  it("falls back to the first free half-hour when every suggestion is taken", () => {
    expect(nextDeliveryTime([1140, 720, 1260, 540])).toBe(0);
  });
});
