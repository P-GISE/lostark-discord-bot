"""Identify nonstandard pip lock names in separate scanner inputs, preserving tracked source."""
from pathlib import Path
import json
import shutil
import sys

def prepare(folder: Path):
    tree = folder / 'inputs/tree'
    mapping = {}
    for source in sorted(tree.rglob('requirements.lock')):
        if source.is_symlink() or not source.resolve().is_relative_to(tree.resolve()):
            raise ValueError('Pip lock input must be a tracked regular file inside the exported tree')
        relative = source.relative_to(tree)
        # Keep the real requirements.txt even when it shares the same source directory.
        target = folder / 'inputs/normalized-locks' / relative / 'requirements.txt'
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
        mapping[target.relative_to(folder / 'inputs').as_posix()] = relative.as_posix()
    (folder / 'identified-locks.json').write_text(json.dumps(mapping), encoding='utf-8')
    return mapping

if __name__ == '__main__':
    prepare(Path(sys.argv[1]))
