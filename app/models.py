from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    email: Mapped[str] = mapped_column(String, unique=True, nullable=False, index=True)
    password_hash: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    settings: Mapped[UserSettings | None] = relationship("UserSettings", back_populates="user", uselist=False)


class UserSettings(Base):
    __tablename__ = "user_settings"

    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), primary_key=True)

    # iPratico
    ipratico_email: Mapped[str | None] = mapped_column(String)
    ipratico_password_enc: Mapped[str | None] = mapped_column(String)
    ipratico_channel: Mapped[str] = mapped_column(String, default="lct_20572")

    # Green API
    greenapi_id_instance: Mapped[str | None] = mapped_column(String)
    greenapi_api_token_enc: Mapped[str | None] = mapped_column(String)
    greenapi_api_url: Mapped[str] = mapped_column(String, default="https://7107.api.greenapi.com")
    greenapi_chat_id: Mapped[str | None] = mapped_column(String)
    greenapi_chat_name: Mapped[str | None] = mapped_column(String)

    # Schedule
    send_time: Mapped[str] = mapped_column(String, default="01:00")  # HH:MM
    timezone: Mapped[str] = mapped_column(String, default="Europe/Rome")
    is_active: Mapped[bool] = mapped_column(Boolean, default=False)

    # Message templates (None = use built-in default)
    template_day: Mapped[str | None] = mapped_column(String)
    template_month: Mapped[str | None] = mapped_column(String)
    template_month_closed: Mapped[str | None] = mapped_column(String)

    # Per-message frequency: "daily" | "weekly" | "monthly" | "disabled"
    freq_day: Mapped[str] = mapped_column(String, default="daily")
    freq_month: Mapped[str] = mapped_column(String, default="daily")
    freq_month_closed: Mapped[str] = mapped_column(String, default="monthly")

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    user: Mapped[User] = relationship("User", back_populates="settings")
