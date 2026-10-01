import { deleteWater } from "@/src/nutrition/water";
import { json } from "../../../http";
import { invalid } from "../../http";

export const dynamic = "force-dynamic";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return deleteWater((await params).id) ? json({ ok: true }) : invalid("no such entry", 404);
}
