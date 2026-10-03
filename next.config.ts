import type { NextConfig } from "next";

// Keep local startup from generating agent instruction files in the checkout.
const config: NextConfig = {
  ...(process.env.LOCAL_DEV === "true" ? { agentRules: false } : {}),
};
export default config;
