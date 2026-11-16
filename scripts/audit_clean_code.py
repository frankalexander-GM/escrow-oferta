#!/usr/bin/env python3
"""Auditor determinista de ruido en código fuente.

    python audit_clean_code.py <ruta> [opciones]

Directivas: audit:allow <regla>, audit:ignore, audit:ignore-file.
Sale con 1 si hay hallazgos de severidad error o warn, para usar en CI.
"""

# audit:allow debug

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import asdict, dataclass
from pathlib import Path

SKIP_DIRS = set(""".git .hg .svn node_modules bower_components venv .venv env __pycache__ dist
build out target vendor .next .nuxt coverage .pytest_cache .mypy_cache .ruff_cache bin obj
.idea .vs .gradle Pods DerivedData .terraform""".split())

EXT_GROUPS = {
    "python": (".py", ".pyi"),
    "js": (".js", ".mjs", ".cjs", ".jsx"),
    "ts": (".ts", ".tsx", ".mts", ".cts"),
    "java": (".java",), "kotlin": (".kt", ".kts"), "scala": (".scala",),
    "go": (".go",), "rust": (".rs",), "swift": (".swift",),
    "c": (".c", ".h"), "cpp": (".cpp", ".cc", ".cxx", ".hpp"),
    "csharp": (".cs",), "php": (".php",), "ruby": (".rb",), "shell": (".sh", ".bash"),
}
LANG_BY_EXT = {ext: lang for lang, exts in EXT_GROUPS.items() for ext in exts}

BRACE_LANGS = {"js", "ts", "java", "kotlin", "scala", "go", "rust", "swift", "c", "cpp", "csharp", "php"}
HASH_COMMENT_LANGS = {"python", "shell", "ruby"}

ALLOW_PREFIXES = (
    "eslint", "prettier", "@ts-", "istanbul", "webpack", "vite-ignore",
    "noqa", "type:", "pylint", "pragma", "fmt:", "isort:", "coding:", "-*-",
    "go:", "clippy", "allow(", "![", "NOSONAR", "region", "endregion", "audit:",
)

CODE_START = re.compile(
    r"^(?:if|elif|else|for|while|switch|case|return|break|continue|const|let|var|"
    r"function|def|class|import|from|export|public|private|protected|static|async|"
    r"await|try|catch|finally|throw|raise|new|console\.|print\(|SELECT|INSERT|"
    r"UPDATE|DELETE|CREATE|ALTER|DROP|package|using|namespace|struct|enum|impl|"
    r"fn|func|pub|mod|use\s)\b",
    re.IGNORECASE,
)
DECORATIVE = re.compile(r"^[\s\W]*([=\-*#~_+]{4,})[\s\W]*$")
BANNER = re.compile(r"^(?:[=\-*#~_+]{3,}\s*\S.*?\s*[=\-*#~_+]{3,})$")
TODO = re.compile(r"\b(TODO|FIXME|XXX|HACK)\b")
PLACEHOLDER = re.compile(
    r"\b(NotImplementedError|NotImplemented|not\s+implemented|NotSupportedException)\b"
    r"|throw\s+new\s+Error\(\s*['\"]not\s+implemented",
    re.IGNORECASE,
)
EMPTY_CATCH = re.compile(r"(catch\s*(\([^)]*\))?\s*\{\s*\}|except[^:]*:\s*pass\b)")
PATTERN_DEF = re.compile(r"re\.compile\(|re\.match\(|r\"|r'")
IMPORT_PY = re.compile(r"^\s*(?:from\s+([\w.]+)\s+import\s+(.+)|import\s+([\w.,\s]+))$")
IMPORT_JS = re.compile(r"^\s*import\s+(?:(\w+)\s*,?\s*)?(?:\{([^}]*)\})?\s*(?:\*\s+as\s+(\w+))?\s*from\s+['\"]")
FUNCTION_BRACE = re.compile(
    r"^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?"
    r"(?:public|private|protected|static|final|override|suspend|inline|pub|unsafe|extern)?\s*"
    r"(?:function\s+\w+|fn\s+\w+|func\s+\w+|\w+\s*\([^;]*\)\s*(?::\s*[^{]+)?)\s*\{\s*$"
)
HEADER_IGNORE = re.compile(r"^\s*(if|for|while|switch|catch|else|do|match|loop)\b")
DIRECTIVE = re.compile(r"^audit:\s*(allow\s+([\w-]+)|ignore-file|ignore)\b")

