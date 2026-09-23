#!/usr/bin/env python3
"""Temporary-directory-only probes of the original Worker I/O behavior."""
import argparse
import dataclasses
import json
import os
from pathlib import Path
import tempfile
import types
import warnings
import zipfile

from reference_oracle import ROOT, load_reference


def probe(kind):
    m = load_reference()
    with tempfile.TemporaryDirectory(prefix='aozora_io_design_') as tmp:
        root = Path(tmp)
        opts = m.Options(add_frontmatter=False, remove_annotations=False, remove_aozora_footer=False)
        input_path = root/'work.txt'
        input_path.write_bytes(b'SOURCE\r\n')
        if kind == 'txt-overwrites-existing-md':
            (root/'work.md').write_bytes(b'EXISTING INPUT')
        elif kind == 'md-overwrites-existing-converted':
            input_path = root/'work.md'
            input_path.write_bytes(b'SOURCE MD')
            (root/'work_converted.md').write_bytes(b'OLD RESULT')
        elif kind == 'hardlink-alias':
            os.link(input_path, root/'work.md')
        elif kind == 'symlink-alias':
            (root/'work.md').symlink_to(input_path.name)
        elif kind in ('zip-flatten', 'zip-duplicate'):
            input_path = root/'archive.zip'
            with warnings.catch_warnings():
                warnings.simplefilter('ignore', UserWarning)
                with zipfile.ZipFile(input_path, 'w') as z:
                    if kind == 'zip-flatten':
                        z.writestr('a/work.txt', b'FIRST')
                        z.writestr('b/work.txt', b'SECOND')
                        z.writestr('extra.md', b'MARKDOWN')
                        z.writestr('image.png', b'IGNORED')
                    else:
                        z.writestr('work.txt', b'FIRST')
                        z.writestr('work.txt', b'SECOND')
        elif kind == 'folder-exclusions':
            (root/'work_converted.txt').write_bytes(b'IGNORED TXT')
            (root/'work_converted2.md').write_bytes(b'IGNORED MD')
            (root/'CAPITAL.TXT').write_bytes(b'UPPERCASE')
            (root/'nested').mkdir()
            (root/'nested'/'other.txt').write_bytes(b'OTHER')
            input_path = root
        logs,progress,finished=[],[],[]
        def snapshot():
            return {p.relative_to(root).as_posix(): ('<ZIP fixture>' if p.suffix=='.zip' else p.read_bytes().hex())
                    for p in sorted(root.rglob('*')) if p.is_file()}
        before=snapshot()
        worker=m.Worker(input_path,None,opts)
        worker.log=types.SimpleNamespace(emit=logs.append)
        worker.progress=types.SimpleNamespace(emit=lambda *x: progress.append(x))
        worker.finished=types.SimpleNamespace(emit=lambda stats: finished.append(dataclasses.asdict(stats)))
        worker.run()
        after=snapshot()
        return {'id':kind,'before':before,'after':after,'stats':finished,'progress':progress,
                'logs':[line.replace(tmp,'<TEMP>') for line in logs]}


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--check',action='store_true')
    args=parser.parse_args()
    data=[probe(kind) for kind in ['txt-overwrites-existing-md','md-overwrites-existing-converted',
          'hardlink-alias','symlink-alias','zip-flatten','zip-duplicate','folder-exclusions']]
    path=ROOT/'design'/'fixtures'/'io-probes.json'
    payload=json.dumps(data,ensure_ascii=False,indent=2)+'\n'
    if args.check:
        # File iteration order is host-sensitive; compare this run on the pinned host only.
        if path.read_text()!=payload: raise RuntimeError('I/O probe changed; inspect host/order differences')
    else: path.write_text(payload,encoding='utf-8')
    print(json.dumps([{'id':row['id'],'stats':row['stats'],'changedFiles':[p for p in row['after'] if row['before'].get(p)!=row['after'][p]]} for row in data],ensure_ascii=False))


if __name__=='__main__': main()
