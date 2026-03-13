from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
import json
import os
import sqlite3
from typing import Dict, List, Optional


@dataclass
class DeviceRecord:
    device_id: str
    device_name: str
    binding_key_id: str
    enrolled_at: datetime
    face_vector: Optional[List[float]] = None
    face_vectors: Optional[Dict[str, List[float]]] = None


@dataclass
class UserRecord:
    username: str
    password_hash: str
    display_name: str | None = None
    devices: Dict[str, DeviceRecord] = field(default_factory=dict)


@dataclass
class ChallengeRecord:
    challenge_id: str
    username: str
    device_id: str
    nonce: str
    mode: str
    expires_at: datetime
    consumed: bool = False


@dataclass
class SessionRecord:
    access_token: str
    username: str
    auth_method: str
    expires_at: datetime


def _resolve_db_path() -> Path:
    configured = os.getenv("FACEAUTH_DB_PATH")
    if configured:
        return Path(configured)
    return Path(__file__).resolve().parents[2] / "data" / "faceauth.sqlite3"


DB_PATH = _resolve_db_path()


def _connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def _to_iso(value: datetime) -> str:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat()


def _from_iso(value: str) -> datetime:
    return datetime.fromisoformat(value)


def _init_db() -> None:
    with _connect() as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                username TEXT PRIMARY KEY,
                password_hash TEXT NOT NULL,
                display_name TEXT
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS devices (
                username TEXT NOT NULL,
                device_id TEXT NOT NULL,
                device_name TEXT NOT NULL,
                binding_key_id TEXT NOT NULL,
                enrolled_at TEXT NOT NULL,
                face_vector TEXT,
                face_vectors TEXT,
                PRIMARY KEY (username, device_id),
                FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
            )
            """
        )
        # Migrate existing DB that may not have the face_vector column yet
        existing_cols = [row[1] for row in connection.execute("PRAGMA table_info(devices)").fetchall()]
        if "face_vector" not in existing_cols:
            connection.execute("ALTER TABLE devices ADD COLUMN face_vector TEXT")
        if "face_vectors" not in existing_cols:
            connection.execute("ALTER TABLE devices ADD COLUMN face_vectors TEXT")
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS challenges (
                challenge_id TEXT PRIMARY KEY,
                username TEXT NOT NULL,
                device_id TEXT NOT NULL,
                nonce TEXT NOT NULL,
                mode TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                consumed INTEGER NOT NULL DEFAULT 0
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS sessions (
                access_token TEXT PRIMARY KEY,
                username TEXT NOT NULL,
                auth_method TEXT NOT NULL,
                expires_at TEXT NOT NULL
            )
            """
        )
        connection.commit()


_init_db()


def get_user(username: str) -> Optional[UserRecord]:
    normalized = username.lower()
    with _connect() as connection:
        user_row = connection.execute(
            "SELECT username, password_hash, display_name FROM users WHERE username = ?",
            (normalized,),
        ).fetchone()
        if not user_row:
            return None

        device_rows = connection.execute(
            """
            SELECT device_id, device_name, binding_key_id, enrolled_at, face_vector, face_vectors
            FROM devices
            WHERE username = ?
            """,
            (normalized,),
        ).fetchall()

    devices: Dict[str, DeviceRecord] = {}
    for row in device_rows:
        raw_vec = row["face_vector"]
        face_vector = json.loads(raw_vec) if raw_vec else None
        raw_vecs = row["face_vectors"]
        face_vectors = json.loads(raw_vecs) if raw_vecs else None
        device = DeviceRecord(
            device_id=row["device_id"],
            device_name=row["device_name"],
            binding_key_id=row["binding_key_id"],
            enrolled_at=_from_iso(row["enrolled_at"]),
            face_vector=face_vector,
            face_vectors=face_vectors,
        )
        devices[device.device_id] = device

    return UserRecord(
        username=user_row["username"],
        password_hash=user_row["password_hash"],
        display_name=user_row["display_name"],
        devices=devices,
    )


