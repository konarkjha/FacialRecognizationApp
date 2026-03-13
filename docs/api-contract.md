# API contract

## Endpoints

### `GET /health`
Returns service health.

### `POST /auth/register`
Creates a demo user.

Request:
```json
{
  "username": "demo",
  "password": "1234",
  "display_name": "Demo"
}
```

### `POST /auth/enroll-device`
Associates a device binding with a user.

### `POST /auth/password-login`
Authenticates with fallback password/PIN.

### `POST /auth/challenge`
Issues a nonce-based face challenge for either `face-primary` or `face-mfa`.

### `POST /auth/verify`
Completes face verification. Phase 1 expects a deterministic placeholder assertion derived from:

`sha256-like(challenge_id : nonce : binding_key_id)`

The backend also checks:
- `face_match == true`
- `liveness_score >= 0.65`
- challenge not expired or reused
