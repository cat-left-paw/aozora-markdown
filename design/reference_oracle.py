#!/usr/bin/env python3
"""Design-time oracle. Executes the unchanged reference; no TS implementation.

The AST loader omits only Qt imports, GUI class, and GUI entrypoint. Worker is
executed unchanged with in-memory read/write and signal substitutes. Byte decode
and path probes use disposable temporary directories. See README.md for scope.
"""
import argparse
import ast
import dataclasses
import gzip
import hashlib
import json
from pathlib import Path
import platform
import re
import sys
import tempfile
import types

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'aozora_zip_batch_gui.py'
SHA256 = '4c45c5e777718e88815117e49db85ccb13e1dd4e35eba858e3eae958bd2f2cc0'


def load_reference():
    raw = SOURCE.read_bytes()
    if hashlib.sha256(raw).hexdigest() != SHA256:
        raise RuntimeError('Reference changed; review changes before updating oracle pin')
    tree = ast.parse(raw, filename=str(SOURCE))
    tree.body = [node for node in tree.body if not (
        isinstance(node, ast.ImportFrom) and (node.module or '').startswith('PySide6')
        or isinstance(node, (ast.FunctionDef, ast.ClassDef)) and node.name in ('MainWindow', 'main')
        or isinstance(node, ast.If) and ast.unparse(node.test) == "__name__ == '__main__'"
    )]
    module = types.ModuleType('aozora_reference_oracle')
    sys.modules[module.__name__] = module
    module.QObject = object
    module.Signal = lambda *args: None
    exec(compile(tree, str(SOURCE), 'exec'), module.__dict__)
    return module


def plain(value):
    if dataclasses.is_dataclass(value):
        return plain(dataclasses.asdict(value))
    if isinstance(value, dict):
        return {key: plain(val) for key, val in value.items()}
    if isinstance(value, (list, tuple)):
        return [plain(val) for val in value]
    return value


FIELDS = {
    'convert_aozora_gaiji': ['converted', 'unconverted'],
    'convert_aozora_markdown_emphasis': ['bold', 'italic', 'both', 'unconverted'],
    'convert_aozora_underline': ['converted', 'approximated', 'unconverted'],
    'convert_aozora_bouten': ['converted', 'unconverted'],
    'convert_aozora_headings': ['converted', 'unsupported'],
    'convert_aozora_indent': ['converted', 'unconverted'],
    'convert_aozora_align_end': ['converted', 'approximated', 'unconverted'],
    'convert_aozora_page_breaks': ['pageBreaks', 'blankPages', 'spreadApproximated', 'unconverted', 'kaidanUnconverted'],
    'remove_aozora_footer_metadata': ['removed'],
}


