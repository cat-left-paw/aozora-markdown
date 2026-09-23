"""Independent aozora-import-v1 fixtures. Python zipfile + deliberate binary cases.
Run --check in gates; no zip.js writer/oracle involved. Never changes old fixtures.
"""
import sys, io, struct, zlib, zipfile, json, hashlib, warnings
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1] / 'tests/fixtures/zip'
fixtures = {}
producer_records = {}
def put(name, data, purpose): fixtures[name] = (bytes(data), purpose)
def pack(entries):
    local, central = bytearray(), bytearray()
    for e in entries:
        name = e['name']; raw = e.get('data', b'OK'); method = e.get('method', 0)
        compressed = zlib.compress(raw)[2:-4] if method == 8 else raw
        compressed = e.get('compressed', compressed)
        flags = e.get('flags', 0); extra = e.get('extra', b'')
        if e.get('zip64'): extra=struct.pack('<HHQQ',1,16,e.get('zip64size',len(raw)),len(compressed))
        declared_comp=0xffffffff if e.get('zip64') else e.get('csize',len(compressed))
        declared_size=0xffffffff if e.get('zip64') else e.get('size',len(raw))
        crc = e.get('crc', zlib.crc32(raw)); size = declared_size; offset = e.get('offset', len(local))
        localname = e.get('localname', name)
        localextra = e.get('localextra', extra)
        local += struct.pack('<IHHHHHIIIHH', 0x04034b50,45 if e.get('zip64') else 20, e.get('localflags', flags),e.get('localmethod',method),0,33, e.get('localcrc', crc),e.get('localsize',declared_comp),e.get('localusize',size),len(localname),len(localextra)) + localname + localextra + compressed
        if e.get('descriptor'): local+=struct.pack('<IIII',0x08074b50,e.get('descriptor_crc',crc),len(compressed),size)
        central += struct.pack('<IHHHHHHIIIHHHHHII',0x02014b50,0x0314,45 if e.get('zip64') else 20,flags,method,0,33,crc,declared_comp,size,len(name),len(extra),0,e.get('disk',0),0,e.get('mode',0o100644)<<16,offset) + name + extra
    data=local + central + struct.pack('<IHHHHIIH',0x06054b50,0,0,len(entries),len(entries),len(central),len(local),0)
    producer_records[hashlib.sha256(data).hexdigest()]=[{'rawNameHex':e['name'].hex(),'sourceBytes':len(e.get('data',b'OK')),'sourceSha256':hashlib.sha256(e.get('data',b'OK')).hexdigest(),**({'sourceHex':e.get('data',b'OK').hex()} if len(e.get('data',b'OK'))<=1024 else {})} for e in entries]
    return data
def prepend(data, count, rebase):
    prefix = b'A' * count
    result = bytearray(prefix + data)
    old_eocd = data.rfind(struct.pack('<I', 0x06054b50))
    eocd = count + old_eocd
    entries = struct.unpack_from('<H', data, old_eocd + 10)[0]
    central = count + struct.unpack_from('<I', data, old_eocd + 16)[0]
    for _ in range(entries):
        assert struct.unpack_from('<I', result, central)[0] == 0x02014b50
        if rebase:
            offset = struct.unpack_from('<I', result, central + 42)[0]
            struct.pack_into('<I', result, central + 42, offset + count)
        name, extra, comment = struct.unpack_from('<HHH', result, central + 28)
        central += 46 + name + extra + comment
    if rebase:
        offset = struct.unpack_from('<I', result, eocd + 16)[0]
        struct.pack_into('<I', result, eocd + 16, offset + count)
    return bytes(result)
def eocd_disk_entries(data, count):
    result = bytearray(data)
    eocd = data.rfind(struct.pack('<I', 0x06054b50))
    struct.pack_into('<H', result, eocd + 8, count)
    return bytes(result)
