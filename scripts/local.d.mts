export function cleanEnvironment(
  source?: Record<string, string | undefined>,
): Record<string, string | undefined>;
export function validateLocalStatus<
  T extends { DB_URL: string; API_URL: string; PUBLISHABLE_KEY?: string },
>(status: T): T;