def make_units(m):
    cases = []

    def add(id, fn, value, **options):
        try:
            result = getattr(m, fn)(value, **options)
            expected = {'return': plain(result), 'warnings': []}
            if fn in FIELDS:
                expected['output'] = result[0]
                expected['stats'] = dict(zip(FIELDS[fn], result[1:]))
        except Exception as exc:
            expected = {'exception': type(exc).__name__, 'message': str(exc)}
        cases.append({'id': id, 'function': fn, 'input': value, 'options': options, 'expected': expected})

    gaiji = {
        'uplus': '※［＃U+546D］', 'plane1': '※［＃第3水準1-84-77、2-3］',
        'plane2': '※［＃第4水準2-12-11］', 'bare': '※［＃1-13-21］',
        'fullwidth': '※［＃第３水準１－８４－７７］', 'supplementary': '※［＃u+20000］',
        'unknown': '※［＃未知の字］', 'invalid-preferred-fallback': '※［＃U+0000、第3水準1-84-77］',
        'invalid-specific-no-bare-retry': '※［＃第3水準3-1-1、1-13-21］',
        'first-uplus-only': '※［＃U+0000 U+0041］', 'hex-boundary': '※［＃U+1234567］',
        'date-boundary': '※［＃2026-09-17］', 'substitute': '１［＃「１」はローマ数字、1-13-21］',
        'substitute-mismatch': '２［＃「１」はローマ数字、1-13-21］',
        'substitute-no-code': '１［＃「１」はローマ数字］', 'substitute-segment': 'A［＃「A」はU+0042］B［＃「AB」はU+0043］',
        'fence': '```\n※［＃U+0041］\n```', 'two-codepoints': '※［＃1-4-87］',
        'jis0212-fallback': '※［＃2-2-15］', 'nested-note-newline': '※［＃説明\nU+0041］',
    }
    for id, value in gaiji.items(): add('gaiji-' + id, 'convert_aozora_gaiji', value)
    for cp in ['001F','0020','007F','0080','009F','00A0','D800','DFFF','FDD0','FFFF','10FFFF','110000']:
        add('gaiji-codepoint-' + cp, 'convert_aozora_gaiji', f'※［＃U+{cp}］')
    for plane,row,cell in [(0,1,1),(3,1,1),(1,0,1),(1,95,1),(1,1,0),(1,1,95),(1,1,32),(1,2,18)]:
        add(f'jis-bounds-{plane}-{row}-{cell}', 'jis0213_to_unicode', plane, row=row, cell=cell)

    emphasis = {
        'bold': '青空［＃「青空」は太字］', 'italic': '青空［＃「青空」は斜体字］',
        'both': '青空［＃「青空」は太字］［＃「青空」は斜体］',
        'both-unsafe-count': '別［＃「青空」は太字］［＃「青空」は斜体］',
        'same-kind-adjacent': '青空［＃「青空」は太字］［＃「青空」は太字］',
        'range': '［＃太字］青空［＃太字終わり］',
        'nested': '［＃太字］［＃斜体］青空［＃斜体終わり］［＃太字終わり］',
        'same-kind-nested': '［＃太字］［＃太字］青空［＃太字終わり］［＃太字終わり］',
        'asterisk': 'a*b［＃「a*b」は太字］', 'empty-range': '［＃太字］［＃太字終わり］',
        'multiline-range': '［＃太字］青\n空［＃太字終わり］',
        'block': '［＃ここから太字］\n青\n\n 空 \n［＃ここで太字終わり］',
        'block-unsafe': '［＃ここから太字］\n青［＃不明］\n［＃ここで太字終わり］',
        'block-missing-end': '［＃ここから太字］\n青［＃「青」は斜体］',
        'block-empty': '［＃ここから太字］\n［＃ここで太字終わり］',
        'backtick': '```\n青［＃「青」は太字］\n```',
        'tilde': '~~~\n青［＃「青」は太字］\n~~~',
        'inline-code': '`青［＃「青」は太字］`',
        'cr-nested': '［＃太字］［＃斜体］青\r空［＃斜体終わり］［＃太字終わり］',
    }
    for id, value in emphasis.items(): add('emphasis-' + id, 'convert_aozora_markdown_emphasis', value)
    for style in ['傍線','二重傍線','鎖線','破線','波線']:
        for approx in [False,True]:
            add(f'underline-{style}-{approx}', 'convert_aozora_underline', f'青［＃「青」に{style}］', approximate_other_styles=approx)
    for left in [False,True]:
        for other in [False,True]:
            add(f'underline-left-special-{left}-{other}', 'convert_aozora_underline', '青［＃「青」の左に二重傍線］', approximate_left=left, approximate_other_styles=other)
    for id, value in {
        'range':'［＃傍線］青［＃傍線終わり］', 'block':'［＃ここから傍線］\n青\n\n 空 \n［＃ここで傍線終わり］',
        'block-unsafe':'［＃ここから傍線］\n青［＃不明］\n［＃ここで傍線終わり］',
        'existing-inner':'||青［＃「青」に傍線］||', 'existing-outer':'||青||［＃「青」に傍線］',
        'existing-range':'<U>［＃傍線］青［＃傍線終わり］</U>',
        'cross-format-body':'<u>青</u>［＃「<u>青</u>」に傍線］',
        'mismatch':'空［＃「青」に傍線］','unmatched-end':'青［＃傍線終わり］',
        'multiline':'［＃傍線］青\n空［＃傍線終わり］','unsafe-body':'［＃傍線］青［＃不明］［＃傍線終わり］',
    }.items(): add('underline-' + id, 'convert_aozora_underline', value)
    add('underline-html', 'convert_aozora_underline', 'a&b［＃「a&b」に傍線］', output_format='html')
    add('underline-invalid-format', 'convert_aozora_underline', '青［＃「青」に傍線］', output_format='invalid')
    for kind in m._BOUTEN_KIND_NAMES:
        add('bouten-' + kind, 'convert_aozora_bouten', f'青空［＃「青空」に{kind}］')
    for id,value in {
        'supplementary':'𠀀［＃「𠀀」に傍点］','combining':'か\u3099［＃「か\u3099」に傍点］',
        'space':'［＃傍点］青 \t　空［＃傍点終わり］','only-space-range':'［＃傍点］ \t［＃傍点終わり］',
        'only-space-forward':' ［＃「 」に傍点］', 'ruby':'｜青《あお》［＃「｜青《あお》」に傍点］',
        'ruby-context':'｜青［＃「青」に傍点］《あお》','left':'青［＃「青」の左に傍点］',
        'multiline':'［＃傍点］青\n空［＃傍点終わり］', 'unmatched':'［＃傍点］青',
        'block-unsupported':'［＃ここから傍点］\n青\n［＃ここで傍点終わり］',
        'fence':'```\n青［＃「青」に傍点］\n```','python-whitespace':'［＃傍点］\u001c\u0085\ufeff［＃傍点終わり］',
    }.items(): add('bouten-' + id, 'convert_aozora_bouten', value)
    for mark in ['•','𠀀X','', 'ab']:
        add('bouten-mark-' + repr(mark), 'convert_aozora_bouten', '青［＃「青」に傍点］', bouten_char=mark)
    for level in ['大','中','小']:
        add('heading-' + level, 'convert_aozora_headings', f'章［＃「章」は{level}見出し］')
    for id,value in {
        'quote-not-checked':'本文［＃「不一致」は大見出し］','ruby':'｜章《しょう》［＃「章」は大見出し］',
        'multiline':'［＃ここから中見出し］\n 一 \n\n 二\n［＃ここで中見出し終わり］',
        'indent':'［＃３字下げ］章［＃「章」は大見出し］','indent-clamp':'［＃99字下げ］章［＃「章」は大見出し］',
        'unsupported':'章［＃「章」は窓大見出し］','empty':'［＃大見出し］［＃大見出し終わり］',
        'not-whole-line':'前［＃大見出し］章［＃大見出し終わり］後',
        'fence':'```\n章［＃「章」は大見出し］\n```','unicode-splitlines':'［＃大見出し］一\u2028二［＃大見出し終わり］',
    }.items(): add('heading-' + id, 'convert_aozora_headings', value)
    for n in [0,1,2,3,4,5,6,7,40]: add(f'indent-level-{n}', 'convert_aozora_indent', f'［＃{n}字下げ］本文')
    indent = {
        'one':'  ［＃３字下げ］本文','empty':'［＃３字下げ］', 'block':'［＃ここから２字下げ］\n本文\n［＃ここで字下げ終わり］',
        'switch':'［＃ここから２字下げ］\n甲\n［＃ここから３字下げ］\n乙\n［＃ここで字下げ終わり］',
        'inline-inside':'［＃ここから２字下げ］\n［＃３字下げ］甲\n［＃ここで字下げ終わり］',
        'invalid-switch':'［＃ここから２字下げ］\n甲\n［＃ここから７字下げ］\n乙\n［＃ここで字下げ終わり］',
        'eof':'［＃ここから２字下げ］\n本文\n','existing':':::indent-2\n［＃３字下げ］本文\n:::',
        'already-following':'［＃ここから２字下げ］\n\n:::indent-2\n本文\n:::',
        'modified':'［＃２字下げ、折り返して１字下げ］本文','stray-end':'［＃ここで字下げ終わり］',
        'fence-close':'［＃ここから２字下げ］\n甲\n```\n乙\n```\n丙',
    }
    for id,value in indent.items():
        for preserve in [False,True]: add(f'indent-{id}-{preserve}', 'convert_aozora_indent', value, preserve_notes=preserve)
    align = {
        'one':'［＃地付き］署名','mid':'本文  ［＃地付き］署名','empty':'本文［＃地付き］',
        'block':'［＃ここから地付き］\n署名\n［＃ここで地付き終わり］','eof':'［＃ここから地付き］\n署名\n',
        'jiage':'［＃地から３字上げ］署名','jiage-zero':'［＃地から０字上げ］署名',
        'jiage-huge':'［＃地から9999字上げ］署名',
        'passthrough':'［＃ここから地から３字上げ］\n［＃地付き］署名\n［＃ここで字上げ終わり］',
        'multiple':'［＃地付き］甲［＃地から２字上げ］乙','existing':':::indent-2\n［＃地付き］署名\n:::',
        'mismatched-end':'［＃ここから地付き］\n署名\n［＃ここで字上げ終わり］',
    }
    for id,value in align.items():
        for approx in [False,True]: add(f'align-{id}-{approx}', 'convert_aozora_align_end', value, approximate_jiage=approx)
    add('align-preserve-mid', 'convert_aozora_align_end', align['mid'], preserve_notes=True)
    add('align-preserve-block', 'convert_aozora_align_end', align['block'], preserve_notes=True)
    page = {
        'one':'［＃改ページ］','blank':'［＃改ページ］\n\n［＃改ページ］',
        'adjacent':'［＃改ページ］\n［＃改ページ］','triple':'［＃改ページ］\n\n［＃改ページ］\n\n［＃改ページ］',
        'space':'［＃改ページ］\n \t　\n［＃改ページ］','inline':'前［＃改ページ］後',
        'kaicho':'［＃改丁］','kaihiraki':'［＃改見開き］','kaidan':'［＃改段］',
        'mixed-hint':'［＃改段］［＃改ページ］','existing':':::align-end\n［＃改ページ］\n:::',
        'already-following':'［＃改ページ］\n\n:::page-break\n:::',
        'blank-existing':'［＃改ページ］\n\n［＃改ページ］\n:::blank-page-2\n:::',
    }
    for id,value in page.items():
        for approx in [False,True]: add(f'page-{id}-{approx}', 'convert_aozora_page_breaks', value, approximate_spread_breaks=approx)
    add('page-preserve-blank', 'convert_aozora_page_breaks', page['blank'], preserve_notes=True)
    safe = '底本：資料\n入力：人\n青空文庫作成ファイル：\n末尾'
    footer = {
        'safe':'本文\n\n' + safe,'no-creation':'本文\n底本：資料\n入力：人',
        'no-personnel-date':'本文\n底本：資料\n青空文庫作成ファイル：',
        'parent-only':'本文\n底本の親本：資料\n入力：人\n青空文庫作成ファイル：',
        'date':'本文\n底本:資料\n青空文庫作成ファイル:\n２０２６年９月２２日 修正',
        'date-not-validated':'本文\n底本:資料\n青空文庫作成ファイル:\n2026年99月99日作成',
        'inline-base':'本文に底本：がある\n入力：人\n青空文庫作成ファイル：',
        'honbun':'本文\n［＃本文終わり］\n入力：人\n青空文庫作成ファイル：',
        'teihon-priority':'本文\n［＃本文終わり］\n' + safe,
        'last-base':'本文\n底本：初期\n' + safe,
        'in-code':'```\n' + safe + '\n```',
        'window-in':'本文\n底本：資料\n' + '\n'.join(['行']*397) + '\n入力：人\n青空文庫作成ファイル：',
        'window-out':'本文\n底本：資料\n' + '\n'.join(['行']*398) + '\n入力：人\n青空文庫作成ファイル：',
    }
    for id,value in footer.items(): add('footer-' + id, 'remove_aozora_footer_metadata', value)
    for id,value in {'normal':'前\n-----\n注釈\n-----\n後','unclosed':'前\n-----\n後',
                     'suffix':'前\n-----abc\n本文\n-----xyz\n後','code':'```\n-----\nコード\n-----\n```'}.items():
        add('annotation-' + id, 'remove_aozora_annotations', value)
    for id,value in {
        'basic':'［＃不明］ ※［＃外字］\n［＃不明］','multiline':'［＃改\nページ］',
        'fences':'````info\n［＃内］\n```\n［＃まだ内］\n````\n［＃外］\n~~~\n［＃内］\n~~~',
        'inline':'`［＃内］` ［＃外］','double-backtick':'``［＃内］`` ［＃外］',
        'bad-close':'```\n［＃内］\n```suffix\n［＃まだ内］',
        'preserved':'\ue000［＃改ページ］\ue001\n［＃改ページ］',
        'partial-marker':'\ue000［＃改ページ］x\ue001',
        'isolated-pua':'甲\ue000乙\ue001［＃不明］',
    }.items():
        add('scan-' + id, 'scan_remaining_aozora_notes', value)
        if 'marker' in id or 'preserved' in id or 'pua' in id:
            add('strip-' + id, 'strip_preserved_aozora_note_markers', value)
    for id,value in {
        'two':'題\n著者\n\n本文','no-blank':'題\n著者','blank-first':'\n題\n著者\n\n本文',
        'three':'題\n副題\n著者\n\n本文','multi-author':'題\n副題\n甲\n乙\n\n本文',
        'translation':'題\n副題\n著者\n甲訳\n乙訳\n\n本文',
        'translation-second':'題\n甲訳\n失われる行\n\n本文',
        'space-separator':'題\n著者\n　\n本文',
    }.items(): add('header-' + id, 'parse_aozora_header', value)
    for id,value in {
        'quoted':'---\ntitle: "題"\nauthor: 人 #注\n---\n本文',
        'raw-block':'---\ntitle: 題\nraw_header: |\n  副題\n---\n本文',
        'array':'---\nauthors:\n  - 甲\n  - 乙\n---\n本文',
        'empty':'---\n---\n本文','empty-array':'---\ntitle: 題\nauthors:\n---\n本文',
        'indented-key':'---\n title: 題\n---\n本文',
    }.items():
        add('frontmatter-' + id, 'extract_frontmatter_metadata', value)
        add('metadata-' + id, 'get_metadata_from_text', value)
    add('yaml-unescaped', 'create_frontmatter', {'title':'a: b # c','author':'[人]','authors':['甲','乙'],'raw_header':'副題\n別名'})
    add('header-reconstruct-order', 'reconstruct_header_from_metadata', {'title':'題','raw_header':'副題','author':'丙','authors':['甲','乙'],'translator':'丁訳'})
    for id,value in {'invalid':' a/b:c*?"<>|\\. ', 'reserved':'CON', 'unicode-length':'𠀀'*101, 'dot-space':'. .', 'control':'a\x00b\x7f'}.items():
        add('filename-' + id, 'sanitize_filename', value)
    protected_samples = {
        'convert_aozora_gaiji':'※［＃U+0041］',
        'convert_aozora_markdown_emphasis':'青［＃「青」は太字］',
        'convert_aozora_underline':'青［＃「青」に傍線］',
        'convert_aozora_bouten':'青［＃「青」に傍点］',
        'convert_aozora_headings':'章［＃「章」は大見出し］',
        'convert_aozora_indent':'［＃２字下げ］青',
        'convert_aozora_align_end':'［＃地付き］青',
        'convert_aozora_page_breaks':'［＃改ページ］',
    }
    for fn,body in protected_samples.items():
        for prefix,suffix,label in [('```\n','\n```','backtick'),('~~~\n','\n~~~','tilde'),
                                    ('`','`','inline-code'),(':::custom\n','\n:::','directive'),
                                    ('````\n','\n```suffix\n'+body+'\n````','mismatched-fence')]:
            add(f'protection-{fn}-{label}',fn,prefix+body+suffix)
    return cases


