export type Identity = { id: string };

export interface AuthIdentityProvider {
  currentIdentity(): Promise<Identity | null>;
}

export interface DatabaseReadinessPort {
  check(): Promise<void>;
}
