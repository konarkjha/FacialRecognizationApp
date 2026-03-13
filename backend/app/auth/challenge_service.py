from __future__ import annotations

import os
import secrets
from datetime import datetime, timedelta, timezone

from .store import ChallengeRecord, DeviceRecord, SessionRecord, UserRecord, get_challenge, prune_expired_records, save_challenge, save_session


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def hash_password(password: str) -> str:
    import hashlib

    return hashlib.sha256(password.encode("utf-8")).hexdigest()


def verify_password(password: str, password_hash: str) -> bool:
    return hash_password(password) == password_hash


def build_demo_assertion(challenge_id: str, nonce: str, binding_key_id: str) -> str:
    value = f"{challenge_id}:{nonce}:{binding_key_id}"
    hash_value = 0
    for char in value:
        hash_value = (hash_value * 33 + ord(char)) & 0xFFFFFFFF
    return (f"{hash_value:08x}" * 8)[:64]


def issue_challenge(username: str, device_id: str, mode: str) -> ChallengeRecord:
    prune_expired_records(now_utc())
    ttl_seconds = int(os.getenv("CHALLENGE_TTL_SECONDS", "120"))
    challenge = ChallengeRecord(
        challenge_id=secrets.token_urlsafe(18),
        username=username,
        device_id=device_id,
        nonce=secrets.token_urlsafe(24),
        mode=mode,
        expires_at=now_utc() + timedelta(seconds=ttl_seconds),
    )
    return save_challenge(challenge)


def verify_challenge_response(
    *,
    user: UserRecord,
    device: DeviceRecord,
    challenge_id: str,
    client_assertion: str,
    face_match: bool,
    liveness_score: float,
) -> bool:
    prune_expired_records(now_utc())
    challenge = get_challenge(challenge_id)
    if not challenge:
        return False
    if challenge.consumed:
        return False
    if challenge.username != user.username or challenge.device_id != device.device_id:
        return False
    if challenge.expires_at < now_utc():
        return False
    if not face_match:
        return False
    if liveness_score < 0.65:
        return False

    expected = build_demo_assertion(challenge.challenge_id, challenge.nonce, device.binding_key_id)
    if client_assertion != expected:
        return False

    challenge.consumed = True
    save_challenge(challenge)
    return True


def create_session(username: str, auth_method: str) -> SessionRecord:
    prune_expired_records(now_utc())
    ttl_hours = int(os.getenv("SESSION_TTL_HOURS", "12"))
    session = SessionRecord(
        access_token=secrets.token_urlsafe(32),
        username=username,
        auth_method=auth_method,
        expires_at=now_utc() + timedelta(hours=ttl_hours),
    )
    return save_session(session)
