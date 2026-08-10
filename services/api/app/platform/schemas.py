"""Versioned public API schemas."""

import re
from datetime import datetime
from typing import Any, Dict, List, Literal, Optional

from pydantic import (
    AliasChoices,
    BaseModel,
    ConfigDict,
    Field,
    SecretStr,
    field_validator,
    model_validator,
)

RunStatus = Literal[
    "queued",
    "running",
    "awaiting_user_input",
    "completed",
    "failed",
    "cancelling",
    "cancelled",
]
ProviderName = Literal["openai", "gemini", "deepseek"]
ProjectRole = Literal["owner", "editor", "viewer"]
ProjectMemberStatus = Literal["active", "inactive"]


class OrmSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class UserRead(OrmSchema):
    id: str
    email: Optional[str]
    display_name: Optional[str]
    status: str
    created_at: datetime


def _normalize_preview_email(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    normalized = value.strip().lower()
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[A-Za-z]{2,}", normalized):
        raise ValueError("email must be a valid address")
    return normalized


class PreviewAllowedUserWrite(BaseModel):
    user_id: Optional[str] = Field(default=None, min_length=1, max_length=255)
    email: Optional[str] = Field(default=None, max_length=320)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: Optional[str]) -> Optional[str]:
        return _normalize_preview_email(value)

    @model_validator(mode="after")
    def require_identity(self) -> "PreviewAllowedUserWrite":
        if not self.user_id and not self.email:
            raise ValueError("user_id or email is required")
        return self


class PreviewAllowedUserRead(OrmSchema):
    user_id: Optional[str] = None
    email: Optional[str] = None
    name: Optional[str] = None
    image_url: Optional[str] = None


class UserLookupRead(BaseModel):
    success: bool = True
    user_id: Optional[str] = None
    email: str
    name: Optional[str] = None
    image_url: Optional[str] = None


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    description: Optional[str] = Field(default=None, max_length=5000)


class ProjectUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=160)
    description: Optional[str] = Field(default=None, max_length=5000)
    is_preview_public: Optional[bool] = None
    allowed: Optional[List[PreviewAllowedUserWrite]] = Field(
        default=None, max_length=50
    )


class ProjectRead(OrmSchema):
    id: str
    owner_id: str
    name: str
    description: Optional[str]
    is_preview_public: bool = False
    allowed: List[PreviewAllowedUserRead] = Field(
        default_factory=list,
        validation_alias=AliasChoices("allowed", "preview_grants"),
    )
    created_at: datetime
    updated_at: datetime


class ProjectMemberCreate(BaseModel):
    user_id: Optional[str] = Field(default=None, min_length=1, max_length=255)
    email: Optional[str] = Field(default=None, max_length=320)
    role: ProjectRole

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: Optional[str]) -> Optional[str]:
        return _normalize_preview_email(value)

    @model_validator(mode="after")
    def require_identity(self) -> "ProjectMemberCreate":
        if not self.user_id and not self.email:
            raise ValueError("user_id or email is required")
        return self


class ProjectMemberUpdate(BaseModel):
    role: Optional[ProjectRole] = None
    status: Optional[ProjectMemberStatus] = None

    @model_validator(mode="after")
    def require_change(self) -> "ProjectMemberUpdate":
        if self.role is None and self.status is None:
            raise ValueError("role or status is required")
        return self


class ProjectMemberRead(BaseModel):
    id: str
    project_id: str
    user_id: str
    email: Optional[str] = None
    display_name: Optional[str] = None
    role: ProjectRole
    status: ProjectMemberStatus
    created_at: datetime
    updated_at: datetime


class LegacyProjectRead(ProjectRead):
    latest_conversation_id: Optional[str] = None
    latest_dashboard_id: Optional[str] = None
    dashboard_title: Optional[str] = None
    name_source: Optional[str] = None
    dashboard_preview_key: Optional[str] = None
    is_preview_public: bool = False
    allowed: List[Dict[str, Any]] = Field(default_factory=list)
    source_type: Optional[str] = None


