"""APScheduler — per-user cron jobs for the daily report."""
from __future__ import annotations

import logging

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

logger = logging.getLogger(__name__)
# AsyncIOScheduler runs on the same event loop as FastAPI/uvicorn,
# so async DB sessions and httpx calls work without cross-loop issues.
scheduler = AsyncIOScheduler()


def _job_id(user_id: int) -> str:
    return f"report_{user_id}"


async def _run_report_async(user_id: int) -> None:
    from app.database import SessionLocal
    from app.models import UserSettings
    from app.reporter import run_report
    from sqlalchemy import select

    async with SessionLocal() as db:
        result = await db.execute(select(UserSettings).where(UserSettings.user_id == user_id))
        settings = result.scalar_one_or_none()
        if settings is None or not settings.is_active:
            logger.info("Job for user %d skipped (inactive or missing settings)", user_id)
            return

    try:
        messages = await run_report(settings)
        logger.info("Report sent for user %d: %d messages", user_id, len(messages))
    except Exception:
        logger.exception("Report failed for user %d", user_id)


def sync_user_job(user_id: int, settings) -> None:
    """Add or remove the user's cron job based on settings.is_active."""
    job_id = _job_id(user_id)
    scheduler.remove_job(job_id) if scheduler.get_job(job_id) else None

    if not settings.is_active:
        return

    try:
        hour, minute = settings.send_time.split(":")
    except Exception:
        logger.warning("Invalid send_time for user %d: %s", user_id, settings.send_time)
        return

    scheduler.add_job(
        _run_report_async,
        CronTrigger(hour=int(hour), minute=int(minute), timezone=settings.timezone or "Europe/Rome"),
        id=job_id,
        replace_existing=True,
        args=[user_id],
    )
    logger.info("Scheduled job for user %d at %s (%s)", user_id, settings.send_time, settings.timezone)


async def load_all_jobs() -> None:
    """Load active jobs for all users at startup."""
    from app.database import SessionLocal
    from app.models import UserSettings
    from sqlalchemy import select

    async with SessionLocal() as db:
        result = await db.execute(select(UserSettings).where(UserSettings.is_active == True))  # noqa: E712
        all_settings = result.scalars().all()

    for s in all_settings:
        sync_user_job(s.user_id, s)

    logger.info("Loaded %d active scheduler jobs", len(all_settings))
