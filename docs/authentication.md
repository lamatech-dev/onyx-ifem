# Authentication and authorization

ONYX supports a strict signed bearer-token profile for production deployments. Local development remains unauthenticated unless authentication is explicitly enabled.

## Enable required authentication

```bash
ONYX_AUTH_MODE=required \
ONYX_AUTH_PUBLIC_KEY_PATH=/run/secrets/onyx-access-public.pem \
ONYX_AUTH_ISSUER=https://identity.example.com \
ONYX_AUTH_AUDIENCE=onyx-ifem-api \
npm start
```

`ONYX_AUTH_MODE` accepts only `disabled` or `required`. Required mode fails during startup if the selected key source, issuer, or audience is missing or a configured key is not Ed25519. Private signing keys belong to the external identity service and must never be deployed with the ONYX API.

For rotation without a token-signing outage, configure a local static JWKS instead of the single PEM:

```bash
ONYX_AUTH_MODE=required \
ONYX_AUTH_JWKS_PATH=/run/secrets/onyx-access-jwks.json \
ONYX_AUTH_ISSUER=https://identity.example.com \
ONYX_AUTH_AUDIENCE=onyx-ifem-api \
npm start
```

Exactly one of `ONYX_AUTH_PUBLIC_KEY_PATH` and `ONYX_AUTH_JWKS_PATH` must be configured. The JWKS is read at startup, may contain 1–32 public Ed25519 `OKP` keys, and requires a unique bounded `kid` for each key. Private `d` values and incompatible `alg`, `use`, or `key_ops` metadata are rejected. ONYX never follows a token-controlled key URL.

## ONYX access-token profile

Tokens use compact JWS serialization with:

- exactly `alg=EdDSA`;
- exactly `typ=onyx-access+jwt`;
- no `kid` in single-PEM mode, or a required configured `kid` in JWKS mode;
- an Ed25519 signature;
- the configured `iss` and `aud` values;
- UUIDv7 `sub` and `org` claims;
- `actor_type`, unique `scope` values, `authority_epoch`, and non-empty `jti`;
- mandatory `exp`, with optional `nbf` and `iat` NumericDate claims.

Tokens are limited to 8 KiB and must use canonical base64url and valid UTF-8. Unknown header or claim fields are rejected. The verifier allows a configurable clock tolerance capped at five minutes; the server uses the default 30 seconds.

## Command binding

Before a command reaches its context service, the API requires:

- token `org` to equal `organization_id`;
- token `sub` and `actor_type` to equal `actor_context`;
- token `jti` to equal `authority_proof.proof_ref`;
- token and proof authority epochs to match;
- every proof scope to be present in the token;
- proof expiry not to exceed token expiry.

The context service still enforces the command-specific scope and proof expiration. This keeps cryptographic authentication at the API boundary and domain authorization inside the bounded context.

## Query scopes

- `mission:read`
- `work:read`
- `timeline:read`
- `reporting-evidence:read`

The query organization must equal the token organization. `/healthz`, `/readyz`, `/metrics`, and `/openapi.json` remain public for infrastructure operations and API discovery. Keep `/metrics` and `/readyz` off public ingress routes.

## Key rotation

Use an overlap window longer than the maximum token lifetime plus clock tolerance:

1. add the next public key to the mounted JWKS while keeping the retiring key;
2. restart ONYX and verify readiness;
3. switch the issuer to sign new tokens with the next `kid`;
4. wait for all tokens signed by the retiring key to expire;
5. remove the retiring public key and restart ONYX again.

Unknown or missing key IDs fail authentication. The file is intentionally not hot-reloaded, so every accepted key set corresponds to a reviewed deployment revision.

## Deployment requirements

Bearer tokens must be transported over TLS. Invalid or missing tokens return `401 AUTHENTICATION_REQUIRED` with `WWW-Authenticate: Bearer`; authenticated requests that exceed tenant or authority boundaries return 403.

The validation profile follows [JWT Best Current Practices (RFC 8725)](https://www.rfc-editor.org/info/rfc8725/), [JSON Web Token (RFC 7519)](https://www.rfc-editor.org/info/rfc7519/), [JSON Web Key (RFC 7517)](https://www.rfc-editor.org/info/rfc7517/), and [EdDSA for JOSE (RFC 8037)](https://www.rfc-editor.org/info/rfc8037/).
