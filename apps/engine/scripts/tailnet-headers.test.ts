import { expect, test } from "bun:test";
import { forwardHeaders } from "./tailnet-headers.mjs";

test("the proxy stamps tailnet, keeps the browser's Host and points Host at the engine", () => {
  const headers = forwardHeaders({ host: "100.64.0.7:8090", cookie: "a=b" }, 3230);
  expect(headers).toMatchObject({ "x-pulso-via": "tailnet", "x-pulso-host": "100.64.0.7:8090", host: "127.0.0.1:3230", cookie: "a=b" });
});

test("a client cannot forge the proxy's headers", () => {
  const headers = forwardHeaders({ "x-pulso-via": "loopback", "x-pulso-host": "evil.example" }, 3230);
  expect(headers["x-pulso-via"]).toBe("tailnet");
  expect(headers["x-pulso-host"]).toBeUndefined();
});

test("tailscale serve's forwarded headers are dropped, so Next keeps answering on plain http", () => {
  const headers = forwardHeaders({ host: "mini.tail.ts.net:8443", "x-forwarded-proto": "https", "x-forwarded-host": "mini.tail.ts.net:8443", "x-forwarded-for": "100.64.0.9" }, 3230);
  expect(headers["x-pulso-host"]).toBe("mini.tail.ts.net:8443");
  expect(headers["x-forwarded-proto"]).toBeUndefined();
  expect(headers["x-forwarded-for"]).toBeUndefined();
});
