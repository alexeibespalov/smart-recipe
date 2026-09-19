import { describe, expect, it } from "vitest";
import { MonsieurCuisineSmartClient } from "../src/mc/client.js";

function clientReturning(body: unknown): MonsieurCuisineSmartClient {
  const fetchImpl = (async () => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
  return new MonsieurCuisineSmartClient({ cookie: "session=test", locale: "cs-CZ", fetch: fetchImpl });
}

describe("MonsieurCuisineSmartClient.getMedia", () => {
  it("returns the media list when the API sends data.media as an array", async () => {
    const client = clientReturning({ code: 0, data: { media: [{ id: 1, url: "https://cdn.example/1.jpg" }, { id: 2, url: "https://cdn.example/2.jpg" }] } });

    const media = await client.getMedia([1, 2]);

    expect(media).toEqual([{ id: 1, url: "https://cdn.example/1.jpg" }, { id: 2, url: "https://cdn.example/2.jpg" }]);
  });

  it("treats an empty media array as 'not processed yet' instead of failing", async () => {
    const client = clientReturning({ code: 0, data: { media: [] } });

    await expect(client.getMedia([1])).resolves.toEqual([]);
  });
});
