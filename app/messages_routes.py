"""CRUD for user-defined message blocks."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.database import get_db
from app.models import DEFAULT_MSG_TEMPLATES, User, UserMessage

router = APIRouter(prefix="/api/messages", tags=["messages"])

_DEFAULT_SEEDS = [
    dict(title="📊 Incassi giornalieri", data_type="day",         freq="daily",   sort_order=0),
    dict(title="📆 Totale mensile",       data_type="month",        freq="daily",   sort_order=1),
    dict(title="🎯 Mese chiuso",          data_type="month_closed", freq="monthly", sort_order=2),
]


# ---------- Schemas ----------

class MessageOut(BaseModel):
    id: int
    title: str
    template: str
    data_type: str
    freq: str
    sort_order: int
    model_config = {"from_attributes": True}


class MessageIn(BaseModel):
    title: Optional[str] = None
    template: Optional[str] = None
    data_type: Optional[str] = None
    freq: Optional[str] = None
    sort_order: Optional[int] = None


# ---------- Helpers ----------

async def _seed_defaults(user_id: int, db: AsyncSession) -> list[UserMessage]:
    msgs = []
    for seed in _DEFAULT_SEEDS:
        m = UserMessage(
            user_id=user_id,
            title=seed["title"],
            template=DEFAULT_MSG_TEMPLATES[seed["data_type"]],
            data_type=seed["data_type"],
            freq=seed["freq"],
            sort_order=seed["sort_order"],
        )
        db.add(m)
        msgs.append(m)
    await db.commit()
    for m in msgs:
        await db.refresh(m)
    return msgs


async def get_user_messages(user_id: int, db: AsyncSession) -> list[UserMessage]:
    """Load messages for user, seeding defaults if none exist yet."""
    result = await db.execute(
        select(UserMessage)
        .where(UserMessage.user_id == user_id)
        .order_by(UserMessage.sort_order, UserMessage.id)
    )
    msgs = result.scalars().all()
    if not msgs:
        msgs = await _seed_defaults(user_id, db)
    return list(msgs)


# ---------- Routes ----------

@router.get("", response_model=list[MessageOut])
async def list_messages(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await get_user_messages(current_user.id, db)


@router.post("", response_model=MessageOut)
async def create_message(
    body: MessageIn,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    data_type = body.data_type or "day"
    m = UserMessage(
        user_id=current_user.id,
        title=body.title or "",
        template=body.template or DEFAULT_MSG_TEMPLATES.get(data_type, ""),
        data_type=data_type,
        freq=body.freq or "daily",
        sort_order=body.sort_order or 0,
    )
    db.add(m)
    await db.commit()
    await db.refresh(m)
    return m


@router.put("/{msg_id}", response_model=MessageOut)
async def update_message(
    msg_id: int,
    body: MessageIn,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(UserMessage).where(UserMessage.id == msg_id, UserMessage.user_id == current_user.id)
    )
    m = result.scalar_one_or_none()
    if m is None:
        raise HTTPException(status_code=404, detail="Message not found")

    if body.title is not None:
        m.title = body.title
    if body.template is not None:
        m.template = body.template
    if body.data_type is not None:
        m.data_type = body.data_type
    if body.freq is not None:
        m.freq = body.freq
    if body.sort_order is not None:
        m.sort_order = body.sort_order

    await db.commit()
    await db.refresh(m)
    return m


@router.delete("/{msg_id}", status_code=204)
async def delete_message(
    msg_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(UserMessage).where(UserMessage.id == msg_id, UserMessage.user_id == current_user.id)
    )
    m = result.scalar_one_or_none()
    if m is None:
        raise HTTPException(status_code=404, detail="Message not found")
    await db.delete(m)
    await db.commit()
