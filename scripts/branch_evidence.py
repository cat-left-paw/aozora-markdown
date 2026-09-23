"""Trace unchanged Python unit/differential cases to source branches, no TS snapshot.
Each arm lists observed test IDs. Missing arms remain visible, never called covered.
"""
import ast,json,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'design'))
from reference_oracle import load_reference,SOURCE
m=load_reference();tree=ast.parse(SOURCE.read_text());records=[]
for fn in tree.body:
 if not isinstance(fn,ast.FunctionDef) or not (124<=fn.lineno<=2185):continue
 for node in ast.walk(fn):
  if isinstance(node,(ast.If,ast.For,ast.While)):
   head_end=(node.test.end_lineno if hasattr(node,'test') else node.iter.end_lineno)
   records.append({'function':fn.name,'line':node.lineno,'conditionEnd':head_end,'end':node.end_lineno,'kind':type(node).__name__,'condition':ast.unparse(node.test if hasattr(node,'test') else node.iter),'bodyStart':node.body[0].lineno,'bodyEnd':node.body[-1].end_lineno,'bodyTests':[],'exitOrElseTests':[]})
inputs=[]
for suite,path in [('unit','design/fixtures/unit-fixtures.json'),('differential','tests/fixtures/differential.json')]:
 for c in json.loads((ROOT/path).read_text()):inputs.append((suite+':'+c['id'],c))
warning=json.loads((ROOT/'design/fixtures/warning-format-fixture.json').read_text())
for label,notes in [('full',warning['notes']),('empty',[]),('short',[{'line':1,'text':'［＃注］'}]*2)]:
 inputs.append(('warning:'+label,{'function':'format_remaining_aozora_note_log_lines','input':'work.md','options':{'notes':[m.RemainingAozoraNote(**n) for n in notes]}}))
inputs.append(('R15-preserve-jiage',{'function':'convert_aozora_align_end','input':'［＃ここから地から３字上げ］\n署名\n［＃ここで字上げ終わり］','options':{'approximate_jiage':True,'preserve_notes':True}}))
inputs.append(('R15-preserve-page-spread',{'function':'convert_aozora_page_breaks','input':'［＃改ページ］\n本文\n［＃改丁］','options':{'approximate_spread_breaks':True,'preserve_notes':True}}))
for id,c in inputs:
 arcs=set();previous={}
 def trace(frame,event,arg):
  if frame.f_code.co_filename!=str(SOURCE):return trace
  key=id_builtin(frame)
  if event=='line':
   if key in previous:arcs.add((previous[key],frame.f_lineno))
   previous[key]=frame.f_lineno
  elif event=='return':
   if key in previous:arcs.add((previous.pop(key),-frame.f_code.co_firstlineno))
  return trace
 id_builtin=__builtins__.id
 sys.settrace(trace)
 try:getattr(m,c['function'])(c['input'],**c['options'])
 except Exception:pass
 finally:sys.settrace(None)
 for r in records:
  edges=[b for a,b in arcs if r['line']<=a<=r['conditionEnd']]
  if any(r['bodyStart']<=b<=r['bodyEnd'] for b in edges):r['bodyTests'].append(id)
  if any(b<0 or b>r['bodyEnd'] for b in edges):r['exitOrElseTests'].append(id)
report={'sourceSha256':'4c45c5e777718e88815117e49db85ccb13e1dd4e35eba858e3eae958bd2f2cc0','method':'CPython sys.settrace arcs from if/for/while guard to body or exit/else. Unit + additional differential cases. This is original-source evidence, not TypeScript branch coverage. Retired sentinel/legacy code remains visible.','branches':records}
(ROOT/'reports/python-branch-evidence.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print('Python branch records:',len(records),'with body:',sum(bool(r['bodyTests']) for r in records),'with exit/else:',sum(bool(r['exitOrElseTests']) for r in records))
