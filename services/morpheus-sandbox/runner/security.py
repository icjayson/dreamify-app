"""Static policy for generated analysis code.

The Vercel Sandbox microVM is the primary trust boundary. This policy adds a
second layer by permitting data-analysis expressions while denying imports,
filesystem/network/process primitives, and Python object-model escapes.
"""

from __future__ import annotations

import ast
from dataclasses import dataclass
from typing import Any

from .constants import MAX_ANALYSIS_CODE_CHARS, MAX_AST_NODES
from .errors import RunnerError

_FORBIDDEN_NODES = (
    ast.Import,
    ast.ImportFrom,
    ast.FunctionDef,
    ast.AsyncFunctionDef,
    ast.ClassDef,
    ast.Lambda,
    ast.With,
    ast.AsyncWith,
    ast.Try,
    ast.Raise,
    ast.Global,
    ast.Nonlocal,
    ast.Delete,
    ast.Await,
    ast.Yield,
    ast.YieldFrom,
    ast.While,
)

_FORBIDDEN_NAMES = frozenset(
    {
        "__builtins__",
        "breakpoint",
        "compile",
        "eval",
        "exec",
        "exit",
        "getattr",
        "globals",
        "help",
        "input",
        "locals",
        "memoryview",
        "open",
        "quit",
        "setattr",
        "vars",
        "os",
        "sys",
        "subprocess",
        "socket",
        "pathlib",
        "shutil",
        "requests",
        "urllib",
        "http",
        "importlib",
        "builtins",
    }
)

_SAFE_DIRECT_CALLS = frozenset(
    {
        "abs",
        "all",
        "any",
        "bool",
        "dict",
        "enumerate",
        "float",
        "int",
        "isinstance",
        "iter",
        "len",
        "list",
        "max",
        "min",
        "next",
        "print",
        "range",
        "reversed",
        "round",
        "set",
        "sorted",
        "str",
        "sum",
        "tuple",
        "zip",
    }
)

_SAFE_PD_CALLS = frozenset(
    {
        "DataFrame",
        "Series",
        "concat",
        "crosstab",
        "cut",
        "isna",
        "merge",
        "notna",
        "pivot_table",
        "qcut",
        "to_datetime",
        "to_numeric",
    }
)

_SAFE_NP_CALLS = frozenset(
    {
        "abs",
        "arange",
        "array",
        "clip",
        "isfinite",
        "isnan",
        "max",
        "mean",
        "median",
        "min",
        "percentile",
        "round",
        "std",
        "sum",
        "where",
    }
)

_FORBIDDEN_ATTRIBUTES = frozenset(
    {
        "eval",
        "query",
        "system",
        "popen",
        "spawn",
        "fork",
        "kill",
        "remove",
        "unlink",
        "rmdir",
        "rename",
        "replace",
        "write",
        "save",
        "dump",
        "environ",
        "getenv",
        "load",
        "listdir",
        "makedirs",
        "os",
        "pathlib",
        "connect",
        "request",
        "urlopen",
        "read_pickle",
        "read_sql",
        "read_html",
        "read_xml",
        "shutil",
        "socket",
        "subprocess",
        "sys",
        "read_parquet",
        "read_feather",
        "to_pickle",
        "to_csv",
        "to_json",
        "to_excel",
        "to_sql",
        "to_parquet",
        "to_feather",
        "to_html",
        "to_xml",
    }
)

_SAFE_TO_ATTRIBUTES = frozenset({"to_dict", "to_list", "to_numpy", "tolist"})


def _root_name(node: ast.AST) -> str | None:
    current = node
    while isinstance(current, ast.Attribute):
        current = current.value
    return current.id if isinstance(current, ast.Name) else None


