"""FastAPI application entry point."""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app import auth, settings_routes, whatsapp_routes
from app.scheduler import load_all_jobs, scheduler

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    scheduler.start()
    await load_all_jobs()
    yield
    # Shutdown
    scheduler.shutdown(wait=False)


app = FastAPI(title="iPratico Reporter", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(settings_routes.router)
app.include_router(whatsapp_routes.router)

# Serve frontend SPA — must be last so API routes take priority
app.mount("/", StaticFiles(directory="app/static", html=True), name="static")
