from __future__ import annotations

from .devices import MANAGED_COMPONENTS, resolve_device, validate_device_available


def validate_runtime_device() -> None:
    for component in MANAGED_COMPONENTS:
        resolution = resolve_device(component)
        validate_device_available(resolution.selected, resolution.setting_name)
