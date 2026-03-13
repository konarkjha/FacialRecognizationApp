"""
Debug data viewer  –  available at  http://127.0.0.1:8000/debug/
Reload this page any time to see the current SQLite state.
"""
from __future__ import annotations

import os
from datetime import datetime, timezone

from fastapi import APIRouter
from fastapi.responses import HTMLResponse

from .auth.store import DB_PATH, list_active_sessions, list_all_users

router = APIRouter(prefix="/debug", tags=["debug"])


def _badge(text: str, colour: str) -> str:
    return (
        f'<span style="background:{colour};color:#fff;font-size:11px;'
        f'font-weight:700;padding:2px 8px;border-radius:999px;white-space:nowrap">{text}</span>'
    )


def _build_html(users_html: str, sessions_html: str, db_path: str, ts: str) -> str:
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>FaceAuth · Data Viewer</title>
<style>
  *{{box-sizing:border-box;margin:0;padding:0}}
  body{{background:#07090f;color:#d1fae5;font-family:'Segoe UI',system-ui,sans-serif;padding:24px 20px;min-height:100vh}}
  h1{{font-size:26px;font-weight:800;color:#39ff14;letter-spacing:.5px;margin-bottom:4px}}
  .sub{{color:#4b7c5a;font-size:13px;margin-bottom:28px}}
  .meta{{background:#0d1117;border:1px solid #1d2b1a;border-radius:12px;padding:14px 18px;margin-bottom:28px;font-size:13px;color:#6b8f6b}}
  .meta strong{{color:#9dfd8c}}
  h2{{font-size:17px;font-weight:700;color:#7cfc00;margin-bottom:12px;display:flex;align-items:center;gap:8px}}
  table{{width:100%;border-collapse:collapse;background:#0d1117;border-radius:12px;overflow:hidden;margin-bottom:32px;font-size:13px}}
  thead tr{{background:#111d12}}
  th{{padding:10px 14px;text-align:left;color:#4ade80;font-weight:700;letter-spacing:.4px;font-size:11px;text-transform:uppercase}}
  td{{padding:10px 14px;border-top:1px solid #132012;vertical-align:top}}
  tr:hover td{{background:#0f1c10}}
  .empty{{padding:16px 14px;color:#2e5030;font-style:italic}}
  .mono{{font-family:monospace;word-break:break-all;max-width:240px;font-size:12px}}
  .device-pill{{display:inline-block;background:#0f2a12;border:1px solid #2aa40f;border-radius:8px;padding:4px 10px;margin:2px 0;font-size:11px;color:#9efc8f;white-space:nowrap}}
  a{{color:#39ff14;text-decoration:none;font-weight:700}}
  a:hover{{text-decoration:underline}}
  .refresh{{display:inline-block;background:#39ff14;color:#031207;font-weight:800;padding:8px 18px;border-radius:10px;margin-bottom:24px;font-size:13px}}
</style>
</head>
<body>
<h1>FaceAuth · Data Viewer</h1>
<p class="sub">Live SQLite snapshot — reload to refresh</p>
<a class="refresh" href="/debug/">&#8635; Refresh</a>

<div class="meta">
  <strong>DB file:</strong> {db_path}<br/>
  <strong>Snapshot at:</strong> {ts}
</div>

<h2>Users &amp; enrolled devices</h2>
{users_html}

<h2>Active sessions</h2>
{sessions_html}

<p style="color:#2e5030;font-size:12px;margin-top:16px">
  JSON endpoints: 
  <a href="/auth/enrollment/&lt;username&gt;">/auth/enrollment/&lt;username&gt;</a> ·
  <a href="/docs">/docs</a>
</p>
</body>
</html>"""


@router.get("/", response_class=HTMLResponse)
def debug_home() -> HTMLResponse:
    users = list_all_users()
    sessions = list_active_sessions()
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")

    # ----- users table -----
    if users:
        rows = ""
        for u in users:
            device_pills = ""
            for d in u.devices.values():
                enrolled = d.enrolled_at.strftime("%Y-%m-%d %H:%M UTC")
                device_pills += (
                    f'<div class="device-pill">'
                    f'{d.device_id}'
                    f'<br/><span style="opacity:.7">{d.device_name} · {enrolled}</span>'
                    f'</div>'
                )
            device_pills = device_pills or '<span style="color:#2e5030">none</span>'
            face_badge = _badge("enrolled", "#166534") if u.devices else _badge("no device", "#7f1d1d")
            rows += (
                f"<tr>"
                f"<td><strong>{u.username}</strong></td>"
                f"<td>{u.display_name or '—'}</td>"
                f"<td>{face_badge}</td>"
                f"<td>{device_pills}</td>"
                f"</tr>"
            )
        users_html = (
            "<table>"
            "<thead><tr><th>Username</th><th>Display name</th><th>Face</th><th>Devices</th></tr></thead>"
            f"<tbody>{rows}</tbody></table>"
        )
    else:
        users_html = "<table><tbody><tr><td class='empty'>No users registered yet.</td></tr></tbody></table>"

    # ----- sessions table -----
    if sessions:
        rows = ""
        for s in sessions:
            expires = s.expires_at.strftime("%Y-%m-%d %H:%M UTC")
            rows += (
                f"<tr>"
                f"<td><strong>{s.username}</strong></td>"
                f"<td>{_badge(s.auth_method, '#065f46')}</td>"
                f"<td>{expires}</td>"
                f"<td class='mono'>{s.access_token}</td>"
                f"</tr>"
            )
        sessions_html = (
            "<table>"
            "<thead><tr><th>Username</th><th>Method</th><th>Expires</th><th>Token</th></tr></thead>"
            f"<tbody>{rows}</tbody></table>"
        )
    else:
        sessions_html = "<table><tbody><tr><td class='empty'>No active sessions.</td></tr></tbody></table>"

    html = _build_html(
        users_html=users_html,
        sessions_html=sessions_html,
        db_path=str(DB_PATH),
        ts=now,
    )
    return HTMLResponse(content=html)


@router.get("/users", response_class=HTMLResponse)
def debug_users_json() -> HTMLResponse:
    """Same as /debug/ but redirects to human-friendly view."""
    from fastapi.responses import RedirectResponse
    return RedirectResponse("/debug/")