def with_zip64_end_record(data, disk_entries=0xffff, total_entries=0xffff, sentinel_mode='none'):
    eocd = data.rfind(struct.pack('<I', 0x06054b50))
    result = bytearray(data)
    total = struct.unpack_from('<H', data, eocd + 10)[0]
    central_bytes, central_offset = struct.unpack_from('<II', data, eocd + 12)
    record = struct.pack('<IQHHIIQQQQ', 0x06064b50, 44, 45, 45, 0, 0, total, total, central_bytes, central_offset)
    locator = struct.pack('<IIQI', 0x07064b50, 0, eocd, 1)
    struct.pack_into('<HH', result, eocd + 8, disk_entries, total_entries)
    if sentinel_mode in ['size', 'both']: struct.pack_into('<I', result, eocd + 12, 0xffffffff)
    if sentinel_mode in ['offset', 'both']: struct.pack_into('<I', result, eocd + 16, 0xffffffff)
    return bytes(result[:eocd] + record + locator + result[eocd:])
def with_comment(data, comment):
    assert len(comment) <= 0xffff
    eocd = data.rfind(struct.pack('<I', 0x06054b50))
    result = bytearray(data + comment)
    struct.pack_into('<H', result, eocd + 20, len(comment))
    return bytes(result)
def unicode_extra(raw, text, version=1, crc=None, payload=None):
    val = bytes([version]) + struct.pack('<I', zlib.crc32(raw) if crc is None else crc) + (text.encode() if payload is None else payload)
    return struct.pack('<HH',0x7075,len(val))+val
buf = io.BytesIO()
with warnings.catch_warnings():
    warnings.simplefilter('ignore')
    with zipfile.ZipFile(buf,'w') as z:
        for name, data, method in [('same.txt',b'FIRST',0),('same.txt',b'SECOND',8),('a/book.TXT','青［＃「青」に傍点］'.encode(),8),('b/book.txt',b'OTHER',0),('画像.png',b'IGNORED',0),('nested.zip',b'IGNORED',0),('empty/',b'',0)]:
            i=zipfile.ZipInfo(name,(2020,1,1,0,0,0)); i.compress_type=method; z.writestr(i,data)
put('normal.zip',buf.getvalue(),'S2-01/02: Python zipfile STORE/DEFLATE, duplicates, hierarchy, ignored')
put('empty.zip',pack([]),'S2-01: empty archive')
put('ignored.zip',pack([{'name':b'image.png'}]),'S2-01: no supported entry')
boundary_zip = pack([{'name':b'a.txt'}])
for count in range(6):
    put(f'prefix-rebased-{count}.zip',prepend(boundary_zip,count,True),'S2-02: rebased prepended-data boundary')
for count in range(1,6):
    put(f'prefix-unadjusted-{count}.zip',prepend(boundary_zip,count,False),'S2-02: unadjusted prepended-data boundary')
for count in range(1,6):
    put(f'empty-prefix-{count}.zip',prepend(pack([]),count,True),'S2-02: empty archive prepended-data boundary')
for count in [0,1,2]:
    put(f'eocd-disk-entries-{count}.zip',eocd_disk_entries(boundary_zip,count),'S2-02: EOCD single-disk entry count consistency')
put('eocd-disk-entries-sentinel.zip',eocd_disk_entries(boundary_zip,0xffff),'S2-02: EOCD ZIP64 sentinel without locator')
put('zip64-end-record.zip',with_zip64_end_record(boundary_zip),'S2-02: valid ZIP64 resolved entry count')
for mode in ['size','offset','both']:
    put(f'zip64-{mode}-sentinel.zip',with_zip64_end_record(boundary_zip,1,1,mode),'S2-02: valid field-specific ZIP64 sentinel')
    for count in [0,2]:
        put(f'zip64-disk-{count}-{mode}.zip',with_zip64_end_record(boundary_zip,count,1,mode),'S2-02: non-sentinel classic/ZIP64 entry count mismatch')
put('comment-plain.zip',with_comment(boundary_zip,b'Archive comment'),'S2-02: ordinary global ZIP comment')
put('comment-signature-only.zip',with_comment(boundary_zip,struct.pack('<I',0x06054b50)),'S2-02: EOCD signature bytes in global comment')
for prefix,suffix in [(0,0),(3,0),(0,7)]:
    fake = struct.pack('<IHHHHIIH',0x06054b50,0,0,1,1,1,0,suffix)
    comment = b'A'*prefix + fake + b'A'*suffix
    put(f'comment-unreachable-{prefix}-{suffix}.zip',with_comment(boundary_zip,comment),'S2-02: unreachable EOCD-like bytes in global comment')