class LegacyProjectListRead(BaseModel):
    projects: List[LegacyProjectRead]


class PublicProjectRead(BaseModel):
    id: str
    name: str
    description: Optional[str]
    created_at: datetime
    updated_at: datetime
    latest_conversation_id: Optional[str] = None
    latest_dashboard_id: Optional[str] = None
    dashboard_title: Optional[str] = None
    is_preview_public: bool


class PublicDashboardDataRead(BaseModel):
    dashboard_id: Optional[str]
    dashboard_data: Optional[Dict[str, Any]]
    current_version: Optional[int] = None
    dashboard_title: Optional[str] = None
    updated_at: Optional[datetime] = None


class AssetRead(OrmSchema):
    id: str
    project_id: str
    filename: str
    asset_type: str
    content_type: str
    size_bytes: int
    status: str
    created_at: datetime


class StorageReferenceRead(BaseModel):
    provider: str
    pathname: str


class LegacyAssetRead(BaseModel):
    asset_id: str
    file_id: str
    project_id: str
    filename: str
    extension: str
    status: str
    storage_ref: StorageReferenceRead
    size_bytes: int
    created_at: datetime
    asset_type: str
    checksum_sha256: str


class LegacyAssetListRead(BaseModel):
    assets: List[LegacyAssetRead]


class FilePreviewRead(BaseModel):
    success: bool = True
    filename: str
    columns: List[str]
    rows: List[List[Any]]
    total_rows: int
    displayed_rows: int
    offset: int
    source_type: Literal["csv", "json"]


class UploadIntentCreate(BaseModel):
    project_id: str
    filename: str = Field(min_length=1, max_length=255)
    asset_type: Literal["dataset"] = "dataset"
    content_type: str = Field(min_length=1, max_length=255)
    size_bytes: int = Field(gt=0)
    checksum_sha256: Optional[str] = None
    idempotency_key: Optional[str] = Field(default=None, min_length=8, max_length=128)
    client_request_id: Optional[str] = Field(default=None, min_length=8, max_length=128)

    @field_validator("checksum_sha256")
    @classmethod
    def validate_checksum(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        lowered = value.lower()
        if len(lowered) != 64 or any(
            char not in "0123456789abcdef" for char in lowered
        ):
            raise ValueError("checksum_sha256 must be 64 hexadecimal characters")
        return lowered

    @model_validator(mode="after")
    def validate_request_keys(self) -> "UploadIntentCreate":
        if (
            self.idempotency_key
            and self.client_request_id
            and self.idempotency_key != self.client_request_id
        ):
            raise ValueError("idempotency_key and client_request_id must match")
        return self


class UploadTargetRead(BaseModel):
    kind: str
    method: str
    url: str
    pathname: str
    headers: Dict[str, str]


class UploadIntentRead(OrmSchema):
    id: str
    intent_id: str
    client_request_id: Optional[str]
    project_id: str
    pathname: str
    filename: str
    asset_type: str
    content_type: str
    expected_size_bytes: int
    max_size_bytes: int
    status: str
    expires_at: datetime
    asset_id: Optional[str]
    upload: UploadTargetRead


class BlobUploadCallback(BaseModel):
    intent_id: str
    client_request_id: str = Field(min_length=8, max_length=128)
    pathname: str = Field(min_length=1, max_length=1024)
    content_type: str = Field(min_length=1, max_length=255)
    size: int = Field(gt=0, validation_alias=AliasChoices("size", "size_bytes"))
    checksum: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("checksum", "checksum_sha256"),
    )

    @field_validator("checksum")
    @classmethod
    def validate_callback_checksum(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        lowered = value.lower()
        if len(lowered) != 64 or any(
            char not in "0123456789abcdef" for char in lowered
        ):
            raise ValueError("checksum must be 64 hexadecimal characters")
        return lowered


class BlobTokenValidationRead(BaseModel):
    valid: bool
    intent_id: str
    client_request_id: str
    pathname: str
    content_type: str
    size_bytes: int
    checksum_sha256: Optional[str]
    max_size_bytes: int


class ConversationCreate(BaseModel):
    project_id: Optional[str] = None
    title: str = Field(default="New conversation", min_length=1, max_length=200)


class ConversationUpdate(BaseModel):
    title: str = Field(min_length=1, max_length=200)


class ConversationRead(OrmSchema):
    id: str
    project_id: Optional[str]
    title: str
    active_run_id: Optional[str]
    created_at: datetime
    updated_at: datetime


class DashboardCreate(BaseModel):
    project_id: str
    conversation_id: Optional[str] = None
    title: str = Field(min_length=1, max_length=200)
    content: Dict[str, Any] = Field(default_factory=dict)


class DashboardUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=200)
    status: Optional[str] = Field(default=None, pattern="^(draft|published|archived)$")
    content: Optional[Dict[str, Any]] = None
    expected_version: Optional[int] = Field(default=None, ge=1)


