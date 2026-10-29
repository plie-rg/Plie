"""Produce raw Apps Script HTML; never HtmlTemplate.evaluate the JS bundle."""
from pathlib import Path
import json
import base64

ROOT=Path(__file__).resolve().parent
SITE=ROOT.parent
html=(SITE/'cms-app/web/index.html').read_text(encoding='utf-8')
css=(SITE/'cms-app/web/cms.css').read_text(encoding='utf-8')
bridge=(ROOT/'bridge.js').read_text(encoding='utf-8')
boot=(ROOT/'boot.js').read_text(encoding='utf-8')
js=(SITE/'cms-app/web/cms.js').read_text(encoding='utf-8')
html=html.replace('<link rel="stylesheet" href="/cms/cms.css">','<style>'+css+'</style>')
html=html.replace('<script src="/cms/cms.js" defer></script>','')
# Keep template literals and regexes out of HtmlService's inline HTML processing.
# Only our fixed, build-time editor source is encoded; user data is never executable.
scripts=bridge+'\n'+js
encoded=base64.b64encode(scripts.encode('utf-8')).decode('ascii')
chunks=[encoded[i:i+240] for i in range(0,len(encoded),240)]
loader=(ROOT/'loader.js').read_text(encoding='utf-8')
assert loader.count('/*CMS_EDITOR_BASE64*/')==1
loader=loader.replace('/*CMS_EDITOR_BASE64*/',json.dumps(chunks))
html=html.replace('</body>','<script>'+boot+'</script><script>'+loader+'</script></body>')
assert '<?' not in html
(ROOT/'Admin.html').write_text(html,encoding='utf-8')
article=(SITE/'cms-app/article.html').read_text(encoding='utf-8')
(ROOT/'Article.html').write_text(article,encoding='utf-8')
backend=(ROOT/'Code.gs').read_text(encoding='utf-8')
for source, replacement in [
    ("HtmlService.createHtmlOutputFromFile('Admin').getContent()", 'CMS_ADMIN_HTML'),
    ("HtmlService.createHtmlOutputFromFile('Article').getContent()", 'CMS_ARTICLE_HTML'),
]:
    assert backend.count(source)==1, source
    backend=backend.replace(source,replacement)
bundle=('// Paste this entire file into Code.gs in the Plie content CMS project.\n'
        '// For updates, keep the existing project and deployment; existing data and properties are retained.\n'
        '// Do not paste into the rental project. No additional HTML files are required.\n'
        +backend+'\nconst CMS_ADMIN_HTML = '+json.dumps(html,ensure_ascii=True)+';\n'
        +'const CMS_ARTICLE_HTML = '+json.dumps(article,ensure_ascii=True)+';\n')
assert 'createHtmlOutputFromFile' not in bundle
(ROOT/'Install.gs').write_text(bundle,encoding='utf-8')
print('Built Admin.html, Article.html and single-file Install.gs; no tokens included.')