DEBUG_BY_LANG = {
    "js": r"\b(console\.(log|debug|dir|table|trace)|debugger)\b",
    "ts": r"\b(console\.(log|debug|dir|table|trace)|debugger)\b",
    "python": r"^\s*(print\(|breakpoint\(\)|import\s+pdb|pdb\.set_trace)",
    "php": r"\b(var_dump|print_r|dd)\(",
    "ruby": r"^\s*(puts|pp)\s",
    "go": r"\bfmt\.Print(ln|f)?\(",
    "java": r"\bSystem\.(out|err)\.print",
    "kotlin": r"\bprintln\(", "scala": r"\bprintln\(",
    "csharp": r"\bConsole\.WriteLine\(", "swift": r"^\s*print\(",
    "rust": r"\b(dbgl|println!)\(",
}


@dataclass
class Issue:
    path: str
    line: int
    rule: str
    severity: str
    message: str
    snippet: str


def comment_marker(lang: str) -> str | None:
    if lang in HASH_COMMENT_LANGS:
        return "#"
    if lang in BRACE_LANGS:
        return "//"
    return None


def comment_body(raw: str, marker: str) -> str | None:
    stripped = raw.strip()
    if not stripped.startswith(marker):
        return None
    return stripped[len(marker):].strip()


def parse_directives(lines: list[str], marker: str | None) -> tuple[bool, set[str], set[int]]:
    ignore_file, allowed, silent = False, set(), set()
    if not marker:
        return ignore_file, allowed, silent
    for index, raw in enumerate(lines):
        body = comment_body(raw, marker)
        match = DIRECTIVE.match(body) if body else None
        if not match:
            continue
        if match.group(1) == "ignore-file":
            ignore_file = True
        elif match.group(2):
            allowed.add(match.group(2))
        else:
            silent.add(index + 1)
    return ignore_file, allowed, silent


def looks_like_code(body: str) -> bool:
    if not body:
        return False
    if any(body.lower().startswith(prefix.lower()) for prefix in ALLOW_PREFIXES):
        return False
    if DECORATIVE.match(body) or BANNER.match(body):
        return False
    if body.endswith((";", "{", "}", ");")) or CODE_START.match(body):
        return True
    return bool(re.match(r"^[\w.\[\]'\"]+\s*=\s*[^=]", body)) and not body.endswith(".")


def is_decorative(body: str) -> bool:
    if DECORATIVE.match(body) or BANNER.match(body):
        return True
    return len(body) > 3 and len(set(body.replace(" ", ""))) == 1

def count_braces(text: str) -> int:
    clean = re.sub(r"['\"].*?['\"]", "", text)
    return clean.count("{") - clean.count("}")


def function_end(lines: list[str], start: int, lang: str) -> int:
    if lang == "python":
        match = re.match(r"^(\s*)def\s", lines[start])
        if not match:
            return start
        base, end = len(match.group(1)), start
        for index in range(start + 1, len(lines)):
            if not lines[index].strip():
                continue
            if len(lines[index]) - len(lines[index].lstrip()) <= base:
                break
            end = index
        return end
    depth, opened = 0, False
    for index in range(start, min(len(lines), start + 500)):
        depth += count_braces(lines[index])
        opened = opened or "{" in lines[index]
        if opened and depth <= 0:
            return index
    return start


def split_import_names(clause: str) -> list[str]:
    tokens = (part.strip().split(" as ")[-1].strip().strip("() ") for part in clause.split(","))
    return [token for token in tokens if token and token not in {"*", "type"}]


def import_names(match: re.Match, lang: str) -> list[str]:
    if lang == "python":
        return split_import_names(match.group(2) or match.group(3) or "")
    names = []
    if match.group(1) and match.group(1) != "type":
        names.append(match.group(1))
    if match.group(3):
        names.append(match.group(3))
    return names + split_import_names(match.group(2) or "")


