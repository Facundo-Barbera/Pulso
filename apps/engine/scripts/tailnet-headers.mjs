/**
 * The headers the tailnet proxy forwards. Its word and nobody else's: any
 * client-sent `x-pulso-via` / `x-pulso-host` is dropped before stamping.
 * `x-pulso-host` keeps the Host the browser wrote, because `host` is rewritten
 * to the engine's loopback address; cookie writes check `Origin` against it.
 *
 * @param {import("node:http").IncomingHttpHeaders} incoming
 * @param {number} targetPort
 */
export function forwardHeaders(incoming, targetPort) {
  const headers = { ...incoming };
  delete headers["x-pulso-via"];
  delete headers["x-pulso-host"];
  headers["x-pulso-via"] = "tailnet";
  if (incoming.host) headers["x-pulso-host"] = incoming.host;
  headers.host = `127.0.0.1:${targetPort}`;
  return headers;
}