def pipeline_case(id, text, options=None, filename='work.txt', write_error=False):
    m = load_reference()
    opts = m.Options(**(options or {}))
    logs, writes, stages = [], [], {}
    m.detect_and_read_text = lambda p: (text, 'unicode-fixture')
    def write(p, value):
        writes.append({'path': p.as_posix(), 'text': value})
        if write_error: raise OSError('fixture write failure')
    m.write_utf8_text = write
    for name, fields in FIELDS.items():
        original = getattr(m, name)
        def spy(value, *args, _fn=original, _name=name, _fields=fields, **kwargs):
            result = _fn(value, *args, **kwargs)
            stages[_name] = dict(zip(_fields, result[1:]))
            return result
        setattr(m, name, spy)
    stats = m.JobStats()
    source = Path('/__aozora_design_oracle__') / filename
    worker = m.Worker(source, None, opts)
    worker.log = types.SimpleNamespace(emit=logs.append)
    worker._process_text_file(source, stats, None, False)
    return {'id':id, 'input':text, 'options':dataclasses.asdict(opts), 'filename':filename,
            'writeError':write_error, 'expected':{'writes':writes, 'stats':dataclasses.asdict(stats),
            'stages':stages, 'logs':logs, 'warnings':[line for line in logs if '[WARN]' in line or line.startswith('         ')]}}


