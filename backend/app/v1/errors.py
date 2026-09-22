"""Public v1 errors contain actionable fields, never request bodies or secrets."""

from __future__ import annotations


def error_content(
    code: str,
    message: str,
    *,
    field: str | None = None,
    stage: str | None = None,
    action: str = "adjust_settings",
) -> dict:
    return {"error": {"code": code, "message": message, "field": field,
                      "stage": stage, "action": action}}


class ApiError(Exception):
    def __init__(
        self, status_code: int, code: str, message: str, *,
        field: str | None = None, stage: str | None = None,
        action: str = "adjust_settings",
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.content = error_content(code, message, field=field, stage=stage, action=action)
