"""Provider secrets live in the OS credential store; SQLite holds references."""

from __future__ import annotations

from typing import Protocol


class Credentials(Protocol):
    def get(self, reference: str) -> str | None: ...
    def set(self, reference: str, value: str) -> None: ...
    def delete(self, reference: str) -> None: ...


class CredentialStoreError(RuntimeError):
    pass


class SystemCredentials:
    SERVICE = "YouDub"
    SYSTEM_BACKENDS = {
        "keyring.backends.macOS", "keyring.backends.Windows",
        "keyring.backends.SecretService", "keyring.backends.kwallet",
    }

    def _backend(self):
        try:
            import keyring

            backend = keyring.get_keyring()
            if type(backend).__module__ not in self.SYSTEM_BACKENDS:
                raise CredentialStoreError("A supported OS credential store is required.")
            return backend
        except CredentialStoreError:
            raise
        except Exception as exc:
            raise CredentialStoreError(
                f"OS credential store is unavailable ({type(exc).__name__})."
            ) from exc

    def get(self, reference: str) -> str | None:
        try:
            return self._backend().get_password(self.SERVICE, reference)
        except CredentialStoreError:
            raise
        except Exception as exc:
            raise CredentialStoreError(
                f"OS credential read failed ({type(exc).__name__})."
            ) from exc

    def set(self, reference: str, value: str) -> None:
        try:
            self._backend().set_password(self.SERVICE, reference, value)
        except CredentialStoreError:
            raise
        except Exception as exc:
            raise CredentialStoreError(
                f"OS credential write failed ({type(exc).__name__})."
            ) from exc

    def delete(self, reference: str) -> None:
        if self.get(reference) is None:
            return
        try:
            self._backend().delete_password(self.SERVICE, reference)
        except CredentialStoreError:
            raise
        except Exception as exc:
            raise CredentialStoreError(
                f"OS credential delete failed ({type(exc).__name__})."
            ) from exc
