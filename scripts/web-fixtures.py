"""Independent ephemeral UI input fixtures. No product APIs or golden regeneration."""
import base64
import io
import json
import zipfile

def archive(entries):
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, 'w', compression=zipfile.ZIP_DEFLATED) as output:
        for name, data in entries:
            output.writestr(name, data)
    return base64.b64encode(stream.getvalue()).decode('ascii')

print(json.dumps({
    'pages.zip': archive([(f'doc{i:02}.md', f'body-{i:02}\n') for i in range(52)]),
    'large.zip': archive([(f'doc{i:02}.md', 'A' * 100000) for i in range(40)]),
    'empty.zip': archive([]),
    'ignored.zip': archive([('image.png', b'not decoded')]),
    'cp932.txt': base64.b64encode('①髙'.encode('cp932')).decode('ascii'),
    'shift.txt': base64.b64encode('青空'.encode('shift_jis')).decode('ascii'),
}))
