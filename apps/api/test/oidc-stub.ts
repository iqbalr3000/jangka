import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { exportJWK, generateKeyPair, SignJWT } from "jose";

export type StubClaims = {
  sub: string;
  email?: string;
  email_verified?: boolean | string;
  name?: string;
  hd?: string;
};

type Grant = { clientId: string; nonce: string; challenge: string; claims: StubClaims };

/**
 * Minimal OpenID provider for tests and e2e: discovery, JWKS, an /authorize that redirects
 * straight back with a code (signing in as `nextClaims`), and a /token that checks PKCE and
 * signs the ID token. `tamper` breaks a response on purpose.
 */
export async function startOidcStub(port = 0) {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "stub", alg: "RS256", use: "sig" };
  const grants = new Map<string, Grant>();
  const state = {
    nextClaims: { sub: "user-1" } as StubClaims,
    tamper: {} as { nonce?: string },
  };
  let issuer = "";

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", issuer || "http://127.0.0.1");
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };

    if (url.pathname === "/.well-known/openid-configuration") {
      return json(200, {
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`,
        response_types_supported: ["code"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic"],
      });
    }
    if (url.pathname === "/jwks") return json(200, { keys: [jwk] });
    if (url.pathname === "/authorize") {
      const code = randomBytes(16).toString("hex");
      grants.set(code, {
        clientId: url.searchParams.get("client_id") ?? "",
        nonce: url.searchParams.get("nonce") ?? "",
        challenge: url.searchParams.get("code_challenge") ?? "",
        claims: state.nextClaims,
      });
      const back = new URL(url.searchParams.get("redirect_uri") ?? "");
      back.searchParams.set("code", code);
      back.searchParams.set("state", url.searchParams.get("state") ?? "");
      back.searchParams.set("iss", issuer);
      res.writeHead(302, { location: back.href });
      return res.end();
    }
    if (url.pathname === "/token" && req.method === "POST") {
      let raw = "";
      req.on("data", (chunk: Buffer) => {
        raw += chunk.toString("utf8");
      });
      req.on("end", async () => {
        const form = new URLSearchParams(raw);
        const grant = grants.get(form.get("code") ?? "");
        grants.delete(form.get("code") ?? "");
        const verifier = form.get("code_verifier") ?? "";
        const challenge = createHash("sha256").update(verifier).digest("base64url");
        if (!grant || challenge !== grant.challenge) return json(400, { error: "invalid_grant" });
        const idToken = await new SignJWT({
          ...grant.claims,
          nonce: state.tamper.nonce ?? grant.nonce,
        })
          .setProtectedHeader({ alg: "RS256", kid: "stub" })
          .setIssuer(issuer)
          .setAudience(grant.clientId)
          .setSubject(grant.claims.sub)
          .setIssuedAt()
          .setExpirationTime("5m")
          .sign(privateKey);
        json(200, { access_token: "stub-access", token_type: "Bearer", id_token: idToken });
      });
      return;
    }
    json(404, { error: "not_found" });
  });

  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  return {
    issuer,
    state,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

export type OidcStub = Awaited<ReturnType<typeof startOidcStub>>;