put('comment-real-ambiguity.zip',with_comment(boundary_zip,boundary_zip[-22:]),'S2-02: two EOCD records reaching the actual central directory')
for name, entries, purpose in [
 ('payload-central',[{'name':b'a.txt','data':b'A','csize':50}],'S2-02: payload overlaps central directory'),
 ('descriptor',[{'name':b'a.txt','flags':8,'localcrc':0,'localsize':0,'localusize':0,'descriptor':True}],'S2-02: data descriptor'),
 ('descriptor-bad',[{'name':b'a.txt','flags':8,'localcrc':0,'localsize':0,'localusize':0,'descriptor':True,'descriptor_crc':0}],'S2-02: contradictory descriptor'),
 ('zip64',[{'name':b'a.txt','zip64':True}],'S2-02: safe ZIP64 numbers'),
 ('zip64-unsafe',[{'name':b'a.txt','zip64':True,'zip64size':9007199254740992}],'S2-02: unsafe ZIP64 size'),
 ('cancel',[{'name':b'a.txt','data':b'A'*8388608,'method':8}],'S2-06: bounded real-worker expansion cancel'),
 ('percent',[{'name':b'%2e%2e/book.txt'}],'R06: no percent decoding'),
 ('long-name',[{'name':b'a'*4093+b'.txt'}],'S2-04: raw name default limit'),
 ('cp437',[{'name':b'caf\x82.txt'}],'S2-03: CP437 e acute'),
 ('utf8-unflagged',[{'name':'é.txt'.encode()}],'S2-03: never guess UTF8'),
 ('utf8',[{'name':'題.TXT'.encode(),'flags':0x800}],'S2-03: UTF8 flag'),
 ('utf8-invalid',[{'name':b'\xff.txt','flags':0x800}],'S2-03: strict UTF8'),
 ('symlink',[{'name':b'link.txt','mode':0o120777}],'R06: Unix symlink'),
 ('encrypted',[{'name':b'a.txt','flags':1}],'S2-02: encrypted'),
 ('unknown-flag',[{'name':b'a.txt','flags':0x4000}],'S2-03: no flag guessing'),
 ('unsupported',[{'name':b'a.txt','method':99}],'S2-02: unsupported compression'),
 ('split',[{'name':b'a.txt','disk':1}],'S2-02: split'),
 ('bad-crc',[{'name':b'a.txt','crc':0}],'S2-02: CRC mismatch'),
 ('bad-deflate',[{'name':b'a.txt','method':8,'compressed':b'\xff\xff\xff'}],'S2-02: invalid deflate'),
 ('header-name',[{'name':b'a.txt','localname':b'b.txt'}],'S2-02: local filename mismatch'),
 ('header-method',[{'name':b'a.txt','localmethod':8}],'S2-02: local method mismatch'),
 ('header-zero',[{'name':b'a.txt','localcrc':0,'localsize':0,'localusize':0}],'S2-02: zero local values without descriptor'),
 ('header-flag',[{'name':b'a.txt','localflags':0x800}],'S2-02: local flag mismatch'),
 ('offset',[{'name':b'a.txt','offset':0xfffffff0}],'S2-02: out of bounds'),
 ('overlap',[{'name':b'a.txt'},{'name':b'a.txt','offset':0}],'S2-02: same payload duplicate reference'),
 ('atomic-crc',[{'name':b'first.txt','data':b'FIRST'},{'name':b'bad.txt','crc':0}],'S2-02: discard earlier stage'),
 ('atomic-decode',[{'name':b'first.txt','data':b'FIRST'},{'name':b'bad.txt','data':b'\xff'}],'S2-02: strict decode failure'),
 ('chunk',[{'name':b'a.txt','data':b'A'*262144,'method':8}],'S2-04: small compressed streaming quota fixture'),
 ('forged-small',[{'name':b'a.txt','data':b'A'*262144,'method':8,'size':1}],'S2-04: forged declared small size'),
 ('forged-large',[{'name':b'a.txt','data':b'ABC','method':8,'size':100}],'S2-04: wrong large size'),
 ('many-empty',[{'name':str(i).encode()+b'.txt','data':b''} for i in range(10)],'S2-04: zero payload entries still counted'),
 ('collision',[{'name':n.encode(),'data':b'OK','flags':0x800} for n in ['CON.txt','a?.txt','a*.txt','É.txt','E\u0301.txt','A/book.txt','a/book.txt']],'R03/05/18: sanitize NFC case grouping'),
 ('mixed-separators',[{'name':b'a\\b/c.txt'}],'R06: normalized separators'),
]: put(name+'.zip',pack(entries),purpose)
for label, name in [('dotdot',b'../a.txt'),('backdot',b'a\\..\\b.txt'),('drive',b'C:a.txt'),('unc',b'\\\\host\\a.txt'),('absolute',b'/a.txt'),('nul',b'a\x00.txt'),('c0',b'a\x1f.txt'),('unsafe-ignored',b'../x.png'),('unsafe-directory',b'../x/'),('unsafe-nested',b'../x.zip')]:
    put(label+'.zip',pack([{'name':b'first.txt'},{'name':name}]),'R06: all metadata before payload')
