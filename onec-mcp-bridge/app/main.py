from collections import deque
from dataclasses import dataclass
import hashlib
import json
import logging
import os
import queue
import secrets
import shlex
import subprocess
import threading
import time
from typing import Any
import uuid

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from .metadata_reader import GET_EDT_METADATA_SUMMARY_TOOL, MetadataReader
from .register_reader import READ_REGISTER_RECORDS_TOOL, read_register_records
from .source_reader import (
    ESTIMATE_TOOL_PAYLOAD_TOOL,
    FIND_REFERENCES_TOOL,
    GET_SOURCE_CHECKSUM_TOOL,
    LIST_MODULE_METHODS_TOOL,
    READ_METHOD_SOURCE_TOOL,
    READ_SOURCE_TOOL,
    RESOLVE_SYMBOL_TOOL,
    SourceNotConfiguredError,
    SourceNotFoundError,
    SourceReader,
    SourceReaderError,
)


logger = logging.getLogger("onec_mcp_bridge")

PROFILE_TOKEN_ENV = {
    "business": "ONEC_MCP_BRIDGE_TOKEN",
    "development": "ONEC_MCP_INSPECTOR_TOKEN",
    "diagnostics": "ONEC_MCP_DIAGNOSTICS_TOKEN",
}
PROFILE_TOOLS_ENV = {
    "business": "ONEC_MCP_ALLOWED_TOOLS",
    "development": "ONEC_MCP_INSPECTOR_ALLOWED_TOOLS",
    "diagnostics": "ONEC_MCP_DIAGNOSTICS_ALLOWED_TOOLS",
}
PROFILE_DEFAULT_TOOLS = {
    "business": {
        "get_metadata_tree",
        "get_object_structure",
        "get_form_structure",
        "get_configuration_info",
        "execute_query",
        "validate_query",
    },
    "development": {
        "get_metadata_tree",
        "get_object_structure",
        "get_form_structure",
        "get_configuration_info",
        "search_code",
        "bsl_syntax_help",
        "validate_query",
        "read_source",
        "read_method_source",
        "get_edt_metadata_summary",
        "list_module_methods",
        "resolve_symbol",
        "find_references",
        "get_source_checksum",
        "estimate_tool_payload",
        "read_register_records",
    },
    "diagnostics": {
        "get_configuration_info",
        "get_event_log",
    },
}


def env_text(name: str, default: str = "") -> str:
    return (os.getenv(name) or default).strip()


def split_args(value: str) -> list[str]:
    if not value.strip():
        return []
    return shlex.split(value, posix=os.name != "nt")


