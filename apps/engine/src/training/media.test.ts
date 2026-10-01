import { beforeEach, expect, test } from "bun:test";
import { CACHE_MS, clearMediaCache, firstFrame, loadGif, parseMediaPath } from "./media";

beforeEach(clearMediaCache);

test("only exercises/<library id>/(animation|thumbnail).gif is a media path", () => {
  expect(parseMediaPath(["exercises", "press-banca", "animation.gif"])).toEqual({ exerciseId: "press-banca", kind: "animation" });
  expect(parseMediaPath(["exercises", "press-banca", "thumbnail.gif"])).toEqual({ exerciseId: "press-banca", kind: "thumbnail" });
  for (const bad of [
    ["exercises", "..", "animation.gif"],
    ["exercises", "../../pulso.sqlite", "animation.gif"],
    ["exercises", "..%2F..%2Fpulso.sqlite", "animation.gif"],
    ["exercises", "press-banca", "..", "animation.gif"],
    ["exercises", "press-banca", "animation.png"],
    ["exercises", "/etc/passwd", "animation.gif"],
    ["exercises", "Press-Banca", "animation.gif"],
    ["exercises", "-press", "animation.gif"],
    ["..", "press-banca", "animation.gif"],
    ["exercises", "press-banca"],
    [],
  ]) {
    expect(parseMediaPath(bad)).toBeNull();
  }
});

// A 2×1 GIF with a global palette, a looping extension and two frames.
const frame = (color: number) => [0x21, 0xf9, 4, 0, 10, 0, 0, 0, 0x2c, 0, 0, 0, 0, 2, 0, 1, 0, 0, 2, 2, 0x44, color, 0];
const GIF = Uint8Array.from([
  ...Array.from("GIF89a", (c) => c.charCodeAt(0)),
  2, 0, 1, 0, 0x80, 0, 0, // 2×1, global table of 2 colours
  0, 0, 0, 255, 255, 255,
  0x21, 0xff, 11, ...Array.from("NETSCAPE2.0", (c) => c.charCodeAt(0)), 3, 1, 0, 0, 0,
  ...frame(0x01),
  ...frame(0x05),
  0x3b,
]);

test("firstFrame keeps the header, palette and only the first frame", () => {
  const still = firstFrame(GIF)!;
  const header = 13 + 6;
  expect([...still.subarray(0, header)]).toEqual([...GIF.subarray(0, header)]);
  expect([...still.subarray(header)]).toEqual([...frame(0x01), 0x3b]);
  expect(still.filter((b) => b === 0x2c).length).toBe(1);
});

test("firstFrame refuses what is not a GIF or is cut short", () => {
  expect(firstFrame(new TextEncoder().encode("<html>not a gif</html>"))).toBeNull();
  expect(firstFrame(GIF.subarray(0, 40))).toBeNull();
});

const fakeFetch = (responses: Response[]) => {
  const calls: string[] = [];
  const fetcher = async (url: string) => {
    calls.push(url);
    return responses.shift() ?? new Response("gone", { status: 404 });
  };
  return { calls, fetcher };
};

test("a GIF is fetched once and served from memory for at most an hour", async () => {
  const { calls, fetcher } = fakeFetch([new Response(GIF), new Response(GIF)]);
  expect(await loadGif("abc123", 0, fetcher)).toEqual(GIF);
  expect(await loadGif("abc123", CACHE_MS - 1, fetcher)).toEqual(GIF);
  expect(calls).toEqual(["https://static.exercisedb.dev/media/abc123.gif"]);
  await loadGif("abc123", CACHE_MS, fetcher);
  expect(calls.length).toBe(2);
});

test("concurrent requests for one GIF share a single download", async () => {
  const { calls, fetcher } = fakeFetch([new Response(GIF)]);
  const [a, b] = await Promise.all([loadGif("same1", 0, fetcher), loadGif("same1", 0, fetcher)]);
  expect(a).toEqual(GIF);
  expect(b).toEqual(GIF);
  expect(calls.length).toBe(1);
});

test("a rate limit is retried once; failures and odd ids are not cached or fetched", async () => {
  const limited = fakeFetch([new Response("slow down", { status: 429, headers: { "retry-after": "0" } }), new Response(GIF)]);
  expect(await loadGif("lim1", 0, limited.fetcher)).toEqual(GIF);
  expect(limited.calls.length).toBe(2);

  const missing = fakeFetch([new Response("no", { status: 404 }), new Response(GIF)]);
  expect(await loadGif("miss1", 0, missing.fetcher)).toBeNull();
  expect(await loadGif("miss1", 0, missing.fetcher)).toEqual(GIF);

  const never = fakeFetch([]);
  expect(await loadGif("../secret", 0, never.fetcher)).toBeNull();
  expect(await loadGif("a.gif?x=1", 0, never.fetcher)).toBeNull();
  expect(never.calls).toEqual([]);
});
