export class ShoppingError extends Error {
  constructor(
    public code: "not_found" | "no_plan",
    message: string,
  ) {
    super(message);
  }
}
