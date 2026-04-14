"""User settings CRUD + report actions."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.crypto import decrypt, encrypt
from app.database import get_db
from app.models import User, UserSettings

router = APIRouter(prefix="/api", tags=["settings"])


# ---------- Schemas ---------- #

class SettingsOut(BaseModel):
    ipratico_email: Optional[str] = None
    ipratico_channel: str = "lct_20572"
    greenapi_id_instance: Optional[str] = None
    greenapi_api_url: str = "https://7107.api.greenapi.com"
    greenapi_chat_id: Optional[str] = None
    greenapi_chat_name: Optional[str] = None
    send_time: str = "01:00"
    timezone: str = "Europe/Rome"
    is_active: bool = False
    # Indicate whether secrets are saved (without exposing them)
    has_ipratico_password: bool = False
    has_greenapi_token: bool = False
    # Message templates (None = use built-in default)
    template_day: Optional[str] = None
    template_month: Optional[str] = None
    template_month_closed: Optional[str] = None
    # Per-message frequency
    freq_day: str = "daily"
    freq_month: str = "daily"
    freq_month_closed: str = "monthly"

    model_config = {"from_attributes": True}


class SettingsIn(BaseModel):
    ipratico_email: Optional[str] = None
    ipratico_password: Optional[str] = None  # plaintext; stored encrypted
    ipratico_channel: Optional[str] = None
    greenapi_id_instance: Optional[str] = None
    greenapi_api_token: Optional[str] = None  # plaintext; stored encrypted
    greenapi_api_url: Optional[str] = None
    greenapi_chat_id: Optional[str] = None
    greenapi_chat_name: Optional[str] = None
    send_time: Optional[str] = None
    timezone: Optional[str] = None
    is_active: Optional[bool] = None
    # Message templates
    template_day: Optional[str] = None
    template_month: Optional[str] = None
    template_month_closed: Optional[str] = None
    # Per-message frequency
    freq_day: Optional[str] = None
    freq_month: Optional[str] = None
    freq_month_closed: Optional[str] = None


# ---------- Helpers ---------- #

async def _get_settings(user_id: int, db: AsyncSession) -> UserSettings:
    result = await db.execute(select(UserSettings).where(UserSettings.user_id == user_id))
    s = result.scalar_one_or_none()
    if s is None:
        s = UserSettings(user_id=user_id)
        db.add(s)
        await db.commit()
        await db.refresh(s)
    return s


def _to_out(s: UserSettings) -> SettingsOut:
    return SettingsOut(
        ipratico_email=s.ipratico_email,
        ipratico_channel=s.ipratico_channel,
        greenapi_id_instance=s.greenapi_id_instance,
        greenapi_api_url=s.greenapi_api_url,
        greenapi_chat_id=s.greenapi_chat_id,
        greenapi_chat_name=s.greenapi_chat_name,
        send_time=s.send_time,
        timezone=s.timezone,
        is_active=s.is_active,
        has_ipratico_password=bool(s.ipratico_password_enc),
        has_greenapi_token=bool(s.greenapi_api_token_enc),
        template_day=s.template_day,
        template_month=s.template_month,
        template_month_closed=s.template_month_closed,
        freq_day=s.freq_day or "daily",
        freq_month=s.freq_month or "daily",
        freq_month_closed=s.freq_month_closed or "monthly",
    )


# ---------- Routes ---------- #

@router.get("/settings", response_model=SettingsOut)
async def get_settings(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    s = await _get_settings(current_user.id, db)
    return _to_out(s)


@router.put("/settings", response_model=SettingsOut)
async def update_settings(
    body: SettingsIn,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    s = await _get_settings(current_user.id, db)

    if body.ipratico_email is not None:
        s.ipratico_email = body.ipratico_email
    if body.ipratico_password is not None:
        s.ipratico_password_enc = encrypt(body.ipratico_password)
    if body.ipratico_channel is not None:
        s.ipratico_channel = body.ipratico_channel
    if body.greenapi_id_instance is not None:
        s.greenapi_id_instance = body.greenapi_id_instance
    if body.greenapi_api_token is not None:
        s.greenapi_api_token_enc = encrypt(body.greenapi_api_token)
    if body.greenapi_api_url is not None:
        s.greenapi_api_url = body.greenapi_api_url
    if body.greenapi_chat_id is not None:
        s.greenapi_chat_id = body.greenapi_chat_id
    if body.greenapi_chat_name is not None:
        s.greenapi_chat_name = body.greenapi_chat_name
    if body.send_time is not None:
        s.send_time = body.send_time
    if body.timezone is not None:
        s.timezone = body.timezone
    if body.is_active is not None:
        s.is_active = body.is_active
    if body.template_day is not None:
        s.template_day = body.template_day or None  # empty string → reset to default
    if body.template_month is not None:
        s.template_month = body.template_month or None
    if body.template_month_closed is not None:
        s.template_month_closed = body.template_month_closed or None
    if body.freq_day is not None:
        s.freq_day = body.freq_day
    if body.freq_month is not None:
        s.freq_month = body.freq_month
    if body.freq_month_closed is not None:
        s.freq_month_closed = body.freq_month_closed

    await db.commit()
    await db.refresh(s)

    # Update scheduler job when active/time/timezone changes
    from app.scheduler import sync_user_job
    sync_user_job(current_user.id, s)

    return _to_out(s)


@router.post("/report/preview")
async def preview_report(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from app.messages_routes import get_user_messages
    from app.reporter import preview_report as _preview
    s = await _get_settings(current_user.id, db)
    msgs = await get_user_messages(current_user.id, db)
    try:
        messages = await _preview(s, msgs)
        return {"messages": messages}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/report/send-now")
async def send_now(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from app.messages_routes import get_user_messages
    from app.reporter import run_report
    s = await _get_settings(current_user.id, db)
    msgs = await get_user_messages(current_user.id, db)
    try:
        messages = await run_report(s, msgs)
        return {"sent": len(messages), "messages": messages}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/ipratico/test")
async def test_ipratico(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from app.ipratico import test_credentials
    s = await _get_settings(current_user.id, db)
    if not s.ipratico_email or not s.ipratico_password_enc:
        raise HTTPException(status_code=400, detail="iPratico credentials not saved yet")
    from app.crypto import decrypt
    ok = await test_credentials(s.ipratico_email, decrypt(s.ipratico_password_enc))
    if not ok:
        raise HTTPException(status_code=401, detail="iPratico login failed — check credentials")
    return {"ok": True}
