# Phase 1 scope

This MVP proves the face-login architecture without claiming production-grade spoof resistance.

## Included
- FastAPI backend with user registration, password login, device enrollment, challenge issue, and challenge verification.
- React Native Android client structure for enrollment, face-primary login, and face-MFA flow.
- On-device encrypted storage for the face template placeholder and device binding metadata.
- Placeholder embedding and matching logic to validate the app architecture.

## Deferred
- Real camera preview + landmark detection
- On-device ML embedding model
- Strong cryptographic device attestation
- Passive/active liveness checks
- Root/jailbreak detection
- Remote revocation and risk engines
