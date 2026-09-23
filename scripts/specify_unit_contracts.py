"""Explicit source-coordinate expectations for newly added diagnostics and preserve regions.
Derived from the original input and decision conditions, not TypeScript snapshots.
"""
import json,re
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
u=json.loads((ROOT/'design/fixtures/unit-fixtures.json').read_text());side=json.loads((ROOT/'design/improvement-fixtures.json').read_text());overrides={x['caseKey']:x for x in side['cases']}
def utf16(s):return len(s.encode('utf-16-le'))//2
def diag(c,code,stage,start,end,details=None):
 a,b=utf16(c['input'][:start]),utf16(c['input'][:end]);return {'code':code,'severity':'warning','stage':stage,'range':{'startUtf16':a,'endUtf16':b},'sourceOccurrenceId':f'source:{a}:{b}','details':details or {}}
result=[]
for c in u:
 id=c['id'];d=[];regions=[];text=c['input'];override=overrides.get('unit:'+id,{})
 if id=='emphasis-both-unsafe-count':
  for m in re.finditer(r'［＃「[^」]+」は(?:太字|斜体字?)］',text):d.append(diag(c,'EMPHASIS_NOT_CONVERTED','emphasis',m.start(),m.end(),{'reason':'target-mismatch'}))
 if id=='emphasis-same-kind-adjacent':
  m=list(re.finditer(r'［＃「[^」]+」は太字］',text))[-1];d=[diag(c,'EMPHASIS_NOT_CONVERTED','emphasis',m.start(),m.end(),{'reason':'target-mismatch'})]
 if id=='emphasis-asterisk':
  a=text.index('［＃');d=[diag(c,'EMPHASIS_NOT_CONVERTED','emphasis',a,len(text),{'reason':'asterisk'})]
 if id in ['emphasis-same-kind-nested','emphasis-empty-range','emphasis-multiline-range']:
  d=[diag(c,'EMPHASIS_NOT_CONVERTED','emphasis',0,len('［＃太字］'),{'reason':'unsupported-range'})]
 if id=='emphasis-same-kind-nested':d.append(diag(c,'EMPHASIS_NOT_CONVERTED','emphasis',5,10,{'reason':'unsupported-range'}))
 if id in ['emphasis-block-unsafe','emphasis-block-missing-end']:
  d=[diag(c,'EMPHASIS_NOT_CONVERTED','emphasis',0,text.index('\n'),{'reason':'unsupported-block'})]
 if id=='heading-quote-not-checked':
  a=text.index('［＃');d=[diag(c,'HEADING_TARGET_MISMATCH','headings',a,len(text),{'quoted':'不一致','baseText':'本文'})]
 if id in ['bouten-ruby-context','bouten-ruby']:
  a=text.index('［＃');b=text.index('］')+1;d=[diag(c,'BOUTEN_RUBY_CONTEXT','bouten',a,b)]
 if id=='annotation-unclosed':
  a=text.index('-----');d=[diag(c,'UNCLOSED_ANNOTATION_BLOCK','annotationBlocks',a,a+5)]
 if id in ['footer-date-not-validated','footer-in-code']:
  a=text.index('底本');b=text.index('\n',a);d=[diag(c,'FOOTER_CANDIDATE_PRESERVED','footer',a,b)]
 if 'preservedRegions' in override.get('newContract',{}):
  # Map explicit generated-preserve sidecar occurrences to input occurrences in order.
  cursor=0
  for r in override['newContract']['preservedRegions']:
   a=text.index(r['text'],cursor);b=a+len(r['text']);cursor=b
   regions.append(r|{'sourceOccurrenceId':f'source:{utf16(text[:a])}:{utf16(text[:b])}'})
 result.append({'caseKey':'unit:'+id,'diagnostics':d,'preservedRegions':regions})
(ROOT/'tests/fixtures/unit-contracts.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print('Specified 307 new unit diagnostic / preserve contracts.')