class _PolicyVisitor(ast.NodeVisitor):
    def __init__(self) -> None:
        self.result_assigned = False

    def generic_visit(self, node: ast.AST) -> None:
        if isinstance(node, _FORBIDDEN_NODES):
            raise RunnerError(
                "SECURITY_VIOLATION",
                f"Python construct {type(node).__name__} is not allowed",
            )
        super().generic_visit(node)

    def visit_Name(self, node: ast.Name) -> None:
        if node.id.startswith("_") or node.id in _FORBIDDEN_NAMES:
            raise RunnerError("SECURITY_VIOLATION", f"Name {node.id!r} is not allowed")
        if isinstance(node.ctx, ast.Store) and node.id in {"datasets", "pd", "np"}:
            raise RunnerError(
                "SECURITY_VIOLATION", f"Protected name {node.id!r} is read-only"
            )
        if isinstance(node.ctx, ast.Store) and node.id == "result":
            self.result_assigned = True
        self.generic_visit(node)

    def visit_Attribute(self, node: ast.Attribute) -> None:
        unsafe_reader = node.attr.startswith("read_")
        unsafe_exporter = (
            node.attr.startswith("to_") and node.attr not in _SAFE_TO_ATTRIBUTES
        )
        if (
            node.attr.startswith("_")
            or node.attr in _FORBIDDEN_ATTRIBUTES
            or unsafe_reader
            or unsafe_exporter
        ):
            raise RunnerError(
                "SECURITY_VIOLATION", f"Attribute {node.attr!r} is not allowed"
            )
        self.generic_visit(node)

    def visit_Call(self, node: ast.Call) -> None:
        if isinstance(node.func, ast.Name):
            if node.func.id not in _SAFE_DIRECT_CALLS:
                raise RunnerError(
                    "SECURITY_VIOLATION",
                    f"Function call {node.func.id!r} is not allowed",
                )
        elif isinstance(node.func, ast.Attribute):
            root = _root_name(node.func)
            if root == "pd" and node.func.attr not in _SAFE_PD_CALLS:
                raise RunnerError(
                    "SECURITY_VIOLATION",
                    f"pandas call {node.func.attr!r} is not allowed",
                )
            if root == "np" and node.func.attr not in _SAFE_NP_CALLS:
                raise RunnerError(
                    "SECURITY_VIOLATION",
                    f"NumPy call {node.func.attr!r} is not allowed",
                )
        else:
            raise RunnerError(
                "SECURITY_VIOLATION", "Dynamic callable expressions are not allowed"
            )
        self.generic_visit(node)


@dataclass(frozen=True)
class ValidatedCode:
    source: str
    tree: ast.Module


def validate_analysis_code(source: str) -> ValidatedCode:
    if not source or len(source) > MAX_ANALYSIS_CODE_CHARS:
        raise RunnerError("CODE_LIMIT_EXCEEDED", "Analysis code is empty or too large")
    try:
        tree = ast.parse(source, mode="exec")
    except SyntaxError as error:
        raise RunnerError(
            "CODE_SYNTAX_ERROR", "Analysis code has invalid syntax"
        ) from error
    if sum(1 for _ in ast.walk(tree)) > MAX_AST_NODES:
        raise RunnerError(
            "CODE_LIMIT_EXCEEDED", "Analysis code has too many syntax nodes"
        )
    visitor = _PolicyVisitor()
    visitor.visit(tree)
    if not visitor.result_assigned:
        raise RunnerError(
            "RESULT_MISSING", "Analysis code must assign a JSON object to result"
        )
    return ValidatedCode(source=source, tree=tree)


SAFE_BUILTINS: dict[str, Any] = {
    "abs": abs,
    "all": all,
    "any": any,
    "bool": bool,
    "dict": dict,
    "enumerate": enumerate,
    "float": float,
    "int": int,
    "isinstance": isinstance,
    "iter": iter,
    "len": len,
    "list": list,
    "max": max,
    "min": min,
    "next": next,
    "print": print,
    "range": range,
    "reversed": reversed,
    "round": round,
    "set": set,
    "sorted": sorted,
    "str": str,
    "sum": sum,
    "tuple": tuple,
    "zip": zip,
}
