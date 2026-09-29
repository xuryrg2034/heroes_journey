"""Generate movement vectors by invoking the external recovered Python model.

No native DLL is loaded and no external research file is modified. The product
uses a stricter occupied/cardinal eligibility adapter; the pure ordering rule is
tested separately from that adapter. Run with --source to relocate the research.
"""
from pathlib import Path
import argparse
import hashlib
import importlib.util
import json
import sys
from collections import Counter


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', type=Path, default=Path('D:/GameResearch/Grindstone/Recovery/recovered_enemies.py'))
    parser.add_argument('--output', type=Path, default=Path(__file__).with_name('recovered-movement.json'))
    args = parser.parse_args()
    sys.dont_write_bytecode = True
    sys.path.insert(0, str(args.source.parent))
    spec = importlib.util.spec_from_file_location('fixture_recovered_enemies', args.source)
    model = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = model
    spec.loader.exec_module(model)
    vectors = []

    def add(case_id, start, goal, min_dist, eligible, draws, descriptors=None, playable=None):
        allowed = set(eligible)
        class Ops:
            def __init__(self):
                self.rng_calls = []
                self.eligibility_calls = []
            def valid(self, x, y):
                self.eligibility_calls.append([x, y])
                return (x, y) in allowed
            def cell(self, x, y):
                descriptor = (descriptors or {}).get((x, y), 'creep')
                if descriptor == 'empty':
                    return None
                return model.Actor(subtype={'creep': 2, 'fire': 112}.get(descriptor, 99),
                    kind=5 if descriptor == 'item' else 1,
                    properties={254: 0} if descriptor == 'frozen' else {37: 0} if descriptor == 'fixed' else {})
            def playable_move(self, old_x, old_y, x, y):
                return playable is None or (x, y) in playable
            def rand(self, low, high):
                value = draws[len(self.rng_calls)]
                assert low <= value < high
                self.rng_calls.append([low, high])
                return value

        check_playable = playable is not None
        # Collapse original can_move_to dependencies into the pure TS callback.
        probe = Ops()
        resolved = [[start[0]+dx, start[1]+dy] for dx, dy in model.OCTANTS
                    if model.can_move_to(*start, start[0]+dx, start[1]+dy, False, check_playable, probe)]
        ops = Ops()
        result = model.move_towards(*start, *goal, min_dist, check_playable, ops)
        vectors.append({'id': case_id,
            'input': {'col': start[0], 'row': start[1], 'destCol': goal[0], 'destRow': goal[1], 'minDist': min_dist},
            'eligible': resolved, 'draws': draws, 'expected': {'col': result[0], 'row': result[1]},
            'expectedDraws': len(ops.rng_calls), 'expectedRngCalls': ops.rng_calls,
            'expectedEligibilityCalls': ops.eligibility_calls})

    # Exhaust every occupancy mask with two asymmetric goals and RNG streams.
    start = (3, 3)
    for mask in range(256):
        eligible = [(3+dx, 3+dy) for i, (dx, dy) in enumerate(model.OCTANTS) if mask & (1 << i)]
        for goal in [(6, 3), (1, 0)]:
            for draws in [[0, 3, 6], [7, 2, 5]]:
                add(f'octants-{mask}-{goal[0]}-{goal[1]}-{draws[0]}', start, goal, 0, eligible, draws)
    # Exhaust cardinal occupancy masks, all goal octants and all first offsets.
    cardinal = [(0, -1), (1, 0), (0, 1), (-1, 0)]
    for mask in range(16):
        eligible = [(3+dx, 3+dy) for i, (dx, dy) in enumerate(cardinal) if mask & (1 << i)]
        for direction, (dx, dy) in enumerate(model.OCTANTS):
            for offset in range(8):
                add(f'cardinal-{mask}-{direction}-{offset}', start, (3+dx*3, 3+dy*3), 0,
                    eligible, [offset, (offset+3) % 8, (offset+6) % 8])
    # Edge eligibility, negative coordinates and exact minDist early returns.
    for sx, sy in [(0, 0), (0, 4), (4, 0), (4, 4), (-2, -2)]:
        eligible = [(sx+dx, sy+dy) for dx, dy in model.OCTANTS if 0 <= sx+dx < 5 and 0 <= sy+dy < 5]
        for goal in [(0, 0), (2, 2), (4, 4)]:
            distance = model.grid_distance(sx, sy, *goal)
            for min_dist in sorted({0, max(0, distance-1), distance, distance+1}):
                add(f'edge-{sx}-{sy}-{goal[0]}-{goal[1]}-{min_dist}', (sx, sy), goal,
                    min_dist, eligible, [7, 0, 4])
    # Original eligibility has empty/fire/item semantics beyond our adapter.
    for descriptor in ['creep', 'fire', 'item', 'empty', 'elite', 'frozen', 'fixed']:
        for playable in [None, set(), {(4, 3)}]:
            for offset in range(8):
                add(f'eligibility-{descriptor}-{str(playable is not None)}-{bool(playable)}-{offset}',
                    start, (6, 3), 0, [(4, 3)], [offset, (offset+1) % 8, (offset+2) % 8],
                    {(4, 3): descriptor}, playable)

    hist = Counter(v['expectedDraws'] for v in vectors)
    assert set(hist) == {0, 1, 2, 3}
    assert any(v['expectedDraws'] == 3 and v['expected'] != {'col': v['input']['col'], 'row': v['input']['row']} for v in vectors)
    assert len({v['id'] for v in vectors}) == len(vectors)
    output = {'schemaVersion': 1,
        'provenance': {'sourcePath': str(args.source.resolve()),
            'sourceSha256': hashlib.sha256(args.source.read_bytes()).hexdigest(),
            'dependencyPath': str(args.source.with_name('recovered_core.py').resolve()),
            'dependencySha256': hashlib.sha256(args.source.with_name('recovered_core.py').read_bytes()).hexdigest(),
            'function': 'move_towards', 'originalAddress': '0x180C91C30',
            'method': 'Direct Python model invocation; no native execution; no copied implementation.',
            'eligibility': 'Actual can_move_to result collapsed into eligible coordinates; trace records each invocation before distance filtering.',
            'adaptation': 'Product restricts eligibility to cardinal occupied swaps; octant ordering and Chebyshev three-pass search are unchanged.'},
        'coverage': {'vectors': len(vectors), 'rngCallsHistogram': dict(sorted(hist.items())),
            'families': ['all 256 neighbor masks', 'all 16 cardinal masks × 8 goal headings × 8 first RNG offsets',
                         'edges and minDist early return', 'original empty/fire/item/frozen/fixed/elite and playable gate']},
        'vectors': vectors}
    # Compact each vector while keeping diffs reviewable one vector per line.
    header = json.dumps({k: v for k, v in output.items() if k != 'vectors'}, ensure_ascii=False, indent=2)
    text = header[:-2] + ',\n  "vectors": [\n' + ',\n'.join('    '+json.dumps(v, separators=(',', ':')) for v in vectors) + '\n  ]\n}\n'
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(text, encoding='utf-8')
    print(json.dumps(output['coverage']))


if __name__ == '__main__':
    main()
