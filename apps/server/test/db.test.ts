import { describe, expect, it } from "vitest";
process.env.DB_PATH = ":memory:";

describe("fare cache", () => {
  it("does not let an empty page wipe fares already stored", async () => {
    const { cachePut, cacheGet } = await import("../src/db.ts");
    const fare = { id: "x", provider: "google", price: 515, currency: "GBP", fetchedAt: "", slices: [] } as never;
    cachePut("k", [fare]);
    cachePut("k", []);
    expect(cacheGet("k", 60)).toHaveLength(1);
    // A page that was empty before can still be stored as empty.
    cachePut("e", []);
    cachePut("e", []);
    expect(cacheGet("e", 60)).toEqual([]);
  });
});
