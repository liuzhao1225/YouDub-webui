from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from fastapi import APIRouter, Depends

from . import runtime as runtime_catalog
from .contracts import Runtime, Settings, SettingsPatch
from .errors import ApiError
from .storage import Store, data_directory

router = APIRouter(prefix="/api/v1")


@lru_cache(maxsize=1)
def _store_at(root: Path) -> Store:
    return Store(root)


def get_store() -> Store:
    return _store_at(data_directory())


def runtime_snapshot(settings: dict) -> dict:
    defaults = settings["defaults"]
    model = defaults["translation"]["model"] if defaults else None
    return runtime_catalog.build_runtime(connections=settings["connections"], translation_model=model)


@router.get("/runtime", response_model=Runtime)
def get_runtime(store: Store = Depends(get_store)) -> dict:
    return runtime_snapshot(store.read_settings())


@router.get("/settings", response_model=Settings)
def get_settings(store: Store = Depends(get_store)) -> dict:
    return store.read_settings()


@router.patch("/settings", response_model=Settings)
def patch_settings(patch: SettingsPatch, store: Store = Depends(get_store)) -> dict:
    current = store.read_settings()
    runtime = runtime_snapshot(current)
    if "defaults" in patch.model_fields_set:
        try:
            runtime_catalog.validate_config_capabilities(
                patch.defaults.model_dump(mode="json"), runtime,
                connections=current["connections"],
            )
        except runtime_catalog.CapabilityError as exc:
            raise ApiError(422, exc.code, str(exc), field=exc.field) from exc
    elif "connection" in patch.model_fields_set:
        registered = {item["adapter"] for item in runtime["capabilities"] if item["execution"] == "remote"}
        if patch.connection.adapter not in registered:
            raise ApiError(422, "INVALID_CONFIG", "Unknown remote adapter.", field="connection.adapter")
    return store.patch_settings(patch)
