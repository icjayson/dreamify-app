import asyncio
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException


USER_ID = "test_user_123"


def run(coro):
    return asyncio.run(coro)


def test_supabase_oauth_state_requires_pending_pkce_verifier():
    from app.services.supabase_service import SupabaseConnectorService

    service = SupabaseConnectorService()
    state = service._make_state_payload(USER_ID, "nonce", 1_900_000_000)

    with patch("app.services.supabase_service.connected_accounts_repo") as repo:
        repo.get_connection.return_value = {"pending_oauth_states": {}}
        with pytest.raises(ValueError, match="Missing Supabase OAuth verifier"):
            run(service.handle_oauth_callback(code="code", state=state))


def test_supabase_connection_uri_accepts_direct_and_rejects_transaction_pooler():
    from app.services.supabase_service import _validate_supabase_connection_uri

    direct = _validate_supabase_connection_uri(
        "postgresql://postgres:secret@db.abcdefghijklmnopqrst.supabase.co:5432/postgres"
    )
    assert direct["project_ref"] == "abcdefghijklmnopqrst"
    assert direct["connection_mode"] == "direct"
    assert direct["credential_risk"] == "admin_role"

    session = _validate_supabase_connection_uri(
        "postgresql://postgres.abcdefghijklmnopqrst:secret@aws-0-us-east-1.pooler.supabase.com:5432/postgres"
    )
    assert session["connection_mode"] == "session_pooler"

    with pytest.raises(HTTPException):
        _validate_supabase_connection_uri(
            "postgresql://postgres.abcdefghijklmnopqrst:secret@aws-0-us-east-1.pooler.supabase.com:6543/postgres"
        )


def test_supabase_profile_entity_id_parses_to_profile_mode():
    from app.services.supabase_service import SupabaseConnectorService

    parsed = SupabaseConnectorService().parse_entity_id("supabase:conn_1:profile")

    assert parsed == {"connection_id": "conn_1", "sync_mode": "profile_only"}


def test_supabase_create_connection_encrypts_credentials_and_flags_admin_role():
    from app.services.supabase_service import SupabaseConnectorService

    service = SupabaseConnectorService()
    service.adapter.test_connection = MagicMock(  # type: ignore[method-assign]
        return_value={
            "database": "postgres",
            "username": "postgres",
            "version": "PostgreSQL",
        }
    )

    with patch("app.services.supabase_service.connected_accounts_repo") as repo, patch(
        "app.services.supabase_service._encrypt_secret"
    ) as encrypt_secret:
        encrypt_secret.side_effect = lambda value: f"enc:{value}"
        repo.upsert_provider_metadata.return_value = {}

        summary = service.create_connection(
            user_id=USER_ID,
            project_ref="abcdefghijklmnopqrst",
            project_name="Dreambase",
            connection_uri="postgresql://postgres:secret@db.abcdefghijklmnopqrst.supabase.co:5432/postgres",
            include_schemas=["public", "auth"],
            service_role_key="service_role_secret",
        )

    metadata = repo.upsert_provider_metadata.call_args.kwargs["metadata"]
    assert summary["connector_key"] == "supabase"
    assert summary["credential_risk"] == "admin_role"
    assert metadata["encrypted_connection_uri"].startswith("enc:")
    assert metadata["encrypted_service_role_key"].startswith("enc:")
    assert metadata["include_schemas"] == ["public"]
    assert "connection_uri" not in metadata
    assert "service_role_key" not in metadata


def test_supabase_refresh_schema_persists_rls_profile():
    from app.services.supabase_service import SupabaseConnectorService

    service = SupabaseConnectorService()
    snapshot = {
        "schemas": [
            {
                "name": "public",
                "tables": [
                    {
                        "schema": "public",
                        "name": "orders",
                        "rls_enabled": True,
                        "policy_count": 2,
                        "columns": [{"name": "id"}],
                    }
                ],
            }
        ],
        "table_count": 1,
        "schema_fingerprint": "fp",
    }
    service.adapter.refresh_schema = MagicMock(return_value=snapshot)  # type: ignore[method-assign]

    with patch("app.services.supabase_service.connected_accounts_repo") as repo, patch(
        "app.services.supabase_service._decrypt_secret",
        return_value="postgresql://example",
    ):
        repo.get_connection.return_value = {
            "connection_id": "conn_1",
            "project_ref": "abcdefghijklmnopqrst",
            "project_name": "Dreambase",
            "encrypted_connection_uri": "enc_uri",
            "include_schemas": ["public"],
            "schema_snapshot": {},
        }

        summary = service.refresh_schema(USER_ID, "conn_1")

    assert summary["schema_snapshot"]["schemas"][0]["tables"][0]["rls_enabled"] is True
    metadata = repo.upsert_provider_metadata.call_args.kwargs["metadata"]
    assert metadata["schema_snapshot"]["schemas"][0]["tables"][0]["policy_count"] == 2


