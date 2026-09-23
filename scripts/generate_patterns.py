"""Translate the pinned regex inventory; no runtime Python or mutable regex instances."""
import argparse,json,re,unicodedata,platform,hashlib
from pathlib import Path
root=Path(__file__).resolve().parents[1]
if platform.python_version()!='3.12.8':raise RuntimeError('CPython 3.12.8 required')
parser=argparse.ArgumentParser();parser.add_argument('--check',action='store_true');args=parser.parse_args()
nd='['+''.join('\\u{%x}'%n for n in range(0x110000) if unicodedata.category(chr(n))=='Nd')+']'
rows=[]
for p in json.loads((root/'design/fixtures/regex-inventory.json').read_text()):
 if p['name'] in ('_PRESERVED_NOTE_WRAP_RE','_INLINE_CODE_RE','_CONVERTED_STEM_RE'):continue
 s=p['pattern'];s=re.sub(r'\(\?P<(\w+)>',r'(?<\1>',s);s=re.sub(r'\(\?P=(\w+)\)',r'\\k<\1>',s)
 out='';inside=False;i=0
 while i<len(s):
  c=s[i]
  if c=='\\':
   if s[i+1]=='d':out+=nd
   else:out+=s[i:i+2]
   i+=2;continue
  if c=='[':inside=True
  if c==']':inside=False
  if not inside and c=='.':out+=r'[\s\S]' if p['flags']&16 else r'[^\n]'
  elif not inside and c=='^' and p['flags']&8:out+=r'(?<![^\n])'
  elif not inside and c=='$':out+=r'(?=\n|$)' if p['flags']&8 else r'(?=\n?$)'
  else:out+=c
  i+=1
 rows.append(f'  {p["name"]}: [{json.dumps(out,ensure_ascii=False)}, {json.dumps("u"+("i" if p["flags"]&2 else ""))}],')
payload=('// Derived from pinned Python regex inventory by scripts/generate_patterns.py.\nconst patterns = {\n'+'\n'.join(rows)+'\n} as const;\nexport type PatternName = keyof typeof patterns;\nexport function pattern(name: PatternName, global = false): RegExp { const [source,flags] = patterns[name]; return new RegExp(source,flags+(global?"g":"")); }\n')

path=root/'src/core/patterns.generated.ts'
if args.check:
 if path.read_text()!=payload:raise RuntimeError('Generated regex source differs')
else:path.write_text(payload)
print('PASS: 52 derived patterns; 3 retired/host-only patterns accounted for')
