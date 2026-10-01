import { json } from "../http";

export type Context = { params: Promise<{ id: string }> };

export const notFound = () => json({ code: "not_found", message: "Esa conversación ya no existe." }, 404);
export const busy = () => json({ code: "busy", message: "El Coach todavía está respondiendo en esta conversación." }, 409);