def test_supabase_sync_manifest_excludes_credentials_and_records_entity():
    from app.services.supabase_service import SupabaseConnectorService

    service = SupabaseConnectorService()
    service.adapter.export_table_csv = MagicMock(  # type: ignore[method-assign]
        return_value={
            "csv_content": b"id,email\n1,a@example.com\n",
            "headers": ["id", "email"],
            "row_count": 1,
            "column_count": 2,
            "generated_sql": 'SELECT "id", "email" FROM "public"."profiles" LIMIT 5000',
            "row_limit": 5000,
            "data_format": "csv",
            "truncated": False,
        }
    )
    snapshot = {
        "schemas": [
            {
                "name": "public",
                "tables": [
                    {
                        "schema": "public",
                        "name": "profiles",
                        "type": "base table",
                        "rls_enabled": True,
                        "policy_count": 1,
                        "grant_count": 3,
                        "columns": [
                            {"name": "id", "data_type": "uuid"},
                            {
                                "name": "email",
                                "data_type": "text",
                                "possible_pii": True,
                            },
                        ],
                    }
                ],
            }
        ],
        "table_count": 1,
        "schema_fingerprint": "fp",
    }

    with patch("app.services.supabase_service.connected_accounts_repo") as repo, patch(
        "app.services.supabase_service.assets_repo"
    ) as assets_repo, patch("app.services.supabase_service.upload_bytes"), patch(
        "app.services.supabase_service._decrypt_secret",
        return_value="postgresql://example",
    ):
        repo.get_connection.return_value = {
            "connection_id": "conn_1",
            "project_ref": "abcdefghijklmnopqrst",
            "project_name": "Dreambase",
            "encrypted_connection_uri": "enc_uri",
            "encrypted_service_role_key": "enc_service_role",
            "connection_mode": "direct",
            "credential_risk": "admin_role",
            "max_export_bytes": 1_000_000,
            "source_timezone": "UTC",
            "schema_snapshot": snapshot,
        }
        assets_repo.create_asset.return_value = {
            "asset_id": "asset_1",
            "filename": "supabase.csv",
            "size_bytes": 24,
            "extension": "csv",
            "project_id": "p1",
        }
        assets_repo.update_asset_metadata.side_effect = (
            lambda user_id, asset_id, metadata: {
                **assets_repo.create_asset.return_value,
                **metadata,
            }
        )

        result = service.sync(
            user_id=USER_ID,
            project_id="p1",
            connection_id="conn_1",
            sync_mode="bounded_table_snapshot",
            schema_name="public",
            table_name="profiles",
            columns=["id", "email"],
        )

    assert result["entity_id"] == "supabase:conn_1:table:public.profiles"
    metadata = assets_repo.update_asset_metadata.call_args.kwargs["metadata"]
    manifest = metadata["supabase_manifest"]
    assert manifest["rls_profile"]["enabled"] is True
    assert manifest["credential_risk"] == "admin_role"
    assert "encrypted_connection_uri" not in str(manifest)
    assert "enc_service_role" not in str(manifest)
    repo.append_selected_entity.assert_called_once()


def test_supabase_api_request_refreshes_401_and_retries_429():
    from app.services.supabase_service import SupabaseConnectorService

    service = SupabaseConnectorService()
    expired_at = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
    ok = MagicMock(status_code=200, text='[{"ref":"abc","name":"Demo"}]', headers={})
    ok.json.return_value = [{"ref": "abc", "name": "Demo"}]
    limited = MagicMock(status_code=429, text="", headers={"Retry-After": "0"})

    with patch("app.services.supabase_service.connected_accounts_repo") as repo, patch(
        "app.services.supabase_service._decrypt_secret"
    ) as decrypt_secret, patch(
        "app.services.supabase_service._encrypt_secret", lambda value: f"enc:{value}"
    ), patch(
        "httpx.AsyncClient"
    ) as mock_client, patch(
        "app.services.supabase_service.time.sleep"
    ) as sleep_mock, patch.dict(
        "os.environ",
        {"SUPABASE_CLIENT_ID": "cid", "SUPABASE_CLIENT_SECRET": "secret"},
    ):
        repo.get_connection.return_value = {
            "encrypted_access_token": "enc_old_access",
            "encrypted_refresh_token": "enc_refresh",
            "expires_at": expired_at,
        }
        decrypt_secret.side_effect = {
            "enc_old_access": "old_access",
            "enc_refresh": "refresh",
        }.__getitem__
        refresh_resp = MagicMock(status_code=200, text='{"access_token":"new_access"}')
        refresh_resp.json.return_value = {
            "access_token": "new_access",
            "refresh_token": "new_refresh",
            "expires_in": 3600,
        }
        mock_client.return_value.__aenter__ = AsyncMock(
            return_value=mock_client.return_value
        )
        mock_client.return_value.__aexit__ = AsyncMock(return_value=False)
        mock_client.return_value.post = AsyncMock(return_value=refresh_resp)
        mock_client.return_value.request = AsyncMock(side_effect=[limited, ok])

        projects = run(service.list_projects(USER_ID))

    assert projects == [
        {
            "ref": "abc",
            "name": "Demo",
            "region": None,
            "status": None,
            "organization_id": None,
        }
    ]
    assert sleep_mock.called
    assert mock_client.return_value.request.await_count == 2
    repo.upsert_provider_metadata.assert_called()
