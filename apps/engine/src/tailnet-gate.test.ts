import { expect, test } from "bun:test";
import { fromTailnet, gate } from "./tailnet-gate";

test("the tailnet reaches only the phone routes", () => {
  expect(gate("/api/mobile/pair").allow).toBe(true);
  expect(gate("/api/mobile/workouts/").allow).toBe(true);
  expect(gate("/").allow).toBe(false);
  expect(gate("/api/pair/code").allow).toBe(false);
  expect(gate("/api/mobilex").allow).toBe(false);
});

test("only the proxy's stamp marks a request as tailnet", () => {
  expect(fromTailnet(new Headers({ "x-pulso-via": "tailnet" }))).toBe(true);
  expect(fromTailnet(new Headers())).toBe(false);
});
