#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Aozora ZIP Batch Converter (GUI)
--------------------------------
Cross-platform PySide6 utility to process Aozora Bunko archives.

Features
- Choose an input folder, or a single .zip / .txt / .md file
- Recursively process .zip files (and loose .txt files) when a folder is given
- Extract zips into folders named after zip basenames
- Convert Aozora gaiji notes (JIS X 0213 / U+XXXX) to Unicode
- Convert Aozora heading notes to Markdown ATX headings (H2/H3/H4)
- Convert Aozora bouten notes to per-character Nyoze ruby
- Optional: convert Aozora indent notes to Nyoze :::indent-N directives
- Optional: convert Aozora 地付き notes to Nyoze :::align-end directives
- Optional: convert Aozora page-break notes to Nyoze :::page-break / :::blank-page
- Optional: remove Aozora bibliographic footer (底本 / 作成ファイル)
- Optional: convert Aozora bold/italic notes to Markdown ** / *
- Optional: convert Aozora 傍線 notes to Nyoze || || or HTML <u>
- Optional: convert text encoding to UTF-8
- Optional: change .txt to .md
- After Markdown conversion, warn about leftover Aozora ［＃…］ notes
- Never modifies or deletes input files; writes results as new files
- Progress bar and live log

Requirements
    pip install PySide6

