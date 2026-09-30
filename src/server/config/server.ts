import "server-only";
import { parseServerConfig } from "./parse";

export function getServerConfig() {
  return parseServerConfig(process.env);
}
