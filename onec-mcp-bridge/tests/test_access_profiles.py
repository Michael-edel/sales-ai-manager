import os
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from app import main


ALL_TOOLS = sorted(set().union(*main.PROFILE_DEFAULT_TOOLS.values()))
LOCAL_TOOLS = {
    "read_source",
    "read_method_source",
    "get_edt_metadata_summary",
    "list_module_methods",
    "resolve_symbol",
    "find_references",
    "get_source_checksum",
    "estimate_tool_payload",
}


class FakeMcpClient:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict]] = []
        self.failure: Exception | None = None

    def tools(self) -> list[dict]:
        return [{"name": name, "description": name} for name in ALL_TOOLS if name not in LOCAL_TOOLS]

    def call_tool(self, name: str, arguments: dict) -> dict:
        if self.failure:
            raise self.failure
        self.calls.append((name, arguments))
        return {"content": [{"type": "text", "text": "ok"}]}

    def health(self) -> dict:
        return {"running": True, "initialized": True}


class FakeSourceReader:
    available = True

    def status(self) -> dict:
        return {"available": True, "indexed_modules": 1}

    def read(self, arguments: dict) -> dict:
        return {"sourceComplete": True, "arguments": arguments}

    def read_method(self, arguments: dict) -> dict:
        return {"sourceComplete": True, "sourceScope": "method", "arguments": arguments}

    def list_methods(self, arguments: dict) -> dict:
        return {"methods": [], "arguments": arguments}

    def resolve_symbol(self, arguments: dict) -> dict:
        return {"matches": [], "arguments": arguments}

    def find_references(self, arguments: dict) -> dict:
        return {"references": [], "arguments": arguments}

    def checksum(self, arguments: dict) -> dict:
        return {"sha256": "0" * 64, "arguments": arguments}

    def estimate_payload(self, arguments: dict) -> dict:
        return {"responseBytes": 1, "arguments": arguments}


class FakeMetadataReader:
    available = True

    def status(self) -> dict:
        return {"available": True}

    def read(self, arguments: dict) -> dict:
        return {"metadataComplete": True, "arguments": arguments}


class AccessProfileTests(unittest.TestCase):
    def setUp(self) -> None:
        self.fake_client = FakeMcpClient()
        self.env = patch.dict(
            os.environ,
            {
                "ONEC_MCP_BRIDGE_TOKEN": "business-token",
                "ONEC_MCP_INSPECTOR_TOKEN": "inspector-token",
                "ONEC_MCP_DIAGNOSTICS_TOKEN": "diagnostics-token",
                "ONEC_MCP_ALLOWED_TOOLS": "",
                "ONEC_MCP_INSPECTOR_ALLOWED_TOOLS": "",
                "ONEC_MCP_DIAGNOSTICS_ALLOWED_TOOLS": "",
                "ONEC_MCP_RATE_LIMIT_PER_MINUTE": "100",
                "ONEC_MCP_MAX_BODY_BYTES": "1048576",
            },
        )
        self.client_patch = patch.object(main, "client", self.fake_client)
        self.reader_patch = patch.object(main, "source_reader", FakeSourceReader())
        self.metadata_patch = patch.object(main, "metadata_reader", FakeMetadataReader())
        self.env.start()
        self.client_patch.start()
        self.reader_patch.start()
        self.metadata_patch.start()
        main.rate_limiter.reset()
        self.client = TestClient(main.app)

    def tearDown(self) -> None:
        self.client.close()
        self.metadata_patch.stop()
        self.reader_patch.stop()
        self.client_patch.stop()
        self.env.stop()
        main.rate_limiter.reset()

    @staticmethod
    def headers(token: str) -> dict[str, str]:
        return {"Authorization": f"Bearer {token}"}

    def tool_names(self, token: str) -> set[str]:
        response = self.client.get("/tools", headers=self.headers(token))
        self.assertEqual(response.status_code, 200)
        return {tool["name"] for tool in response.json()["tools"]}

    def test_development_profile_is_read_only_source_access(self) -> None:
        names = self.tool_names("inspector-token")
        self.assertIn("search_code", names)
        self.assertIn("read_source", names)
        self.assertIn("read_method_source", names)
        self.assertIn("get_edt_metadata_summary", names)
        self.assertTrue({
            "list_module_methods",
            "resolve_symbol",
            "find_references",
            "get_source_checksum",
            "estimate_tool_payload",
        }.issubset(names))
        self.assertNotIn("execute_query", names)
        self.assertNotIn("get_event_log", names)

    def test_development_navigation_tool_stays_local(self) -> None:
        response = self.client.post(
            "/tools/call",
            headers=self.headers("inspector-token"),
            json={"name": "list_module_methods", "arguments": {"module": "ОбщийМодуль.Тест.Модуль"}},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.fake_client.calls, [])

    def test_business_profile_keeps_queries_without_source_or_logs(self) -> None:
        names = self.tool_names("business-token")
        self.assertIn("execute_query", names)
        self.assertNotIn("search_code", names)
        self.assertNotIn("read_source", names)
        self.assertNotIn("read_method_source", names)
        self.assertNotIn("get_edt_metadata_summary", names)
        self.assertNotIn("get_event_log", names)

    def test_diagnostics_profile_is_separate(self) -> None:
        names = self.tool_names("diagnostics-token")
        self.assertEqual(names, {"get_configuration_info", "get_event_log"})

    def test_cross_profile_tool_call_is_denied(self) -> None:
        response = self.client.post(
            "/tools/call",
            headers=self.headers("inspector-token"),
            json={"name": "execute_query", "arguments": {"query": "select"}},
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["detail"]["code"], "TOOL_NOT_ALLOWED")
        self.assertEqual(self.fake_client.calls, [])

    def test_upstream_error_does_not_leak_diagnostics(self) -> None:
        self.fake_client.failure = main.McpRuntimeError("secret internal path")
        response = self.client.post(
            "/tools/call",
            headers={**self.headers("business-token"), "X-Request-ID": "test-request"},
            json={"name": "execute_query", "arguments": {}},
        )
        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.json()["detail"]["code"], "UPSTREAM_UNAVAILABLE")
        self.assertEqual(response.headers["X-Request-ID"], "test-request")
        self.assertNotIn("secret internal path", response.text)

    def test_invalid_token_returns_generic_error(self) -> None:
        response = self.client.get("/health", headers=self.headers("wrong-secret"))
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["detail"]["code"], "AUTH_FAILED")
        self.assertNotIn("wrong-secret", response.text)

    def test_request_body_limit_is_enforced(self) -> None:
        with patch.dict(os.environ, {"ONEC_MCP_MAX_BODY_BYTES": "1024"}):
            response = self.client.post(
                "/tools/call",
                headers=self.headers("business-token"),
                json={"name": "execute_query", "arguments": {"query": "x" * 2000}},
            )
        self.assertEqual(response.status_code, 413)
        self.assertEqual(response.json()["detail"]["code"], "REQUEST_TOO_LARGE")

    def test_rate_limit_is_enforced_per_token(self) -> None:
        main.rate_limiter.reset()
        with patch.dict(os.environ, {"ONEC_MCP_RATE_LIMIT_PER_MINUTE": "1"}):
            first = self.client.get("/health", headers=self.headers("business-token"))
            second = self.client.get("/health", headers=self.headers("business-token"))
        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 429)
        self.assertEqual(second.json()["detail"]["code"], "RATE_LIMITED")


if __name__ == "__main__":
    unittest.main()
