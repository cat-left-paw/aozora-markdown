"""Additional strict controls from the unmodified CPython oracle.
Exclude intentionally changed contract inputs by construction, not by TS output.
"""
import json,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'design'))
from reference_oracle import load_reference,plain,FIELDS
m=load_reference();cases=[]
def add(id,fn,value,**options):
 r=getattr(m,fn)(value,**options);expected={'return':plain(r),'warnings':[]}
 if fn in FIELDS:expected.update(output=r[0],stats=dict(zip(FIELDS[fn],r[1:])))
 cases.append({'id':id,'function':fn,'input':value,'options':options,'expected':expected})
bodies=['青','𠀀','か\u3099','$&$1','A\\B','青\r空','青\u2028空','青\u2029空','青\u0085空','青\ufeff空','青\x1c空','a_b','a*b','<tag>青</tag>']
for i,b in enumerate(bodies):
 for kind in ['太字','斜体']:
  add(f'python-dot-emphasis-{i}-{kind}','convert_aozora_markdown_emphasis',f'［＃{kind}］{b}［＃{kind}終わり］')
  add(f'python-forward-emphasis-{i}-{kind}','convert_aozora_markdown_emphasis',f'{b}［＃「{b}」は{kind}］')
 for fmt in ['nyoze','html']:
  add(f'python-underline-{i}-{fmt}','convert_aozora_underline',f'［＃傍線］{b}［＃傍線終わり］',output_format=fmt)
 add(f'python-bouten-{i}','convert_aozora_bouten',f'{b}［＃「{b}」に傍点］')
 add(f'python-heading-splitlines-{i}','convert_aozora_headings',f'［＃大見出し］{b}［＃大見出し終わり］')
 add(f'python-indent-body-{i}','convert_aozora_indent',f'［＃２字下げ］{b}')
 add(f'python-align-body-{i}','convert_aozora_align_end',f'前［＃地付き］{b}')
for i,ch in enumerate([chr(n) for n in range(0x110000) if chr(n).isspace()]+['\ufeff']):
 add(f'python-whitespace-bouten-{i}','convert_aozora_bouten',f'青{ch}空［＃「青{ch}空」に傍点］')
 add(f'python-whitespace-heading-{i}','convert_aozora_headings',f'［＃中見出し］{ch}章{ch}［＃中見出し終わり］')
for i,s in enumerate(['١-١٣-٢١','第3水準١-١٣-٢١','1-١٣-٢١','1-𝟙𝟛-𝟚𝟙','1-13-21','第3水準3-1-1、1-13-21','U+0000 1-13-21']):
 add(f'python-unicode-Nd-{i}','convert_aozora_gaiji',f'※［＃{s}］')
for n in ['0','7','999999999999999999999999999','9'*4301,'0'*4301]:
 id=str(len(n))+'-'+n[:4]
 add(f'python-heading-number-{id}','convert_aozora_headings',f'［＃{n}字下げ］章［＃「章」は大見出し］')
 add(f'python-indent-number-{id}','convert_aozora_indent',f'［＃{n}字下げ］本文')
 add(f'python-jiage-number-{id}','convert_aozora_align_end',f'［＃地から{n}字上げ］署名',approximate_jiage=True)
# Empty blocks in each document position probe removal of LF separators, not just content.
for i,s in enumerate(['{block}','前\n{block}','{block}\n後','前\n{block}\n後','前\n{block}\n']):
 add(f'python-empty-emphasis-block-{i}','convert_aozora_markdown_emphasis',s.format(block='［＃ここから太字］\n［＃ここで太字終わり］'))
 add(f'python-empty-underline-block-{i}','convert_aozora_underline',s.format(block='［＃ここから傍線］\n［＃ここで傍線終わり］'))