def make_pipelines():
    cases=[]
    def add(*args, **kwargs): cases.append(pipeline_case(*args, **kwargs))
    add('default-header', '題\n著者\n\n青空［＃「青空」は太字］\n')
    add('bouten-before-heading', '題\n著者\n\n青空［＃「青空」に傍点］［＃「青空」は大見出し］\n')
    add('gaiji-before-name', '※［＃U+984C］\n著者\n\n本文', {'organize_by_author':True})
    add('heading-consumes-indent', '［＃３字下げ］章［＃「章」は大見出し］', {'convert_nyoze_indent':True,'add_frontmatter':False})
    add('indent-protects-align-page', '［＃ここから２字下げ］\n［＃地付き］署名\n［＃改ページ］\n［＃ここで字下げ終わり］',
        {'convert_nyoze_indent':True,'convert_nyoze_align_end':True,'convert_nyoze_page_break':True,'add_frontmatter':False})
    add('preserve-mixed', '［＃３字下げ］本文\n［＃改ページ］\n前［＃改ページ］後',
        {'convert_nyoze_indent':True,'preserve_aozora_indent_notes':True,'convert_nyoze_page_break':True,'preserve_aozora_page_break_notes':True,'add_frontmatter':False})
    add('preserve-deleted-no-stale-suppression', '-----\n［＃ここから２字下げ］\n消える\n［＃ここで字下げ終わり］\n-----\n［＃ここから２字下げ］\n:::indent-2\n残る\n:::',
        {'convert_nyoze_indent':True,'preserve_aozora_indent_notes':True,'add_frontmatter':False})
    add('footer-before-annotation', '本文\n-----\n底本：資料\n入力：人\n青空文庫作成ファイル：\n-----\n末尾', {'add_frontmatter':False})
    add('converted-count-survives-footer', '本文\n底本：資料\n入力：人\n※［＃U+0041］\n青空文庫作成ファイル：', {'add_frontmatter':False})
    add('txt-gating', '※［＃U+0041］\n青［＃「青」は太字］\n［＃改ページ］', {'rename_to_md':False,'convert_nyoze_page_break':True})
    add('md-even-rename-off', '題\n著者\n\n青［＃「青」は太字］', {'rename_to_md':False}, filename='work.md')
    add('header-restore', '---\ntitle: 題\nauthor: 著者\nraw_header: |\n  副題\n---\n本文', {'add_header_to_body':True},filename='work.md')
    add('header-duplicate-within-ten', '---\ntitle: 題\nauthor: 著者\n---\n一\n題\n本文', {'add_header_to_body':True},filename='work.md')
    add('frontmatter-retain-original-header','題\n著者\n\n本文',{'add_header_to_body':True})
    add('empty-author-fallback', '---\ntitle: 題\nauthors:\n---\n本文', {'organize_by_author':True},filename='work.md')
    add('unknown-no-error', '※［＃未知］\n［＃不明］',{'add_frontmatter':False})
    add('write-failure-stats', '［＃不明］', {'add_frontmatter':False}, write_error=True)
    add('skip-unknown-txt', '※［＃未知］',{'convert_utf8':False,'rename_to_md':False,'remove_annotations':False,'remove_aozora_footer':False})
    add('remove-annotations-forces-write', '本文',{'convert_utf8':False,'rename_to_md':False,'remove_aozora_footer':False})
    add('whole-document', '※［＃U+984C］\n著者\n\n-----\n説明\n-----\n青空［＃「青空」に傍点］［＃「青空」は大見出し］\n'
        '強調［＃「強調」は太字］\n［＃傍線］下線［＃傍線終わり］\n［＃３字下げ］字下げ本文\n'
        '［＃地から３字上げ］署名\n［＃改ページ］\n\n［＃改ページ］\n［＃改丁］\n［＃不明］\n'
        '底本：資料\n入力：人\n青空文庫作成ファイル：\n',
        {'convert_nyoze_indent':True,'preserve_aozora_indent_notes':True,'convert_nyoze_align_end':True,
         'approximate_aozora_jiage_as_align_end':True,'convert_nyoze_page_break':True,'approximate_aozora_spread_breaks':True})
    return cases