def save_user(user: UserRecord) -> UserRecord:
    normalized = user.username.lower()
    with _connect() as connection:
        connection.execute(
            """
            INSERT INTO users (username, password_hash, display_name)
            VALUES (?, ?, ?)
            ON CONFLICT(username) DO UPDATE SET
                password_hash = excluded.password_hash,
                display_name = excluded.display_name
            """,
            (normalized, user.password_hash, user.display_name),
        )

        connection.execute("DELETE FROM devices WHERE username = ?", (normalized,))
        for device in user.devices.values():
            vec_json = json.dumps(device.face_vector) if device.face_vector else None
            vecs_json = json.dumps(device.face_vectors) if device.face_vectors else None
            connection.execute(
                """
                INSERT INTO devices (username, device_id, device_name, binding_key_id, enrolled_at, face_vector, face_vectors)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    normalized,
                    device.device_id,
                    device.device_name,
                    device.binding_key_id,
                    _to_iso(device.enrolled_at),
                    vec_json,
                    vecs_json,
                ),
            )
        connection.commit()

    saved_user = get_user(normalized)
    return saved_user if saved_user else user


def save_challenge(challenge: ChallengeRecord) -> ChallengeRecord:
    with _connect() as connection:
        connection.execute(
            """
            INSERT INTO challenges (challenge_id, username, device_id, nonce, mode, expires_at, consumed)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(challenge_id) DO UPDATE SET
                username = excluded.username,
                device_id = excluded.device_id,
                nonce = excluded.nonce,
                mode = excluded.mode,
                expires_at = excluded.expires_at,
                consumed = excluded.consumed
            """,
            (
                challenge.challenge_id,
                challenge.username,
                challenge.device_id,
                challenge.nonce,
                challenge.mode,
                _to_iso(challenge.expires_at),
                1 if challenge.consumed else 0,
            ),
        )
        connection.commit()
    return challenge


def get_challenge(challenge_id: str) -> Optional[ChallengeRecord]:
    with _connect() as connection:
        row = connection.execute(
            """
            SELECT challenge_id, username, device_id, nonce, mode, expires_at, consumed
            FROM challenges
            WHERE challenge_id = ?
            """,
            (challenge_id,),
        ).fetchone()

    if not row:
        return None

    return ChallengeRecord(
        challenge_id=row["challenge_id"],
        username=row["username"],
        device_id=row["device_id"],
        nonce=row["nonce"],
        mode=row["mode"],
        expires_at=_from_iso(row["expires_at"]),
        consumed=bool(row["consumed"]),
    )


def save_session(session: SessionRecord) -> SessionRecord:
    with _connect() as connection:
        connection.execute(
            """
            INSERT INTO sessions (access_token, username, auth_method, expires_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(access_token) DO UPDATE SET
                username = excluded.username,
                auth_method = excluded.auth_method,
                expires_at = excluded.expires_at
            """,
            (session.access_token, session.username, session.auth_method, _to_iso(session.expires_at)),
        )
        connection.commit()
    return session


def prune_expired_records(now: datetime) -> None:
    now_iso = _to_iso(now)
    with _connect() as connection:
        connection.execute("DELETE FROM challenges WHERE consumed = 1 OR expires_at < ?", (now_iso,))
        connection.execute("DELETE FROM sessions WHERE expires_at < ?", (now_iso,))
        connection.commit()


def list_all_users() -> list[UserRecord]:
    """Return every registered user with their enrolled devices."""
    with _connect() as connection:
        user_rows = connection.execute(
            "SELECT username, password_hash, display_name FROM users ORDER BY username"
        ).fetchall()
        device_rows = connection.execute(
            "SELECT username, device_id, device_name, binding_key_id, enrolled_at, face_vector, face_vectors FROM devices ORDER BY username, enrolled_at"
        ).fetchall()

    devices_by_user: Dict[str, Dict[str, DeviceRecord]] = {}
    for row in device_rows:
        bucket = devices_by_user.setdefault(row["username"], {})
        raw_vec = row["face_vector"]
        face_vector = json.loads(raw_vec) if raw_vec else None
        raw_vecs = row["face_vectors"]
        face_vectors = json.loads(raw_vecs) if raw_vecs else None
        bucket[row["device_id"]] = DeviceRecord(
            device_id=row["device_id"],
            device_name=row["device_name"],
            binding_key_id=row["binding_key_id"],
            enrolled_at=_from_iso(row["enrolled_at"]),
            face_vector=face_vector,
            face_vectors=face_vectors,
        )

    result = []
    for row in user_rows:
        result.append(
            UserRecord(
                username=row["username"],
                password_hash=row["password_hash"],
                display_name=row["display_name"],
                devices=devices_by_user.get(row["username"], {}),
            )
        )
    return result


def list_all_face_vectors() -> list[tuple[str, str, list[float]]]:
    """Return (username, device_id, face_vector) for all enrolled devices that have a stored vector."""
    with _connect() as connection:
        rows = connection.execute(
            "SELECT username, device_id, face_vector, face_vectors FROM devices WHERE face_vector IS NOT NULL OR face_vectors IS NOT NULL"
        ).fetchall()
    result: list[tuple[str, str, list[float]]] = []
    for row in rows:
        if row["face_vector"]:
            result.append((row["username"], row["device_id"], json.loads(row["face_vector"])))
            continue
        if row["face_vectors"]:
            vecs = json.loads(row["face_vectors"])
            front = vecs.get("front") if isinstance(vecs, dict) else None
            if front:
                result.append((row["username"], row["device_id"], front))
    return result


def list_active_sessions() -> list[SessionRecord]:
    """Return all non-expired sessions."""
    now_iso = _to_iso(datetime.now(timezone.utc))
    with _connect() as connection:
        rows = connection.execute(
            "SELECT access_token, username, auth_method, expires_at FROM sessions WHERE expires_at > ? ORDER BY expires_at DESC",
            (now_iso,),
        ).fetchall()
    return [
        SessionRecord(
            access_token=row["access_token"],
            username=row["username"],
            auth_method=row["auth_method"],
            expires_at=_from_iso(row["expires_at"]),
        )
        for row in rows
    ]