def env_int(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        return max(minimum, min(int(env_text(name, str(default))), maximum))
    except ValueError:
        return default


def allowed_tools(profile: str) -> set[str]:
    try:
        env_name = PROFILE_TOOLS_ENV[profile]
        defaults = PROFILE_DEFAULT_TOOLS[profile]
    except KeyError as exc:
        raise ValueError("unknown bridge access profile") from exc
    raw = env_text(env_name)
    if not raw:
        return set(defaults)
    return {item.strip() for item in raw.split(",") if item.strip()}


def request_timeout() -> float:
    try:
        return max(5.0, min(float(env_text("ONEC_MCP_REQUEST_TIMEOUT", "60")), 300.0))
    except ValueError:
        return 60.0


def request_rate_limit() -> int:
    return env_int("ONEC_MCP_RATE_LIMIT_PER_MINUTE", 120, 1, 10_000)


def max_body_bytes() -> int:
    return env_int("ONEC_MCP_MAX_BODY_BYTES", 1_048_576, 1_024, 16_777_216)


@dataclass(frozen=True)
class AccessContext:
    profile: str
    token_fingerprint: str


class SlidingWindowRateLimiter:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._requests: dict[str, deque[float]] = {}

    def allow(self, key: str, limit: int) -> bool:
        now = time.monotonic()
        with self._lock:
            requests = self._requests.setdefault(key, deque())
            while requests and requests[0] <= now - 60:
                requests.popleft()
            if len(requests) >= limit:
                return False
            requests.append(now)
            return True

    def reset(self) -> None:
        with self._lock:
            self._requests.clear()


rate_limiter = SlidingWindowRateLimiter()


def request_id(request: Request) -> str:
    return str(getattr(request.state, "request_id", "unknown"))


def public_error(code: str, request: Request) -> dict[str, str]:
    return {"code": code, "request_id": request_id(request)}


class ToolCallRequest(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    arguments: dict[str, Any] = Field(default_factory=dict)


class McpRuntimeError(RuntimeError):
    pass


class McpClient:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._process: subprocess.Popen[str] | None = None
        self._messages: queue.Queue[dict[str, Any]] = queue.Queue()
        self._pending: dict[int, dict[str, Any]] = {}
        self._next_id = 1
        self._initialized = False
        self._stderr_tail: list[str] = []

    def health(self) -> dict[str, Any]:
        with self._lock:
            running = self._process is not None and self._process.poll() is None
            return {
                "running": running,
                "initialized": self._initialized and running,
            }

    def tools(self) -> list[dict[str, Any]]:
        response = self.request("tools/list", {})
        tools = response.get("tools", [])
        return tools if isinstance(tools, list) else []

    def call_tool(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        return self.request("tools/call", {"name": name, "arguments": arguments})

    def request(self, method: str, params: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            self._ensure_started_locked()
            return self._send_request_locked(method, params)

    def _ensure_started_locked(self) -> None:
        if self._process is not None and self._process.poll() is None and self._initialized:
            return

        command = env_text("ONEC_MCP_COMMAND", "mcp-1c")
        args = split_args(env_text("ONEC_MCP_ARGS"))
        creationflags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
        try:
            self._process = subprocess.Popen(
                [command, *args],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
                errors="replace",
                bufsize=1,
                creationflags=creationflags,
            )
        except OSError as exc:
            raise McpRuntimeError(f"Не удалось запустить mcp-1c: {exc}") from exc

        self._messages = queue.Queue()
        self._pending.clear()
        self._initialized = False
        threading.Thread(target=self._read_stdout, daemon=True).start()
        threading.Thread(target=self._read_stderr, daemon=True).start()

        self._send_request_locked(
            "initialize",
            {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "sales-ai-manager-onec-bridge", "version": "0.9.0"},
            },
        )
        self._send_notification_locked("notifications/initialized", {})
        self._initialized = True

    def _read_stdout(self) -> None:
        process = self._process
        if process is None or process.stdout is None:
            return
        for line in process.stdout:
            text = line.strip()
            if not text:
                continue
            try:
                message = json.loads(text)
            except json.JSONDecodeError:
                self._remember_stderr(f"Non-JSON stdout: {text[:300]}")
                continue
            if isinstance(message, dict):
                self._messages.put(message)

    def _read_stderr(self) -> None:
        process = self._process
        if process is None or process.stderr is None:
            return
        for line in process.stderr:
            self._remember_stderr(line.strip())

    def _remember_stderr(self, line: str) -> None:
        if not line:
            return
        with self._lock:
            self._stderr_tail.append(line[:500])
            self._stderr_tail = self._stderr_tail[-20:]

    def _send_request_locked(self, method: str, params: dict[str, Any]) -> dict[str, Any]:
        process = self._process
        if process is None or process.stdin is None or process.poll() is not None:
            raise McpRuntimeError("Процесс mcp-1c не запущен.")

        request_id = self._next_id
        self._next_id += 1
        payload = {"jsonrpc": "2.0", "id": request_id, "method": method, "params": params}
        try:
            process.stdin.write(json.dumps(payload, ensure_ascii=False) + "\n")
            process.stdin.flush()
        except OSError as exc:
            self._initialized = False
            raise McpRuntimeError(f"Не удалось отправить запрос в mcp-1c: {exc}") from exc

        deadline = time.monotonic() + request_timeout()
        while time.monotonic() < deadline:
            pending = self._pending.pop(request_id, None)
            if pending is not None:
                return self._result_or_error(pending)
            try:
                message = self._messages.get(timeout=max(0.05, min(0.5, deadline - time.monotonic())))
            except queue.Empty:
                continue

            message_id = message.get("id")
            if message_id == request_id:
                return self._result_or_error(message)
            if message_id is not None:
                try:
                    self._pending[int(message_id)] = message
                except (TypeError, ValueError):
                    pass

        raise McpRuntimeError(f"mcp-1c не ответил на метод {method} за отведенное время.")

    def _send_notification_locked(self, method: str, params: dict[str, Any]) -> None:
        process = self._process
        if process is None or process.stdin is None or process.poll() is not None:
            raise McpRuntimeError("Процесс mcp-1c не запущен.")
        payload = {"jsonrpc": "2.0", "method": method, "params": params}
        process.stdin.write(json.dumps(payload, ensure_ascii=False) + "\n")
        process.stdin.flush()

    def _result_or_error(self, message: dict[str, Any]) -> dict[str, Any]:
        if "error" in message:
            error = message["error"]
            if isinstance(error, dict):
                text = error.get("message") or json.dumps(error, ensure_ascii=False)
            else:
                text = str(error)
            raise McpRuntimeError(f"Ошибка MCP: {text}")
        result = message.get("result", {})
        return result if isinstance(result, dict) else {"result": result}


app = FastAPI(title="Sales AI Manager 1C MCP Bridge", version="0.9.0")
client = McpClient()
source_reader = SourceReader(env_text("ONEC_MCP_DUMP_PATH"))
metadata_reader = MetadataReader(env_text("ONEC_MCP_DUMP_PATH"))


@app.middleware("http")
async def enforce_http_limits(request: Request, call_next):
    supplied_request_id = request.headers.get("x-request-id", "")
    if supplied_request_id and len(supplied_request_id) <= 64 and all(
        char.isalnum() or char in "-_." for char in supplied_request_id
    ):
        current_request_id = supplied_request_id
    else:
        current_request_id = uuid.uuid4().hex
    request.state.request_id = current_request_id

    if request.method in {"POST", "PUT", "PATCH"}:
        content_length = request.headers.get("content-length")
        try:
            declared_length = int(content_length) if content_length is not None else 0
        except ValueError:
            declared_length = -1
        if declared_length < 0 or declared_length > max_body_bytes():
            return JSONResponse(
                status_code=413,
                content={"detail": public_error("REQUEST_TOO_LARGE", request)},
                headers={"X-Request-ID": current_request_id},
            )
        body = await request.body()
        if len(body) > max_body_bytes():
            return JSONResponse(
                status_code=413,
                content={"detail": public_error("REQUEST_TOO_LARGE", request)},
                headers={"X-Request-ID": current_request_id},
            )

    response = await call_next(request)
    response.headers["X-Request-ID"] = current_request_id
    return response


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, _: RequestValidationError) -> JSONResponse:
    return JSONResponse(
        status_code=422,
        content={"detail": public_error("INVALID_REQUEST", request)},
        headers={"X-Request-ID": request_id(request)},
    )


def require_access(
    request: Request,
    authorization: str | None = Header(default=None),
    x_onec_mcp_token: str | None = Header(default=None),
) -> AccessContext:
    token = ""
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()
    if not token and x_onec_mcp_token:
        token = x_onec_mcp_token.strip()

    fingerprint = hashlib.sha256(token.encode("utf-8")).hexdigest()[:16]
    client_host = request.client.host if request.client else "unknown"
    if not rate_limiter.allow(f"{client_host}:{fingerprint}", request_rate_limit()):
        raise HTTPException(status_code=429, detail=public_error("RATE_LIMITED", request))

    configured = {
        profile: env_text(env_name)
        for profile, env_name in PROFILE_TOKEN_ENV.items()
        if env_text(env_name)
    }
    if not configured:
        raise HTTPException(status_code=503, detail=public_error("AUTH_NOT_CONFIGURED", request))
    if len(set(configured.values())) != len(configured):
        logger.error("bridge_auth_configuration_invalid request_id=%s", request_id(request))
        raise HTTPException(status_code=503, detail=public_error("AUTH_CONFIGURATION_INVALID", request))

    for profile, expected in configured.items():
        if token and secrets.compare_digest(token, expected):
            return AccessContext(profile=profile, token_fingerprint=fingerprint)
    raise HTTPException(status_code=401, detail=public_error("AUTH_FAILED", request))


@app.get("/health")
def health(request: Request, access: AccessContext = Depends(require_access)) -> dict[str, Any]:
    try:
        tools = client.tools()
        return {
            "status": "ok",
            "service": "onec-mcp-bridge",
            "profile": access.profile,
            "allowed_tools": sorted(allowed_tools(access.profile)),
            "tools_count": len(tools),
            "source_reader": source_reader.status(),
            "metadata_reader": metadata_reader.status(),
            **client.health(),
        }
    except McpRuntimeError as exc:
        logger.exception("bridge_health_failed request_id=%s profile=%s", request_id(request), access.profile)
        raise HTTPException(status_code=502, detail=public_error("UPSTREAM_UNAVAILABLE", request)) from exc


@app.get("/tools")
def list_tools(request: Request, access: AccessContext = Depends(require_access)) -> dict[str, Any]:
    allowed = allowed_tools(access.profile)
    try:
        tools = [tool for tool in client.tools() if tool.get("name") in allowed]
        if source_reader.available and "read_source" in allowed and not any(
            tool.get("name") == "read_source" for tool in tools
        ):
            tools.append(READ_SOURCE_TOOL)
        if source_reader.available and "read_method_source" in allowed and not any(
            tool.get("name") == "read_method_source" for tool in tools
        ):
            tools.append(READ_METHOD_SOURCE_TOOL)
        if metadata_reader.available and "get_edt_metadata_summary" in allowed and not any(
            tool.get("name") == "get_edt_metadata_summary" for tool in tools
        ):
            tools.append(GET_EDT_METADATA_SUMMARY_TOOL)
        local_tools = (
            LIST_MODULE_METHODS_TOOL,
            RESOLVE_SYMBOL_TOOL,
            FIND_REFERENCES_TOOL,
            GET_SOURCE_CHECKSUM_TOOL,
            ESTIMATE_TOOL_PAYLOAD_TOOL,
            READ_REGISTER_RECORDS_TOOL,
        )
        for tool in local_tools:
            local_available = tool["name"] == "read_register_records" or source_reader.available
            if local_available and tool["name"] in allowed and not any(
                item.get("name") == tool["name"] for item in tools
            ):
                tools.append(tool)
        return {"tools": tools, "allowed_tools": sorted(allowed), "profile": access.profile}
    except McpRuntimeError as exc:
        logger.exception("bridge_tools_failed request_id=%s profile=%s", request_id(request), access.profile)
        raise HTTPException(status_code=502, detail=public_error("UPSTREAM_UNAVAILABLE", request)) from exc


@app.post("/tools/call")
async def call_tool(
    payload: ToolCallRequest,
    request: Request,
    access: AccessContext = Depends(require_access),
) -> dict[str, Any]:
    allowed = allowed_tools(access.profile)
    if payload.name not in allowed:
        raise HTTPException(status_code=403, detail=public_error("TOOL_NOT_ALLOWED", request))
    if not isinstance(payload.arguments, dict):
        raise HTTPException(status_code=400, detail=public_error("INVALID_ARGUMENTS", request))

    started = time.perf_counter()
    try:
        if payload.name in {
            "read_source",
            "read_method_source",
            "list_module_methods",
            "resolve_symbol",
            "find_references",
            "get_source_checksum",
            "estimate_tool_payload",
        }:
            if not source_reader.available:
                raise HTTPException(
                    status_code=503,
                    detail=public_error("SOURCE_UNAVAILABLE", request),
                )
            handlers = {
                "read_source": source_reader.read,
                "read_method_source": source_reader.read_method,
                "list_module_methods": source_reader.list_methods,
                "resolve_symbol": source_reader.resolve_symbol,
                "find_references": source_reader.find_references,
                "get_source_checksum": source_reader.checksum,
                "estimate_tool_payload": source_reader.estimate_payload,
            }
            result = handlers[payload.name](payload.arguments)
        elif payload.name == "get_edt_metadata_summary":
            if not metadata_reader.available:
                raise HTTPException(
                    status_code=503,
                    detail=public_error("SOURCE_UNAVAILABLE", request),
                )
            result = metadata_reader.read(payload.arguments)
        elif payload.name == "read_register_records":
            result = read_register_records(payload.arguments, client.call_tool)
        else:
            result = client.call_tool(payload.name, payload.arguments)
        result_bytes = len(json.dumps(result, ensure_ascii=False, default=str).encode("utf-8"))
        logger.info(
            "bridge_tool_call request_id=%s profile=%s tool=%s status=completed duration_ms=%d result_bytes=%d",
            request_id(request),
            access.profile,
            payload.name,
            int((time.perf_counter() - started) * 1000),
            result_bytes,
        )
        return {"tool": payload.name, "result": result, "request_id": request_id(request)}
    except SourceNotConfiguredError as exc:
        raise HTTPException(status_code=503, detail=public_error("SOURCE_UNAVAILABLE", request)) from exc
    except SourceNotFoundError as exc:
        raise HTTPException(status_code=404, detail=public_error("SOURCE_NOT_FOUND", request)) from exc
    except SourceReaderError as exc:
        raise HTTPException(status_code=400, detail=public_error("INVALID_ARGUMENTS", request)) from exc
    except McpRuntimeError as exc:
        logger.exception(
            "bridge_tool_call request_id=%s profile=%s tool=%s status=failed duration_ms=%d",
            request_id(request),
            access.profile,
            payload.name,
            int((time.perf_counter() - started) * 1000),
        )
        raise HTTPException(status_code=502, detail=public_error("UPSTREAM_UNAVAILABLE", request)) from exc
