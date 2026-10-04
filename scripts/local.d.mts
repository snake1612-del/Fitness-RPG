export function cleanEnvironment(
  source?: Record<string, string | undefined>,
): Record<string, string | undefined>;
export function validateLocalStatus<
  T extends { DB_URL: string; API_URL: string; PUBLISHABLE_KEY?: string },
>(status: T): T;

export function environment(
  local: { DB_URL: string },
  target?: string,
  port?: string,
): Promise<Record<string, string>>;
