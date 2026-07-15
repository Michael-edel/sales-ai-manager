from app.register_reader import read_register_records


def test_auto_type_uses_exact_register_reference_before_query() -> None:
    calls: list[tuple[str, dict]] = []

    def call_tool(name: str, arguments: dict) -> dict:
        calls.append((name, arguments))
        if name == "search_code":
            return {
                "content": [{
                    "type": "text",
                    "text": "РегистрНакопления.НДСЗаписиКнигиПродаж",
                }]
            }
        return {"content": [{"type": "text", "text": "[]"}]}

    result = read_register_records(
        {"registerType": "auto", "name": "НДСЗаписиКнигиПродаж", "limit": 50},
        call_tool,
    )

    assert [name for name, _ in calls] == ["search_code", "execute_query"]
    assert "РегистрНакопления.НДСЗаписиКнигиПродаж" in calls[-1][1]["query"]
    assert result["registerFqn"] == "РегистрНакопления.НДСЗаписиКнигиПродаж"
    assert result["rowLimit"] == 50
