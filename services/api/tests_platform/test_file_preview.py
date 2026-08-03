import hashlib
import io
import zipfile

import pytest


async def create_project(client, headers):
    response = await client.post(
        "/api/v1/projects", headers=headers, json={"name": "Preview files"}
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


async def upload_asset(
    client,
    headers,
    project_id,
    filename,
    content_type,
    content,
    request_key,
):
    intent = await client.post(
        "/api/v1/uploads/intents",
        headers=headers,
        json={
            "project_id": project_id,
            "filename": filename,
            "content_type": content_type,
            "size_bytes": len(content),
            "checksum_sha256": hashlib.sha256(content).hexdigest(),
            "idempotency_key": request_key,
        },
    )
    assert intent.status_code == 201, intent.text
    reservation_id = intent.json()["id"]
    uploaded = await client.put(
        f"/api/v1/uploads/{reservation_id}/content",
        headers={**headers, "Content-Type": content_type},
        content=content,
    )
    assert uploaded.status_code == 202, uploaded.text
    finalized = await client.post(
        f"/api/v1/uploads/{reservation_id}/finalize", headers=headers
    )
    assert finalized.status_code == 200, finalized.text
    return finalized.json()["id"]


def minimal_xlsx() -> bytes:
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as archive:
        archive.writestr("[Content_Types].xml", "<Types />")
        archive.writestr("xl/workbook.xml", "<workbook />")
    return output.getvalue()


@pytest.mark.anyio
async def test_csv_preview_is_bounded_paginated_and_owner_only(client, auth_headers):
    owner = auth_headers("file-owner")
    outsider = auth_headers("file-outsider")
    project_id = await create_project(client, owner)
    asset_id = await upload_asset(
        client,
        owner,
        project_id,
        "dataset.csv",
        "text/csv",
        b"name,value\nalpha,1\nbeta,2\ngamma,3\n",
        "preview-csv-0001",
    )

    preview = await client.get(
        f"/api/v1/files/preview/{asset_id}?limit=1&offset=1", headers=owner
    )
    assert preview.status_code == 200, preview.text
    assert preview.json() == {
        "success": True,
        "filename": "dataset.csv",
        "columns": ["name", "value"],
        "rows": [["beta", "2"]],
        "total_rows": 3,
        "displayed_rows": 1,
        "offset": 1,
        "source_type": "csv",
    }
    assert (
        await client.get(f"/api/v1/files/preview/{asset_id}", headers=outsider)
    ).status_code == 404
    assert (await client.get(f"/api/v1/files/preview/{asset_id}")).status_code == 401


@pytest.mark.anyio
async def test_flat_json_preview_and_nested_json_rejection(client, auth_headers):
    owner = auth_headers("file-owner")
    project_id = await create_project(client, owner)
    flat_id = await upload_asset(
        client,
        owner,
        project_id,
        "flat.json",
        "application/json",
        b'[{"name":"alpha","value":1},{"name":"beta","value":null}]',
        "preview-json-0001",
    )
    flat = await client.get(f"/api/v1/files/preview/{flat_id}", headers=owner)
    assert flat.status_code == 200, flat.text
    assert flat.json()["columns"] == ["name", "value"]
    assert flat.json()["rows"] == [["alpha", 1], ["beta", None]]

    nested_content = b'[{"name":"alpha","nested":{"secret":1}}]'
    intent = await client.post(
        "/api/v1/uploads/intents",
        headers=owner,
        json={
            "project_id": project_id,
            "filename": "nested.json",
            "content_type": "application/json",
            "size_bytes": len(nested_content),
            "checksum_sha256": hashlib.sha256(nested_content).hexdigest(),
            "idempotency_key": "preview-json-0002",
        },
    )
    reservation_id = intent.json()["id"]
    uploaded = await client.put(
        f"/api/v1/uploads/{reservation_id}/content",
        headers={**owner, "Content-Type": "application/json"},
        content=nested_content,
    )
    assert uploaded.status_code == 202
    rejected = await client.post(
        f"/api/v1/uploads/{reservation_id}/finalize", headers=owner
    )
    assert rejected.status_code == 422
    assert rejected.json()["error"]["code"] == "JSON_NOT_FLAT"


@pytest.mark.anyio
async def test_excel_preview_returns_typed_unsupported_error(client, auth_headers):
    owner = auth_headers("file-owner")
    project_id = await create_project(client, owner)
    asset_id = await upload_asset(
        client,
        owner,
        project_id,
        "workbook.xlsx",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        minimal_xlsx(),
        "preview-xlsx-0001",
    )
    preview = await client.get(f"/api/v1/files/preview/{asset_id}", headers=owner)
    assert preview.status_code == 415
    assert preview.json()["error"] == {
        "code": "PREVIEW_FORMAT_UNSUPPORTED",
        "message": "Excel preview is unavailable; the file can still be analyzed",
        "details": {"format": "xlsx", "analysis_supported": True},
    }


@pytest.mark.anyio
async def test_preview_enforces_row_column_and_page_boundaries(
    client, auth_headers, runtime_settings
):
    owner = auth_headers("file-owner")
    project_id = await create_project(client, owner)
    asset_id = await upload_asset(
        client,
        owner,
        project_id,
        "wide.csv",
        "text/csv",
        b"a,b,c\n1,2,3\n4,5,6\n7,8,9\n",
        "preview-csv-0002",
    )

    runtime_settings.max_columns_per_file = 2
    columns = await client.get(f"/api/v1/files/preview/{asset_id}", headers=owner)
    assert columns.status_code == 413
    assert columns.json()["error"]["code"] == "PREVIEW_COLUMN_LIMIT"

    runtime_settings.max_columns_per_file = 200
    runtime_settings.max_rows_per_file = 2
    rows = await client.get(f"/api/v1/files/preview/{asset_id}", headers=owner)
    assert rows.status_code == 413
    assert rows.json()["error"]["code"] == "PREVIEW_ROW_LIMIT"

    invalid_page = await client.get(
        f"/api/v1/files/preview/{asset_id}?limit=5001", headers=owner
    )
    assert invalid_page.status_code == 422
