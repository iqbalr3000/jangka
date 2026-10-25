import { startOidcStub } from "../apps/api/test/oidc-stub";
import { IDP_PORT } from "./env";
import { ADMIN } from "./session";

// The e2e "corporate IdP": signs everyone in as the onboarding admin, with a verified email.
const stub = await startOidcStub(IDP_PORT);
stub.state.nextClaims = { sub: "ada-sso", email: ADMIN.email, email_verified: true, name: "Ada" };
console.log(`stub IdP at ${stub.issuer}`);
