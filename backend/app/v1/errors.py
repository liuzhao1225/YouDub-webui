"""Structured media operation errors consumed by the worker protocol."""

from __future__ import annotations


class ApiError(Exception):
    def __init__(
        self, status_code: int, code: str, message: str, *,
        field: str | None = None, stage: str | None = None,
        action: str = "adjust_settings",
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.content = {"error": {"code": code, "message": message, "field": field,
                                  "stage": stage, "action": action}}
