"""Local connection profiles; saving settings never contacts a remote service."""
from dataclasses import dataclass, field
import ipaddress
import json
import os
from pathlib import Path
import re
import tempfile
from urllib.parse import urlsplit, urlunsplit

from .materials import ROOT

CONFIG_NAME = ".env.providers.json"
MAX_CONFIG_BYTES = 32_768
CAPABILITY_DEFAULTS = {"vision": False, "tool_calls": False, "structured_output": "none", "reasoning": False}
META_CAPABILITIES = {"vision": True, "tool_calls": True, "structured_output": "json_schema", "reasoning": True}
_CATALOG = (
    ("meta", "Meta", "https://api.meta.ai/v1", "muse-spark-1.3-contributor", "chat_completions", "https://dev.meta.ai/docs"),
    ("openrouter", "OpenRouter", "https://openrouter.ai/api/v1", "", "chat_completions", "https://openrouter.ai/docs/api/reference/overview"),
    ("openai", "OpenAI", "https://api.openai.com/v1", "", "chat_completions", "https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create"),
    ("google", "Google", "https://generativelanguage.googleapis.com/v1beta", "", "google_generate_content", "https://ai.google.dev/api/generate-content"),
    ("anthropic", "Anthropic", "https://api.anthropic.com/v1", "", "anthropic_messages", "https://platform.claude.com/docs/en/api/messages/create"),
    ("nvidia", "NVIDIA", "https://integrate.api.nvidia.com/v1", "", "chat_completions", "https://docs.api.nvidia.com/nim/reference/llm-apis"),
    ("deepseek", "DeepSeek", "https://api.deepseek.com", "", "chat_completions", "https://api-docs.deepseek.com/api/create-chat-completion/"),
    ("custom", "Custom endpoint", "", "", "chat_completions", ""),
)
_ROWS = {row[0]: row for row in _CATALOG}


class ProviderConfigurationError(ValueError):
    pass


@dataclass(frozen=True)
class ProviderProfile:
    provider: str
    model: str
    base_url: str
    api_key: str = field(repr=False)
    capabilities: dict = field(default_factory=lambda: dict(CAPABILITY_DEFAULTS))
    protocol: str = "chat_completions"
    source: str = "saved"
    workspace_id: str = ""

    @property
    def name(self):
        return _ROWS[self.provider][1]

    @property
    def configured(self):
        return bool(self.model and (self.api_key or (self.provider == "custom" and _loopback(urlsplit(self.base_url).hostname))))


def provider_catalog():
    return [{"id": identity, "name": name, "default_base_url": base, "default_model": model,
             "protocol": protocol, "defaults": dict(META_CAPABILITIES if identity == "meta" else CAPABILITY_DEFAULTS),
             "capabilities": {"vision": "model_dependent", "tool_calls": "model_dependent",
                              "structured_output": ["none", "json_object", "json_schema"],
                              "reasoning": "model_dependent" if identity in {"meta", "openrouter", "openai"} else "unsupported"},
             "details_url": docs} for identity, name, base, model, protocol, docs in _CATALOG]


def _loopback(host):
    if host == "localhost":
        return True
    try:
        return ipaddress.ip_address(host or "").is_loopback
    except ValueError:
        return False


def validate_base_url(value, provider):
    if not isinstance(value, str) or len(value) > 512 or any(ord(char) < 33 for char in value):
        raise ProviderConfigurationError("Enter a valid API base URL without spaces.")
    try:
        parts = urlsplit(value)
        port = parts.port
    except ValueError:
        raise ProviderConfigurationError("Enter a valid API base URL.") from None
    if (not parts.hostname or parts.username is not None or parts.password is not None or parts.query or parts.fragment
            or "\\" in value or "%" in value or any(segment in {".", ".."} for segment in parts.path.split("/"))
            or parts.scheme not in {"https", "http"} or (port is not None and not 1 <= port <= 65535)):
        raise ProviderConfigurationError("Use an API base URL without credentials, query parameters or fragments.")
    if parts.scheme != "https" and not (provider == "custom" and _loopback(parts.hostname)):
        raise ProviderConfigurationError("Use HTTPS. HTTP is allowed only for a custom service on this computer.")
    if provider != "custom" and parts.hostname != urlsplit(_ROWS[provider][2]).hostname:
        raise ProviderConfigurationError("Use this provider's official host, or choose Custom endpoint for a proxy.")
    return urlunsplit((parts.scheme, parts.netloc, parts.path.rstrip("/"), "", ""))