class DashboardRead(OrmSchema):
    id: str
    project_id: str
    conversation_id: Optional[str]
    title: str
    status: str
    current_version: int
    content: Dict[str, Any]
    created_at: datetime
    updated_at: datetime


class DashboardVersionRead(OrmSchema):
    id: str
    version: int
    content: Dict[str, Any]
    source: str
    edit_summary: Optional[str]
    created_at: datetime


class ProviderConnectionWrite(BaseModel):
    api_key: SecretStr = Field(
        min_length=8,
        max_length=512,
        json_schema_extra={"writeOnly": True},
    )
    model: Optional[str] = Field(default=None, min_length=1, max_length=128)
    activate: bool = True

    @field_validator("api_key")
    @classmethod
    def validate_api_key(cls, value: SecretStr) -> SecretStr:
        secret = value.get_secret_value()
        if any(character.isspace() for character in secret):
            raise ValueError("api_key must not contain whitespace")
        return value

    @field_validator("model")
    @classmethod
    def validate_model(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        allowed = set(
            "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._:-"
        )
        if value[0] not in allowed or any(
            character not in allowed for character in value
        ):
            raise ValueError("model contains unsupported characters")
        return value


class ProviderConnectionRead(OrmSchema):
    provider: ProviderName
    model: str
    status: Literal["verified"]
    is_active: bool
    verified_at: datetime
    created_at: datetime
    updated_at: datetime


class ProviderConnectionsRead(BaseModel):
    model_mode: Literal["demo", "byok"]
    active_provider: Optional[ProviderName]
    byok_configurable: bool
    available_providers: List[ProviderName]
    connections: List[ProviderConnectionRead]


class InternalProviderCredentialRead(BaseModel):
    mode: Literal["demo", "byok"]
    provider: Literal["demo", "openai", "gemini", "deepseek"]
    model: str = Field(min_length=1, max_length=128)
    api_key: Optional[str] = Field(
        default=None,
        min_length=8,
        max_length=512,
        json_schema_extra={"x-dreamify-sensitive": True},
    )

    @model_validator(mode="after")
    def validate_provider_mode(self) -> "InternalProviderCredentialRead":
        if self.mode == "demo" and (
            self.provider != "demo" or self.api_key is not None
        ):
            raise ValueError("demo provider credentials must not contain a key")
        if self.mode == "byok" and (self.provider == "demo" or self.api_key is None):
            raise ValueError("byok provider credentials require a key")
        return self


class WorkflowRunCreate(BaseModel):
    project_id: str
    conversation_id: Optional[str] = None
    parent_run_id: Optional[str] = None
    workflow_name: str = Field(default="analyze_data", min_length=1, max_length=120)
    asset_ids: List[str] = Field(default_factory=list)
    input: Dict[str, Any] = Field(default_factory=dict)

    @field_validator("asset_ids")
    @classmethod
    def validate_unique_assets(cls, value: List[str]) -> List[str]:
        if len(value) != len(set(value)):
            raise ValueError("asset_ids must be unique")
        return value


class WorkflowRunRead(OrmSchema):
    id: str
    project_id: str
    conversation_id: Optional[str]
    parent_run_id: Optional[str]
    workflow_name: str
    run_kind: Literal["data", "text"]
    client_request_id: Optional[str]
    status: RunStatus
    current_step: str
    response_type: Optional[str]
    cancel_requested: bool
    version: int
    input: Dict[str, Any]
    output: Optional[Dict[str, Any]]
    result: Optional[Dict[str, Any]]
    error: Optional[Dict[str, Any]]
    cancel_reason: Optional[str]
    created_at: datetime
    updated_at: datetime
    started_at: Optional[datetime]
    completed_at: Optional[datetime]


class WorkflowEventCreate(BaseModel):
    event_key: str = Field(min_length=1, max_length=128)
    event_type: str = Field(min_length=1, max_length=80)
    payload: Dict[str, Any] = Field(default_factory=dict)
    payload_object_id: Optional[str] = None


class WorkflowEventRead(OrmSchema):
    id: str
    run_id: str
    sequence: int
    event_key: str
    event_type: str
    payload: Dict[str, Any]
    payload_object_id: Optional[str]
    created_at: datetime


class CancelRunRequest(BaseModel):
    reason: str = Field(default="Cancelled by user", min_length=1, max_length=256)


class InternalAssetResolveRequest(BaseModel):
    run_id: str
    object_id: str


class DataAssetReferenceRead(BaseModel):
    asset_id: str
    object_id: str
    file_name: str
    format: str
    media_type: str
    size_bytes: int
    sha256: str
    relative_path: str
    download_url: str
    expires_at: datetime


class ConversationNodeContent(BaseModel):
    type: str = Field(min_length=1, max_length=80)
    data: Dict[str, Any] = Field(default_factory=dict)


class ConversationEditTarget(BaseModel):
    dashboard_id: str = Field(min_length=1, max_length=128)
    component_ids: List[str] = Field(min_length=1, max_length=16)

    @field_validator("component_ids")
    @classmethod
    def unique_component_ids(cls, value: List[str]) -> List[str]:
        if any(not item.strip() or len(item) > 128 for item in value):
            raise ValueError("component_ids must contain bounded non-empty IDs")
        normalized = [item.strip() for item in value]
        if len(set(normalized)) != len(normalized):
            raise ValueError("component_ids must be unique")
        return normalized


class ConversationChatCreate(BaseModel):
    client_request_id: str = Field(min_length=8, max_length=128)
    conversation_id: Optional[str] = None
    project_id: str
    asset_id: Optional[str] = None
    user_node_contents: List[ConversationNodeContent] = Field(
        min_length=1, max_length=32
    )
    user_node_metadata: Optional[Dict[str, Any]] = None
    model: Optional[Literal["pro", "fast"]] = None
    theme_id: Optional[str] = Field(default=None, max_length=64)
    analysis_focus_id: Optional[str] = Field(default=None, max_length=64)
    template_id: Optional[str] = Field(default=None, max_length=64)
    edit_target: Optional[ConversationEditTarget] = None


class AcceptedRunLinks(BaseModel):
    status: str
    events: str
    stream: str
    cancel: str


class AcceptedRunRead(BaseModel):
    conversation_id: str
    project_id: str
    run_id: str
    status: Literal["accepted"]
    links: AcceptedRunLinks


class WorkflowStatusCompatRead(BaseModel):
    conversation_id: str
    node_id: str
    run_id: str
    status: str
    metadata: Dict[str, Any]
    updated_at: datetime


class ThinkingEventRead(BaseModel):
    id: str
    run_id: str
    sequence: int
    event_key: str
    phase: str
    status: str
    title: str
    summary: Optional[str]
    detail: Optional[str]
    started_at: datetime
    completed_at: Optional[datetime]
    duration_ms: Optional[int]
    metadata: Dict[str, Any]


class WorkflowEventsCompatRead(BaseModel):
    conversation_id: str
    run_id: str
    status: WorkflowStatusCompatRead
    events: List[ThinkingEventRead]
    next_after: int


class DashboardDataCompatRead(BaseModel):
    dashboard_id: Optional[str]
    dashboard_data: Optional[Dict[str, Any]]
    current_version: Optional[int] = None
    change_summary: Optional[Dict[str, Any]] = None
    computed_values: Optional[Dict[str, Any]] = None
    analysis_steps: Optional[List[Dict[str, Any]]] = None
    edit_note: Optional[str] = None


class DashboardDataUpdate(BaseModel):
    project_id: str
    dashboard_data: Dict[str, Any]
    edit_summary: Optional[str] = Field(default=None, max_length=2000)
    expected_version: int = Field(ge=1)


class DashboardStyleUpdate(BaseModel):
    project_id: str
    template_id: Optional[str] = Field(default=None, max_length=64)
    theme_id: Optional[str] = Field(default=None, max_length=64)
    expected_version: int = Field(ge=1)


class DashboardRevertRequest(BaseModel):
    project_id: str
    target_version: int = Field(ge=1)
    expected_version: int = Field(ge=1)


class NewThinkingEvent(BaseModel):
    run_id: str
    event_key: str = Field(min_length=1, max_length=128)
    phase: Literal[
        "queued",
        "context",
        "clarification",
        "capacity",
        "profiling",
        "routing",
        "analysis",
        "tool",
        "synthesis",
        "validation",
        "persist",
        "final",
        "error",
    ]
    status: Literal["active", "completed", "error"]
    title: str = Field(min_length=1, max_length=160)
    summary: Optional[str] = Field(default=None, max_length=1000)
    detail: Optional[str] = Field(default=None, max_length=4000)
    started_at: datetime
    completed_at: Optional[datetime] = None
    duration_ms: Optional[int] = Field(default=None, ge=0)
    metadata: Dict[str, Any] = Field(default_factory=dict)


class InternalRunRecordRead(BaseModel):
    run_id: str
    conversation_id: str
    project_id: str
    owner_id: str
    parent_run_id: Optional[str]
    workflow_run_id: Optional[str]
    status: RunStatus
    current_step: str
    response_type: Optional[str]
    cancel_requested: bool
    cancel_reason: Optional[str]
    version: int
    result: Optional[Dict[str, Any]]
    error: Optional[Dict[str, Any]]
    created_at: datetime
    updated_at: datetime
    started_at: Optional[datetime]
    completed_at: Optional[datetime]


class InternalRunEnvelope(BaseModel):
    run: InternalRunRecordRead


class WorkflowClaimRequest(BaseModel):
    workflow_execution_id: str = Field(min_length=1, max_length=128)
    event: NewThinkingEvent


class WorkflowClaimRead(InternalRunEnvelope):
    outcome: Literal["claimed", "resume", "busy", "terminal"]


class WorkflowDispatchAuthorizeRequest(BaseModel):
    dispatch_lease_id: str = Field(min_length=1, max_length=128)


class WorkflowDispatchReceiptRequest(WorkflowDispatchAuthorizeRequest):
    workflow_execution_id: str = Field(min_length=1, max_length=128)


class WorkflowDispatchStateRead(BaseModel):
    outcome: Literal["authorized", "in_progress", "recorded", "conflict", "invalid"]
    dispatch_lease_id: Optional[str] = None
    workflow_execution_id: Optional[str] = None


class WorkflowProviderCallReserveRequest(BaseModel):
    call_key: str = Field(min_length=1, max_length=128)


class WorkflowProviderCallRead(BaseModel):
    call_key: str
    ordinal: int = Field(ge=1, le=5)
    remaining: int = Field(ge=0, le=5)
    created: bool


class WorkflowAssetContextRead(BaseModel):
    asset_id: str
    object_id: str
    file_name: str
    format: Literal["csv", "xlsx", "xls", "json"]
    media_type: str
    size_bytes: int
    sha256: str
    relative_path: str


class WorkflowContextRead(BaseModel):
    run_id: str
    conversation_id: str
    project_id: str
    owner_id: str
    prompt: str
    assets: List[WorkflowAssetContextRead]
    theme_id: str
    focus_id: Optional[str]
    existing_dashboard: Optional[Dict[str, Any]]
    edit_target: Optional[ConversationEditTarget]
    conversation_revision_object_id: str


class WorkflowContextEnvelope(BaseModel):
    context: WorkflowContextRead


class WorkflowStepBeginRequest(BaseModel):
    step: str = Field(min_length=1, max_length=32)
    event: NewThinkingEvent


class WorkflowStepResultRead(BaseModel):
    found: bool
    value: Any = None


class WorkflowStepCompleteRequest(BaseModel):
    result: Any
    event: NewThinkingEvent


class WorkflowTransitionRequest(BaseModel):
    allowed_from: List[RunStatus] = Field(min_length=1)
    status: RunStatus
    current_step: str = Field(min_length=1, max_length=32)
    response_type: Optional[str] = Field(default=None, max_length=40)
    error: Optional[Dict[str, Any]] = None
    event: NewThinkingEvent


class WorkflowResponseCommitRequest(BaseModel):
    terminal_status: Literal["completed", "awaiting_user_input"]
    response: Dict[str, Any]
    response_artifact: Dict[str, Any]
    result_reference: Dict[str, Any]
    event: NewThinkingEvent


class WorkflowResponseRead(BaseModel):
    response: Optional[Dict[str, Any]]


class InternalWorkflowCancelRequest(BaseModel):
    reason: Literal["user", "superseded"]


class WorkflowArtifactCreate(BaseModel):
    kind: Literal["profile", "analysis", "response"]
    value: Any
    idempotency_key: str = Field(min_length=1, max_length=128)
    max_bytes: int = Field(gt=0)


class WorkflowArtifactReferenceRead(BaseModel):
    object_id: str
    kind: Literal["profile", "analysis", "response"]
    size_bytes: int
    sha256: str


class WorkflowArtifactEnvelope(BaseModel):
    artifact: WorkflowArtifactReferenceRead


class WorkflowArtifactValueRead(BaseModel):
    value: Any


class WorkflowCapacityAcquireRequest(BaseModel):
    run_id: str
    idempotency_key: str = Field(min_length=1, max_length=128)


class WorkflowLeaseRead(BaseModel):
    lease_id: str
    run_id: str
    expires_at: datetime


class WorkflowLeaseEnvelope(BaseModel):
    lease: WorkflowLeaseRead


class WorkflowCapacityReleaseRequest(BaseModel):
    lease: WorkflowLeaseRead
    idempotency_key: str = Field(min_length=1, max_length=128)


class CapabilityState(BaseModel):
    enabled: bool
    connected: Optional[bool] = None
    reason: Optional[str] = None


class BillingCapability(BaseModel):
    enabled: bool
    label: str


class ModelCapability(BaseModel):
    mode: Literal["demo", "byok"]
    active_provider: Literal["demo", "openai", "gemini", "deepseek"]
    providers: List[str]


class CapabilityLimits(BaseModel):
    max_file_bytes: int
    max_files_per_run: int
    max_total_run_bytes: int
    max_rows_per_file: int
    max_columns_per_file: int
    max_user_storage_bytes: int
    max_global_storage_bytes: int
    workflow_slots: int
    active_data_runs_per_user: int
    data_runs_per_user_per_day: int
    deployment_runs_per_day: int
    text_runs_per_user_per_day: int
    max_dashboard_bytes: int
    max_database_bytes: int
    workflow_event_max_bytes: int
    max_events_per_run: int
    max_upload_bytes: int
    max_workflow_assets: int


class CapabilitiesRead(BaseModel):
    api_version: str
    environment: str
    auth_mode: str
    storage_backend: str
    profile: Literal["hobby_demo"]
    billing: BillingCapability
    model: ModelCapability
    connectors: Dict[str, CapabilityState]
    features: Dict[str, CapabilityState]
    limits: CapabilityLimits
    accepted_upload_content_types: List[str]
    checksum_verification: bool
