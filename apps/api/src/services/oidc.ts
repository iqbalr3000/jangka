import type { authProviders } from "@jangka/db";
import { decryptSecret, encryptSecret } from "@jangka/shared/crypto";
import { AppError } from "@jangka/shared/errors";
import * as client from "openid-client";
import { z } from "zod";
import type { SsoClaims } from "./sso";

type ProviderRow = typeof authProviders.$inferSelect;

const FLOW_TTL_MS = 10 * 60 * 1000;
const DISCOVERY_TTL_MS = 60 * 60 * 1000;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** https, or http on the local machine (Keycloak/Dex in dev, the stub IdP in tests). */
export function assertIssuerAllowed(issuer: string): void {
  const url = new URL(issuer);
  if (url.protocol === "https:" || (url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname))) {
    return;
  }
  throw new AppError("validation_failed", 400, "The issuer must use https", [
    { path: ["issuer"], message: "Use an https:// issuer URL" },
  ]);
}

/**
 * One callback for every provider (the flow cookie names the provider), so admins can register
 * it with the IdP before the provider exists in Jangka.
 */
export function redirectUri(publicUrl: string): string {
  return `${publicUrl}/api/v1/auth/oidc/callback`;
}

type ClientInput = { issuer: string; clientId: string; clientSecret: string };

function discover(input: ClientInput): Promise<client.Configuration> {
  const issuer = new URL(input.issuer);
  return client.discovery(issuer, input.clientId, input.clientSecret, undefined, {
    execute: issuer.protocol === "http:" ? [client.allowInsecureRequests] : [],
  });
}

const cache = new Map<string, { at: number; config: Promise<client.Configuration> }>();

/** Discovery, cached per provider version so edits apply without a restart. */
export function configurationFor(
  provider: ProviderRow,
  masterKey: Buffer,
): Promise<client.Configuration> {
  const key = `${provider.id}:${provider.updatedAt.getTime()}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < DISCOVERY_TTL_MS) return hit.config;

  const config = discover({
    issuer: provider.issuer,
    clientId: provider.clientId,
    clientSecret: decryptSecret(provider.clientSecretEnc, masterKey),
  });
  for (const old of cache.keys()) if (old.startsWith(`${provider.id}:`)) cache.delete(old);
  cache.set(key, { at: Date.now(), config });
  config.catch(() => cache.delete(key));
  return config;
}

/** Discovery for an admin "Test" or before saving (uncached); a normalized message on failure. */
export async function testDiscovery(input: ClientInput): Promise<void> {
  try {
    await discover(input);
  } catch {
    throw new AppError(
      "invalid_provider",
      400,
      "Couldn't read the provider's OpenID configuration. Check the issuer URL.",
    );
  }
}

const flowState = z.object({
  providerId: z.string(),
  state: z.string(),
  nonce: z.string(),
  verifier: z.string(),
  redirect: z.string(),
  expiresAt: z.number(),
});
type FlowState = z.infer<typeof flowState>;

/** Relative paths only (`/x`, not `//x` or `/\x`), so the callback can't become an open redirect. */
export function safeRedirectPath(value: string | undefined): string {
  return value && /^\/(?![/\\])/.test(value) ? value : "/";
}

/** The IdP authorization URL plus the encrypted flow cookie value (state, nonce, PKCE). */
export async function startFlow(
  provider: ProviderRow,
  options: { publicUrl: string; masterKey: Buffer; redirect?: string },
): Promise<{ url: string; cookie: string }> {
  const config = await configurationFor(provider, options.masterKey);
  const verifier = client.randomPKCECodeVerifier();
  const flow: FlowState = {
    providerId: provider.id,
    state: client.randomState(),
    nonce: client.randomNonce(),
    verifier,
    redirect: safeRedirectPath(options.redirect),
    expiresAt: Date.now() + FLOW_TTL_MS,
  };
  const url = client.buildAuthorizationUrl(config, {
    redirect_uri: redirectUri(options.publicUrl),
    scope: "openid email profile",
    code_challenge: await client.calculatePKCECodeChallenge(verifier),
    code_challenge_method: "S256",
    state: flow.state,
    nonce: flow.nonce,
  });
  return { url: url.href, cookie: encryptSecret(JSON.stringify(flow), options.masterKey) };
}

/** Decrypted, unexpired flow, or null (missing, tampered or expired). */
export function readFlow(cookie: string | undefined, masterKey: Buffer): FlowState | null {
  if (!cookie) return null;
  try {
    const flow = flowState.parse(JSON.parse(decryptSecret(cookie, masterKey)));
    return flow.expiresAt > Date.now() ? flow : null;
  } catch {
    return null;
  }
}

const idTokenClaims = z.object({
  sub: z.string().min(1),
  email: z.string().optional(),
  email_verified: z.unknown().optional(),
  name: z.string().optional(),
  hd: z.string().optional(),
});

/**
 * Exchanges the code (checks state, PKCE and the ID token's nonce and signature) and returns
 * its claims. `callbackUrl` is rebuilt from PUBLIC_URL so it matches the registered redirect URI
 * behind a proxy.
 */
export async function finishFlow(
  provider: ProviderRow,
  flow: FlowState,
  callbackUrl: URL,
  masterKey: Buffer,
): Promise<SsoClaims> {
  const config = await configurationFor(provider, masterKey);
  const tokens = await client.authorizationCodeGrant(config, callbackUrl, {
    pkceCodeVerifier: flow.verifier,
    expectedState: flow.state,
    expectedNonce: flow.nonce,
    idTokenExpected: true,
  });
  const claims = idTokenClaims.parse(tokens.claims());
  return {
    sub: claims.sub,
    email: claims.email,
    // Only a real boolean true counts (some IdPs send the string "true").
    email_verified: claims.email_verified === true,
    name: claims.name,
    hd: claims.hd,
  };
}