def _legacy(root, environ):
    values = {}
    path = Path(root) / ".env"
    if path.is_file():
        for line in path.read_text().splitlines():
            line = line.strip().removeprefix("export ")
            if not line or line.startswith("#") or "=" not in line:
                continue
            name, value = line.split("=", 1)
            if name.strip() in {"MODEL_API_KEY", "META_API_KEY", "META_MODEL"}:
                values[name.strip()] = value.strip().strip("\"'")
    env = os.environ if environ is None else environ
    for name in ("MODEL_API_KEY", "META_API_KEY", "META_MODEL"):
        if name in env:
            values[name] = env[name]
    return ProviderProfile("meta", values.get("META_MODEL") or "muse-spark-1.3-contributor", _ROWS["meta"][2],
                           values.get("MODEL_API_KEY") or values.get("META_API_KEY") or "",
                           dict(META_CAPABILITIES), source="local_env")


def _profile(payload, prior=None):
    if not isinstance(payload, dict) or set(payload) - {"provider", "model", "base_url", "api_key", "clear_api_key", "capabilities", "protocol", "workspace_id"}:
        raise ProviderConfigurationError("Connection settings contain unsupported fields.")
    provider = payload.get("provider")
    if not isinstance(provider, str) or provider not in _ROWS:
        raise ProviderConfigurationError("Choose a listed inference provider.")
    row = _ROWS[provider]
    model = payload.get("model", row[3])
    if not isinstance(model, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,199}", model):
        raise ProviderConfigurationError("Enter the exact model identifier from your provider.")
    base = validate_base_url(payload.get("base_url") or row[2], provider)
    protocol = payload.get("protocol", row[4])
    if protocol not in {"chat_completions", "google_generate_content", "anthropic_messages"} or (provider != "custom" and protocol != row[4]):
        raise ProviderConfigurationError("Choose the API protocol supported by this provider.")
    caps = payload.get("capabilities", dict(META_CAPABILITIES if provider == "meta" else CAPABILITY_DEFAULTS))
    if not isinstance(caps, dict) or set(caps) - set(CAPABILITY_DEFAULTS):
        raise ProviderConfigurationError("Connection capabilities contain unsupported fields.")
    capabilities = dict(META_CAPABILITIES if provider == "meta" else CAPABILITY_DEFAULTS)
    capabilities.update(caps)
    if (any(not isinstance(capabilities[name], bool) for name in ("vision", "tool_calls", "reasoning"))
            or not isinstance(capabilities["structured_output"], str)
            or capabilities["structured_output"] not in {"none", "json_object", "json_schema"}):
        raise ProviderConfigurationError("Select valid model capabilities.")
    if capabilities["reasoning"] and provider not in {"meta", "openrouter", "openai"}:
        raise ProviderConfigurationError("Reasoning controls are not implemented for this provider. Leave this switch off.")
    if provider == "deepseek" and capabilities["structured_output"] == "json_schema":
        raise ProviderConfigurationError("This connection supports JSON object mode; strict JSON schema mode is not implemented.")
    if protocol in {"google_generate_content", "anthropic_messages"} and capabilities["structured_output"] == "json_object":
        raise ProviderConfigurationError("For this native API, select JSON schema mode or disable structured output.")
    key = payload.get("api_key", "")
    if not isinstance(key, str) or len(key) > 4096 or any(ord(char) < 33 or ord(char) > 126 for char in key):
        raise ProviderConfigurationError("Enter a valid API key without spaces or control characters.")
    clear = payload.get("clear_api_key", False)
    if not isinstance(clear, bool) or (clear and key):
        raise ProviderConfigurationError("Clear the key or enter a replacement key, using one action at a time.")
    if not key and not clear and prior and prior.provider == provider and prior.base_url == base:
        key = prior.api_key
    workspace = payload.get("workspace_id", "")
    if (not isinstance(workspace, str) or (workspace and (protocol != "anthropic_messages"
            or not re.fullmatch(r"wrkspc_[A-Za-z0-9_-]{1,120}", workspace)))):
        raise ProviderConfigurationError("Use the workspace identifier from your native Messages account, or leave it blank.")
    return ProviderProfile(provider, model, base, "" if clear else key, capabilities, protocol, workspace_id=workspace)


