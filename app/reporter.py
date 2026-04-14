"""Message building and sending — ported from daily_whatsapp.py."""
from __future__ import annotations

import re
from datetime import date, timedelta
from zoneinfo import ZoneInfo

import httpx

from app import ipratico as _ip
from app.crypto import decrypt
from app.models import UserSettings

WEEKDAYS_IT = ["Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato", "Domenica"]
MONTHS_IT = [
    "gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno",
    "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre",
]

# ---------- Default templates ---------- #

DEFAULT_TEMPLATE_DAY = (
    "📊 Incassi del giorno:\n"
    "📆 Data: {{data}}\n"
    "💰 Vendite: €{{vendite}}"
)

DEFAULT_TEMPLATE_MONTH = (
    "📆 Totale mese di {{mese}}:\n"
    "💰 Vendite: €{{vendite_mese}}\n"
    "📈 Variazione vs {{anno_prec}}: {{variazione_pct}} | {{variazione_eur}} €"
)

DEFAULT_TEMPLATE_MONTH_CLOSED = (
    "🎯 MESE CHIUSO - {{mese}}:\n"
    "💰 Vendite totali: €{{vendite_totali}}\n"
    "📈 Variazione vs {{anno_prec}}: {{variazione_pct}} | {{variazione_eur}} €"
)


# ---------- Template helpers ---------- #

def _substitute(template: str, variables: dict) -> str:
    """Replace {{key}} placeholders; leave unknown tags unchanged."""
    def replacer(m: re.Match) -> str:
        key = m.group(1).strip()
        return str(variables[key]) if key in variables else m.group(0)
    return re.sub(r"\{\{(\w+)\}\}", replacer, template)


def _should_send(freq: str | None, today: date) -> bool:
    """Return True if this message type should fire today given its frequency."""
    f = (freq or "daily").lower()
    if f == "disabled":
        return False
    if f == "weekly":
        return today.weekday() == 0  # Monday
    if f == "monthly":
        return today.day == 1
    return True  # "daily" or unrecognised → always send


# ---------- Message builders ---------- #

def build_day_message(sales_date: date, total: float, template: str | None = None) -> str:
    day_name = WEEKDAYS_IT[sales_date.weekday()]
    month_name = MONTHS_IT[sales_date.month - 1]
    variables = {
        "data": f"{day_name} {sales_date.day} {month_name} {sales_date.year}",
        "vendite": f"{total:.2f}",
    }
    return _substitute(template or DEFAULT_TEMPLATE_DAY, variables)


def build_month_message(
    ref_date: date,
    current_total: float,
    prev_total: float,
    mode: str = "month",
    template: str | None = None,
) -> str:
    month_name = MONTHS_IT[ref_date.month - 1].capitalize()
    try:
        delta_pct = ((current_total - prev_total) / prev_total * 100) if prev_total else 0.0
        delta_eur = current_total - prev_total
        variazione_pct = f"{delta_pct:+.1f}%"
        variazione_eur = f"{delta_eur:+.2f}"
    except Exception:
        variazione_pct = "n/d"
        variazione_eur = "n/d"

    variables = {
        "mese": f"{month_name} {ref_date.year}",
        "anno_prec": str(ref_date.year - 1),
        "vendite_mese": f"{current_total:.2f}",
        "vendite_totali": f"{current_total:.2f}",
        "vendite_anno_prec": f"{prev_total:.2f}",
        "variazione_pct": variazione_pct,
        "variazione_eur": variazione_eur,
    }

    if template is None:
        template = DEFAULT_TEMPLATE_MONTH_CLOSED if mode == "month_closed" else DEFAULT_TEMPLATE_MONTH

    return _substitute(template, variables)


# ---------- Green API sender ---------- #

async def send_whatsapp(message: str, settings: UserSettings) -> None:
    if not settings.greenapi_id_instance or not settings.greenapi_api_token_enc or not settings.greenapi_chat_id:
        raise ValueError("WhatsApp settings incomplete (instance, token, chat)")
    api_token = decrypt(settings.greenapi_api_token_enc)
    api_url = settings.greenapi_api_url or "https://7107.api.greenapi.com"
    url = f"{api_url}/waInstance{settings.greenapi_id_instance}/sendMessage/{api_token}"
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.post(url, json={"chatId": settings.greenapi_chat_id, "message": message})
        r.raise_for_status()


# ---------- Full report runner ---------- #