def unused_imports(lines: list[str], lang: str) -> list[tuple[int, str]]:
    if lang == "python":
        pattern = IMPORT_PY
    elif lang in {"js", "ts"}:
        pattern = IMPORT_JS
    else:
        return []

    found: list[tuple[int, str]] = []
    for index, line in enumerate(lines):
        match = pattern.match(line)
        if not match or line.strip().startswith("from __future__"):
            continue
        rest = "\n".join(lines[:index] + lines[index + 1:])
        for name in import_names(match, lang):
            if not re.search(rf"\b{re.escape(name)}\b", rest):
                found.append((index + 1, name.strip()))
    return found


def check_comment(rel: str, lineno: int, body: str) -> list[Issue]:
    if TODO.search(body):
        return [Issue(rel, lineno, "comments/todo", "error", "marcador pendiente en el codigo", body[:80])]
    if is_decorative(body):
        return [Issue(rel, lineno, "comments/decorative", "warn", "comentario decorativo", body[:80])]
    if looks_like_code(body):
        return [Issue(rel, lineno, "comments/commented-code", "error", "codigo comentado", body[:80])]
    return []


def check_code(rel: str, lineno: int, raw: str, lang: str) -> list[Issue]:
    stripped = raw.strip()
    issues: list[Issue] = []
    if not PATTERN_DEF.search(stripped) and PLACEHOLDER.search(stripped):
        issues.append(Issue(rel, lineno, "dead-code/placeholder", "error", "placeholder sin implementar", stripped[:80]))
    debug_pattern = DEBUG_BY_LANG.get(lang)
    if debug_pattern and re.search(debug_pattern, raw):
        issues.append(Issue(rel, lineno, "debug/statement", "warn", "sentencia de depuracion", stripped[:80]))
    if EMPTY_CATCH.search(raw):
        issues.append(Issue(rel, lineno, "dead-code/empty-catch", "error", "error capturado y silenciado", stripped[:80]))
    return issues


def check_nesting(rel: str, lines: list[str], lang: str, limit: int) -> list[Issue]:
    if not limit:
        return []
    issues: list[Issue] = []
    if lang == "python":
        stack: list[int] = []
        for index, raw in enumerate(lines):
            stripped = raw.strip()
            if not stripped or stripped.startswith("#"):
                continue
            indent = len(raw) - len(raw.lstrip())
            while stack and indent <= stack[-1]:
                stack.pop()
            if len(stack) > limit:
                issues.append(Issue(rel, index + 1, "style/deep-nesting", "info",
                                    f"anidamiento {len(stack)} (limite {limit})", stripped[:80]))
            if stripped.endswith(":"):
                stack.append(indent)
        return issues

    depth = 0
    for index, raw in enumerate(lines):
        if depth > limit and raw.strip():
            issues.append(Issue(rel, index + 1, "style/deep-nesting", "info",
                                f"anidamiento {depth} (limite {limit})", raw.strip()[:80]))
        depth = max(0, depth + count_braces(raw))
    return issues


def function_span(lines: list[str], index: int, lang: str) -> int:
    if lang == "python" and not re.match(r"^\s*(async\s+)?def\s", lines[index]):
        return 0
    if lang != "python" and not (FUNCTION_BRACE.match(lines[index]) and not HEADER_IGNORE.match(lines[index])):
        return 0
    return function_end(lines, index, lang) - index + 1


def check_function_sizes(rel: str, lines: list[str], lang: str, limit: int) -> list[Issue]:
    if lang != "python" and lang not in BRACE_LANGS:
        return []
    return [
        Issue(rel, index + 1, "size/long-function", "warn",
              f"funcion de {size} lineas (limite {limit})", raw.strip()[:80])
        for index, raw in enumerate(lines)
        if raw.strip() and (size := function_span(lines, index, lang)) > limit
    ]


