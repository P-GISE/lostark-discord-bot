"""Print finding coordinates and counts only. Never secret, patch, author, or body."""
import json
from pathlib import Path
import sys

folder = Path(sys.argv[1])
statuses = dict(zip(['tree', 'history', 'vuln'], map(int, sys.argv[2:]), strict=True))
failed = False
for scope in ['tree', 'history']:
    report = folder / f'{scope}.json'
    if not report.exists() or statuses[scope] not in [0, 1]:
        print(f'{scope}: scanner did not complete; blocking')
        failed = True
        continue
    findings = json.loads(report.read_text(encoding='utf-8')) or []
    print(f'{scope}: {len(findings)} secret candidates (redacted; no raw report uploaded)')
    for entry in findings:
        path = str(entry.get('File', '')).replace(str(folder / 'inputs/tree'), '<tracked>').replace(str(folder / 'tree'), '<tracked>')
        print(json.dumps({'scope': scope, 'rule': entry.get('RuleID'), 'file': path,
                          'line': entry.get('StartLine')}, ensure_ascii=True))
    failed = failed or statuses[scope] != 0 or bool(findings)
report = folder / 'vuln.json'
if not report.exists() or statuses['vuln'] not in [0, 1]:
    print('dependency: scanner did not complete; blocking')
    failed = True
else:
    data = json.loads(report.read_text(encoding='utf-8'))
    results = data.get('Results', [])
    mapping_path = folder / 'identified-locks.json'
    mapping = json.loads(mapping_path.read_text(encoding='utf-8')) if mapping_path.exists() else {}
    targets = []
    for item in results:
        identified = item.get('Target', '').replace('\\', '/')
        original = mapping.get(identified, identified.removeprefix('tree/'))
        targets.append({'target': original, 'identified_as': identified if identified in mapping else None,
                        'type': item.get('Type'), 'high_critical': len(item.get('Vulnerabilities') or [])})
    total = sum(item['high_critical'] for item in targets)
    print(json.dumps({'dependency_targets': targets, 'high_critical': total}, ensure_ascii=True))
    if not targets:
        print('No recognized dependency target: library vulnerability coverage UNASSESSED, not proof of safety.')
    failed = failed or statuses['vuln'] != 0 or total > 0
sys.exit(1 if failed else 0)
