"""Exercise the real design and Oxlint gates; restore every temporary input."""
import hashlib
import json
import pathlib
import subprocess
import uuid

root = pathlib.Path(__file__).resolve().parents[2]
manifest_path = root / 'verification/paper/kanon-manifest.json'
inventory_path = root / 'docs/design/legacy-ui-imports.json'
fixture = root / f'apps/web/src/design-guard-{uuid.uuid4().hex}.tsx'
original_manifest = manifest_path.read_bytes()
original_inventory = inventory_path.read_bytes()
manifest = json.loads(original_manifest)
inventory = json.loads(original_inventory)
results = []


def check(name, command, expected_text=None):
    run = subprocess.run(command, cwd=root, text=True, capture_output=True)
    output = run.stdout + run.stderr
    passed = run.returncode == 0 if expected_text is None else run.returncode != 0 and expected_text in output
    results.append({'case': name, 'passed': passed, 'exitCode': run.returncode, 'output': output})
    if not passed:
        raise RuntimeError(f'{name}: unexpected gate result\n{output}')


def run_guard(name, expected_text):
    check(name, ['node', 'verification/paper/check.mjs'], expected_text)


try:
    check('baseline succeeds', ['node', 'verification/paper/check.mjs'])
    for name, source in [
        ('import', 'import { Button } from "@open-erp/ui/components/button";'),
        ('re-export', 'export { Button } from "@open-erp/ui/components/button";'),
        ('dynamic import', 'export const load = () => import("@open-erp/ui/components/button");'),
        ('template import', 'export const load = () => import(`@open-erp/ui/components/button`);'),
        ('require', 'export const load = () => require("@open-erp/ui/components/button");'),
    ]:
        fixture.write_text(source + '\n')
        check(name + ' fails Oxlint', ['bunx', '--no-install', 'oxlint', '--config', '.oxlintrc.changed.json', str(fixture.relative_to(root))], 'no-new-legacy-ui-imports')
    fixture.write_text('export const newScreen = null;\n')
    run_guard('unmapped UI refused', 'Changed UI file needs screen contract')
    fixture.unlink()
    candidate = json.loads(original_manifest)
    candidate['entries'][0]['baselineSha256'] = '0' * 64
    manifest_path.write_text(json.dumps(candidate))
    run_guard('changed reference refused', 'Changed baseline')
    candidate = json.loads(original_manifest)
    candidate['entries'].append(candidate['entries'][0])
    manifest_path.write_text(json.dumps(candidate))
    run_guard('duplicate screen refused', 'Duplicate screen ID')
    candidate = json.loads(original_manifest)
    candidate['entries'][0]['status'] = 'matches'
    manifest_path.write_text(json.dumps(candidate))
    run_guard('unproved parity refused', 'Measured status needs route and tracked evidence')
    manifest_path.write_bytes(original_manifest)
    candidate = json.loads(original_inventory)
    candidate['imports'].append('apps/web/src/fake.tsx:@open-erp/ui/components/button')
    inventory_path.write_text(json.dumps(candidate))
    run_guard('inventory growth refused', 'legacy inventory' if subprocess.run(['git', 'cat-file', '-e', 'HEAD:docs/design/legacy-ui-imports.json'], cwd=root, capture_output=True).returncode else 'Legacy inventory may only shrink')
    inventory_path.write_bytes(original_inventory)
    candidate = json.loads(original_manifest)
    candidate['entries'].pop()
    manifest_path.write_text(json.dumps(candidate))
    run_guard('removed board refused', 'Missing retained board')
    manifest_path.write_bytes(original_manifest)
    comparison_root = root / 'test-results/design-guard/comparator'
    comparison_root.mkdir(parents=True, exist_ok=True)
    entry = next(row for row in manifest['entries'] if row['id'] == 'K-10')
    capture = {
        'actual': entry['baseline'], 'command': 'synthetic comparator protocol verification',
        'reviewer': 'protocol verification; no UI approval', 'sourceRevision': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip(),
        'sourceHashes': {file: hashlib.sha256((root / file).read_bytes()).hexdigest() for file in entry['files']},
        'conditions': {'browser': 'synthetic control, not a browser capture', 'deviceScaleFactor': 1, 'fonts': 'Paper reference control', 'locale': 'sv-SE', 'theme': 'light', 'time': 'fixed synthetic control', 'fixture': 'comparator protocol only', 'viewport': entry['viewport'], 'route': '/synthetic-control'},
    }
    capture_path = comparison_root / 'capture.json'
    capture_path.write_text(json.dumps(capture))
    command = ['node', 'verification/paper/compare.mjs', 'K-10', str(capture_path.relative_to(root)), str((comparison_root / 'output').relative_to(root))]
    check('unadopted comparison refused', command, 'Adopt the exact state')
    candidate = json.loads(original_manifest)
    selected = next(row for row in candidate['entries'] if row['id'] == 'K-10')
    selected.update({'adoption': 'approved', 'route': '/synthetic-control', 'comparison': {'channelTolerance': 0, 'maxDiffRatio': 0, 'adoptedBy': 'synthetic protocol verification only'}})
    manifest_path.write_text(json.dumps(candidate))
    check('identical image control passes comparator', command)
    generator = "import {createRequire} from 'node:module'; import {writeFileSync} from 'node:fs'; const {PNG}=createRequire(import.meta.resolve('e2e'))('pngjs'); const p=new PNG({width:Number(process.argv[2]),height:Number(process.argv[3])}); p.data.fill(255); writeFileSync(process.argv[1],PNG.sync.write(p));"
    mismatch = comparison_root / 'mismatch.png'
    subprocess.run(['node', '--input-type=module', '-e', generator, str(mismatch), str(entry['viewport']['width']), str(entry['viewport']['height'])], cwd=root, check=True)
    capture['actual'] = str(mismatch.relative_to(root))
    capture_path.write_text(json.dumps(capture))
    check('controlled visual mismatch fails comparator', command, '"passed":false')
    subprocess.run(['node', '--input-type=module', '-e', generator, str(mismatch), '1', '1'], cwd=root, check=True)
    check('wrong dimensions refused', command, 'Image dimensions differ')
    capture['sourceHashes'][entry['files'][0]] = '0' * 64
    capture_path.write_text(json.dumps(capture))
    check('changed source after capture refused', command, 'Implementation changed after capture')
finally:
    fixture.unlink(missing_ok=True)
    manifest_path.write_bytes(original_manifest)
    inventory_path.write_bytes(original_inventory)

check('restored baseline succeeds', ['node', 'verification/paper/check.mjs'])
report = {
    'scope': 'Real repository design-contract and Oxlint integration; no browser or visual parity claim.',
    'repeat': 'python3 verification/paper/verify-guard.py',
    'sources': {str(path.relative_to(root)): hashlib.sha256(path.read_bytes()).hexdigest() for path in [root / 'verification/paper/check.mjs', root / 'config/oxlint/anti-slop/rules/no-new-legacy-ui-imports.ts']},
    'results': results,
}
output = root / 'test-results/design-guard/results.json'
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps(report, indent=2) + '\n')
print(f'{len(results)} integration cases pass; artifact: {output.relative_to(root)}')