async def run_report(settings: UserSettings) -> list[str]:
    """Build and send messages according to per-user templates and frequencies.

    Returns list of sent message texts.
    """
    if not settings.ipratico_email or not settings.ipratico_password_enc:
        raise ValueError("iPratico credentials not configured")

    email = settings.ipratico_email
    password = decrypt(settings.ipratico_password_enc)
    channel = settings.ipratico_channel or "lct_20572"
    tz = ZoneInfo(settings.timezone or "Europe/Rome")

    from datetime import datetime
    today = datetime.now(tz).date()
    yesterday = today - timedelta(days=1)

    client, token = await _ip.login(email, password)
    try:
        messages: list[str] = []

        # Daily
        if _should_send(settings.freq_day, today):
            _, day_total = await _ip.fetch_day_sales(yesterday, email, password, channel, client=client, token=token)
            day_msg = build_day_message(yesterday, day_total, settings.template_day)
            await send_whatsapp(day_msg, settings)
            messages.append(day_msg)

        # Month-to-date vs same period last year
        if _should_send(settings.freq_month, today):
            start_month = today.replace(day=1)
            start_prev = start_month.replace(year=start_month.year - 1)
            end_prev = yesterday.replace(year=yesterday.year - 1)
            current_total = await _ip.fetch_range_sales(start_month, yesterday, email, password, channel, client=client, token=token)
            prev_total = await _ip.fetch_range_sales(start_prev, end_prev, email, password, channel, client=client, token=token)
            month_msg = build_month_message(start_month, current_total, prev_total, mode="month", template=settings.template_month)
            await send_whatsapp(month_msg, settings)
            messages.append(month_msg)

        # Month-closed (only on 1st of month, and only if frequency allows)
        if today.day == 1 and _should_send(settings.freq_month_closed, today):
            last_day_prev = today - timedelta(days=1)
            first_day_prev = last_day_prev.replace(day=1)
            first_prev_yr = first_day_prev.replace(year=first_day_prev.year - 1)
            last_prev_yr = last_day_prev.replace(year=last_day_prev.year - 1)
            closed_total = await _ip.fetch_range_sales(first_day_prev, last_day_prev, email, password, channel, client=client, token=token)
            closed_prev = await _ip.fetch_range_sales(first_prev_yr, last_prev_yr, email, password, channel, client=client, token=token)
            closed_msg = build_month_message(first_day_prev, closed_total, closed_prev, mode="month_closed", template=settings.template_month_closed)
            await send_whatsapp(closed_msg, settings)
            messages.append(closed_msg)
    finally:
        await client.aclose()

    return messages


async def preview_report(settings: UserSettings) -> list[str]:
    """Build messages without sending. Respects templates but ignores frequency."""
    if not settings.ipratico_email or not settings.ipratico_password_enc:
        raise ValueError("iPratico credentials not configured")

    email = settings.ipratico_email
    password = decrypt(settings.ipratico_password_enc)
    channel = settings.ipratico_channel or "lct_20572"
    tz = ZoneInfo(settings.timezone or "Europe/Rome")

    from datetime import datetime
    today = datetime.now(tz).date()
    yesterday = today - timedelta(days=1)

    client, token = await _ip.login(email, password)
    try:
        messages: list[str] = []

        _, day_total = await _ip.fetch_day_sales(yesterday, email, password, channel, client=client, token=token)
        messages.append(build_day_message(yesterday, day_total, settings.template_day))

        start_month = today.replace(day=1)
        start_prev = start_month.replace(year=start_month.year - 1)
        end_prev = yesterday.replace(year=yesterday.year - 1)
        current_total = await _ip.fetch_range_sales(start_month, yesterday, email, password, channel, client=client, token=token)
        prev_total = await _ip.fetch_range_sales(start_prev, end_prev, email, password, channel, client=client, token=token)
        messages.append(build_month_message(start_month, current_total, prev_total, mode="month", template=settings.template_month))

        if today.day == 1:
            last_day_prev = today - timedelta(days=1)
            first_day_prev = last_day_prev.replace(day=1)
            first_prev_yr = first_day_prev.replace(year=first_day_prev.year - 1)
            last_prev_yr = last_day_prev.replace(year=last_day_prev.year - 1)
            closed_total = await _ip.fetch_range_sales(first_day_prev, last_day_prev, email, password, channel, client=client, token=token)
            closed_prev = await _ip.fetch_range_sales(first_prev_yr, last_prev_yr, email, password, channel, client=client, token=token)
            messages.append(build_month_message(first_day_prev, closed_total, closed_prev, mode="month_closed", template=settings.template_month_closed))
    finally:
        await client.aclose()

    return messages
