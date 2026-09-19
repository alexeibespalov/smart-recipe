import { afterEach, describe, expect, it, vi } from "vitest";
import { ThermomixAdapter } from "../src/devices/tm/adapter.js";

describe("ThermomixAdapter.getCurrentUser", () => {
  const originalLocale = process.env.TM_LOCALE;

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalLocale === undefined) delete process.env.TM_LOCALE;
    else process.env.TM_LOCALE = originalLocale;
  });

  async function profileUrlFor(locale: string | undefined): Promise<string> {
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (url: string | URL) => {
      urls.push(String(url));
      return new Response(JSON.stringify({ userInfo: { username: "test" } }), { status: 200, headers: { "content-type": "application/json" } });
    });
    if (locale === undefined) delete process.env.TM_LOCALE;
    else process.env.TM_LOCALE = locale;

    await new ThermomixAdapter().getCurrentUser("_oauth2_proxy=a; v-authenticated=b");

    return urls[0];
  }

  it("checks the session on the domain of the configured locale", async () => {
    expect(await profileUrlFor("cs-CZ")).toBe("https://cookidoo.cz/community/profile");
    expect(await profileUrlFor("pl-PL")).toBe("https://cookidoo.pl/community/profile");
  });

  it("defaults to cookidoo.de when no locale is configured", async () => {
    expect(await profileUrlFor(undefined)).toBe("https://cookidoo.de/community/profile");
  });
});
