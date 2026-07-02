import json
import os
import queue
import shlex
import subprocess
import threading
import time
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from pydantic import BaseModel, Field


DEFAULT_ALLOWED_TOOLS = {
    "get_metadata_tree",
    "get_object_structure",
    "get_form_structure",
    "get_configuration_info",
    "search_code",
    "bsl_syntax_help",
    "execute_query",
    "validate_query",
    "get_event_log",
}


def env_text(name: str, default: str = "") -> str:
    return (os.getenv(name) or default).strip()


def split_args(value: str) -> list[str]:
    if not value.strip():
        return []
    return shlex.split(value, posix=os.name != "nt")


def allowed_tools() -> set[str]:
    raw = env_text("ONEC_MCP_ALLOWED_TOOLS")
    if not raw:
        return set(DEFAULT_ALLOWED_TOOLS)
    return {item.strip() for item in raw.split(",") if item.strip()}


def request_timeout() -> float:
    try:
        return max(5.0, min(float(env_text("ONEC_MCP_REQUEST_TIMEOUT", "60")), 300.0))
    except ValueError:
        return 60.0


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
                "stderr_tail": self._stderr_tail[-5:],
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
                "clientInfo": {"name": "sales-ai-manager-onec-bridge", "version": "0.1.0"},
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


app = FastAPI(title="Sales AI Manager 1C MCP Bridge", version="0.1.0")
client = McpClient()


def require_token(
    authorization: str | None = Header(default=None),
    x_onec_mcp_token: str | None = Header(default=None),
) -> None:
    expected = env_text("ONEC_MCP_BRIDGE_TOKEN")
    if not expected:
        raise HTTPException(status_code=503, detail="ONEC_MCP_BRIDGE_TOKEN не задан.")

    token = ""
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()
    if not token and x_onec_mcp_token:
        token = x_onec_mcp_token.strip()
    if token != expected:
        raise HTTPException(status_code=401, detail="Неверный токен 1C MCP bridge.")


@app.get("/health")
def health(_: None = Depends(require_token)) -> dict[str, Any]:
    try:
        tools = client.tools()
        return {
            "status": "ok",
            "service": "onec-mcp-bridge",
            "allowed_tools": sorted(allowed_tools()),
            "tools_count": len(tools),
            **client.health(),
        }
    except McpRuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.get("/tools")
def list_tools(_: None = Depends(require_token)) -> dict[str, Any]:
    allowed = allowed_tools()
    try:
        tools = [tool for tool in client.tools() if tool.get("name") in allowed]
        return {"tools": tools, "allowed_tools": sorted(allowed)}
    except McpRuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.post("/tools/call")
async def call_tool(payload: ToolCallRequest, request: Request, _: None = Depends(require_token)) -> dict[str, Any]:
    allowed = allowed_tools()
    if payload.name not in allowed:
        raise HTTPException(status_code=403, detail="Этот MCP-инструмент не разрешен в bridge.")
    if not isinstance(payload.arguments, dict):
        raise HTTPException(status_code=400, detail="arguments должен быть объектом.")

    try:
        result = client.call_tool(payload.name, payload.arguments)
        return {"tool": payload.name, "result": result}
    except McpRuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