raw=b'base.txt'
for label, name, extra in [
 ('unicode-valid',raw,unicode_extra(raw,'題.txt')),
 ('unicode-bad-crc',raw,unicode_extra(raw,'題.txt',crc=0)),
 ('unicode-bad-version',raw,unicode_extra(raw,'題.txt',version=2)),
 ('unicode-bad-utf8',raw,unicode_extra(raw,'',payload=b'\xff.txt')),
 ('unicode-bad-directory',raw,unicode_extra(raw,'',payload=b'\xff/')),
 ('unicode-decoded-unsafe',raw,unicode_extra(raw,'../bad.txt')),
 ('unicode-raw-unsafe',b'../bad.txt',unicode_extra(b'../bad.txt','safe.txt')),
]: put(label+'.zip',pack([{'name':name,'extra':extra}]),'S2-03/R06: Unicode Path validation')
put('unicode-local-unsafe.zip',pack([{'name':raw,'localextra':unicode_extra(raw,'../bad.txt')}]),'S2-02/R06: unsafe local Unicode Path')
put('unicode-local-mismatch.zip',pack([{'name':raw,'extra':unicode_extra(raw,'題.txt'),'localextra':unicode_extra(raw,'別.txt')}]),'S2-02: contradictory local Unicode Path')
put('unicode-central-only.zip',pack([{'name':raw,'extra':unicode_extra(raw,'題.txt'),'localextra':b''}]),'S2-03: optional local Unicode Path is absent')
put('integration.zip',pack([
 {'name':b'heading.txt','data':'※［＃U+9752］［＃「青」に傍点］［＃「青」は大見出し］'.encode(),'method':8},
 {'name':b'preserve.txt','data':'［＃２字下げ］青\n-----\n［＃未対応］\n-----\n［＃未対応］'.encode()},
 {'name':b'fm.md','data':'---\ntitle: 題\nauthor: 著者\nraw_header: |\n  題\n  ---\n  ［＃内］\n---\n［＃傍線］青［＃「青」は太字］［＃傍線終わり］［＃「青」は大見出し］'.encode(),'method':8},
]),'S2-01/05: composed batch independent input and expected outputs in import-contract.mjs')
put('truncated.zip',buf.getvalue()[:-8],'S2-02: truncation')
put('appended.zip',buf.getvalue()+b'extra','S2-02: ambiguity')
put('prepended.zip',b'extra'+buf.getvalue(),'S2-02: ambiguity')
manifest={'producer':'Python zipfile + struct/zlib; scripts/generate_zip_fixtures.py', 'contract':'aozora-import-v1','files':{}}
for name,(data,purpose) in sorted(fixtures.items()):
    manifest['files'][name]={'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data),'purpose':purpose, 'producerEntries':producer_records.get(hashlib.sha256(data).hexdigest(),[])}
    if '--check' in sys.argv:
        assert (ROOT/name).read_bytes()==data,name
    else: (ROOT/name).write_bytes(data)
serialized=(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n').encode()
if '--check' in sys.argv: assert (ROOT/'manifest.json').read_bytes()==serialized
else: (ROOT/'manifest.json').write_bytes(serialized)
table = '// Generated by scripts/generate_zip_fixtures.py using CPython 3.12.8 cp437.\nexport const CP437 =\n  ' + json.dumps(''.join(bytes([i]).decode('cp437') for i in range(256)),ensure_ascii=True) + ';\n'
table_path=ROOT.parents[2] / 'src/import/cp437.generated.ts'
if '--check' in sys.argv: assert table_path.read_text()==table
else: table_path.write_text(table)
print(f'{len(fixtures)} independent ZIP fixtures and 256 CP437 values verified')