def make_encoding(m):
    samples = [('ascii',b'abc\r\ndef\rghi\n'),('cp932','青空文庫①髙'.encode('cp932')),
               ('utf8','青空文庫'.encode()),('utf8-ambiguous','あい'.encode()),
               ('bom-ascii',b'\xef\xbb\xbfabc'),('utf8-bom','青空文庫'.encode('utf-8-sig')),
               ('invalid',b'\x81\x30\x81'),('ignore-newline',b'\x81\x30\r\n\r'),
               ('windows-extras',bytes([0x80,0xa0,0xfd,0xfe,0xff])),('wave-dash',bytes.fromhex('8160'))]
    result=[]
    with tempfile.TemporaryDirectory(prefix='aozora_design_') as tmp:
        for id,data in samples:
            p=Path(tmp)/'test.txt'
            p.write_bytes(data)
            result.append({'id':id,'hex':data.hex(),'expected':plain(m.detect_and_read_text(p))})
    return result


def make_table(m):
    table=[m.jis0213_to_unicode(p,r,c) for p in (1,2) for r in range(1,95) for c in range(1,95)]
    raw=json.dumps(table,ensure_ascii=False,separators=(',',':')).encode()
    return {'index':'(plane - 1) * 8836 + (row - 1) * 94 + cell - 1','values':table}, {
        'total':len(table),'mapped':sum(v is not None for v in table),'unmapped':sum(v is None for v in table),
        'multiCodepoint':sum(v is not None and len(v)>1 for v in table),
        'supplementaryEntries':sum(v is not None and any(ord(c)>0xffff for c in v) for v in table),
        'compactUtf8Bytes':len(raw),'gzip9Bytes':len(gzip.compress(raw,compresslevel=9,mtime=0)),
        'compactSha256':hashlib.sha256(raw).hexdigest()}


