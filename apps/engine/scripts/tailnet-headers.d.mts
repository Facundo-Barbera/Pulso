import type { IncomingHttpHeaders } from "node:http";
export function forwardHeaders(incoming: IncomingHttpHeaders, targetPort: number): IncomingHttpHeaders;
