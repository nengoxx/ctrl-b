"""Shared input model for the host-targeted fleet actions."""

from __future__ import annotations

from pydantic import BaseModel, Field


class HostTargetInput(BaseModel):
    """Every Phase 2 action targets one host by its stable slug id."""

    host_id: str = Field(description="Stable slug id of the target host (GET /api/hosts → id)")
