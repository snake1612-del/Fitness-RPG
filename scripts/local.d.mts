export function cleanEnvironment(
  source?: Record<string, string | undefined>,
): Record<string, string | undefined>;
export const localSettings: Readonly<{
  project: string;
  container: string;
  volume: string;
  image: string;
  port: string;
  user: string;
  database: string;
}>;
export function assertLocalMode(
  source?: Record<string, string | undefined>,
): void;
export function validateDockerEndpoint(endpoint: string): void;
export function validateLocalDatabaseUrl(value: string): string;
export function validateComposeConfiguration(config: unknown): void;
export function validateLocalContainer(info: unknown, healthy?: boolean): void;
export function composeArguments(
  command: "start" | "stop" | "config",
): string[];
export function verifyMigrationHistory(
  rows: { hash: string; created_at: string | number }[],
  expected: { hash: string; folderMillis: number }[],
  complete?: boolean,
): void;
export function localDatabase(): Promise<{ DB_URL: string }>;

export function environment(
  local: { DB_URL: string },
  target?: string,
  port?: string,
): Promise<Record<string, string>>;
