"""Independent classic STORE profile oracle. Expectations come from caller bytes."""
import base64
import binascii
import io
import json
import struct
import sys
import zipfile


def check(data, expected):
    u16 = lambda p: struct.unpack_from('<H', data, p)[0]
    u32 = lambda p: struct.unpack_from('<I', data, p)[0]
    assert data[:4] == b'PK\x03\x04'
    end = len(data) - 22
    assert data[end:end+4] == b'PK\x05\x06'
    assert u16(end+4) == u16(end+6) == u16(end+20) == 0
    assert u16(end+8) == u16(end+10) == len(expected)
    central = u32(end+16)
    assert central + u32(end+12) == end
    cursor = 0
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        assert z.comment == b''
        assert len(z.infolist()) == len(expected)
        for info, entry in zip(z.infolist(), expected):
            name = entry['relativePath'].encode('utf-8')
            body = base64.b64decode(entry['base64'])
            crc = binascii.crc32(body)
            assert info.filename == entry['relativePath']
            assert info.header_offset == cursor
            assert info.date_time == (1980, 1, 1, 0, 0, 0)
            assert info.compress_type == 0 and info.flag_bits & 0x800
            assert info.flag_bits & ~0x808 == 0
            assert info.external_attr == 0o100644 << 16
            assert info.create_system == 3 and info.internal_attr == 0
            assert info.extra == info.comment == b''
            assert info.CRC == crc
            assert info.file_size == info.compress_size == len(body)
            assert z.read(info) == body
            assert data[cursor:cursor+4] == b'PK\x03\x04'
            assert u16(cursor+6) == info.flag_bits and u16(cursor+8) == 0
            assert u32(cursor+10) == 0x00210000
            assert u16(cursor+26) == len(name) and u16(cursor+28) == 0
            assert data[cursor+30:cursor+30+len(name)] == name
            if info.flag_bits & 8:
                assert u32(cursor+14) == u32(cursor+18) == u32(cursor+22) == 0
            else:
                assert u32(cursor+14) == crc
                assert u32(cursor+18) == u32(cursor+22) == len(body)
            cursor += 30 + len(name)
            assert data[cursor:cursor+len(body)] == body
            cursor += len(body)
            if info.flag_bits & 8:
                assert data[cursor:cursor+4] == b'PK\x07\x08'
                assert u32(cursor+4) == crc
                assert u32(cursor+8) == u32(cursor+12) == len(body)
                cursor += 16
            assert data[central:central+4] == b'PK\x01\x02'
            assert u16(central+28) == len(name)
            assert u16(central+30) == u16(central+32) == u16(central+34) == 0
            assert u16(central+8) == info.flag_bits and u16(central+10) == 0
            assert u32(central+12) == 0x00210000
            assert u32(central+16) == crc
            assert u32(central+20) == u32(central+24) == len(body)
            assert u32(central+38) == 0o100644 << 16
            assert u32(central+42) == info.header_offset
            assert data[central+46:central+46+len(name)] == name
            central += 46 + len(name)
        assert cursor == u32(end+16) and central == end


if __name__ == '__main__':
    request = json.load(sys.stdin)
    check(base64.b64decode(request['zip']), request['entries'])
    print(json.dumps({'entries': len(request['entries']), 'passed': True}))