def build():
    m=load_reference()
    units=make_units(m)
    pipelines=make_pipelines()
    table,metrics=make_table(m)
    notes=[m.RemainingAozoraNote(i//2+1,'［＃重複］') for i in range(5)]
    notes += [m.RemainingAozoraNote(10+i,f'［＃注記{i}］') for i in range(51)]
    tree=ast.parse(SOURCE.read_text())
    inventory=[{'name':n.name,'start':n.lineno,'end':n.end_lineno} for n in tree.body if isinstance(n,(ast.FunctionDef,ast.ClassDef))]
    manifest={'source':SOURCE.name,'sha256':SHA256,'python':platform.python_version(),
              'unitCases':len(units),'pipelineCases':len(pipelines),'jisMetrics':metrics,'inventory':inventory,
              'optionsDefaults':dataclasses.asdict(m.Options()),'jobStatsDefaults':dataclasses.asdict(m.JobStats()),
              'pythonWhitespaceCodepoints':[n for n in range(0x110000) if chr(n).isspace()]}
    patterns=[{'name':name,'pattern':value.pattern,'flags':value.flags,'flagNames':str(re.RegexFlag(value.flags))}
              for name,value in m.__dict__.items() if isinstance(value,re.Pattern)]
    return {'unit-fixtures.json':units,'pipeline-fixtures.json':pipelines,'encoding-fixtures.json':make_encoding(m),
            'jis-oracle.json':table,'manifest.json':manifest,
            'regex-inventory.json':patterns,
            'warning-format-fixture.json':{'filename':'work.md','notes':plain(notes),'expected':m.format_remaining_aozora_note_log_lines('work.md',notes)}}


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--check',action='store_true')
    args=parser.parse_args()
    results=build()
    out=ROOT/'design'/'fixtures'
    if not args.check: out.mkdir(parents=True,exist_ok=True)
    for name,data in results.items():
        payload=json.dumps(data,ensure_ascii=False,indent=2)+'\n'
        path=out/name
        if args.check:
            if not path.exists() or path.read_text()!=payload: raise RuntimeError(f'Fixture mismatch: {name}')
        else: path.write_text(payload,encoding='utf-8',newline='\n')
    print(json.dumps({'mode':'check' if args.check else 'generate',**{k:v for k,v in results['manifest.json'].items() if k in ('python','unitCases','pipelineCases','jisMetrics')}},ensure_ascii=False))


if __name__=='__main__': main()