Tested on: Windows 10/11, macOS (Intel/Apple Silicon), Linux (X11/Wayland)
"""

import re
import sys
import tempfile
import zipfile
from pathlib import Path
from dataclasses import dataclass
from typing import Optional, Tuple

# PySide6
from PySide6.QtCore import QObject, Signal, QThread
from PySide6.QtWidgets import (
    QApplication, QWidget, QVBoxLayout, QHBoxLayout, QLabel, QPushButton,
    QFileDialog, QLineEdit, QCheckBox, QProgressBar, QTextEdit, QMessageBox,
    QGroupBox, QFormLayout, QComboBox
)

# -------------------- Core conversion logic --------------------

TEXT_EXTS = {'.txt', '.md'}
ALLOWED_INPUT_FILE_EXTS = {'.zip', '.txt', '.md'}
DEFAULT_INPUT_EXT = '.txt'

def validate_input_path(path: Path) -> Optional[str]:
    """
    入力パスの検証。問題があればエラーメッセージ、OKなら None。
    フォルダ、または .zip / .txt / .md ファイルのみ許可する。
    """
    if not path.exists():
        return "有効な入力フォルダまたはファイルを選択してください。"
    if path.is_dir():
        return None
    if path.is_file():
        if path.suffix.lower() not in ALLOWED_INPUT_FILE_EXTS:
            return "対応している入力はフォルダ、.zip、.txt、.mdです。"
        return None
    return "対応している入力はフォルダ、.zip、.txt、.mdです。"

def detect_and_read_text(p: Path) -> Tuple[Optional[str], Optional[str]]:
    """
    Try to read text file with common Aozora encodings.
    Returns (text, encoding_used). If fails, returns (None, None).
    """
    # Try cp932 (Windows Shift_JIS)
    for enc in ('cp932', 'shift_jis', 'utf-8-sig', 'utf-8'):
        try:
            data = p.read_text(encoding=enc)
            return data, enc
        except Exception:
            continue
    try:
        # Last resort: read binary and decode ignoring errors (keeps most content)
        data = p.read_bytes().decode('cp932', errors='ignore')
        return data, 'cp932(ignore)'
    except Exception:
        return None, None

def write_utf8_text(p: Path, text: str) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding='utf-8', newline='\n')

def is_same_file(path_a: Path, path_b: Path) -> bool:
    """パスが同じファイルを指すか（解決後のパスで比較）。"""
    try:
        return path_a.resolve() == path_b.resolve()
    except OSError:
        return path_a == path_b

def unique_output_path(desired: Path, source: Path) -> Path:
    """
    入力元を上書きしない出力パスを返す。
    desired が入力元と同じファイルなら、{stem}_converted{suffix} にする。
    """
    if not is_same_file(desired, source):
        return desired
    parent = source.parent
    stem = source.stem
    suffix = source.suffix
    candidate = parent / f"{stem}_converted{suffix}"
    n = 2
    while is_same_file(candidate, source):
        candidate = parent / f"{stem}_converted{n}{suffix}"
        n += 1
    return candidate

# work_converted.md / work_converted2.md など、このツールが付けた出力名
_CONVERTED_STEM_RE = re.compile(r'_converted\d*$')

def is_tool_generated_output(path: Path) -> bool:
    """フォルダ走査から除外する、このツール生成の _converted 系ファイルか。"""
    return bool(_CONVERTED_STEM_RE.search(path.stem))

# -------------------- Aozora gaiji (外字) → Unicode --------------------
# 他の青空文庫記法（ルビ・傍点・字下げ等）とは独立した変換。
# 変換できない注記は原文のまま残し、処理全体は失敗させない。

# ※［＃…］ 形式の外字注記。その他の ［＃…］ にはマッチしない。
_GAIJI_NOTE_RE = re.compile(r'※［＃([^］]*)］')

# 代替文字＋注記: １［＃「１」はローマ数字、1-13-21］
# 見出し・傍点など「」は… 注記にも形が似るため、面区点/U+ を含むものだけ変換対象にする。
_SUBSTITUTE_GAIJI_NOTE_RE = re.compile(
    r'［＃「(?P<quoted>[^」]+)」は(?P<inner>[^］]*)］'
)

# 第3水準1-84-77 / 第4水準2-12-11（後続のページ・行番号があっても search で拾える）
_JIS0213_MENKUTEN_RE = re.compile(
    r'第[34]水準(?:漢字)?'
    r'(?P<plane>\d{1,3})[-－](?P<row>\d{1,3})[-－](?P<cell>\d{1,3})'
)

# 非漢字などで「第3水準」が付かない 1-13-21 / 2-xx-xx。
# 前後が数字だと 11-13-21 や 2026-09-17 の一部に食い込むため、数字境界を要求する。
_JIS0213_ANY_MENKUTEN_RE = re.compile(
    r'(?<![0-9])(?P<plane>[12])[-－](?P<row>\d{1,3})[-－](?P<cell>\d{1,3})(?![0-9])'
)

# U+546D / u+546d。6桁まで。後続の16進数字には食い込まない。
_UPLUS_RE = re.compile(r'U\+([0-9A-Fa-f]{1,6})(?![0-9A-Fa-f])', re.IGNORECASE)

_FULLWIDTH_TO_ASCII_DIGITS = str.maketrans('０１２３４５６７８９', '0123456789')


def jis0213_to_unicode(plane: int, row: int, cell: int) -> Optional[str]:
    """
    JIS X 0213 の面区点番号を Unicode 文字列へ変換する。
    EUC-JIS-2004 のバイト列を組み立て、標準 codec でデコードする。
    失敗時は None（呼び出し側は原文を保持する）。
    """
    if plane not in (1, 2):
        return None
    if not (1 <= row <= 94 and 1 <= cell <= 94):
        return None
    try:
        if plane == 1:
            raw = bytes((row + 0xA0, cell + 0xA0))
        else:
            raw = bytes((0x8F, row + 0xA0, cell + 0xA0))
        ch = raw.decode('euc_jis_2004')
    except (UnicodeDecodeError, ValueError, LookupError, OverflowError):
        return None
    if not ch or '\ufffd' in ch:
        return None
    return ch


def _codepoint_hex_to_char(hex_str: str) -> Optional[str]:
    """U+XXXX の16進コードポイントを1文字へ。不正なら None。"""
    try:
        n = int(hex_str, 16)
    except ValueError:
        return None
    # 制御文字・サロゲート・Unicode範囲外は変換しない
    if n < 0x20 or n == 0x7F or n > 0x10FFFF:
        return None
    if 0x80 <= n <= 0x9F:
        return None
    if 0xD800 <= n <= 0xDFFF:
        return None
    try:
        return chr(n)
    except ValueError:
        return None


def _menkuten_match_to_unicode(match: re.Match) -> Optional[str]:
    return jis0213_to_unicode(
        int(match.group('plane')),
        int(match.group('row')),
        int(match.group('cell')),
    )


def _gaiji_inner_to_unicode(inner: str) -> Optional[str]:
    """
    外字注記の内側（［＃ と ］ の間）から Unicode 文字を得る。
    U+XXXX を優先し、なければ第3/第4水準面区点、最後に面-区-点のみを試す。
    失敗時は None。
    """
    if not inner:
        return None
    normalized = inner.translate(_FULLWIDTH_TO_ASCII_DIGITS)

    m_u = _UPLUS_RE.search(normalized)
    if m_u:
        ch = _codepoint_hex_to_char(m_u.group(1))
        if ch is not None:
            return ch

    m_jis = _JIS0213_MENKUTEN_RE.search(normalized)
    if m_jis:
        return _menkuten_match_to_unicode(m_jis)

    m_any = _JIS0213_ANY_MENKUTEN_RE.search(normalized)
    if m_any:
        return _menkuten_match_to_unicode(m_any)
    return None


def _inner_has_gaiji_code(inner: str) -> bool:
    """注記内側に U+XXXX または JIS 面区点らしい指定があるか。"""
    if not inner:
        return False
    normalized = inner.translate(_FULLWIDTH_TO_ASCII_DIGITS)
    return bool(
        _UPLUS_RE.search(normalized)
        or _JIS0213_MENKUTEN_RE.search(normalized)
        or _JIS0213_ANY_MENKUTEN_RE.search(normalized)
    )


def _convert_substitute_gaiji_notes(text: str) -> Tuple[str, int, int]:
    """
    代替文字＋注記型: １［＃「１」はローマ数字、1-13-21］ → Ⅰ
    引用文字と直前の代替文字が一致し、かつ面区点/U+ が取れるときだけ置換する。
    """
    converted = 0
    unconverted = 0
    pieces: list[str] = []
    pos = 0
    for match in _SUBSTITUTE_GAIJI_NOTE_RE.finditer(text):
        inner = match.group('inner')
        quoted = match.group('quoted')
        prefix = text[pos:match.start()]
        if not _inner_has_gaiji_code(inner):
            continue
        pieces.append(prefix)
        ch = _gaiji_inner_to_unicode(inner)
        if (
            ch is None
            or not quoted
            or not prefix.endswith(quoted)
        ):
            unconverted += 1
            pieces.append(match.group(0))
        else:
            pieces[-1] = prefix[:-len(quoted)]
            pieces.append(ch)
            converted += 1
        pos = match.end()
    pieces.append(text[pos:])
    return ''.join(pieces), converted, unconverted


def convert_aozora_gaiji(text: str) -> Tuple[str, int, int]:
    """
    青空文庫の外字注記を、可能なものだけ Unicode 文字へ置換する。

    対応形式:
      - ※［＃…］: 第3/第4水準面区点、面-区-点のみ、U+XXXX
      - 代替文字［＃「代替文字」は…、面-区-点］ / U+XXXX

    ルビ《…》や、外字以外の ［＃...］ 注記は変更しない。
    変換できない外字注記は原文のまま残す（削除・?・� への置換はしない）。

    Returns:
        (変換後テキスト, 変換件数, 未変換の外字注記件数)
    """
    converted = 0
    unconverted = 0

    text, c1, u1 = _convert_substitute_gaiji_notes(text)
    converted += c1
    unconverted += u1

    def _replace(match: re.Match) -> str:
        nonlocal converted, unconverted
        ch = _gaiji_inner_to_unicode(match.group(1))
        if ch is None:
            unconverted += 1
            return match.group(0)
        converted += 1
        return ch

    new_text = _GAIJI_NOTE_RE.sub(_replace, text)
    return new_text, converted, unconverted

# -------------------- Aozora 太字・斜体 → Markdown --------------------
# 前方参照 / 同一行の開始終了 / ブロック。太字＋斜体は *** へ。
# 対象に * がある、引用が一致しない、改行またぎの開始終了は原文保持。

_EMPHASIS_WS_TAIL = r'[ \t\u3000\r]*$'
_EMPHASIS_KIND_RE = r'太字|斜体字?'
_FORWARD_EMPHASIS_BOTH_RE = re.compile(
    r'［＃「(?P<q1>[^」]+)」は(?P<k1>' + _EMPHASIS_KIND_RE + r')］'
    r'［＃「(?P<q2>[^」]+)」は(?P<k2>' + _EMPHASIS_KIND_RE + r')］'
)
_FORWARD_EMPHASIS_ONE_RE = re.compile(
    r'［＃「(?P<quoted>[^」]+)」は(?P<kind>' + _EMPHASIS_KIND_RE + r')］'
)
_INLINE_EMPHASIS_NESTED_RE = re.compile(
    r'［＃(?P<outer>太字|斜体)］［＃(?P<inner>太字|斜体)］'
    r'(?P<body>(?:(?!［＃).)+?)'
    r'［＃(?P=inner)終わり］［＃(?P=outer)終わり］'
)
_INLINE_BOLD_RE = re.compile(r'［＃太字］(.*?)［＃太字終わり］')
_INLINE_ITALIC_RE = re.compile(r'［＃斜体］(.*?)［＃斜体終わり］')
_BLOCK_EMPHASIS_START_RE = re.compile(
    r'^[ \t\u3000]*［＃ここから(?P<kind>太字|斜体)］' + _EMPHASIS_WS_TAIL
)
_BLOCK_EMPHASIS_END_RE = re.compile(
    r'^[ \t\u3000]*［＃ここで(?P<kind>太字|斜体)終わり］' + _EMPHASIS_WS_TAIL
)
_LEFTOVER_INLINE_EMPHASIS_OPEN_RE = re.compile(r'［＃(?:太字|斜体)］')


def _emphasis_kind_flags(kind: str) -> Tuple[bool, bool]:
    return kind == '太字', kind in ('斜体', '斜体字')


def _wrap_markdown_emphasis(text: str, bold: bool, italic: bool) -> Optional[str]:
    if not text or '*' in text:
        return None
    if bold and italic:
        return f'***{text}***'
    if bold:
        return f'**{text}**'
    if italic:
        return f'*{text}*'
    return None


def _convert_forward_emphasis_both(text: str) -> Tuple[str, int, int]:
    """同一対象へ隣接する太字＋斜体を先に *** へ。"""
    both = 0
    unconverted = 0
    pieces: list[str] = []
    pos = 0
    for match in _FORWARD_EMPHASIS_BOTH_RE.finditer(text):
        prefix = text[pos:match.start()]
        q1, q2 = match.group('q1'), match.group('q2')
        b1, i1 = _emphasis_kind_flags(match.group('k1'))
        b2, i2 = _emphasis_kind_flags(match.group('k2'))
        complementary = q1 == q2 and (b1 ^ b2) and (i1 ^ i2)
        pieces.append(prefix)
        if not complementary:
            pieces.append(match.group(0))
            pos = match.end()
            continue
        wrapped = (
            _wrap_markdown_emphasis(q1, True, True)
            if prefix.endswith(q1)
            else None
        )
        if wrapped is None:
            unconverted += 1
            pieces.append(match.group(0))
        else:
            pieces[-1] = prefix[:-len(q1)]
            pieces.append(wrapped)
            both += 1
        pos = match.end()
    pieces.append(text[pos:])
    return ''.join(pieces), both, unconverted


def _convert_forward_emphasis_one(text: str) -> Tuple[str, int, int, int]:
    bold = 0
    italic = 0
    unconverted = 0
    pieces: list[str] = []
    pos = 0
    for match in _FORWARD_EMPHASIS_ONE_RE.finditer(text):
        prefix = text[pos:match.start()]
        quoted = match.group('quoted')
        is_bold, is_italic = _emphasis_kind_flags(match.group('kind'))
        pieces.append(prefix)
        wrapped = (
            _wrap_markdown_emphasis(quoted, is_bold, is_italic)
            if quoted and prefix.endswith(quoted)
            else None
        )
        if wrapped is None:
            unconverted += 1
            pieces.append(match.group(0))
        else:
            pieces[-1] = prefix[:-len(quoted)]
            pieces.append(wrapped)
            if is_bold:
                bold += 1
            else:
                italic += 1
        pos = match.end()
    pieces.append(text[pos:])
    return ''.join(pieces), bold, italic, unconverted


def _convert_inline_range_emphasis(text: str) -> Tuple[str, int, int, int, int]:
    bold = 0
    italic = 0
    both = 0
    unconverted = 0

    def _nested(match: re.Match) -> str:
        nonlocal both, unconverted
        outer, inner = match.group('outer'), match.group('inner')
        body = match.group('body')
        if outer == inner:
            return match.group(0)
        wrapped = _wrap_markdown_emphasis(body, True, True)
        if wrapped is None:
            return match.group(0)
        both += 1
        return wrapped

    def _range(is_bold: bool):
        def _repl(match: re.Match) -> str:
            nonlocal bold, italic
            body = match.group(1)
            if '［＃' in body or '\n' in body or '\r' in body:
                return match.group(0)
            wrapped = _wrap_markdown_emphasis(body, is_bold, not is_bold)
            if wrapped is None:
                return match.group(0)
            if is_bold:
                bold += 1
            else:
                italic += 1
            return wrapped
        return _repl

    text = _INLINE_EMPHASIS_NESTED_RE.sub(_nested, text)
    text = _INLINE_BOLD_RE.sub(_range(True), text)
    text = _INLINE_ITALIC_RE.sub(_range(False), text)
    leftover = len(_LEFTOVER_INLINE_EMPHASIS_OPEN_RE.findall(text))
    unconverted += leftover
    return text, bold, italic, both, unconverted


def _convert_emphasis_plain_text(text: str) -> Tuple[str, int, int, int, int]:
    """コードフェンス以外のテキストに前方参照・同一行範囲を適用する。"""
    text, both1, u1 = _convert_forward_emphasis_both(text)
    text, bold1, italic1, u2 = _convert_forward_emphasis_one(text)
    text, bold2, italic2, both2, u3 = _convert_inline_range_emphasis(text)
    return text, bold1 + bold2, italic1 + italic2, both1 + both2, u1 + u2 + u3


def convert_aozora_markdown_emphasis(text: str) -> Tuple[str, int, int, int, int]:
    """
    青空文庫の太字・斜体注記を標準 Markdown の ** / * / *** へ変換する。

    対応:
      - 前方参照: 選考［＃「選考」は太字］ / 斜体 / 斜体字
      - 同一行の開始終了: ［＃太字］…［＃太字終わり］
      - ブロック: ［＃ここから太字］…［＃ここで太字終わり］（非空行ごと）
      - 同一対象の隣接する太字＋斜体 → ***
    非対応（原文保持）:
      - 引用不一致、対象に * を含む、改行またぎの開始終了
      - ブロック内部に別の ［＃ 注記がある場合

    Returns:
        (変換後テキスト, 太字件数, 斜体件数, 太字＋斜体件数, 未変換件数)
    """
    lines = text.split('\n')
    out: list[str] = []
    bold = 0
    italic = 0
    both = 0
    unconverted = 0
    in_code_fence = False
    i = 0
    n = len(lines)

    while i < n:
        line = lines[i]
        stripped = line.strip()

        if stripped.startswith('```'):
            in_code_fence = not in_code_fence
            out.append(line)
            i += 1
            continue
        if in_code_fence:
            out.append(line)
            i += 1
            continue

        m_start = _BLOCK_EMPHASIS_START_RE.match(line.rstrip('\r'))
        if m_start:
            kind = m_start.group('kind')
            is_bold, is_italic = _emphasis_kind_flags(kind)
            j = i + 1
            inner: list[str] = []
            found_end = False
            while j < n:
                if lines[j].strip().startswith('```'):
                    break
                m_end = _BLOCK_EMPHASIS_END_RE.match(lines[j].rstrip('\r'))
                if m_end:
                    if m_end.group('kind') == kind:
                        found_end = True
                    break
                inner.append(lines[j])
                j += 1
            unsafe = (
                not found_end
                or any('［＃' in row for row in inner)
                or any('*' in row for row in inner if row.strip())
            )
            if unsafe:
                unconverted += 1
                if found_end:
                    out.extend(lines[i:j + 1])
                    i = j + 1
                else:
                    out.append(line)
                    i += 1
                continue
            for row in inner:
                if row.strip() == '':
                    out.append(row)
                else:
                    wrapped = _wrap_markdown_emphasis(row, is_bold, is_italic)
                    if wrapped is None:
                        unconverted += 1
                        out.append(row)
                    else:
                        out.append(wrapped)
            if is_bold:
                bold += 1
            else:
                italic += 1
            i = j + 1
            continue

        new_line, b, it, bo, u = _convert_emphasis_plain_text(line)
        out.append(new_line)
        bold += b
        italic += it
        both += bo
        unconverted += u
        i += 1

    return '\n'.join(out), bold, italic, both, unconverted

# -------------------- Aozora 傍線 → 下線（Nyoze || || / HTML <u>） --------------------
# 通常の傍線のみ変換。特殊線種・左側はそれぞれ明示ONのときだけ通常下線へ近似する。

UNDERLINE_FORMAT_NYOZE = 'nyoze'
UNDERLINE_FORMAT_HTML = 'html'
UNDERLINE_FORMAT_CHOICES = (
    ('nyoze', 'Nyoze ||text||'),
    ('html', 'HTML <u>text</u>'),
)

_UNDERLINE_STYLE_RE = r'二重傍線|鎖線|破線|波線|傍線'
_UNDERLINE_HEAD_RE = r'(?:左に)?(?:' + _UNDERLINE_STYLE_RE + r')'
_UNDERLINE_WS_TAIL = r'[ \t\u3000\r]*$'
_FORWARD_UNDERLINE_RE = re.compile(
    r'［＃「(?P<quoted>[^」]+)」(?P<left>の左)?に(?P<style>'
    + _UNDERLINE_STYLE_RE
    + r')］'
)
_INLINE_UNDERLINE_RE = re.compile(
    r'［＃(?P<head>' + _UNDERLINE_HEAD_RE + r')］'
    r'(?P<body>.*?)'
    r'［＃(?P=head)終わり］'
)
_BLOCK_UNDERLINE_START_RE = re.compile(
    r'^[ \t\u3000]*［＃ここから(?P<head>' + _UNDERLINE_HEAD_RE + r')］'
    + _UNDERLINE_WS_TAIL
)
_BLOCK_UNDERLINE_END_RE = re.compile(
    r'^[ \t\u3000]*［＃ここで(?P<head>' + _UNDERLINE_HEAD_RE + r')終わり］'
    + _UNDERLINE_WS_TAIL
)
_LEFTOVER_UNDERLINE_NOTE_RE = re.compile(
    r'［＃「[^」]+」(?:の左)?に(?:' + _UNDERLINE_STYLE_RE + r')］'
    r'|［＃(?:左に)?(?:' + _UNDERLINE_STYLE_RE + r')］'
)
_OTHER_UNDERLINE_STYLES = frozenset({'二重傍線', '鎖線', '破線', '波線'})


def _parse_underline_head(head: str) -> Tuple[bool, str]:
    is_left = head.startswith('左に')
    style = head[2:] if is_left else head
    return is_left, style


def _underline_conversion_kind(
    is_left: bool,
    style: str,
    approximate_other_styles: bool,
    approximate_left: bool,
) -> Optional[str]:
    """'plain' / 'approx' / 変換しないなら None。"""
    if style == '傍線':
        if is_left:
            return 'approx' if approximate_left else None
        return 'plain'
    if style in _OTHER_UNDERLINE_STYLES:
        if is_left:
            return 'approx' if (approximate_left and approximate_other_styles) else None
        return 'approx' if approximate_other_styles else None
    return None


def _wrap_underline(text: str, output_format: str) -> Optional[str]:
    if not text:
        return None
    if output_format == UNDERLINE_FORMAT_NYOZE:
        if '||' in text:
            return None
        return f'||{text}||'
    if output_format == UNDERLINE_FORMAT_HTML:
        lowered = text.lower()
        if '<u>' in lowered or '</u>' in lowered:
            return None
        return f'<u>{text}</u>'
    return None


def _already_inside_underline(before: str, after: str) -> bool:
    """対象が既存の ||…|| / <u>…</u> に包まれていれば True。"""
    if before.endswith('||') and after.startswith('||'):
        return True
    if before.lower().endswith('<u>') and after.lower().startswith('</u>'):
        return True
    return False


def _convert_forward_underline(
    text: str,
    output_format: str,
    approximate_other_styles: bool,
    approximate_left: bool,
) -> Tuple[str, int, int]:
    converted = 0
    approximated = 0
    pieces: list[str] = []
    pos = 0
    for match in _FORWARD_UNDERLINE_RE.finditer(text):
        prefix = text[pos:match.start()]
        quoted = match.group('quoted')
        is_left = bool(match.group('left'))
        style = match.group('style')
        kind = _underline_conversion_kind(
            is_left, style, approximate_other_styles, approximate_left
        )
        pieces.append(prefix)
        wrapped = None
        if kind is not None and quoted and prefix.endswith(quoted):
            before_target = prefix[:-len(quoted)]
            after_note = text[match.end():]
            if not _already_inside_underline(before_target, after_note):
                wrapped = _wrap_underline(quoted, output_format)
        if wrapped is None:
            pieces.append(match.group(0))
        else:
            pieces[-1] = prefix[:-len(quoted)]
            pieces.append(wrapped)
            if kind == 'plain':
                converted += 1
            else:
                approximated += 1
        pos = match.end()
    pieces.append(text[pos:])
    return ''.join(pieces), converted, approximated


def _convert_inline_underline(
    text: str,
    output_format: str,
    approximate_other_styles: bool,
    approximate_left: bool,
) -> Tuple[str, int, int]:
    converted = 0
    approximated = 0

    def _repl(match: re.Match) -> str:
        nonlocal converted, approximated
        is_left, style = _parse_underline_head(match.group('head'))
        kind = _underline_conversion_kind(
            is_left, style, approximate_other_styles, approximate_left
        )
        body = match.group('body')
        if (
            kind is None
            or '［＃' in body
            or '\n' in body
            or '\r' in body
            or _already_inside_underline(
                match.string[:match.start()], match.string[match.end():]
            )
        ):
            return match.group(0)
        wrapped = _wrap_underline(body, output_format)
        if wrapped is None:
            return match.group(0)
        if kind == 'plain':
            converted += 1
        else:
            approximated += 1
        return wrapped

    return _INLINE_UNDERLINE_RE.sub(_repl, text), converted, approximated


def _convert_underline_plain_text(
    text: str,
    output_format: str,
    approximate_other_styles: bool,
    approximate_left: bool,
) -> Tuple[str, int, int, int]:
    text, c1, a1 = _convert_forward_underline(
        text, output_format, approximate_other_styles, approximate_left
    )
    text, c2, a2 = _convert_inline_underline(
        text, output_format, approximate_other_styles, approximate_left
    )
    leftover = len(_LEFTOVER_UNDERLINE_NOTE_RE.findall(text))
    return text, c1 + c2, a1 + a2, leftover


def convert_aozora_underline(
    text: str,
    output_format: str = UNDERLINE_FORMAT_NYOZE,
    approximate_other_styles: bool = False,
    approximate_left: bool = False,
) -> Tuple[str, int, int, int]:
    """
    青空文庫の傍線注記を Nyoze || || または HTML <u> へ変換する。

    デフォルトは通常の「傍線」のみ。
    二重傍線・鎖線・破線・波線と左側は、それぞれの近似オプションON時だけ通常下線へ丸める。
    左＋特殊線種は両方ONのときだけ変換する。

    Returns:
        (変換後テキスト, 通常傍線変換件数, 近似変換件数, 未変換件数)
    """
    if output_format not in (UNDERLINE_FORMAT_NYOZE, UNDERLINE_FORMAT_HTML):
        output_format = UNDERLINE_FORMAT_NYOZE

    lines = text.split('\n')
    out: list[str] = []
    converted = 0
    approximated = 0
    unconverted = 0
    in_code_fence = False
    i = 0
    n = len(lines)

    def _line_convert(line: str) -> None:
        nonlocal converted, approximated, unconverted
        new_line, c, a, u = _convert_underline_plain_text(
            line, output_format, approximate_other_styles, approximate_left
        )
        out.append(new_line)
        converted += c
        approximated += a
        unconverted += u

    while i < n:
        line = lines[i]
        stripped = line.strip()

        if stripped.startswith('```'):
            in_code_fence = not in_code_fence
            out.append(line)
            i += 1
            continue
        if in_code_fence:
            out.append(line)
            i += 1
            continue

        m_start = _BLOCK_UNDERLINE_START_RE.match(line.rstrip('\r'))
        if m_start:
            is_left, style = _parse_underline_head(m_start.group('head'))
            kind = _underline_conversion_kind(
                is_left, style, approximate_other_styles, approximate_left
            )
            j = i + 1
            inner: list[str] = []
            found_end = False
            while j < n:
                if lines[j].strip().startswith('```'):
                    break
                m_end = _BLOCK_UNDERLINE_END_RE.match(lines[j].rstrip('\r'))
                if m_end:
                    end_left, end_style = _parse_underline_head(m_end.group('head'))
                    if end_left == is_left and end_style == style:
                        found_end = True
                    break
                inner.append(lines[j])
                j += 1
            if kind is None or not found_end or any('［＃' in row for row in inner):
                unconverted += 1
                if found_end:
                    out.extend(lines[i:j + 1])
                    i = j + 1
                else:
                    out.append(line)
                    i += 1
                continue
            wrap_unsafe = any(
                _wrap_underline(row, output_format) is None
                for row in inner
                if row.strip()
            )
            if wrap_unsafe:
                unconverted += 1
                out.extend(lines[i:j + 1])
                i = j + 1
                continue
            for row in inner:
                if row.strip() == '':
                    out.append(row)
                else:
                    out.append(_wrap_underline(row, output_format) or row)
            if kind == 'plain':
                converted += 1
            else:
                approximated += 1
            i = j + 1
            continue

        _line_convert(line)
        i += 1

    return '\n'.join(out), converted, approximated, unconverted

# -------------------- Aozora headings → Markdown --------------------
# 大見出し→H2 / 中見出し→H3 / 小見出し→H4（H1は作品タイトル用に空ける）
# 同行見出し・窓見出しは対象外。ルビは本文側の表記をそのまま残す。

_MD_HEADING_MARKS = {
    '大': '##',
    '中': '###',
    '小': '####',
}

# 見出し直前の字下げ。同行・窓は (大|中|小)見出し の直前に別語が入るためマッチしない。
_HEADING_INDENT_PREFIX = r'(?:［＃(?P<indent>[０-９0-9]+)字下げ］)?'

_BLOCK_HEADING_RE = re.compile(
    r'^[ \t　]*'
    + _HEADING_INDENT_PREFIX
    + r'［＃ここから(?P<level>大|中|小)見出し］'
    r'(?P<body>.*?)'
    r'［＃ここで(?P=level)見出し終わり］'
    r'[ \t　\r]*$',
    re.MULTILINE | re.DOTALL,
)

_RANGE_HEADING_RE = re.compile(
    r'^[ \t　]*'
    + _HEADING_INDENT_PREFIX
    + r'［＃(?P<level>大|中|小)見出し］'
    r'(?P<body>.*?)'
    r'［＃(?P=level)見出し終わり］'
    r'[ \t　\r]*$',
    re.MULTILINE | re.DOTALL,
)

_FORWARD_HEADING_RE = re.compile(
    r'^[ \t　]*'
    + _HEADING_INDENT_PREFIX
    + r'(?P<body>[^\n［]+?)'
    r'［＃「(?P<quoted>[^」]*)」は(?P<level>大|中|小)見出し］'
    r'[ \t　\r]*$',
    re.MULTILINE,
)

_UNSUPPORTED_HEADING_RE = re.compile(
    r'［＃「[^」]*」は(?:同行|窓)(?:大|中|小)見出し］'
    r'|［＃(?:ここから)?(?:同行|窓)(?:大|中|小)見出し］'
)


def _heading_indent_spaces(num_str: Optional[str]) -> str:
    """［＃N字下げ］の N を全角空白へ。不正値は空文字。"""
    if not num_str:
        return ''
    try:
        n = int(num_str.translate(_FULLWIDTH_TO_ASCII_DIGITS))
    except ValueError:
        return ''
    n = max(0, min(n, 40))
    return '　' * n


def _join_heading_lines(body: str) -> str:
    """複数行見出しを空白連結する。空行は無視し、前後空白だけ整える。"""
    parts = [line.strip() for line in body.splitlines()]
    return ' '.join(part for part in parts if part)


def _markdown_heading(level: str, body: str, indent_num: Optional[str]) -> Optional[str]:
    marks = _MD_HEADING_MARKS.get(level)
    if not marks:
        return None
    title = _join_heading_lines(body)
    if not title:
        return None
    return f'{marks} {_heading_indent_spaces(indent_num)}{title}'


def convert_aozora_headings(text: str) -> Tuple[str, int, int]:
    """
    青空文庫の通常見出し注記を Markdown ATX 見出しへ変換する。

    対応:
      - 前方参照型: 第一章［＃「第一章」は大見出し］
      - 開始/終了型: ［＃中見出し］…［＃中見出し終わり］
      - 複数行型: ［＃ここから大見出し］…［＃ここで大見出し終わり］
    非対応（原文のまま）:
      - 同行大/中/小見出し、窓大/中/小見出し

    見出し本文は注記の引用ではなく、本文側文字列（ルビ含む）を使う。

    Returns:
        (変換後テキスト, 変換件数, 未対応の同行・窓見出し件数)
    """
    converted = 0

    def _replace(match: re.Match) -> str:
        nonlocal converted
        md = _markdown_heading(
            match.group('level'),
            match.group('body'),
            match.group('indent'),
        )
        if md is None:
            return match.group(0)
        converted += 1
        return md

    # より構造が明確な複数行・範囲を先に処理し、残りを前方参照型へ。
    text = _BLOCK_HEADING_RE.sub(_replace, text)
    text = _RANGE_HEADING_RE.sub(_replace, text)
    text = _FORWARD_HEADING_RE.sub(_replace, text)
    unsupported = len(_UNSUPPORTED_HEADING_RE.findall(text))
    return text, converted, unsupported

# -------------------- Aozora bouten → Nyoze ruby --------------------
# 傍点注記を 1 文字ごとの ｜字《記号》 へ。傍線は対象外。
# 左側傍点は変換せず未変換件数に含める。
# 種類（白ゴマ・丸・三角等）は GUI で選んだ記号へ正規化する。

DEFAULT_BOUTEN_CHAR = '﹅'

# (内部値, 表示ラベル) 将来の候補追加用
BOUTEN_CHAR_CHOICES = (
    ('﹅', '﹅  ゴマ点'),
    ('•', '•  丸点'),
)

# 長い名称を先に置き、丸傍点 が 白丸傍点 を部分一致しないようにする
_BOUTEN_KIND_NAMES = (
    '白ゴマ傍点',
    '白丸傍点',
    '黒三角傍点',
    '白三角傍点',
    '二重丸傍点',
    '蛇の目傍点',
    'ばつ傍点',
    '丸傍点',
    '傍点',
)
_BOUTEN_KIND_RE = '|'.join(re.escape(name) for name in _BOUTEN_KIND_NAMES)

_FORWARD_BOUTEN_RE = re.compile(
    r'［＃「(?P<quoted>[^」]*)」に(?P<kind>' + _BOUTEN_KIND_RE + r')］'
)
_RANGE_BOUTEN_RE = re.compile(
    r'［＃(?P<kind>' + _BOUTEN_KIND_RE + r')］'
    r'(?P<body>.*?)'
    r'［＃(?P=kind)終わり］',
    re.DOTALL,
)

# 左側傍点は変換しないが、未変換として検出する。
# ［＃左に傍点終わり］は「［＃左に傍点］」に一致しない（終わりが挟まる）ため、開始側だけ数える。
_LEFT_BOUTEN_NOTE_RE = re.compile(
    r'［＃「[^」]*」の左に(?:' + _BOUTEN_KIND_RE + r')］'
    r'|［＃左に(?:' + _BOUTEN_KIND_RE + r')］'
)


def _normalize_bouten_char(bouten_char: str) -> str:
    """ルビに使う傍点記号を1コードポイントへ。空ならデフォルト。"""
    if not bouten_char:
        return DEFAULT_BOUTEN_CHAR
    return next(iter(bouten_char), DEFAULT_BOUTEN_CHAR)


def _contains_aozora_ruby(text: str) -> bool:
    """対象範囲に既存の青空ルビ（｜ / 《 / 》）があるか。"""
    return '｜' in text or '《' in text or '》' in text


def _apply_bouten_to_text(text: str, bouten_char: str) -> str:
    """
    文字列の各 Unicode 文字に独立した傍点ルビを付ける。
    空白類は傍点対象にせず、そのまま残す。
    """
    mark = _normalize_bouten_char(bouten_char)
    parts: list[str] = []
    for ch in text:
        if ch.isspace():
            parts.append(ch)
        else:
            parts.append(f'｜{ch}《{mark}》')
    return ''.join(parts)


def convert_aozora_bouten(text: str, bouten_char: str = DEFAULT_BOUTEN_CHAR) -> Tuple[str, int, int]:
    """
    青空文庫の傍点注記を Nyoze 向け 1 文字ルビへ変換する。

    対応:
      - 前方参照型: 青空［＃「青空」に傍点］
      - 開始/終了型: ［＃傍点］…［＃傍点終わり］（同一行のみ）
      - 白ゴマ・丸・三角等の種別（出力記号は bouten_char に正規化）
    非対応（原文のまま）:
      - 傍線
      - 左側傍点（未変換件数には含める）
      - 改行をまたぐ開始/終了
      - 対象範囲に既存ルビが含まれる場合

    Returns:
        (変換後テキスト, 変換した注記件数, 認識したが変換しなかった注記件数)
    """
    mark = _normalize_bouten_char(bouten_char)
    converted = 0
    unconverted = 0

    pieces: list[str] = []
    pos = 0
    for match in _RANGE_BOUTEN_RE.finditer(text):
        pieces.append(text[pos:match.start()])
        body = match.group('body')
        unsafe = (
            '\n' in body
            or '\r' in body
            or _contains_aozora_ruby(body)
            or '［＃' in body
        )
        if unsafe:
            unconverted += 1
            pieces.append(match.group(0))
        else:
            applied = _apply_bouten_to_text(body, mark)
            if applied == body:
                unconverted += 1
                pieces.append(match.group(0))
            else:
                converted += 1
                pieces.append(applied)
        pos = match.end()
    pieces.append(text[pos:])
    text = ''.join(pieces)

    pieces = []
    pos = 0
    for match in _FORWARD_BOUTEN_RE.finditer(text):
        prefix = text[pos:match.start()]
        quoted = match.group('quoted')
        target_start = None
        if quoted and prefix.endswith(quoted):
            candidate_start = len(prefix) - len(quoted)
            target = prefix[candidate_start:]
            if not _contains_aozora_ruby(target):
                target_start = candidate_start
        if target_start is None:
            unconverted += 1
            pieces.append(text[pos:match.end()])
        else:
            pieces.append(prefix[:target_start])
            pieces.append(_apply_bouten_to_text(quoted, mark))
            converted += 1
        pos = match.end()
    pieces.append(text[pos:])
    text = ''.join(pieces)

    unconverted += len(_LEFT_BOUTEN_NOTE_RE.findall(text))
    return text, converted, unconverted

# -------------------- Aozora indent → Nyoze :::indent-N --------------------
# Nyoze は indent-1〜6 のみ。ブロック途中の字下げ変更は入れ子にせず付け替える。

NYOZE_INDENT_MIN = 1
NYOZE_INDENT_MAX = 6

_ONE_LINE_INDENT_RE = re.compile(
    r'^(?P<lead>[ \t\u3000]*)［＃(?P<num>[０-９0-9]+)字下げ］(?P<body>.*)$'
)
_BLOCK_INDENT_START_RE = re.compile(
    r'^[ \t\u3000]*［＃ここから(?P<num>[０-９0-9]+)字下げ］[ \t\u3000\r]*$'
)
_BLOCK_INDENT_END_RE = re.compile(
    r'^[ \t\u3000]*［＃ここで字下げ終わり］[ \t\u3000\r]*$'
)
_EXISTING_NYOZE_INDENT_OPEN_RE = re.compile(r'^:::indent-[1-6]$')
_INDENT_NOTE_HINT_RE = re.compile(
    r'［＃ここから[０-９0-9]+字下げ|［＃[０-９0-9]+字下げ'
)


def _parse_indent_number(num_str: str) -> Optional[int]:
    try:
        return int(num_str.translate(_FULLWIDTH_TO_ASCII_DIGITS))
    except ValueError:
        return None


def _is_nyoze_indent_level(n: Optional[int]) -> bool:
    return n is not None and NYOZE_INDENT_MIN <= n <= NYOZE_INDENT_MAX


def _next_nonempty_line(lines: list, index: int) -> str:
    for j in range(index + 1, len(lines)):
        if lines[j].strip():
            return lines[j].strip()
    return ''


# 最終検査・意図的保持注記の検出。
# 変換成功＋元注記保持で出した注記は、書誌/定型注釈削除のあとも
# 「最終出力に残っている出現」だけを除外できるよう PUA マーカーで包む。
_AOZORA_NOTE_RE = re.compile(r'※?［＃[^］\r\n]*］')
_PRESERVED_NOTE_OPEN = '\ue000'
_PRESERVED_NOTE_CLOSE = '\ue001'
_PRESERVED_NOTE_WRAP_RE = re.compile(
    re.escape(_PRESERVED_NOTE_OPEN)
    + r'(' + _AOZORA_NOTE_RE.pattern + r')'
    + re.escape(_PRESERVED_NOTE_CLOSE)
)
_FENCE_OPEN_RE = re.compile(r'^[ \t\u3000]*(`{3,}|~{3,})')
_INLINE_CODE_RE = re.compile(r'`[^`\n]+`')
_REMAINING_NOTE_KIND_LIMIT = 50
_REMAINING_NOTE_LINE_LIMIT = 3


def _mark_preserved_aozora_notes(emitted: str) -> str:
    """変換成功＋元注記保持で出力する注記へ内部マーカーを付ける。"""
    if not emitted:
        return emitted
    return _AOZORA_NOTE_RE.sub(
        lambda m: f'{_PRESERVED_NOTE_OPEN}{m.group(0)}{_PRESERVED_NOTE_CLOSE}',
        emitted,
    )


def _is_marked_preserved_note(text: str, start: int, end: int) -> bool:
    open_len = len(_PRESERVED_NOTE_OPEN)
    close_len = len(_PRESERVED_NOTE_CLOSE)
    return (
        start >= open_len
        and text[start - open_len:start] == _PRESERVED_NOTE_OPEN
        and text[end:end + close_len] == _PRESERVED_NOTE_CLOSE
    )


def strip_preserved_aozora_note_markers(text: str) -> str:
    """最終書き込み前に、内部マーカーで囲んだ青空注記だけを元注記へ戻す。"""
    if not text:
        return text
    return _PRESERVED_NOTE_WRAP_RE.sub(r'\1', text)


def convert_aozora_indent(
    text: str,
    preserve_notes: bool = False,
) -> Tuple[str, int, int]:
    """
    青空文庫の字下げ注記を Nyoze の :::indent-N へ変換する。

    対応:
      - 1行型: ［＃３字下げ］本文
      - ブロック型: ［＃ここから２字下げ］…［＃ここで字下げ終わり］
      - ブロック途中の絶対字下げ量の切り替え（入れ子にしない）
    非対応（原文のまま、未変換件数へ）:
      - 0字・7字以上・不正な数字
      - 修飾付きなど安全に判定できない字下げ注記

    件数は :::indent-N を開く回数（1行型・ここから指定ごと）。

    Returns:
        (変換後テキスト, 変換件数, 未変換件数)
    """
    lines = text.split('\n')
    out: list[str] = []
    converted = 0
    unconverted = 0
    current: Optional[int] = None
    in_code_fence = False
    in_existing_indent = False

    def emit_preserved(emitted: str) -> None:
        out.append(_mark_preserved_aozora_notes(emitted))

    def close_indent() -> None:
        nonlocal current
        if current is not None:
            out.append(':::')
            current = None

    def open_indent(level: int) -> None:
        nonlocal current, converted
        close_indent()
        out.append(f':::indent-{level}')
        current = level
        converted += 1

    for i, line in enumerate(lines):
        stripped = line.strip()

        if stripped.startswith('```'):
            close_indent()
            in_code_fence = not in_code_fence
            out.append(line)
            continue
        if in_code_fence:
            out.append(line)
            continue

        if in_existing_indent:
            out.append(line)
            if stripped == ':::':
                in_existing_indent = False
            continue

        if current is None and _EXISTING_NYOZE_INDENT_OPEN_RE.match(stripped):
            in_existing_indent = True
            out.append(line)
            continue

        m_block_start = _BLOCK_INDENT_START_RE.match(line)
        if m_block_start:
            nxt = _next_nonempty_line(lines, i)
            if _EXISTING_NYOZE_INDENT_OPEN_RE.match(nxt):
                out.append(line)
                continue
            n = _parse_indent_number(m_block_start.group('num'))
            if not _is_nyoze_indent_level(n):
                close_indent()
                unconverted += 1
                out.append(line)
                continue
            # 切替時は先に現在の ::: を閉じ、元注記を外側に出してから開く
            close_indent()
            if preserve_notes:
                emit_preserved(line)
            open_indent(n)
            continue

        if _BLOCK_INDENT_END_RE.match(line):
            if current is not None:
                close_indent()
                if preserve_notes:
                    emit_preserved(line)
            else:
                out.append(line)
            continue

        m_one = _ONE_LINE_INDENT_RE.match(line)
        if m_one:
            body = m_one.group('body')
            if body.strip() == '':
                out.append(line)
                continue
            if current is not None:
                out.append(line)
                continue
            n = _parse_indent_number(m_one.group('num'))
            if not _is_nyoze_indent_level(n):
                unconverted += 1
                out.append(line)
                continue
            if preserve_notes:
                note_line = (m_one.group('lead') + f'［＃{m_one.group("num")}字下げ］').rstrip()
                emit_preserved(note_line)
            open_indent(n)
            out.append(body)
            close_indent()
            continue

        if current is None and _INDENT_NOTE_HINT_RE.search(line):
            unconverted += 1
        out.append(line)

    close_indent()
    return '\n'.join(out), converted, unconverted

# -------------------- Aozora 地付き → Nyoze :::align-end --------------------
# 地からN字上げは正確再現できない。明示ONのときだけ地付きとして近似する。

_INLINE_JITSUKI_RE = re.compile(
    r'^(?P<prefix>.*?)［＃地付き］(?P<body>.*)$'
)
_INLINE_JIAGE_RE = re.compile(
    r'^(?P<prefix>.*?)［＃地から(?P<num>[０-９0-9]+)字上げ］(?P<body>.*)$'
)
_BLOCK_JITSUKI_START_RE = re.compile(
    r'^[ \t\u3000]*［＃ここから地付き］[ \t\u3000\r]*$'
)
_BLOCK_JITSUKI_END_RE = re.compile(
    r'^[ \t\u3000]*［＃ここで地付き終わり］[ \t\u3000\r]*$'
)
_BLOCK_JIAGE_START_RE = re.compile(
    r'^[ \t\u3000]*［＃ここから地から(?P<num>[０-９0-9]+)字上げ］[ \t\u3000\r]*$'
)
_BLOCK_JIAGE_END_RE = re.compile(
    r'^[ \t\u3000]*［＃ここで字上げ終わり］[ \t\u3000\r]*$'
)
_EXISTING_NYOZE_DIRECTIVE_OPEN_RE = re.compile(r'^:::[A-Za-z][A-Za-z0-9_-]*$')
_EXISTING_NYOZE_ALIGN_END_RE = re.compile(r'^:::align-end$')
_ALIGN_RELATED_NOTE_RE = re.compile(
    r'［＃地付き］|［＃地から[０-９0-9]+字上げ］'
)
_JIAGE_NOTE_HINT_RE = re.compile(
    r'［＃(?:ここから)?地から[０-９0-9]+字上げ'
)


def _is_valid_jiage_level(n: Optional[int]) -> bool:
    return n is not None and n >= 1


def _count_align_related_notes(line: str) -> int:
    return len(_ALIGN_RELATED_NOTE_RE.findall(line))


def convert_aozora_align_end(
    text: str,
    approximate_jiage: bool = False,
    preserve_notes: bool = False,
) -> Tuple[str, int, int, int]:
    """
    青空文庫の地付き注記を Nyoze の :::align-end へ変換する。

    対応:
      - 1行型: ［＃地付き］本文
      - 行途中: 本文［＃地付き］署名
      - ブロック型: ［＃ここから地付き］…［＃ここで地付き終わり］
    地からN字上げ:
      - approximate_jiage=False なら原文保持（未変換）
      - True なら :::align-end へ近似（N字情報は捨てる）
    0字・不正な数字・同一行の複数指定など安全に判定できない注記は原文保持。

    Returns:
        (変換後テキスト, 地付き変換件数, 地寄せ近似件数, 地付き・地寄せの未変換件数)
    """
    lines = text.split('\n')
    out: list[str] = []
    converted = 0
    approximated = 0
    unconverted = 0
    in_align = False
    align_kind: Optional[str] = None  # 'jitsuki' | 'jiage'
    in_code_fence = False
    in_existing_directive = False
    in_passthrough_jiage = False

    def close_align() -> None:
        nonlocal in_align, align_kind
        if in_align:
            out.append(':::')
            in_align = False
            align_kind = None

    def open_align(from_jiage: bool) -> None:
        nonlocal in_align, align_kind, converted, approximated
        close_align()
        out.append(':::align-end')
        in_align = True
        align_kind = 'jiage' if from_jiage else 'jitsuki'
        if from_jiage:
            approximated += 1
        else:
            converted += 1

    def emit_inline(prefix: str, note: str, body: str, from_jiage: bool) -> None:
        if prefix.strip():
            out.append(prefix.rstrip())
        if preserve_notes:
            lead = prefix if not prefix.strip() else ''
            emitted = f'{lead}{note}'.rstrip()
            out.append(_mark_preserved_aozora_notes(emitted))
        open_align(from_jiage)
        out.append(body.rstrip('\r'))
        close_align()

    def count_jiage_if_present(line: str) -> None:
        nonlocal unconverted
        if _JIAGE_NOTE_HINT_RE.search(line):
            unconverted += 1

    for i, line in enumerate(lines):
        stripped = line.strip()
        match_line = line.rstrip('\r')

        if stripped.startswith('```'):
            close_align()
            in_code_fence = not in_code_fence
            out.append(line)
            continue
        if in_code_fence:
            out.append(line)
            continue

        if in_passthrough_jiage:
            out.append(line)
            if _BLOCK_JIAGE_END_RE.match(match_line):
                in_passthrough_jiage = False
            continue

        if in_existing_directive:
            out.append(line)
            if stripped == ':::':
                in_existing_directive = False
            continue

        if not in_align and _EXISTING_NYOZE_DIRECTIVE_OPEN_RE.match(stripped):
            in_existing_directive = True
            out.append(line)
            continue

        m_block_jitsuki_start = _BLOCK_JITSUKI_START_RE.match(match_line)
        if m_block_jitsuki_start:
            nxt = _next_nonempty_line(lines, i)
            if _EXISTING_NYOZE_ALIGN_END_RE.match(nxt):
                out.append(line)
                continue
            if in_align:
                out.append(line)
                continue
            close_align()
            if preserve_notes:
                out.append(_mark_preserved_aozora_notes(line))
            open_align(False)
            continue

        if _BLOCK_JITSUKI_END_RE.match(match_line):
            if in_align and align_kind == 'jitsuki':
                close_align()
                if preserve_notes:
                    out.append(_mark_preserved_aozora_notes(line))
            else:
                out.append(line)
            continue

        m_block_jiage_start = _BLOCK_JIAGE_START_RE.match(match_line)
        if m_block_jiage_start:
            nxt = _next_nonempty_line(lines, i)
            if _EXISTING_NYOZE_ALIGN_END_RE.match(nxt):
                out.append(line)
                continue
            if in_align:
                count_jiage_if_present(line)
                out.append(line)
                continue
            n = _parse_indent_number(m_block_jiage_start.group('num'))
            if not approximate_jiage or not _is_valid_jiage_level(n):
                unconverted += 1
                out.append(line)
                in_passthrough_jiage = True
                continue
            close_align()
            if preserve_notes:
                out.append(_mark_preserved_aozora_notes(line))
            open_align(True)
            continue

        if _BLOCK_JIAGE_END_RE.match(match_line):
            if in_align and align_kind == 'jiage':
                close_align()
                if preserve_notes:
                    out.append(_mark_preserved_aozora_notes(line))
            else:
                out.append(line)
            continue

        m_jitsuki = _INLINE_JITSUKI_RE.match(match_line)
        if m_jitsuki:
            body = m_jitsuki.group('body')
            if in_align or body.strip() == '':
                count_jiage_if_present(line)
                out.append(line)
                continue
            if _count_align_related_notes(match_line) > 1:
                unconverted += 1
                out.append(line)
                continue
            emit_inline(m_jitsuki.group('prefix'), '［＃地付き］', body, False)
            continue

        m_jiage = _INLINE_JIAGE_RE.match(match_line)
        if m_jiage:
            body = m_jiage.group('body')
            n = _parse_indent_number(m_jiage.group('num'))
            if (
                in_align
                or body.strip() == ''
                or _count_align_related_notes(match_line) > 1
                or not approximate_jiage
                or not _is_valid_jiage_level(n)
            ):
                unconverted += 1
                out.append(line)
                continue
            note = f'［＃地から{m_jiage.group("num")}字上げ］'
            emit_inline(m_jiage.group('prefix'), note, body, True)
            continue

        if not in_align:
            count_jiage_if_present(line)
        elif _JIAGE_NOTE_HINT_RE.search(line):
            unconverted += 1
        out.append(line)

    close_align()
    return '\n'.join(out), converted, approximated, unconverted

# -------------------- Aozora ページ送り → Nyoze :::page-break / :::blank-page --------------------
# 空白ページは「改ページ＋空行＋改ページ」を通常改ページより先に検出する。
# 改丁・改見開きは左右ページを再現できないため、明示ONのときだけ page-break へ近似する。
# 改段は改ページではないので変換しない。

_PAGE_LINE_WS_TAIL = r'[ \t\u3000\r]*$'
_PAGE_BREAK_LINE_RE = re.compile(r'^[ \t\u3000]*［＃改ページ］' + _PAGE_LINE_WS_TAIL)
_KAICHO_LINE_RE = re.compile(r'^[ \t\u3000]*［＃改丁］' + _PAGE_LINE_WS_TAIL)
_KAIHIRAKI_LINE_RE = re.compile(r'^[ \t\u3000]*［＃改見開き］' + _PAGE_LINE_WS_TAIL)
_KAIDAN_LINE_RE = re.compile(r'^[ \t\u3000]*［＃改段］' + _PAGE_LINE_WS_TAIL)
_EXISTING_NYOZE_PAGE_BREAK_RE = re.compile(r'^:::page-break$')
_EXISTING_NYOZE_BLANK_PAGE_RE = re.compile(r'^:::blank-page(?:-[0-9]+)?$')
_PAGE_NOTE_HINT_RE = re.compile(r'［＃(?:改ページ|改丁|改見開き)］')
_KAIDAN_HINT_RE = re.compile(r'［＃改段］')


def _is_ws_only_line(line: str) -> bool:
    return line.strip() == ''


def convert_aozora_page_breaks(
    text: str,
    approximate_spread_breaks: bool = False,
    preserve_notes: bool = False,
) -> Tuple[str, int, int, int, int, int]:
    """
    青空文庫のページ送り注記を Nyoze の :::page-break / :::blank-page へ変換する。

    対応:
      - 独立行の ［＃改ページ］ → :::page-break
      - ［＃改ページ］＋空行＋［＃改ページ］ → :::blank-page（通常改ページより先に検出）
    改丁・改見開き:
      - approximate_spread_breaks=False なら原文保持（未変換）
      - True なら :::page-break へ近似（左右ページ情報は捨てる）
    改段は変換しない。

    Returns:
        (変換後テキスト, 改ページ変換件数, 空白ページ変換件数,
         改丁・改見開き近似件数, ページ送り未変換件数, 改段未変換件数)
    """
    lines = text.split('\n')
    out: list[str] = []
    page_breaks = 0
    blanks = 0
    spread_approx = 0
    unconverted = 0
    kaidan = 0
    in_code_fence = False
    in_existing_directive = False
    i = 0
    n = len(lines)

    def match_line(idx: int) -> str:
        return lines[idx].rstrip('\r')

    def emit_page_break(*, from_spread: bool = False) -> None:
        nonlocal page_breaks, spread_approx
        out.append(':::page-break')
        out.append(':::')
        if from_spread:
            spread_approx += 1
        else:
            page_breaks += 1

    def emit_blank_page() -> None:
        nonlocal blanks
        out.append(':::blank-page')
        out.append(':::')
        blanks += 1

    def append_range(start: int, end_inclusive: int) -> None:
        for j in range(start, end_inclusive + 1):
            out.append(lines[j])

    def already_page_break(after_idx: int) -> bool:
        return bool(_EXISTING_NYOZE_PAGE_BREAK_RE.match(_next_nonempty_line(lines, after_idx)))

    def already_blank_page(after_idx: int) -> bool:
        return bool(_EXISTING_NYOZE_BLANK_PAGE_RE.match(_next_nonempty_line(lines, after_idx)))

    while i < n:
        line = lines[i]
        stripped = line.strip()
        ml = match_line(i)

        if stripped.startswith('```'):
            in_code_fence = not in_code_fence
            out.append(line)
            i += 1
            continue
        if in_code_fence:
            out.append(line)
            i += 1
            continue

        if in_existing_directive:
            out.append(line)
            if stripped == ':::':
                in_existing_directive = False
            i += 1
            continue

        if _EXISTING_NYOZE_DIRECTIVE_OPEN_RE.match(stripped):
            in_existing_directive = True
            out.append(line)
            i += 1
            continue

        if _PAGE_BREAK_LINE_RE.match(ml):
            k = i + 1
            saw_blank = False
            while k < n and _is_ws_only_line(lines[k]):
                saw_blank = True
                k += 1
            if saw_blank and k < n and _PAGE_BREAK_LINE_RE.match(match_line(k)):
                if already_blank_page(k):
                    append_range(i, k)
                    i = k + 1
                    continue
                if preserve_notes:
                    for j in range(i, k + 1):
                        out.append(_mark_preserved_aozora_notes(lines[j]))
                emit_blank_page()
                i = k + 1
                continue
            if already_page_break(i):
                out.append(line)
                i += 1
                continue
            if preserve_notes:
                out.append(_mark_preserved_aozora_notes(line))
            emit_page_break()
            i += 1
            continue

        if _KAICHO_LINE_RE.match(ml) or _KAIHIRAKI_LINE_RE.match(ml):
            if already_page_break(i):
                out.append(line)
                i += 1
                continue
            if not approximate_spread_breaks:
                unconverted += 1
                out.append(line)
                i += 1
                continue
            if preserve_notes:
                out.append(_mark_preserved_aozora_notes(line))
            emit_page_break(from_spread=True)
            i += 1
            continue

        if _KAIDAN_LINE_RE.match(ml):
            kaidan += 1
            out.append(line)
            i += 1
            continue

        if _KAIDAN_HINT_RE.search(line):
            kaidan += 1
        elif _PAGE_NOTE_HINT_RE.search(line):
            unconverted += 1
        out.append(line)
        i += 1

    return '\n'.join(out), page_breaks, blanks, spread_approx, unconverted, kaidan

def parse_aozora_header(text: str) -> Tuple[dict, str]:
    """
    青空文庫のヘッダーを解析してフロントマター用のメタデータと本文を返す
    Returns: (metadata_dict, body_text)
    """
    lines = text.split('\n')
    
    # 最初の空行を探す
    header_end = 0
    for i, line in enumerate(lines):
        if line.strip() == '':
            header_end = i
            break
    
    if header_end == 0:
        # 空行が見つからない場合は全体を本文として扱う
        return {}, text
    
    header_lines = [line.strip() for line in lines[:header_end] if line.strip()]
    body_text = '\n'.join(lines[header_end:]).lstrip('\n')
    
    if not header_lines:
        return {}, body_text
    
    n = len(header_lines)
    result = {'title': header_lines[0]}
    
    if n == 1:
        return result, body_text
    
    if n == 2:
        # 確実: タイトル + 著者
        result['author'] = header_lines[1]
        return result, body_text
    
    # 3行以上のケース
    translator_indices = [i for i in range(1, n) 
                         if header_lines[i].endswith('訳')]
    
    if translator_indices:
        # 翻訳作品
        first_translator_idx = min(translator_indices)
        
        # 翻訳者を抽出
        translators = [header_lines[i] for i in translator_indices]
        if len(translators) == 1:
            result['translator'] = translators[0]
        else:
            result['translators'] = translators
        
        # 最初の訳者の直前の行は著者（確定）
        result['author'] = header_lines[first_translator_idx - 1]
        
        # 2行目から著者の前までは判断不可（raw_header）
        if first_translator_idx > 2:
            remaining = [header_lines[i] for i in range(1, first_translator_idx - 1)]
            result['raw_header'] = '\n'.join(remaining)
    else:
        # 日本作品（訳がない）で3行以上
        # 2行目は判断不可
        result['raw_header'] = header_lines[1]
        
        # 3行目から最終行は著者
        authors = [header_lines[i] for i in range(2, n)]
        if len(authors) == 1:
            result['author'] = authors[0]
        else:
            result['authors'] = authors
    
    return result, body_text

def remove_aozora_annotations(text: str) -> str:
    """
    青空文庫の定型注釈（-----で囲まれた部分）を削除
    """
    lines = text.split('\n')
    result_lines = []
    in_annotation = False
    
    for line in lines:
        stripped = line.strip()
        
        # -----（5文字以上のハイフン）で始まる行を検出
        if stripped.startswith('-----'):
            if in_annotation:
                # 注釈ブロックの終了
                in_annotation = False
                continue
            else:
                # 注釈ブロックの開始
                in_annotation = True
                continue
        
        # 注釈ブロック内でない行のみ保持
        if not in_annotation:
            result_lines.append(line)
    
    return '\n'.join(result_lines)

# 末尾書誌は長くなり得るが、本文全体を走査すると誤削除のリスクが上がる。
_AOZORA_FOOTER_SEARCH_MAX_LINES = 400
_AOZORA_FOOTER_DATE_RE = re.compile(
    r'[0-9０-９]{4}年[0-9０-９]{1,2}月[0-9０-９]{1,2}日[ \t\u3000]*(?:作成|修正)'
)
# 独立行の ［＃本文終わり］。文字クラスの [ は全角化しないよう分割する。
_HONBUN_OWARI_LINE_RE = re.compile(
    r'^[ \t\u3000]*［＃本文終わり］' + r'[ \t\u3000\r]*$'
)


def _lstrip_aozora_line(line: str) -> str:
    return line.lstrip(' \t\u3000')


def _line_starts_with_label(line: str, *labels: str) -> bool:
    stripped = _lstrip_aozora_line(line)
    return any(stripped.startswith(label) for label in labels)


def _is_teihon_start_line(line: str) -> bool:
    """行頭の「底本：」。『底本の親本：』は開始点にしない。"""
    stripped = _lstrip_aozora_line(line)
    return stripped.startswith('底本：') or stripped.startswith('底本:')


def _is_honbun_owari_line(line: str) -> bool:
    """独立行の ［＃本文終わり］。行途中の出現は開始点にしない。"""
    return bool(_HONBUN_OWARI_LINE_RE.match(line.rstrip('\r')))


def _footer_candidate_is_safe(rest_lines: list[str]) -> bool:
    return (
        _footer_rest_has_creation_file_marker(rest_lines)
        and _footer_rest_has_personnel_or_date(rest_lines)
    )


def _last_safe_footer_start(
    lines: list[str],
    window_start: int,
    predicate,
) -> Optional[int]:
    last_good: Optional[int] = None
    n = len(lines)
    for i in range(window_start, n):
        if not predicate(lines[i]):
            continue
        if _footer_candidate_is_safe(lines[i:]):
            last_good = i
    return last_good


def _footer_rest_has_creation_file_marker(rest_lines: list[str]) -> bool:
    return any(
        _line_starts_with_label(line, '青空文庫作成ファイル：', '青空文庫作成ファイル:')
        for line in rest_lines
    )


def _footer_rest_has_personnel_or_date(rest_lines: list[str]) -> bool:
    for line in rest_lines:
        if _line_starts_with_label(line, '入力：', '入力:', '校正：', '校正:'):
            return True
        if _AOZORA_FOOTER_DATE_RE.search(line):
            return True
    return False


def find_aozora_footer_start(text: str) -> Optional[int]:
    """
    末尾書誌情報の開始行インデックスを返す。
    安全条件をすべて満たす最後の「底本：」を優先し、それが無いときだけ
    独立行の「［＃本文終わり］」を候補にする。見つからなければ None。
    """
    lines = text.split('\n')
    n = len(lines)
    window_start = max(0, n - _AOZORA_FOOTER_SEARCH_MAX_LINES)
    teihon = _last_safe_footer_start(lines, window_start, _is_teihon_start_line)
    if teihon is not None:
        return teihon
    return _last_safe_footer_start(lines, window_start, _is_honbun_owari_line)


def remove_aozora_footer_metadata(text: str) -> Tuple[str, bool]:
    """
    青空文庫テキスト末尾の書誌・ファイル作成情報を、安全条件を満たすときだけ削除する。

    必須:
      - 末尾探索範囲内に行頭「底本：」がある（「底本の親本：」は開始点にしない）
        または、それが無い場合のみ独立行「［＃本文終わり］」
      - その行より後ろに「青空文庫作成ファイル：」がある
      - さらに「入力：」「校正：」または作成/修正日のいずれかがある

    Returns:
        (削除後テキスト, 削除したか)
    """
    if not text:
        return text, False
    start = find_aozora_footer_start(text)
    if start is None:
        return text, False
    lines = text.split('\n')
    kept = lines[:start]
    while kept and kept[-1].strip() == '':
        kept.pop()
    result = '\n'.join(kept)
    if result:
        result += '\n'
    return result, True


@dataclass(frozen=True)
class RemainingAozoraNote:
    line: int
    text: str


def _is_close_fence(line: str, char: str, length: int) -> bool:
    m = re.match(
        r'^[ \t\u3000]*(' + re.escape(char) + r'{3,})[ \t\u3000]*$',
        line.rstrip('\r'),
    )
    return bool(m) and len(m.group(1)) >= length


def scan_remaining_aozora_notes(
    text: str,
) -> list:
    """
    最終出力に残った ［＃…］ / ※［＃…］ を検出する。
    コードフェンス内と、変換成功時に付けた内部マーカー付き注記は除外する。
    """
    found: list[RemainingAozoraNote] = []
    in_fence = False
    fence_char = ''
    fence_len = 0
    for line_no, raw in enumerate(text.split('\n'), 1):
        if in_fence:
            if _is_close_fence(raw, fence_char, fence_len):
                in_fence = False
                fence_char = ''
                fence_len = 0
            continue
        open_m = _FENCE_OPEN_RE.match(raw)
        if open_m:
            marker = open_m.group(1)
            in_fence = True
            fence_char = marker[0]
            fence_len = len(marker)
            continue
        masked = _INLINE_CODE_RE.sub(lambda m: ' ' * len(m.group(0)), raw)
        for note_m in _AOZORA_NOTE_RE.finditer(masked):
            if _is_marked_preserved_note(masked, note_m.start(), note_m.end()):
                continue
            found.append(RemainingAozoraNote(line_no, note_m.group(0)))
    return found


def format_remaining_aozora_note_log_lines(
    filename: str,
    notes: list,
) -> list:
    if not notes:
        return []
    lines = [f'[WARN] 未変換の青空文庫注記: {len(notes)}件 — {filename}']
    groups: dict[str, list[int]] = {}
    order: list[str] = []
    for note in notes:
        if note.text not in groups:
            order.append(note.text)
            groups[note.text] = []
        groups[note.text].append(note.line)
    shown_kinds = order[:_REMAINING_NOTE_KIND_LIMIT]
    for text in shown_kinds:
        line_nos = groups[text]
        shown = line_nos[:_REMAINING_NOTE_LINE_LIMIT]
        loc = ', '.join(str(n) for n in shown)
        if len(line_nos) > _REMAINING_NOTE_LINE_LIMIT:
            loc += ', ...'
        lines.append(f'    {len(line_nos)}件  {text}  (行 {loc})')
    extra = len(order) - len(shown_kinds)
    if extra > 0:
        lines.append(f'    ... 他 {extra}種類')
    return lines

def create_frontmatter(metadata: dict) -> str:
    """
    メタデータからYAMLフロントマターを生成
    """
    if not metadata:
        return ''
    
    lines = ['---']
    
    # title（必須）
    if 'title' in metadata:
        lines.append(f"title: {metadata['title']}")
    
    # author
    if 'author' in metadata:
        lines.append(f"author: {metadata['author']}")
    
    # authors（複数著者）
    if 'authors' in metadata:
        lines.append('authors:')
        for author in metadata['authors']:
            lines.append(f"  - {author}")
    
    # translator
    if 'translator' in metadata:
        lines.append(f"translator: {metadata['translator']}")
    
    # translators（複数訳者）
    if 'translators' in metadata:
        lines.append('translators:')
        for translator in metadata['translators']:
            lines.append(f"  - {translator}")
    
    # raw_header（判断不可の部分）
    if 'raw_header' in metadata:
        lines.append('raw_header: |')
        for line in metadata['raw_header'].split('\n'):
            lines.append(f"  {line}")
    
    lines.append('---')
    return '\n'.join(lines)

def extract_frontmatter_metadata(text: str) -> Optional[dict]:
    """
    既存のフロントマターからメタデータを抽出
    Returns: metadata_dict or None if no frontmatter found
    """
    lines = text.split('\n')
    if not lines or not lines[0].strip() == '---':
        return None
    
    # 2つ目の --- を探す
    end_idx = -1
    for i in range(1, len(lines)):
        if lines[i].strip() == '---':
            end_idx = i
            break
    
    if end_idx == -1:
        return None
    
    # フロントマター部分を解析（簡易的なYAMLパース）
    metadata = {}
    frontmatter_lines = lines[1:end_idx]
    
    i = 0
    while i < len(frontmatter_lines):
        line = frontmatter_lines[i]
        
        # title:, author:などの形式
        if ':' in line and not line.startswith(' '):
            key, _, value = line.partition(':')
            key = key.strip()
            value = value.strip()
            
            if value:  # 値が同じ行にある
                metadata[key] = value
            elif key in ('authors', 'translators'):  # 配列の場合
                arr = []
                i += 1
                while i < len(frontmatter_lines):
                    next_line = frontmatter_lines[i]
                    if next_line.startswith('  - '):
                        arr.append(next_line[4:].strip())
                        i += 1
                    else:
                        i -= 1
                        break
                metadata[key] = arr
        i += 1
    
    return metadata if metadata else None

def sanitize_filename(name: str, max_length: int = 100) -> str:
    """
    ファイル名/フォルダ名として使えない文字を除去・置換
    """
    if not name:
        return "untitled"
    
    # Windowsで使えない文字を置換
    invalid_chars = ['/', '\\', ':', '*', '?', '"', '<', '>', '|']
    for char in invalid_chars:
        name = name.replace(char, '_')
    
    # 制御文字を除去
    name = ''.join(c for c in name if ord(c) >= 32)
    
    # 前後の空白・ピリオドを除去（Windowsでは問題になる）
    name = name.strip().strip('.')
    
    # 長すぎる場合は切り詰め
    if len(name) > max_length:
        name = name[:max_length].rstrip()
    
    return name if name else "untitled"

def reconstruct_header_from_metadata(metadata: dict) -> str:
    """
    メタデータから青空文庫形式のヘッダーを再構築
    末尾に空行を含む（本文との区切りのため）
    """
    lines = []
    
    if 'title' in metadata:
        lines.append(metadata['title'])
    
    # raw_headerがあればそれを追加
    if 'raw_header' in metadata:
        lines.append(metadata['raw_header'])
    
    # authorsまたはauthor
    if 'authors' in metadata:
        for author in metadata['authors']:
            lines.append(author)
    elif 'author' in metadata:
        lines.append(metadata['author'])
    
    # translatorsまたはtranslator
    if 'translators' in metadata:
        for translator in metadata['translators']:
            lines.append(translator)
    elif 'translator' in metadata:
        lines.append(metadata['translator'])
    
    # ヘッダーの末尾に空行を追加（本文との区切り）
    return '\n'.join(lines) + '\n\n' if lines else ''

def get_metadata_from_text(text: str) -> dict:
    """
    テキストからメタデータを取得（フロントマターまたは青空文庫ヘッダー）
    Returns: {'title': str, 'author': str, 'authors': list[str]}
    """
    # まずフロントマターをチェック
    fm_metadata = extract_frontmatter_metadata(text)
    
    if fm_metadata:
        # フロントマターから取得
        result = {}
        
        if 'title' in fm_metadata:
            result['title'] = fm_metadata['title']
        
        # author/authorsの処理
        if 'authors' in fm_metadata:
            result['authors'] = fm_metadata['authors']
            result['author'] = fm_metadata['authors'][0]  # 最初の著者を代表として
        elif 'author' in fm_metadata:
            result['author'] = fm_metadata['author']
        
        return result
    else:
        # 青空文庫ヘッダーから取得
        metadata, _ = parse_aozora_header(text)
        
        result = {}
        if 'title' in metadata:
            result['title'] = metadata['title']
        
        # author/authorsの処理
        if 'authors' in metadata:
            result['authors'] = metadata['authors']
            result['author'] = metadata['authors'][0]  # 最初の著者を代表として
        elif 'author' in metadata:
            result['author'] = metadata['author']
        
        return result

@dataclass
class Options:
    convert_utf8: bool = True
    rename_to_md: bool = True
    process_loose_txt: bool = True     # also process standalone .txt in input
    add_frontmatter: bool = True       # add YAML frontmatter with metadata (only for .md)
    remove_annotations: bool = True    # remove ----- enclosed annotations
    remove_aozora_footer: bool = True  # 末尾の底本・作成ファイル情報を削除
    add_header_to_body: bool = False   # add header info to body start (restore from frontmatter if missing)
    organize_by_author: bool = False   # organize files into author/title.md structure
    bouten_char: str = DEFAULT_BOUTEN_CHAR  # Nyoze 傍点ルビに使う記号
    convert_nyoze_indent: bool = False  # 青空字下げを :::indent-N へ
    preserve_aozora_indent_notes: bool = False  # 変換後も元の字下げ注記を残す
    convert_nyoze_align_end: bool = False  # 青空地付きを :::align-end へ
    approximate_aozora_jiage_as_align_end: bool = False  # 地からN字上げも地付きとして近似
    preserve_aozora_align_notes: bool = False  # 変換後も元の地付き・地寄せ注記を残す
    convert_nyoze_page_break: bool = False  # 青空改ページを :::page-break / :::blank-page へ
    approximate_aozora_spread_breaks: bool = False  # 改丁・改見開きも改ページとして近似
    preserve_aozora_page_break_notes: bool = False  # 変換後も元のページ送り注記を残す
    convert_markdown_emphasis: bool = True  # 太字・斜体を ** / * へ
    convert_aozora_underline: bool = True  # 傍線を || || または <u> へ
    underline_output_format: str = UNDERLINE_FORMAT_NYOZE
    approximate_other_underline_styles: bool = False  # 二重傍線・鎖線・破線・波線を近似
    approximate_left_underline: bool = False  # 左側傍線を近似

@dataclass
class JobStats:
    zips_found: int = 0
    zips_processed: int = 0
    files_converted: int = 0
    files_skipped: int = 0
    errors: int = 0
    files_with_remaining_notes: int = 0
    remaining_notes: int = 0

# -------------------- Worker Thread --------------------

class Worker(QObject):
    progress = Signal(int, int)  # current, total
    log = Signal(str)
    finished = Signal(JobStats)

    def __init__(self, input_path: Path, out_dir: Optional[Path], opts: Options):
        super().__init__()
        self.input_path = input_path
        self.out_dir = out_dir
        self.opts = opts
        self._stop = False

    def stop(self):
        self._stop = True

    def run(self):
        stats = JobStats()
        try:
            if self.input_path.is_dir():
                self._run_directory(stats)
            elif self.input_path.is_file():
                self._run_single_file(stats)
            else:
                stats.errors += 1
                self.log.emit("[ERROR] 対応している入力はフォルダ、.zip、.txt、.mdです。")
        except Exception as e:
            stats.errors += 1
            self.log.emit(f"[ERROR] {e}")
        finally:
            self.finished.emit(stats)

    def _run_directory(self, stats: JobStats):
        all_zips = list(self.input_path.rglob('*.zip'))
        stats.zips_found = len(all_zips)

        # Process loose .txt and .md files
        # 前回このツールが作った _converted 系は再処理しない（増殖防止）
        loose_files = []
        skipped_converted = 0
        if self.opts.process_loose_txt:
            for p in list(self.input_path.rglob('*.txt')) + list(self.input_path.rglob('*.md')):
                if is_tool_generated_output(p):
                    skipped_converted += 1
                    continue
                loose_files.append(p)
        if skipped_converted:
            self.log.emit(f"[INFO] 前回の変換結果 (_converted) を {skipped_converted} 件スキップ")

        total_steps = len(all_zips) + len(loose_files)
        step = 0
        self.progress.emit(step, max(1, total_steps))

        # Process ZIPs
        for zpath in all_zips:
            if self._stop: break
            step += 1
            self.progress.emit(step, total_steps)
            self._process_zip(zpath, stats)

        # Process loose text files (.txt and .md)
        for tpath in loose_files:
            if self._stop: break
            step += 1
            self.progress.emit(step, total_steps)
            self._process_text_file(tpath, stats, base_output=None, extracted=False)

    def _run_single_file(self, stats: JobStats):
        suffix = self.input_path.suffix.lower()
        self.progress.emit(0, 1)
        if self._stop:
            return
        self.progress.emit(1, 1)

        if suffix == '.zip':
            stats.zips_found = 1
            self._process_zip(self.input_path, stats)
        elif suffix in TEXT_EXTS:
            # ユーザーが明示選択した TXT/MD は process_loose_txt に関わらず処理する
            self._process_text_file(
                self.input_path, stats, base_output=None, extracted=False
            )
        else:
            stats.errors += 1
            self.log.emit("[ERROR] 対応している入力はフォルダ、.zip、.txt、.mdです。")

    def _process_zip(self, zpath: Path, stats: JobStats):
        target_root = self.out_dir if self.out_dir else zpath.parent
        self.log.emit(f"→ Extracting: {zpath}")

        # ユーザーフォルダ内の固定名は使わない。システム一時ディレクトリへ一意に展開する。
        try:
            with zipfile.ZipFile(zpath, 'r') as zf:
                infos = zf.infolist()
                with tempfile.TemporaryDirectory(prefix="aozora_zip_") as tmp:
                    temp_extraction = Path(tmp)
                    zf.extractall(temp_extraction)
                    stats.zips_processed += 1
                    for info in infos:
                        if info.is_dir():
                            continue
                        extracted_path = temp_extraction / Path(info.filename)
                        if extracted_path.is_file() and extracted_path.suffix.lower() in TEXT_EXTS:
                            self._process_text_file(
                                extracted_path, stats, base_output=target_root, extracted=True
                            )
        except Exception as e:
            stats.errors += 1
            self.log.emit(f"[ERROR] Failed to extract {zpath}: {e}")
            return

    def _process_text_file(self, tpath: Path, stats: JobStats, base_output: Optional[Path], extracted: bool):
        if base_output is None:
            rel = tpath.name
        else:
            try:
                rel = tpath.relative_to(base_output)
            except ValueError:
                rel = tpath.name
        self.log.emit(f"   • Processing text: {rel}")

        # Read content (always needed for .md files or organize_by_author)
        text, enc = detect_and_read_text(tpath)
        if text is None:
            stats.errors += 1
            self.log.emit(f"     [ERROR] Cannot decode: {tpath}")
            return

        # 外字Unicode化はメタデータ解析・ファイル名生成の前に行う
        text, gaiji_converted, gaiji_unconverted = convert_aozora_gaiji(text)

        # Determine target extension
        is_txt = tpath.suffix.lower() == '.txt'
        is_md = tpath.suffix.lower() == '.md'
        will_convert_to_md = is_txt and self.opts.rename_to_md
        target_extension = '.md' if will_convert_to_md else tpath.suffix

        # 見出し・傍点は .md 出力時のみ（外字変換の直後）
        # 傍点を先に処理し、見出し注記と隣接していても本文側を壊さない
        heading_converted = 0
        heading_unsupported = 0
        bouten_converted = 0
        bouten_unconverted = 0
        indent_converted = 0
        indent_unconverted = 0
        align_converted = 0
        align_approximated = 0
        align_unconverted = 0
        page_break_converted = 0
        blank_page_converted = 0
        spread_approximated = 0
        page_unconverted = 0
        kaidan_unconverted = 0
        emph_bold = 0
        emph_italic = 0
        emph_both = 0
        emph_unconverted = 0
        ul_converted = 0
        ul_approximated = 0
        ul_unconverted = 0
        if is_md or will_convert_to_md:
            if self.opts.convert_markdown_emphasis:
                text, emph_bold, emph_italic, emph_both, emph_unconverted = (
                    convert_aozora_markdown_emphasis(text)
                )
            if self.opts.convert_aozora_underline:
                text, ul_converted, ul_approximated, ul_unconverted = convert_aozora_underline(
                    text,
                    output_format=self.opts.underline_output_format,
                    approximate_other_styles=self.opts.approximate_other_underline_styles,
                    approximate_left=self.opts.approximate_left_underline,
                )
            text, bouten_converted, bouten_unconverted = convert_aozora_bouten(
                text, self.opts.bouten_char
            )
            text, heading_converted, heading_unsupported = convert_aozora_headings(text)
            if self.opts.convert_nyoze_indent:
                text, indent_converted, indent_unconverted = convert_aozora_indent(
                    text,
                    preserve_notes=self.opts.preserve_aozora_indent_notes,
                )
            if self.opts.convert_nyoze_align_end:
                text, align_converted, align_approximated, align_unconverted = convert_aozora_align_end(
                    text,
                    approximate_jiage=self.opts.approximate_aozora_jiage_as_align_end,
                    preserve_notes=self.opts.preserve_aozora_align_notes,
                )
            if self.opts.convert_nyoze_page_break:
                (
                    text,
                    page_break_converted,
                    blank_page_converted,
                    spread_approximated,
                    page_unconverted,
                    kaidan_unconverted,
                ) = convert_aozora_page_breaks(
                    text,
                    approximate_spread_breaks=self.opts.approximate_aozora_spread_breaks,
                    preserve_notes=self.opts.preserve_aozora_page_break_notes,
                )
        
        # Determine base output directory and filename
        if self.opts.organize_by_author:
            # Get metadata to organize by author/title
            try:
                metadata = get_metadata_from_text(text)
                author = metadata.get('author', 'unknown_author')
                title = metadata.get('title', tpath.stem)
                
                # Sanitize names
                author_folder = sanitize_filename(author)
                title_filename = sanitize_filename(title)
                
                # Determine base output directory
                output_base = base_output if base_output else (self.out_dir if self.out_dir else tpath.parent)
                
                # Create author/title.ext structure
                target_path = output_base / author_folder / (title_filename + target_extension)

                # 既に author/title の場所にある場合は、author フォルダを入れ子にしない。
                # 入力元の上書きは unique_output_path() 側で避ける。
                try:
                    if (tpath.parent.name == author_folder and
                        tpath.stem == title_filename):
                        target_path = tpath.parent / (title_filename + target_extension)
                        self.log.emit("     [Already organized in author folder]")
                except Exception:
                    pass

                if not is_same_file(target_path, tpath):
                    self.log.emit(f"     → {author_folder}/{title_filename}{target_extension}")
            except Exception as e:
                # If metadata extraction fails, fall back to normal path
                self.log.emit(f"     [WARN] Could not extract metadata: {e}")
                output_base = base_output if base_output else (self.out_dir if self.out_dir else tpath.parent)
                target_path = output_base / (tpath.stem + target_extension)
        else:
            # Normal path (no organization)
            output_base = base_output if base_output else (self.out_dir if self.out_dir else tpath.parent)
            if will_convert_to_md:
                target_path = output_base / (tpath.stem + target_extension)
            else:
                target_path = output_base / tpath.name

        # Process text content
        processed_text = text
        processing_log = []

        if gaiji_converted:
            processing_log.append(f"外字Unicode化: {gaiji_converted}件")
        if emph_bold:
            processing_log.append(f"Markdown太字変換: {emph_bold}件")
        if emph_italic:
            processing_log.append(f"Markdown斜体変換: {emph_italic}件")
        if emph_both:
            processing_log.append(f"Markdown太字＋斜体変換: {emph_both}件")
        if emph_unconverted:
            processing_log.append(f"太字・斜体未変換: {emph_unconverted}件")
        if ul_converted:
            processing_log.append(f"下線変換: {ul_converted}件")
        if ul_approximated:
            processing_log.append(f"傍線→下線近似: {ul_approximated}件")
        if ul_unconverted:
            processing_log.append(f"傍線未変換: {ul_unconverted}件")
        if heading_converted:
            processing_log.append(f"見出しMarkdown化: {heading_converted}件")
        if heading_unsupported:
            processing_log.append(f"未対応見出し: {heading_unsupported}件")
        if bouten_converted:
            processing_log.append(f"傍点変換: {bouten_converted}件")
        if bouten_unconverted:
            processing_log.append(f"傍点未変換: {bouten_unconverted}件")
        if indent_converted:
            processing_log.append(f"Nyoze字下げ変換: {indent_converted}件")
        if indent_unconverted:
            processing_log.append(f"字下げ未変換: {indent_unconverted}件")
        if align_converted:
            processing_log.append(f"Nyoze地付き変換: {align_converted}件")
        if align_approximated:
            processing_log.append(f"地寄せ→地付き近似: {align_approximated}件")
        if align_unconverted:
            processing_log.append(f"地付き・地寄せ未変換: {align_unconverted}件")
        if page_break_converted:
            processing_log.append(f"Nyoze改ページ変換: {page_break_converted}件")
        if blank_page_converted:
            processing_log.append(f"Nyoze空白ページ変換: {blank_page_converted}件")
        if spread_approximated:
            processing_log.append(f"改丁・改見開き→改ページ近似: {spread_approximated}件")
        if page_unconverted:
            processing_log.append(f"ページ送り未変換: {page_unconverted}件")
        if kaidan_unconverted:
            processing_log.append(f"改段未変換: {kaidan_unconverted}件")

        if self.opts.remove_aozora_footer:
            processed_text, footer_removed = remove_aozora_footer_metadata(processed_text)
            if footer_removed:
                processing_log.append("末尾書誌情報削除")

        # Remove annotations if requested
        if self.opts.remove_annotations:
            processed_text = remove_aozora_annotations(processed_text)
            processing_log.append("注釈削除")
        
        # フロントマター処理
        has_frontmatter = extract_frontmatter_metadata(processed_text) is not None
        
        if is_md or will_convert_to_md:
            # .mdファイルまたは.md変換する場合
            if has_frontmatter:
                # 既にフロントマターがある
                if self.opts.add_header_to_body:
                    # ヘッダー情報を本文に追加するオプションがON
                    fm_metadata = extract_frontmatter_metadata(processed_text)
                    if fm_metadata:
                        # フロントマターの後の本文を取得
                        lines = processed_text.split('\n')
                        end_idx = -1
                        for i in range(1, len(lines)):
                            if lines[i].strip() == '---':
                                end_idx = i
                                break
                        
                        if end_idx != -1:
                            body = '\n'.join(lines[end_idx + 1:]).lstrip('\n')
                            
                            # 本文にヘッダーがあるかチェック
                            # フロントマターのタイトルが本文先頭にあるかで判定
                            title = fm_metadata.get('title', '')
                            has_header_in_body = False
                            
                            if title:
                                # タイトルが本文の最初の方（最初の10行以内）にあるかチェック
                                body_lines = body.split('\n')
                                for i, line in enumerate(body_lines[:10]):
                                    if line.strip() == title:
                                        has_header_in_body = True
                                        break
                            
                            if not has_header_in_body:
                                # 本文にヘッダーがないので、フロントマターから復元
                                header = reconstruct_header_from_metadata(fm_metadata)
                                frontmatter_str = '\n'.join(lines[:end_idx + 1])
                                processed_text = frontmatter_str + '\n' + header + body
                                processing_log.append("ヘッダー復元")
            else:
                # フロントマターがない場合
                # .txt→.md変換、または既存.mdでフロントマター追加オプションONの場合
                if (will_convert_to_md or is_md) and self.opts.add_frontmatter:
                    # 青空文庫ヘッダーを解析
                    metadata, body = parse_aozora_header(processed_text)
                    if metadata:
                        frontmatter = create_frontmatter(metadata)
                        if self.opts.add_header_to_body:
                            # ヘッダー情報を本文に残す
                            processed_text = frontmatter + '\n' + processed_text
                            processing_log.append("フロントマター追加")
                        else:
                            # ヘッダー情報を本文から削除
                            processed_text = frontmatter + '\n' + body
                            processing_log.append("フロントマター追加+ヘッダー削除")
        
        remaining_in_file = []
        if is_md or will_convert_to_md:
            remaining_in_file = scan_remaining_aozora_notes(processed_text)
            processed_text = strip_preserved_aozora_note_markers(processed_text)
            if remaining_in_file:
                stats.files_with_remaining_notes += 1
                stats.remaining_notes += len(remaining_in_file)

        # ファイルを書き込む必要があるか判定
        # - convert_utf8がON
        # - .mdファイル（再処理）
        # - 出力先が入力元と異なる（著者別整理・出力フォルダなど）
        # - 何らかの変換が行われた
        need_write = (
            self.opts.convert_utf8 or
            is_md or
            processing_log or
            not is_same_file(target_path, tpath)
        )

        if need_write:
            try:
                # 入力元は削除も上書きもしない。同じパスになる場合はファイル名を変える。
                target_path = unique_output_path(target_path, tpath)
                write_utf8_text(target_path, processed_text)

                stats.files_converted += 1

                log_msg = f"     [OK]"
                if self.opts.convert_utf8:
                    log_msg += f" {enc} → UTF-8"
                if will_convert_to_md:
                    log_msg += " & .md"
                if target_path.stem != tpath.stem:
                    log_msg += f" → {target_path.name}"
                elif target_path.parent != tpath.parent:
                    log_msg += f" → {target_path}"
                log_parts = list(processing_log)
                if gaiji_unconverted:
                    log_parts.append(f"外字未変換: {gaiji_unconverted}件")
                if log_parts:
                    log_msg += f" ({', '.join(log_parts)})"
                self.log.emit(log_msg)
                for warn_line in format_remaining_aozora_note_log_lines(
                    target_path.name, remaining_in_file
                ):
                    self.log.emit('     ' + warn_line)
            except Exception as e:
                stats.errors += 1
                self.log.emit(f"     [ERROR] Write failed: {e}")
        else:
            stats.files_skipped += 1
            if gaiji_unconverted:
                self.log.emit(f"     [SKIP] No change (外字未変換: {gaiji_unconverted}件)")
            else:
                self.log.emit("     [SKIP] No change")

# -------------------- GUI --------------------

class MainWindow(QWidget):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Aozora ZIP Batch Converter (Obsidian-ready)")
        self.resize(920, 600)

        self.input_edit = QLineEdit()
        self.output_edit = QLineEdit()

        self.btn_browse_in_file = QPushButton("入力ファイルを選択…")
        self.btn_browse_in_dir = QPushButton("入力フォルダを選択…")
        self.btn_browse_out = QPushButton("出力フォルダを選択…")
        self.btn_start = QPushButton("実行")
        self.btn_stop = QPushButton("停止")
        self.btn_stop.setEnabled(False)

        self.chk_utf8 = QCheckBox("UTF-8 に変換（推奨）")
        self.chk_utf8.setChecked(True)
        self.chk_md = QCheckBox(".txt を .md に変更（推奨）")
        self.chk_md.setChecked(True)
        self.cmb_bouten = QComboBox()
        for value, label in BOUTEN_CHAR_CHOICES:
            self.cmb_bouten.addItem(label, value)
        self.cmb_bouten.setCurrentIndex(0)
        self.chk_loose = QCheckBox("ZIP外の .txt/.md も処理する")
        self.chk_loose.setChecked(True)
        self.chk_frontmatter = QCheckBox("  ├ フロントマターを追加")
        self.chk_frontmatter.setChecked(True)
        self.chk_add_header = QCheckBox("    └ ヘッダー情報を本文先頭に追加")
        self.chk_add_header.setChecked(False)
        self.chk_remove_annot = QCheckBox("定型注釈を削除（-----で囲まれた部分）")
        self.chk_remove_annot.setChecked(True)
        self.chk_remove_footer = QCheckBox("末尾の青空文庫書誌・作成情報を削除")
        self.chk_remove_footer.setChecked(True)
        self.chk_emphasis = QCheckBox("太字・斜体をMarkdownに変換")
        self.chk_emphasis.setChecked(True)
        self.chk_underline = QCheckBox("傍線を下線に変換")
        self.chk_underline.setChecked(True)
        self.cmb_underline = QComboBox()
        for value, label in UNDERLINE_FORMAT_CHOICES:
            self.cmb_underline.addItem(label, value)
        self.cmb_underline.setCurrentIndex(0)
        self.chk_approx_ul_style = QCheckBox("    ├ 二重傍線・鎖線・破線・波線も通常の下線として近似")
        self.chk_approx_ul_style.setChecked(False)
        self.chk_approx_ul_left = QCheckBox("    └ 左側の傍線も通常の下線として近似")
        self.chk_approx_ul_left.setChecked(False)
        self.chk_organize = QCheckBox("著者別フォルダに整理（author/title.ext）")
        self.chk_organize.setChecked(False)
        self.chk_nyoze_indent = QCheckBox("Nyoze字下げ形式に変換")
        self.chk_nyoze_indent.setChecked(False)
        self.chk_preserve_indent = QCheckBox("    └ 元の青空文庫字下げ注記を残す")
        self.chk_preserve_indent.setChecked(False)
        self.chk_nyoze_align = QCheckBox("Nyoze地付き形式に変換")
        self.chk_nyoze_align.setChecked(False)
        self.chk_approx_jiage = QCheckBox("    ├ 「地からN字上げ」も地付きとして近似変換")
        self.chk_approx_jiage.setChecked(False)
        self.chk_preserve_align = QCheckBox("    └ 元の青空文庫地付き・地寄せ注記を残す")
        self.chk_preserve_align.setChecked(False)
        self.chk_nyoze_page = QCheckBox("Nyoze改ページ形式に変換")
        self.chk_nyoze_page.setChecked(False)
        self.chk_approx_spread = QCheckBox("    ├ 改丁・改見開きも改ページとして近似変換")
        self.chk_approx_spread.setChecked(False)
        self.chk_preserve_page = QCheckBox("    └ 元の青空文庫ページ送り注記を残す")
        self.chk_preserve_page.setChecked(False)

        self.progress = QProgressBar()
        self.log = QTextEdit()
        self.log.setReadOnly(True)

        # Layouts
        form = QFormLayout()
        form.addRow(
            "入力:",
            self._with_browse(self.input_edit, self.btn_browse_in_file, self.btn_browse_in_dir),
        )
        form.addRow("出力フォルダ（空なら入力と同じ）:", self._with_browse(self.output_edit, self.btn_browse_out))

        opts_box = QGroupBox("オプション")
        opts_layout = QVBoxLayout()
        opts_layout.addWidget(self.chk_utf8)
        opts_layout.addWidget(self.chk_md)
        bouten_row = QWidget()
        bouten_layout = QHBoxLayout(bouten_row)
        bouten_layout.setContentsMargins(20, 0, 0, 0)
        bouten_layout.addWidget(QLabel("傍点記号:"))
        bouten_layout.addWidget(self.cmb_bouten)
        bouten_layout.addStretch()
        opts_layout.addWidget(bouten_row)
        opts_layout.addWidget(self.chk_frontmatter)
        opts_layout.addWidget(self.chk_add_header)
        opts_layout.addWidget(self.chk_remove_annot)
        opts_layout.addWidget(self.chk_remove_footer)
        opts_layout.addWidget(self.chk_emphasis)
        opts_layout.addWidget(self.chk_underline)
        underline_row = QWidget()
        underline_layout = QHBoxLayout(underline_row)
        underline_layout.setContentsMargins(20, 0, 0, 0)
        underline_layout.addWidget(QLabel("出力形式:"))
        underline_layout.addWidget(self.cmb_underline)
        underline_layout.addStretch()
        self.underline_format_row = underline_row
        opts_layout.addWidget(underline_row)
        opts_layout.addWidget(self.chk_approx_ul_style)
        opts_layout.addWidget(self.chk_approx_ul_left)
        opts_layout.addWidget(self.chk_organize)
        opts_layout.addWidget(self.chk_nyoze_indent)
        opts_layout.addWidget(self.chk_preserve_indent)
        opts_layout.addWidget(self.chk_nyoze_align)
        opts_layout.addWidget(self.chk_approx_jiage)
        opts_layout.addWidget(self.chk_preserve_align)
        opts_layout.addWidget(self.chk_nyoze_page)
        opts_layout.addWidget(self.chk_approx_spread)
        opts_layout.addWidget(self.chk_preserve_page)
        opts_layout.addWidget(self.chk_loose)
        opts_box.setLayout(opts_layout)

        ctl = QHBoxLayout()
        ctl.addWidget(self.btn_start)
        ctl.addWidget(self.btn_stop)

        root = QVBoxLayout(self)
        root.addLayout(form)
        root.addWidget(opts_box)
        root.addLayout(ctl)
        root.addWidget(self.progress)
        root.addWidget(QLabel("ログ"))
        root.addWidget(self.log)

        # Signals
        self.btn_browse_in_file.clicked.connect(self.choose_input_file)
        self.btn_browse_in_dir.clicked.connect(self.choose_input_dir)
        self.btn_browse_out.clicked.connect(self.choose_output)
        self.btn_start.clicked.connect(self.start_work)
        self.btn_stop.clicked.connect(self.stop_work)
        
        # チェックボックスの連動
        self.chk_md.stateChanged.connect(self.update_checkbox_states)
        self.chk_frontmatter.stateChanged.connect(self.update_checkbox_states)
        self.chk_nyoze_indent.stateChanged.connect(self.update_checkbox_states)
        self.chk_nyoze_align.stateChanged.connect(self.update_checkbox_states)
        self.chk_nyoze_page.stateChanged.connect(self.update_checkbox_states)
        self.chk_underline.stateChanged.connect(self.update_checkbox_states)
        
        # 初期状態を設定
        self.update_checkbox_states()

        self.thread: Optional[QThread] = None
        self.worker: Optional[Worker] = None

    def _with_browse(self, edit: QLineEdit, *buttons: QPushButton) -> QWidget:
        w = QWidget()
        h = QHBoxLayout(w)
        h.setContentsMargins(0, 0, 0, 0)
        h.addWidget(edit, 1)
        for btn in buttons:
            h.addWidget(btn)
        return w

    def choose_input_file(self):
        start = self.input_edit.text().strip()
        path, _ = QFileDialog.getOpenFileName(
            self,
            "入力ファイルを選択",
            start,
            "青空文庫 (*.zip *.txt *.md);;ZIP (*.zip);;テキスト (*.txt);;Markdown (*.md);;すべてのファイル (*)",
        )
        if path:
            self.input_edit.setText(path)

    def choose_input_dir(self):
        start = self.input_edit.text().strip()
        d = QFileDialog.getExistingDirectory(self, "入力フォルダを選択", start)
        if d:
            self.input_edit.setText(d)

    def choose_output(self):
        d = QFileDialog.getExistingDirectory(self, "出力フォルダを選択")
        if d:
            self.output_edit.setText(d)
    
    def update_checkbox_states(self):
        """チェックボックスの有効/無効を連動させる"""
        # .md変換がOFFなら、フロントマター追加は無効
        md_enabled = self.chk_md.isChecked()
        self.chk_frontmatter.setEnabled(md_enabled)
        
        # フロントマター追加がOFFなら、ヘッダー追加は無効
        frontmatter_enabled = self.chk_frontmatter.isChecked() and md_enabled
        self.chk_add_header.setEnabled(frontmatter_enabled)

        indent_on = self.chk_nyoze_indent.isChecked()
        self.chk_preserve_indent.setEnabled(indent_on)

        align_on = self.chk_nyoze_align.isChecked()
        self.chk_approx_jiage.setEnabled(align_on)
        self.chk_preserve_align.setEnabled(align_on)

        page_on = self.chk_nyoze_page.isChecked()
        self.chk_approx_spread.setEnabled(page_on)
        self.chk_preserve_page.setEnabled(page_on)

        underline_on = self.chk_underline.isChecked()
        self.cmb_underline.setEnabled(underline_on)
        self.underline_format_row.setEnabled(underline_on)
        self.chk_approx_ul_style.setEnabled(underline_on)
        self.chk_approx_ul_left.setEnabled(underline_on)

    def start_work(self):
        raw_in = self.input_edit.text().strip()
        if not raw_in:
            QMessageBox.warning(self, "エラー", "有効な入力フォルダまたはファイルを選択してください。")
            return
        input_path = Path(raw_in)
        err = validate_input_path(input_path)
        if err:
            QMessageBox.warning(self, "エラー", err)
            return
        out_dir = Path(self.output_edit.text().strip()) if self.output_edit.text().strip() else None
        opts = Options(
            convert_utf8=self.chk_utf8.isChecked(),
            rename_to_md=self.chk_md.isChecked(),
            process_loose_txt=self.chk_loose.isChecked(),
            add_frontmatter=self.chk_frontmatter.isChecked(),
            remove_annotations=self.chk_remove_annot.isChecked(),
            remove_aozora_footer=self.chk_remove_footer.isChecked(),
            add_header_to_body=self.chk_add_header.isChecked(),
            organize_by_author=self.chk_organize.isChecked(),
            bouten_char=self.cmb_bouten.currentData() or DEFAULT_BOUTEN_CHAR,
            convert_nyoze_indent=self.chk_nyoze_indent.isChecked(),
            preserve_aozora_indent_notes=self.chk_preserve_indent.isChecked(),
            convert_nyoze_align_end=self.chk_nyoze_align.isChecked(),
            approximate_aozora_jiage_as_align_end=self.chk_approx_jiage.isChecked(),
            preserve_aozora_align_notes=self.chk_preserve_align.isChecked(),
            convert_nyoze_page_break=self.chk_nyoze_page.isChecked(),
            approximate_aozora_spread_breaks=self.chk_approx_spread.isChecked(),
            preserve_aozora_page_break_notes=self.chk_preserve_page.isChecked(),
            convert_markdown_emphasis=self.chk_emphasis.isChecked(),
            convert_aozora_underline=self.chk_underline.isChecked(),
            underline_output_format=self.cmb_underline.currentData() or UNDERLINE_FORMAT_NYOZE,
            approximate_other_underline_styles=self.chk_approx_ul_style.isChecked(),
            approximate_left_underline=self.chk_approx_ul_left.isChecked(),
        )

        self.log.clear()
        self.progress.setValue(0)
        self.btn_start.setEnabled(False)
        self.btn_stop.setEnabled(True)

        self.thread = QThread()
        self.worker = Worker(input_path, out_dir, opts)
        self.worker.moveToThread(self.thread)

        self.thread.started.connect(self.worker.run)
        self.worker.progress.connect(self.on_progress)
        self.worker.log.connect(self.append_log)
        self.worker.finished.connect(self.on_finished)
        self.worker.finished.connect(self.thread.quit)
        self.worker.finished.connect(self.worker.deleteLater)
        self.thread.finished.connect(self.thread.deleteLater)

        self.thread.start()

    def stop_work(self):
        if self.worker:
            self.worker.stop()
            self.append_log("[INFO] 停止要求を送信しました。")

    def on_progress(self, cur: int, total: int):
        if total <= 0:
            self.progress.setRange(0, 0)  # busy
        else:
            self.progress.setRange(0, total)
            self.progress.setValue(cur)

    def append_log(self, text: str):
        self.log.append(text)

    def on_finished(self, stats: JobStats):
        self.btn_start.setEnabled(True)
        self.btn_stop.setEnabled(False)
        summary = (
            f"処理完了:\n"
            f"  ZIP検出: {stats.zips_found}\n"
            f"  ZIP展開: {stats.zips_processed}\n"
            f"  変換数: {stats.files_converted}\n"
            f"  スキップ: {stats.files_skipped}\n"
            f"  エラー: {stats.errors}\n"
        )
        if stats.remaining_notes:
            summary += (
                f"  未変換注記あり: {stats.files_with_remaining_notes}ファイル\n"
                f"  未変換注記総数: {stats.remaining_notes}件\n"
                f"\n"
                f"処理は完了しましたが、未変換の青空文庫注記が残っています。\n"
                f"\n"
                f"該当ファイル: {stats.files_with_remaining_notes}\n"
                f"未変換注記: {stats.remaining_notes}件\n"
                f"\n"
                f"詳細はログを確認してください。"
            )
            self.append_log("\n" + summary)
            QMessageBox.warning(self, "完了", summary)
        else:
            summary += "  未変換注記: 0件"
            self.append_log("\n" + summary)
            QMessageBox.information(self, "完了", summary)

def main():
    app = QApplication(sys.argv)
    w = MainWindow()
    w.show()
    sys.exit(app.exec())

if __name__ == "__main__":
    main()
