"""Build NEW API projections from original Worker observations + explicit v2 edits.
No TypeScript execution. Raw Worker fields are retained under hostReference, with
scope declarations, rather than passed off as values of the pure API.
"""
import copy,dataclasses,json,sys,types
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'design'))
from reference_oracle import load_reference,FIELDS,plain
read=lambda p:json.loads((ROOT/p).read_text())
old=read('design/fixtures/pipeline-fixtures.json');plan=read('design/compatibility-plan.json');side=read('design/improvement-fixtures.json')
policies={p['caseKey']:p for p in plan['cases']}
stages={'convert_aozora_gaiji':'gaiji','convert_aozora_markdown_emphasis':'emphasis','convert_aozora_underline':'underline','convert_aozora_bouten':'bouten','convert_aozora_headings':'headings','convert_aozora_indent':'indent','convert_aozora_align_end':'align','convert_aozora_page_breaks':'pageBreak'}
outputs=[]
for c in old:
 m=load_reference();o=c['options'];id=c['id'];md=c['filename'].lower().endswith('.md') or o['rename_to_md'];observed={}
 original_scan=m.scan_remaining_aozora_notes
 def scan(text):
  result=original_scan(text);observed['remaining']=plain(result);return result
 m.scan_remaining_aozora_notes=scan
 original_metadata=m.get_metadata_from_text
 def meta(text):
  observed['namingInput']=text;return original_metadata(text)
 m.get_metadata_from_text=meta
 # Observe stage-9 text even when organization is disabled, at entry to footer or deletion.
 def footer(text):
  observed.setdefault('namingInput',text);return original_footer(text)
 original_footer=m.remove_aozora_footer_metadata;m.remove_aozora_footer_metadata=footer
 original_annotation=m.remove_aozora_annotations
 def annotation(text):
  observed.setdefault('namingInput',text);return original_annotation(text)
 m.remove_aozora_annotations=annotation
 m.detect_and_read_text=lambda _: (c['input'],'unicode-fixture');m.write_utf8_text=lambda *_:None
 w=m.Worker(Path('/__aozora_design_oracle__')/c['filename'],None,m.Options(**o));w.log=types.SimpleNamespace(emit=lambda _:None)
 w._process_text_file(Path('/__aozora_design_oracle__')/c['filename'],m.JobStats(),None,False)
 text=c['expected']['writes'][0]['text'] if c['expected']['writes'] else c['input']
 stats={stage:dict.fromkeys(FIELDS[fn],0) for fn,stage in stages.items()}
 for fn,values in c['expected']['stages'].items():
  if fn in stages:stats[stages[fn]]=values
 stats['footerRemoved']=c['expected']['stages'].get('remove_aozora_footer_metadata',{}).get('removed',False)
 notes=observed.get('remaining',[]);diagnostics=[]
 if id=='footer-before-annotation':
  text='本文\n末尾';stats['footerRemoved']=False;notes=[]
  diagnostics=[{'code':'FOOTER_CANDIDATE_PRESERVED','severity':'warning','stage':'footer','range':{'startUtf16':9,'endUtf16':14},'sourceOccurrenceId':'source:9:14','details':{}}]
 if id=='header-restore':text=c['input'].split('---\n本文')[0]+'---\n題\n副題\n著者\n\n本文'
 stats['remainingNotes']=len(notes)
 if notes:diagnostics.append({'code':'REMAINING_AOZORA_NOTES','severity':'warning','stage':'residual','details':{'count':len(notes)}})
 naming_input=observed.get('namingInput',c['input'])
 try:naming=m.get_metadata_from_text(naming_input)
 except IndexError:naming={'title':'題'}
 events=[]
 for stage in stages.values():
  for key,value in stats[stage].items():
   if value:events.append({'stage':stage,'action':key,'count':value})
 if stats['footerRemoved']:events.append({'stage':'footer','action':'removed'})
 if o['remove_annotations']:
  # The only closed pairs in these fixtures: stale-preserve, footer-before and whole document.
  events.append({'stage':'annotationBlocks','action':'removal-pass','count':int(id in ['preserve-deleted-no-stale-suppression','footer-before-annotation','whole-document'])})
 if id=='header-restore':events.append({'stage':'frontmatter','action':'header-restored'})
 elif any('フロントマター追加' in log for log in c['expected']['logs']):events.append({'stage':'frontmatter','action':'frontmatter-added' if o['add_header_to_body'] else 'frontmatter-added-header-removed'})
 core={'text':text,'isMarkdownOutput':md,'outputEncoding':'utf-8','stats':stats,'remainingNotes':notes,'diagnostics':diagnostics,'processingEvents':events,'namingMetadata':{'ok':True,'metadata':naming,'diagnostics':[]}}
 ext='md' if md else 'txt';stem=Path(c['filename']).stem
 target=(naming.get('author','unknown_author')+'/'+naming.get('title',stem) if o['organize_by_author'] else stem)+'.'+ext
 if target==c['filename']:target=stem+'_converted.'+ext
 # Pure test submits one result to a fake exclusive writer; legacy need_write is outside new contract.
 policy={'relativePath':target,'filesConverted':0 if c['writeError'] else 1,'errors':int(c['writeError']),'filesWithRemainingNotes':0 if c['writeError'] else int(bool(notes)),'remainingNotes':0 if c['writeError'] else len(notes)}
 projected_original={'text':c['expected']['writes'][0]['text'] if c['expected']['writes'] else c['input'],'stats':copy.deepcopy(stats)}
 if id=='footer-before-annotation':projected_original['stats']['footerRemoved']=True
 from validate_design import changed_paths
 projection_changes=changed_paths(projected_original,{'text':core['text'],'stats':stats})
 item={'caseKey':'pipeline:'+id,'core':core,'policy':policy,'referenceProjection':projected_original,'changedCorePaths':projection_changes,'hostReference':c['expected'],'hostFieldScope':{'writes[*].text':'core.text; write attempt is not commit','writes[*].path':'pure relative naming proposal; absolute host path excluded','stages':'core.stats; uncalled stages explicitly zero','stats':'pure job reducer projection; ZIP fields and legacy skip boundary excluded','logs':'legacy Qt/host presentation not in slice; new processingEvents specified','warnings':'legacy host presentation not in slice; core remainingNotes and diagnostics specified'},'evidence':'Unmodified Python Worker instrumented for scan/naming; explicit R08 restoration, R09 empty author, R14 footer boundary, R16 commit. No TS execution.'}
 outputs.append(item)
 p=policies[item['caseKey']];p['status']='expected-defined'
 replacement={k:copy.deepcopy(p[k]) for k in ['caseKey','compatibility','decisions','reasons','reference']}|{'decisionSet':'aozora-ts-v2','changedPaths':[''],'expected':{'core':core,'policy':policy},'contractScope':'Pure API and fake commit projection, all original fields accounted in tests/fixtures/pipeline-v2.json hostFieldScope.','regression':'Exact new core/policy objects; compare unchanged core fields with original projection and enumerate changedCorePaths.'}
 side['cases']=[x for x in side['cases'] if x['caseKey']!=p['caseKey']]+[replacement]
for filename,data in [('tests/fixtures/pipeline-v2.json',outputs),('design/compatibility-plan.json',plan),('design/improvement-fixtures.json',side)]:
 (ROOT/filename).write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
print('Specified 20 complete pipeline expectations independently from TS.')
