"""Specify v2 unit/encoding expectations from decisions, without importing TS.
Existing exact design cases are retained. Unchanged candidate cases become strict.
"""
import copy,json,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'design'))
from validate_design import changed_paths
read=lambda p:json.loads((ROOT/p).read_text())
plan=read('design/compatibility-plan.json');side=read('design/improvement-fixtures.json')
units={x['id']:x for x in read('design/fixtures/unit-fixtures.json')}
encs={x['id']:x for x in read('design/fixtures/encoding-fixtures.json')}
for p in plan['cases']:
 if p['status']!='needs-expectation' or p['caseKey'].startswith('pipeline:'):continue
 suite,id=p['caseKey'].split(':',1);old=(units if suite=='unit' else encs)[id];expected=copy.deepcopy(old['expected'])
 if suite=='encoding':expected={'ok':True,'text':old['expected'][0],'encoding':old['expected'][1],'bom':False}
 elif id.startswith('protection-'):
  expected['return']=[old['input']]+[0]*(len(expected['return'])-1);expected['output']=old['input'];expected['stats']={k:0 for k in expected['stats']}
 elif id=='metadata-indented-key':expected['return']={'title':'題'}
 elif id not in ['emphasis-backtick','indent-fence-close-False','metadata-raw-block','metadata-empty']:raise RuntimeError(id)
 delta=changed_paths(old['expected'],expected)
 if not delta:
  p.update(compatibility='strict',status='reference-ready',decisions=[],reasons=[])
  p['expectationEvidence']='Independent inspection: v2 protected content/counts or typed naming projection equal original.'
 else:
  p['status']='expected-defined'
  side['cases'].append({k:copy.deepcopy(p[k]) for k in ['caseKey','compatibility','decisions','reasons','reference']}|{'decisionSet':'aozora-ts-v2','changedPaths':delta,'expected':expected,'contractScope':'R13 protected input stays byte-for-byte unchanged with no converter counts; R08 YAML indented mapping key is valid; R01 codec policy result schema.','expectationEvidence':'Derived directly from R13/R08/R01, unchanged original input and CPython codec. No TypeScript execution.','regression':'Exact expected comparison plus unlisted field-difference rejection.'})
for file,data in [('design/compatibility-plan.json',plan),('design/improvement-fixtures.json',side)]:
 (ROOT/file).write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
print('Specified all unit/encoding pending expectations; pipeline projection remains separate.')