# Branch-focused controls that retain the mature syntax and counter denominators.
extra = {
 'convert_aozora_gaiji': ['※［＃］', 'A［＃「A」は］'],
 'convert_aozora_markdown_emphasis': [
  '［＃太字］［＃斜体］a*b［＃斜体終わり］［＃太字終わり］',
  '［＃ここから斜体］\n本文\n［＃ここで斜体終わり］',
  '［＃ここから太字］\n```\n例\n```',
  '［＃ここから太字］\n本文\n［＃ここで斜体終わり］'],
 'convert_aozora_underline': [
  '［＃傍線］［＃傍線終わり］','［＃傍線］a||b［＃傍線終わり］',
  '［＃ここから傍線］\n本文',
  '［＃ここから傍線］\na||b\n［＃ここで傍線終わり］',
  '［＃ここから傍線］\n```\n例\n```',
  '［＃ここから傍線］\n本文\n［＃ここで波線終わり］'],
 'convert_aozora_bouten': ['別［＃「青」に傍点］','青［＃「」に傍点］'],
 'convert_aozora_align_end': [
  '［＃ここから地付き］\n:::align-end\n署名\n:::',
  '［＃ここから地付き］\n［＃ここから地付き］\n署名\n［＃ここで地付き終わり］',
  '［＃ここで地付き終わり］',
  '［＃ここから地から３字上げ］\n:::align-end\n署名\n:::',
  '［＃ここから地付き］\n［＃ここから地から３字上げ］\n本文\n［＃ここで地付き終わり］',
  '［＃ここから地付き］\n前［＃地から３字上げ、修飾］後\n［＃ここで地付き終わり］',
  '［＃地付き］［＃地から３字上げ］',
  '［＃ここから地付き］\n\n署名\n［＃ここで地付き終わり］'],
 'convert_aozora_page_breaks': ['［＃改丁］\n:::page-break\n:::', '［＃改ページ］\n  \n本文'],
 'parse_aozora_header': ['題\n\n本文','\n','題\n著者\n','題\n著者\n甲訳\n\n本文'],
 'remove_aozora_footer_metadata': ['', '底本：資料\n入力：人\n青空文庫作成ファイル：', '底本：資料\n行\n青空文庫作成ファイル：'],
 'extract_frontmatter_metadata': ['本文','---\n閉じなし','---\ntitle: 題\nother:\nauthors:\n  - 甲\nnext: 値\n---'],
 'reconstruct_header_from_metadata': [{},{'title':'題'},{'author':'人'},{'translators':['甲訳','乙訳']}],
 'get_metadata_from_text': ['本文','題\n著者\n\n本文','題\n副題\n甲\n乙\n\n本文','題\n\n本文'],
 'create_frontmatter': [{},{'title':'題'},{'author':'人'},{'translator':'人訳'},{'translators':['甲訳','乙訳']}],
 'sanitize_filename': ['','通常題名'],
}
for fn,values in extra.items():
 for i,value in enumerate(values):add(f'branch-{fn}-{i}',fn,value)
for left in [False,True]:
 add(f'branch-underline-left-{left}','convert_aozora_underline','青［＃「青」の左に傍線］',approximate_left=left)
for style in ['波線','左に二重傍線']:
 for block in [False,True]:
  text=(f'［＃ここから{style}］\n本文\n［＃ここで{style}終わり］' if block else f'［＃{style}］本文［＃{style}終わり］')
  add(f'branch-underline-special-{style}-{block}','convert_aozora_underline',text,approximate_left=True,approximate_other_styles=True)
for text in ['［＃傍線］<u>本文</u>［＃傍線終わり］','［＃ここから傍線］\n<u>本文</u>\n［＃ここで傍線終わり］']:
 add('branch-underline-html-'+str(len(text)),'convert_aozora_underline',text,output_format='html')
(ROOT/'tests/fixtures/differential.json').write_text(json.dumps(cases,ensure_ascii=False,indent=2)+'\n')
print(f'Generated {len(cases)} independent strict differential controls.')
