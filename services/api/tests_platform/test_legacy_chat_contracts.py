import json

import pytest

from app.platform.errors import ApiError
from app.platform.legacy_behavior import (
    MAX_EXPLAINER_BYTES,
    bounded_explainer,
    clarification_dismissal_key,
    normalize_chat_request,
    update_dashboard_presentation,
    validate_clarification_responses,
)
from app.platform.models import Asset, Conversation, StoredObject, WorkflowRun, utc_now


class DispatchResponse:
    status_code = 202

    def json(self):
        return {"workflow_run_id": "wfr-legacy-chat"}


async def create_workspace(client, headers, suffix="legacy"):
    project = await client.post(
        "/api/v1/projects", headers=headers, json={"name": f"Project {suffix}"}
    )
    assert project.status_code == 201, project.text
    conversation = await client.post(
        "/api/v1/conversations",
        headers=headers,
        json={"project_id": project.json()["id"], "title": f"Chat {suffix}"},
    )
    assert conversation.status_code == 201, conversation.text
    return project.json(), conversation.json()


async def create_dashboard(client, headers, project_id, conversation_id):
    response = await client.post(
        "/api/v1/dashboards",
        headers=headers,
        json={
            "project_id": project_id,
            "conversation_id": conversation_id,
            "title": "Revenue",
            "content": {
                "id": "dashboard-revenue",
                "title": "Revenue",
                "theme_id": "default",
                "layout": {"type": "grid", "grid_columns": 24},
                "components": [],
                "styling_recommendations": {
                    "theme": "default",
                    "font": "Inter",
                },
            },
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def mark_awaiting(app, run_id, output):
    with app.state.database.session() as session:
        run = session.get(WorkflowRun, run_id)
        assert run is not None
        run.status = "awaiting_user_input"
        run.current_step = "clarification"
        run.response_type = "clarification_request"
        run.output = output
        run.completed_at = utc_now()
        run.version += 1
        conversation = session.get(Conversation, run.conversation_id)
        assert conversation is not None
        conversation.active_run_id = None


def test_legacy_template_normalization_respects_explicit_presentation():
    assert normalize_chat_request({"template_id": "hr_workforce"}) == {
        "template_id": "hr_workforce",
        "theme_id": "warm",
        "analysis_focus_id": "hr_workforce",
    }
    explicit = normalize_chat_request(
        {
            "template_id": "hr_workforce",
            "theme_id": "aurora",
            "analysis_focus_id": "executive_summary",
        }
    )
    assert explicit["theme_id"] == "aurora"
    assert explicit["analysis_focus_id"] == "executive_summary"
    assert normalize_chat_request({}) == {}


def test_dashboard_presentation_keeps_canonical_and_legacy_views_consistent():
    legacy = {
        "id": "dashboard-1",
        "theme_id": "default",
        "styling_recommendations": {"theme": "default", "font": "Inter"},
    }
    themed = update_dashboard_presentation(legacy, "theme_id", "glacier")
    assert themed["theme_id"] == "glacier"
    assert themed["styling_recommendations"] == {
        "theme": "glacier",
        "font": "Inter",
    }

    templated = update_dashboard_presentation(legacy, "template_id", "finance_overview")
    assert templated["theme_id"] == "chalk"
    assert templated["metadata"] == {
        "template_id": "finance_overview",
        "analysis_focus_id": "finance_overview",
    }
    assert "template_id" not in templated


def test_explainer_preserves_small_fields_and_bounds_oversized_activity():
    assert bounded_explainer(None) == {}
    assert bounded_explainer({}) == {}
    small = bounded_explainer(
        {
            "edit_note": "Recolored the chart.",
            "data_provenance": {"python_code": ["print(1)"]},
            "analysis_steps": [
                {
                    "index": 0,
                    "title": "Load data",
                    "python": "df = read()",
                    "output": "10 rows",
                }
            ],
        }
    )
    assert small["change_summary"] == {"human_summary": "Recolored the chart."}
    assert small["computed_values"] == {"python_code": ["print(1)"]}
    assert small["analysis_steps"][0]["python"] == "df = read()"

    oversized = bounded_explainer(
        {
            "change_summary": {"human_summary": "kept"},
            "computed_values": {"payload": "x" * 100_000},
            "analysis_steps": [
                {"title": f"Step {index}", "output": "y" * 20_000}
                for index in range(20)
            ],
        }
    )
    assert len(json.dumps(oversized).encode("utf-8")) <= MAX_EXPLAINER_BYTES
    assert oversized["change_summary"]["human_summary"] == "kept"


def test_clarification_validation_supports_batches_and_rejects_bad_options():
    parent = {
        "clarifications": [
            {
                "clarification_id": "join",
                "options": [{"id": "auto_join", "label": "Infer"}],
            },
            {
                "clarification_id": "output",
                "options": [{"id": "text_answer", "label": "Text"}],
            },
        ]
    }
    valid = [
        {
            "type": "clarification_response",
            "data": {
                "clarification_id": "join",
                "selected_option_id": "auto_join",
            },
        },
        {
            "type": "clarification_response",
            "data": {
                "clarification_id": "output",
                "selected_option_id": "text_answer",
                "metadata": {"route_mode": "qa"},
            },
        },
    ]
    validate_clarification_responses(valid, parent)

    invalid = [
        {
            "type": "clarification_response",
            "data": {
                "clarification_id": "output",
                "selected_option_id": "missing",
            },
        }
    ]
    with pytest.raises(ApiError) as error:
        validate_clarification_responses(invalid, parent)
    assert error.value.status_code == 400
    assert error.value.code == "INVALID_CLARIFICATION_RESPONSE"
    assert len(clarification_dismissal_key("x" * 128)) <= 128


@pytest.mark.anyio
async def test_chat_normalizes_theme_focus_and_legacy_templates(
    client, auth_headers, monkeypatch
):
    monkeypatch.setattr(
        "app.platform.dispatch.httpx.post",
        lambda *_args, **_kwargs: DispatchResponse(),
    )
    headers = auth_headers("presentation-owner")
    project, conversation = await create_workspace(client, headers, "presentation")

    async def submit(request_id, conversation_id, **presentation):
        response = await client.post(
            "/api/v1/conversation/chat",
            headers=headers,
            json={
                "client_request_id": request_id,
                "project_id": project["id"],
                "conversation_id": conversation_id,
                "user_node_contents": [
                    {"type": "text", "data": {"text": "Build a dashboard"}}
                ],
                **presentation,
            },
        )
        assert response.status_code == 202, response.text
        run_id = response.json()["run_id"]
        context = await client.get(
            f"/api/v1/internal/workflow/runs/{run_id}/context",
            headers={"X-Internal-Service-Secret": "internal-secret"},
        )
        assert context.status_code == 200, context.text
        return run_id, context.json()["context"]

    explicit_id, explicit = await submit(
        "presentation-explicit",
        conversation["id"],
        theme_id="aurora",
        analysis_focus_id="hr_workforce",
    )
    assert explicit["theme_id"] == "aurora"
    assert explicit["focus_id"] == "hr_workforce"

    conversations = []
    for title in ("Default", "Template"):
        created = await client.post(
            "/api/v1/conversations",
            headers=headers,
            json={"project_id": project["id"], "title": title},
        )
        conversations.append(created.json())
    default_id, default = await submit("presentation-default", conversations[0]["id"])
    assert default["theme_id"] == "default"
    assert default["focus_id"] is None
    assert default["assets"] == []

    template_id, template = await submit(
        "presentation-template",
        conversations[1]["id"],
        template_id="hr_workforce",
    )
    assert template["theme_id"] == "warm"
    assert template["focus_id"] == "hr_workforce"

    explicit_run = await client.get(
        f"/api/v1/workflow-runs/{explicit_id}", headers=headers
    )
    default_run = await client.get(
        f"/api/v1/workflow-runs/{default_id}", headers=headers
    )
    template_run = await client.get(
        f"/api/v1/workflow-runs/{template_id}", headers=headers
    )
    assert explicit_run.json()["input"]["chat_request"]["theme_id"] == "aurora"
    assert "theme_id" not in default_run.json()["input"]["chat_request"]
    assert template_run.json()["input"]["chat_request"] == {
        "client_request_id": "presentation-template",
        "conversation_id": conversations[1]["id"],
        "project_id": project["id"],
        "user_node_contents": [{"type": "text", "data": {"text": "Build a dashboard"}}],
        "template_id": "hr_workforce",
        "theme_id": "warm",
        "analysis_focus_id": "hr_workforce",
    }


@pytest.mark.anyio
async def test_dashboard_style_updates_keep_effective_presentation_consistent(
    client, auth_headers
):
    headers = auth_headers("style-owner")
    project, conversation = await create_workspace(client, headers, "style")
    dashboard = await create_dashboard(
        client, headers, project["id"], conversation["id"]
    )
    base = f"/api/v1/conversation/{conversation['id']}/dashboard/{dashboard['id']}"

    themed = await client.put(
        f"{base}/theme",
        headers=headers,
        json={
            "project_id": project["id"],
            "theme_id": "glacier",
            "expected_version": 1,
        },
    )
    assert themed.status_code == 200, themed.text
    templated = await client.put(
        f"{base}/template",
        headers=headers,
        json={
            "project_id": project["id"],
            "template_id": "finance_overview",
            "expected_version": 2,
        },
    )
    assert templated.status_code == 200, templated.text

    current = await client.get(f"/api/v1/dashboards/{dashboard['id']}", headers=headers)
    content = current.json()["content"]
    assert content["theme_id"] == "chalk"
    assert content["styling_recommendations"] == {
        "theme": "chalk",
        "font": "Inter",
    }
    assert content["metadata"] == {
        "template_id": "finance_overview",
        "analysis_focus_id": "finance_overview",
    }
    assert "template_id" not in content


@pytest.mark.anyio
async def test_clarification_children_validate_each_option_and_preserve_metadata(
    client, app, auth_headers, monkeypatch
):
    dispatched = []

    def dispatch(*_args, **_kwargs):
        dispatched.append(True)
        return DispatchResponse()

    monkeypatch.setattr("app.platform.dispatch.httpx.post", dispatch)
    headers = auth_headers("clarification-owner")
    project, conversation = await create_workspace(client, headers, "clarification")
    parent = await client.post(
        "/api/v1/conversation/chat",
        headers=headers,
        json={
            "client_request_id": "clarification-parent",
            "project_id": project["id"],
            "conversation_id": conversation["id"],
            "user_node_contents": [
                {"type": "text", "data": {"text": "Analyze the data"}}
            ],
        },
    )
    assert parent.status_code == 202, parent.text
    mark_awaiting(
        app,
        parent.json()["run_id"],
        {
            "type": "clarification_request",
            "content": "Choose two options",
            "clarifications": [
                {
                    "clarification_id": "join",
                    "reason_code": "join_strategy",
                    "question": "How should files be joined?",
                    "options": [{"id": "auto_join", "label": "Infer"}],
                },
                {
                    "clarification_id": "output",
                    "reason_code": "output_mode",
                    "question": "Which output?",
                    "options": [{"id": "text_answer", "label": "Text"}],
                },
            ],
        },
    )

    def response_payload(request_id, output_option):
        return {
            "client_request_id": request_id,
            "project_id": project["id"],
            "conversation_id": conversation["id"],
            "user_node_contents": [
                {"type": "text", "data": {"text": "Infer and answer inline"}},
                {
                    "type": "clarification_response",
                    "data": {
                        "clarification_id": "join",
                        "selected_option_id": "auto_join",
                    },
                },
                {
                    "type": "clarification_response",
                    "data": {
                        "clarification_id": "output",
                        "selected_option_id": output_option,
                        "metadata": {"route_mode": "qa_visual"},
                    },
                },
            ],
        }

    invalid = await client.post(
        "/api/v1/conversation/chat",
        headers=headers,
        json=response_payload("clarification-invalid", "missing"),
    )
    assert invalid.status_code == 400
    assert invalid.json()["error"]["code"] == "INVALID_CLARIFICATION_RESPONSE"
    assert len(dispatched) == 1

    accepted = await client.post(
        "/api/v1/conversation/chat",
        headers=headers,
        json=response_payload("clarification-valid", "text_answer"),
    )
    assert accepted.status_code == 202, accepted.text
    assert len(dispatched) == 2
    child = await client.get(
        f"/api/v1/workflow-runs/{accepted.json()['run_id']}", headers=headers
    )
    assert child.json()["parent_run_id"] == parent.json()["run_id"]
    assert child.json()["input"]["chat_request"]["user_node_contents"][2]["data"][
        "metadata"
    ] == {"route_mode": "qa_visual"}


@pytest.mark.anyio
async def test_chat_rejects_cross_project_assets_before_dispatch(
    client, app, auth_headers, monkeypatch
):
    dispatched = []

    def dispatch(*_args, **_kwargs):
        dispatched.append(True)
        return DispatchResponse()

    monkeypatch.setattr("app.platform.dispatch.httpx.post", dispatch)
    headers = auth_headers("asset-owner")
    first, conversation = await create_workspace(client, headers, "asset-one")
    second = await client.post(
        "/api/v1/projects", headers=headers, json={"name": "Asset two"}
    )
    with app.state.database.session() as session:
        stored = StoredObject(
            owner_id="asset-owner",
            backend="local",
            pathname="users/asset-owner/assets/other.csv",
            content_type="text/csv",
            size_bytes=4,
            checksum_sha256="a" * 64,
        )
        session.add(stored)
        session.flush()
        asset = Asset(
            owner_id="asset-owner",
            project_id=second.json()["id"],
            stored_object_id=stored.id,
            filename="other.csv",
            content_type="text/csv",
            size_bytes=4,
            status="ready",
        )
        session.add(asset)
        session.flush()
        asset_id = asset.id

    rejected = await client.post(
        "/api/v1/conversation/chat",
        headers=headers,
        json={
            "client_request_id": "cross-project-asset",
            "project_id": first["id"],
            "conversation_id": conversation["id"],
            "asset_id": asset_id,
            "user_node_contents": [
                {"type": "text", "data": {"text": "Analyze other.csv"}}
            ],
        },
    )
    assert rejected.status_code == 404
    assert dispatched == []


@pytest.mark.anyio
async def test_clarification_dismissal_is_durable_idempotent_and_tenant_safe(
    client, app, auth_headers, monkeypatch
):
    dispatched = []

    def dispatch(*_args, **_kwargs):
        dispatched.append(True)
        return DispatchResponse()

    monkeypatch.setattr("app.platform.dispatch.httpx.post", dispatch)
    owner = auth_headers("dismiss-owner")
    project, conversation = await create_workspace(client, owner, "dismiss")
    parent = await client.post(
        "/api/v1/conversation/chat",
        headers=owner,
        json={
            "client_request_id": "dismiss-parent-run",
            "project_id": project["id"],
            "conversation_id": conversation["id"],
            "user_node_contents": [
                {"type": "text", "data": {"text": "Please clarify"}}
            ],
        },
    )
    run_id = parent.json()["run_id"]
    mark_awaiting(
        app,
        run_id,
        {
            "type": "clarification_request",
            "content": "Choose the data context",
            "clarification_id": "clarify-data",
            "reason_code": "asset",
            "options": [{"id": "asset:one", "label": "Dataset"}],
        },
    )
    url = (
        f"/api/v1/conversation/{conversation['id']}/clarification/clarify-data/dismiss"
    )
    outsider = await client.post(
        url,
        headers=auth_headers("dismiss-outsider"),
        params={"project_id": project["id"]},
    )
    assert outsider.status_code == 404
    unknown = await client.post(
        url.replace("clarify-data", "missing"),
        headers=owner,
        params={"project_id": project["id"]},
    )
    assert unknown.status_code == 404
    assert unknown.json()["error"]["code"] == "CLARIFICATION_NOT_FOUND"

    dismissed = await client.post(
        url, headers=owner, params={"project_id": project["id"]}
    )
    repeated = await client.post(
        url, headers=owner, params={"project_id": project["id"]}
    )
    assert dismissed.status_code == repeated.status_code == 200
    assert dismissed.json()["status"] == "stopped"
    assert repeated.json()["run_id"] == run_id
    assert len(dispatched) == 1

    restored = await client.get(
        f"/api/v1/conversation/{conversation['id']}",
        headers=owner,
        params={"project_id": project["id"]},
    )
    hidden = restored.json()["conversation"]["nodes"][-1]
    assert hidden["role"] == "user"
    assert hidden["metadata"] == {"hidden": True}
    assert hidden["contents"] == [
        {
            "type": "clarification_response",
            "data": {
                "clarification_id": "clarify-data",
                "selected_option_id": None,
                "answer_status": "no_answer",
                "hidden": True,
            },
        }
    ]
    events = await client.get(f"/api/v1/workflow-runs/{run_id}/events", headers=owner)
    assert [event["event_type"] for event in events.json()] == [
        "clarification_dismissed"
    ]
    status = await client.get(
        f"/api/v1/conversation/workflow-status/{conversation['id']}",
        headers=owner,
        params={"project_id": project["id"]},
    )
    assert status.json()["status"] == "stopped"


@pytest.mark.anyio
async def test_explainer_fields_flow_to_status_dashboard_and_nested_events(
    client, app, auth_headers
):
    headers = auth_headers("explainer-owner")
    project, conversation = await create_workspace(client, headers, "explainer")
    dashboard = await create_dashboard(
        client, headers, project["id"], conversation["id"]
    )
    created = await client.post(
        "/api/v1/workflow-runs",
        headers=headers,
        json={
            "project_id": project["id"],
            "conversation_id": conversation["id"],
            "input": {"prompt": "Edit revenue"},
        },
    )
    assert created.status_code == 201, created.text
    run_id = created.json()["id"]
    event = await client.post(
        f"/api/v1/workflow-runs/{run_id}/events",
        headers={"X-Internal-Service-Secret": "internal-secret"},
        json={
            "event_key": "analysis-one",
            "event_type": "analysis",
            "payload": {
                "phase": "analysis",
                "title": "Sum revenue",
                "metadata": {
                    "python": "df['rev'].sum()",
                    "output": "12345",
                    "step_index": 1,
                },
            },
        },
    )
    assert event.status_code == 201, event.text
    steps = [
        {
            "index": 0,
            "title": "Load data",
            "python": "df = read()",
            "output": "10 rows",
        }
    ]
    with app.state.database.session() as session:
        run = session.get(WorkflowRun, run_id)
        assert run is not None
        run.status = "completed"
        run.current_step = "done"
        run.response_type = "chart_modification"
        run.output = {
            "type": "chart_modification",
            "content": "Updated revenue",
            "change_summary": {"human_summary": "Recolored the chart."},
            "data_provenance": {"python_code": ["print(1)"]},
            "analysis_steps": steps,
            "edit_note": "Recolored the chart.",
        }
        run.result = {
            "response_type": "chart_modification",
            "dashboard_id": dashboard["id"],
        }
        run.completed_at = utc_now()
        run.version += 1
        stored_conversation = session.get(Conversation, conversation["id"])
        assert stored_conversation is not None
        stored_conversation.active_run_id = None

    status = await client.get(
        f"/api/v1/conversation/workflow-status/{conversation['id']}",
        headers=headers,
        params={"project_id": project["id"]},
    )
    metadata = status.json()["metadata"]
    assert metadata["change_summary"] == {"human_summary": "Recolored the chart."}
    assert metadata["computed_values"] == {"python_code": ["print(1)"]}
    assert metadata["analysis_steps"] == steps

    dashboard_response = await client.get(
        f"/api/v1/conversation/{conversation['id']}/dashboard",
        headers=headers,
        params={
            "project_id": project["id"],
            "dashboard_id": dashboard["id"],
        },
    )
    assert dashboard_response.json()["change_summary"] == metadata["change_summary"]
    assert dashboard_response.json()["computed_values"] == metadata["computed_values"]
    assert dashboard_response.json()["analysis_steps"] == steps

    events = await client.get(
        f"/api/v1/conversation/workflow-events/{conversation['id']}",
        headers=headers,
        params={"project_id": project["id"]},
    )
    nested = events.json()["events"][0]["metadata"]
    assert nested == {
        "python": "df['rev'].sum()",
        "output": "12345",
        "step_index": 1,
    }

    unrelated = await create_dashboard(
        client, headers, project["id"], conversation["id"]
    )
    without_explainer = await client.get(
        f"/api/v1/conversation/{conversation['id']}/dashboard",
        headers=headers,
        params={
            "project_id": project["id"],
            "dashboard_id": unrelated["id"],
        },
    )
    assert without_explainer.json()["change_summary"] is None
    assert without_explainer.json()["computed_values"] is None
    assert without_explainer.json()["analysis_steps"] is None
