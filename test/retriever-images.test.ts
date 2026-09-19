import { describe, expect, it } from "vitest";
import { findRecipeImageCandidates, hydrateImages } from "../src/retriever/images.js";

describe("hydrateImages", () => {
  it("keeps recipe photos larger than 5 MB for the upload but does not send them to the vision model", async () => {
    const big = new Uint8Array(8 * 1024 * 1024);
    big[0] = 0xff;
    big[1] = 0xd8;
    const fetchImpl = (async () => new Response(big, { status: 200, headers: { "content-type": "image/jpeg" } })) as unknown as typeof fetch;

    const [image] = await hydrateImages([{ url: "https://example.com/big.jpg", contentType: "image/jpeg", score: 1, reason: "test" }], { fetchImpl });

    expect(image.bytes?.byteLength).toBe(8 * 1024 * 1024);
    expect(image.dataUrl).toBeUndefined();
  });

  it("still provides a data URL for small images", async () => {
    const small = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const fetchImpl = (async () => new Response(small, { status: 200, headers: { "content-type": "image/jpeg" } })) as unknown as typeof fetch;

    const [image] = await hydrateImages([{ url: "https://example.com/small.jpg", contentType: "image/jpeg", score: 1, reason: "test" }], { fetchImpl });

    expect(image.bytes).toEqual(small);
    expect(image.dataUrl).toMatch(/^data:image\/jpeg;base64,/);
  });

  it("skips images above the configured maximum", async () => {
    const fetchImpl = (async () => new Response(new Uint8Array(1024), { status: 200, headers: { "content-type": "image/jpeg" } })) as unknown as typeof fetch;

    const images = await hydrateImages([{ url: "https://example.com/a.jpg", contentType: "image/jpeg", score: 1, reason: "test" }], { fetchImpl, maxBytes: 512 });

    expect(images).toHaveLength(0);
  });
});

describe("findRecipeImageCandidates", () => {
  it("keeps commas that are part of an image URL (e.g. Cloudflare image resizing)", () => {
    const html = '<img class="hero" src="/cdn-cgi/image/f=auto,w=800/img/recipe.jpg">';

    const [image] = findRecipeImageCandidates(html, "https://shop.example/recipe/1");

    expect(image.url).toBe("https://shop.example/cdn-cgi/image/f=auto,w=800/img/recipe.jpg");
  });

  it("still uses only the first entry of a srcset-style list", () => {
    const html = '<img data-src="https://cdn.example.com/a.jpg 1x, https://cdn.example.com/b.jpg 2x">';

    const [image] = findRecipeImageCandidates(html, "https://shop.example/recipe/1");

    expect(image.url).toBe("https://cdn.example.com/a.jpg");
  });
});