def _read(root):
    path = Path(root) / CONFIG_NAME
    if not path.exists() and not path.is_symlink():
        return {"active_provider": "meta", "profiles": {}}
    try:
        if path.is_symlink() or not path.is_file() or path.stat().st_size > MAX_CONFIG_BYTES:
            raise ValueError()
        if path.stat().st_mode & 0o077:
            raise ProviderConfigurationError("Connection settings must be readable only by your account (file mode 0600).")
        data = json.loads(path.read_text(), parse_constant=lambda value: (_ for _ in ()).throw(ValueError()))
        if not isinstance(data, dict) or set(data) != {"active_provider", "profiles"} or data["active_provider"] not in _ROWS or not isinstance(data["profiles"], dict):
            raise ValueError()
        profiles = {}
        for identity, payload in data["profiles"].items():
            if identity not in _ROWS or payload.get("provider") != identity:
                raise ValueError()
            profiles[identity] = _profile(payload)
        if data["active_provider"] not in profiles and data["active_provider"] != "meta":
            raise ValueError()
        return {"active_provider": data["active_provider"], "profiles": profiles}
    except ProviderConfigurationError:
        raise
    except (OSError, ValueError, TypeError, AttributeError, RecursionError, UnicodeError):
        raise ProviderConfigurationError("Saved connection settings could not be read. Clear them or save a new connection.") from None


def _write(root, data):
    path = Path(root) / CONFIG_NAME
    if path.is_symlink():
        raise ProviderConfigurationError("Connection settings cannot be saved through a symbolic link.")
    rows = {identity: {"provider": item.provider, "model": item.model, "base_url": item.base_url,
                       "api_key": item.api_key, "capabilities": item.capabilities, "protocol": item.protocol,
                       "workspace_id": item.workspace_id}
            for identity, item in data["profiles"].items()}
    raw = json.dumps({"active_provider": data["active_provider"], "profiles": rows}, allow_nan=False, separators=(",", ":")).encode()
    if len(raw) > MAX_CONFIG_BYTES:
        raise ProviderConfigurationError("Connection settings exceeded the size limit.")
    temporary = None
    try:
        fd, temporary = tempfile.mkstemp(prefix=".provider-settings-", dir=Path(root))
        with os.fdopen(fd, "wb") as stream:
            os.fchmod(stream.fileno(), 0o600)
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    except OSError:
        raise ProviderConfigurationError("Connection settings could not be saved on this computer.") from None
    finally:
        if temporary and os.path.exists(temporary):
            os.unlink(temporary)


def load_provider_profile(root=ROOT, environ=None):
    data = _read(root)
    identity = data["active_provider"]
    return data["profiles"].get(identity) or _legacy(root, environ)


def _status(profile):
    return {"provider": profile.provider, "provider_name": profile.name, "model": profile.model,
            "base_url": profile.base_url, "protocol": profile.protocol, "configured": profile.configured,
            "key_configured": bool(profile.api_key), "key_hint": "••••••••" if profile.api_key else "",
            "capabilities": dict(profile.capabilities), "source": profile.source, "workspace_id": profile.workspace_id}


def provider_settings(root=ROOT, environ=None):
    data = _read(root)
    profiles = dict(data["profiles"])
    profiles.setdefault("meta", _legacy(root, environ))
    active = profiles[data["active_provider"]]
    return {**_status(active), "active_provider": active.provider,
            "profiles": [_status(profile) for profile in profiles.values()]}


def save_provider_settings(payload, root=ROOT, environ=None):
    data = _read(root)
    identity = payload.get("provider") if isinstance(payload, dict) else None
    prior = data["profiles"].get(identity) if isinstance(identity, str) else None
    if prior is None and identity == "meta":
        prior = _legacy(root, environ)
    profile = _profile(payload, prior)
    data["profiles"][profile.provider] = profile
    data["active_provider"] = profile.provider
    _write(root, data)
    return provider_settings(root, environ)


def select_provider_settings(provider_id, root=ROOT, environ=None):
    data = _read(root)
    if not isinstance(provider_id, str) or (provider_id not in data["profiles"] and provider_id != "meta"):
        raise ProviderConfigurationError("Save this provider's connection before selecting it.")
    data["active_provider"] = provider_id
    _write(root, data)
    return provider_settings(root, environ)


def clear_provider_settings(provider_id=None, root=ROOT, environ=None):
    if provider_id is None:
        path = Path(root) / CONFIG_NAME
        if path.is_symlink():
            raise ProviderConfigurationError("Connection settings cannot be cleared through a symbolic link.")
        try:
            path.unlink(missing_ok=True)
        except OSError:
            raise ProviderConfigurationError("Connection settings could not be cleared.") from None
    else:
        if not isinstance(provider_id, str) or provider_id not in _ROWS:
            raise ProviderConfigurationError("Choose a listed inference provider.")
        data = _read(root)
        data["profiles"].pop(provider_id, None)
        if data["active_provider"] == provider_id:
            data["active_provider"] = "meta"
        _write(root, data)
    return provider_settings(root, environ)