def scan_file(path: Path, lang: str, cfg: argparse.Namespace) -> list[Issue]:
    try:
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return []
    rel = path.as_posix()
    marker = comment_marker(lang)
    ignore_file, allowed, silent = parse_directives(lines, marker)
    if ignore_file:
        return []

    issues: list[Issue] = []
    if len(lines) > cfg.max_file_lines:
        issues.append(Issue(rel, 1, "size/long-file", "warn",
                            f"{len(lines)} lineas (limite {cfg.max_file_lines})", ""))

    for index, raw in enumerate(lines):
        lineno = index + 1
        if not raw.strip() or lineno in silent:
            continue
        if raw.rstrip() != raw:
            issues.append(Issue(rel, lineno, "style/trailing-whitespace", "info",
                                "espacios al final de linea", raw.strip()[:80]))
        body = comment_body(raw, marker) if marker else None
        if body is not None:
            issues.extend(check_comment(rel, lineno, body))
        else:
            issues.extend(check_code(rel, lineno, raw, lang))

    issues.extend(Issue(rel, lineno, "dead-code/unused-import", "warn", f"import sin usar: {name}", "")
                  for lineno, name in unused_imports(lines, lang))
    issues.extend(check_nesting(rel, lines, lang, cfg.max_nesting))
    issues.extend(check_function_sizes(rel, lines, lang, cfg.max_function_lines))
    return [issue for issue in issues
            if not any(issue.rule == prefix or issue.rule.startswith(prefix + "/") for prefix in allowed)]


def iter_files(root: Path, exclude: set[str]):
    if root.is_file():
        yield root
        return
    for path in root.rglob("*"):
        if not path.is_file() or any(part in SKIP_DIRS for part in path.parts):
            continue
        if path.suffix.lower() not in LANG_BY_EXT or path.stat().st_size > 2_000_000:
            continue
        if any(pattern in path.name for pattern in exclude):
            continue
        yield path


def collect(root: Path, cfg: argparse.Namespace) -> tuple[int, list[Issue]]:
    exclude = {chunk for chunk in cfg.exclude.split(",") if chunk}
    filters = [part.strip() for part in cfg.only.split(",") if part.strip()]
    issues: list[Issue] = []
    count = 0
    for path in iter_files(root, exclude):
        lang = LANG_BY_EXT.get(path.suffix.lower())
        if lang:
            count += 1
            issues.extend(scan_file(path, lang, cfg))
    if filters:
        issues = [issue for issue in issues if any(issue.rule.startswith(f) for f in filters)]
    issues.sort(key=lambda issue: (issue.path, issue.line, issue.rule))
    return count, issues


def render_text(file_count: int, issues: list[Issue]) -> None:
    current = None
    for issue in issues:
        if issue.path != current:
            current = issue.path
            print(f"\n{current}")
        tag = {"error": "ERR ", "warn": "WARN", "info": "INFO"}[issue.severity]
        print(f"  {tag} {issue.line:>5}  {issue.rule:<24} {issue.message}")
        if issue.snippet:
            print(f"                          {issue.snippet}")
    total = {level: sum(1 for issue in issues if issue.severity == level) for level in ("error", "warn", "info")}
    print(f"\n{file_count} archivos analizados")
    print(f"{total['error']} errores, {total['warn']} avisos, {total['info']} informativos")
    if not issues:
        print("Limpio.")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Auditor de ruido en codigo fuente")
    parser.add_argument("path", nargs="?", default=".")
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--only", default="", help="filtrar por prefijo: dead-code,comments,debug,size,style")
    parser.add_argument("--exclude", default=".min.,.bundle.", help="subcadenas de nombre a ignorar")
    parser.add_argument("--max-function-lines", type=int, default=40)
    parser.add_argument("--max-file-lines", type=int, default=400)
    parser.add_argument("--max-nesting", type=int, default=4)
    parser.add_argument("--strict", action="store_true", help="los info tambien hacen fallar")
    return parser


def main() -> int:
    cfg = build_parser().parse_args()
    root = Path(cfg.path)
    if not root.exists():
        print(f"No existe: {root}", file=sys.stderr)
        return 2
    file_count, issues = collect(root, cfg)
    if cfg.json:
        summary = {level: sum(1 for issue in issues if issue.severity == level) for level in ("error", "warn", "info")}
        payload = {"files": file_count, "summary": summary, "issues": [asdict(issue) for issue in issues]}
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        render_text(file_count, issues)
    return 1 if any(issue.severity in {"error", "warn"} or cfg.strict for issue in issues) else 0


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, OSError):
        pass
    sys.exit(main())
