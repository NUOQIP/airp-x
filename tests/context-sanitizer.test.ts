import { describe, expect, it } from "vitest";
import { sanitizeContextValue, stringifyContextValue } from "../apps/server/src/services/context-sanitizer";

describe("context Data URL sanitizer", () => {
  it("recursively removes Data URLs without mutating the snapshot", () => {
    const source = {
      profile: {
        bannerUrl: "data:image/png;base64,AAAA",
        avatarUrl: "data:image/webp;base64,BBBB",
        remoteBannerUrl: "https://example.test/banner.png",
        bio: "ordinary text"
      },
      media: ["data:image/jpeg;base64,CCCC", { url: "https://example.test/media.jpg" }]
    };

    expect(sanitizeContextValue(source)).toEqual({
      profile: {
        remoteBannerUrl: "https://example.test/banner.png",
        bio: "ordinary text"
      },
      media: [{ url: "https://example.test/media.jpg" }]
    });
    expect(source.profile.bannerUrl).toBe("data:image/png;base64,AAAA");
  });

  it("produces context JSON with no inline Data URL payload", () => {
    const json = stringifyContextValue({
      bannerUrl: "  DATA:image/png;base64,AAAA",
      note: "data: is a word here, not a URL",
      name: "Marin"
    });
    expect(json).toBe('{"note":"data: is a word here, not a URL","name":"Marin"}');
  });
});
