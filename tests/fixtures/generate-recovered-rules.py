"""Invoke the three external verified Python models; never load DLLs or copy source.

Only fixtures are written. Original dependencies are controlled event-recording
adapters, so consumers compare results, mutations and dependency call ordering.
"""
from pathlib import Path
from types import SimpleNamespace
from dataclasses import asdict
import argparse, hashlib, importlib, json, random, sys


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', type=Path, default=Path('D:/GameResearch/Grindstone/Recovery'))
    parser.add_argument('--output', type=Path, default=Path(__file__).with_name('recovered-rules.json'))
    args = parser.parse_args()
    sys.dont_write_bytecode = True
    sys.path.insert(0, str(args.source))
    core, board, combat = [importlib.import_module(name) for name in ['recovered_core', 'recovered_board', 'recovered_combat']]
    rng = random.Random(20260924)
    vectors = []

    def run(fn, data):
        events = []
        def log(*event): events.append(list(event))
        entities = {e['id']: SimpleNamespace(**{**e, 'properties': {int(k): v for k, v in e['properties'].items()}}) for e in data.get('entities', [])}
        cells = {(x, y): entities[key] for x, y, key in data.get('cells', [])}
        def get(x, y): return cells.get((x, y))
        def query(x, y): log('get', x, y); return get(x, y)
        player = entities.get(0)
        path = [tuple(p) for p in data.get('path', [])]
        a = data.get('args', [])
        result = None
        state = None
        if fn == 'is_path_ender': result = core.is_path_ender(entities.get(data['target']))
        elif fn == 'power_contribution': result = core.power_contribution(entities.get(data['target']), *a[:1], player, *a[1:])
        elif fn == 'path_attack_power': result = core.path_attack_power(path, cells, player, *a)
        elif fn == 'path_colour': result = core.path_colour(path, cells, *a)
        elif fn == 'is_pathable':
            try: result = core.is_pathable(tuple(data['point']), path, cells, player, *a)
            except ValueError: result = 'ERROR_EMPTY_PATH'
        elif fn == 'gaps_below': result = core.gaps_below(cells, *a)
        elif fn == 'next_board_colour': result = core.next_board_colour(a[0], set(a[1]))
        elif fn == 'agro_start_turn': result = core.agro_start_turn(*a)
        elif fn == 'enemy_will_attack': result = core.enemy_will_attack(player)
        elif fn == 'gem_class': result = core.gem_class(*a)
        elif fn == 'gem_value': result = core.gem_value(*a)
        elif fn == 'process_fall_refill':
            state = dict(data['state']); fills = iter(data['fills'])
            ops = SimpleNamespace(fall=lambda: log('fall'), refill=lambda n: (log('refill', n), next(fills))[1],
                settled=lambda n: (log('settled', n), data['settled5'] if n == 5 else data['settled10'])[1],
                fall_diagonals=lambda: (log('diagonals'), data['diagonal'])[1], sound=lambda n: log('sound', n),
                challenge_countdown=lambda n: log('countdown', n))
            result = core.process_fall_refill(*a, state, ops)
        elif fn in ['can_heal', 'can_shield', 'can_fire_arrow_hit']:
            result = getattr(combat, fn)(*(([player] + a) if fn != 'can_fire_arrow_hit' else a))
        elif fn == 'boss_update':
            boss = combat.BossState(**data['boss'])
            def handler(name, boss):
                log('handler', name, asdict(boss))
                boss.settle_timer = data['handlerSettle']
            result = combat.boss_update(boss, a[0], handler); state = asdict(boss)
        elif fn == 'ghost_action': result = combat.ghost_action(*a, lambda: (log('numSkelly'), data['numSkelly'])[1])
        elif fn == 'volcano_action': result = combat.volcano_action(*a)
        elif fn == 'vine_action':
            def reticle(x, y): log('reticle', x, y); return f'{x},{y}'
            result = combat.vine_action(*a, SimpleNamespace(random=lambda low, high: (log('random', low, high), data['draw'])[1],
                create_reticle=reticle, set_property=lambda e, p, v: log('property', e, p, v),
                play_sound=lambda x: log('sound', x), decrement_boss_property=lambda p, v: log('decrement', p, v),
                set_boss_property=lambda p, v: log('bossProperty', p, v)))
        else:
            width, height = data['width'], data['height']
            def free(x, y, w, h):
                log('free', x, y, w, h)
                return all(0 <= i < width and 0 <= j < height and get(i, j) is None for i in range(x, x+w) for j in range(y, y+h))
            def clear(x, y, flag): log('clear', x, y, flag); cells.pop((x, y), None)
            def set_cell(x, y, e, flag):
                log('cell', x, y, e.id, flag)
                for i in range(x, x+e.width):
                    for j in range(y, y+e.height): cells[i, j] = e
            def prop(e, p, v): log('property', e.id, p, v); e.properties[p] = v
            def remove(e, p): log('remove', e.id, p); e.properties.pop(p, None)
            def next_state(e, s): log('state', e.id, s)
            if fn == 'bottom_free_row': result = board.bottom_free_row(*a, height, query, free, lambda col: log('failure', col))
            elif fn == 'get_fall_layer': result = [e.id if e else None for e in board.get_fall_layer(a[0], width, query, clear)]
            elif fn == 'insert_fall_layer':
                def bottom(x, y, w, h): log('bottom', x, y, w, h); return data['destinations'][x]
                board.insert_fall_layer([entities.get(key) for key in data['layer']], bottom, next_state, set_cell, remove)
            elif fn == 'fall_down': combat.fall_down(width, height, query, prop, lambda row: log('layer', row), lambda: log('insert'))
            elif fn == 'refill':
                serial = 100
                def empty(x, y): log('empty', x, y); return get(x, y) is None
                def above(x, y): log('above', x, y); return any(get(x, j) for j in range(y))
                def spawn(x, y, w, h, colour):
                    nonlocal serial
                    serial += 1
                    size = 2 if w == 2 and data['large'] and serial % 2 else 1
                    e = SimpleNamespace(id=serial, col=x, row=y, width=size, height=size, y=float(serial), properties={})
                    entities[serial] = e; log('spawn', x, y, w, h, colour, serial, size); return e
                def highest(x): log('highest', x); return min([e.y for (col, row), e in cells.items() if col == x] or [0.0])
                result = board.refill(width, height, *a, SimpleNamespace(random_column=lambda w: (log('randomColumn', w), data['draw'])[1],
                    is_empty=empty, any_above=above, is_free=free, spawn=spawn, set_cell=set_cell, set_property=prop,
                    get_cell=query, highest_entity=highest, remove_property=remove, set_next_state=next_state))
            else: raise AssertionError(fn)
            state = {'cells': [[x, y, e.id] for (x, y), e in sorted(cells.items())],
                'entities': [{'id': e.id, 'properties': e.properties, 'y': e.y} for e in sorted(entities.values(), key=lambda e: e.id)]}
        vectors.append({'id': f'{fn}-{sum(v["fn"] == fn for v in vectors)}', 'fn': fn, 'input': data, 'expected': {'result': result, 'events': events, 'state': state}})

    def entity(key, **extra):
        return dict(id=key, subtype=0, power=1, max_power=1, colour=-3, properties={}, attack_power=0, attack_mode=0, col=0, row=0, width=1, height=1, y=0, **extra)

    for trial in range(100):
        es = [entity(i) for i in range(5)]
        for e in es:
            e.update(subtype=rng.choice([0, 202, 274, 27, 279]), power=rng.randrange(-1, 9), max_power=rng.randrange(0, 9),
                colour=rng.choice([-3, -2, 0, 1, 2, 3, 4]), attack_power=rng.randrange(0, 9), attack_mode=rng.randrange(-2, 5),
                properties={p: rng.randrange(-1, 4) for p in [3, 11, 12, 39, 41, 79, 80, 233, 234, 249, 250, 259, 260, 261, 273] if rng.random() < .2})
        data = {'entities': es, 'cells': [[0, 0, 0]] + [[i, 1, i] for i in range(1, 5)], 'path': [[0, 0], [1, 1], [2, 1], [3, 1], [4, 1]]}
        for target in [None, 0, 1]:
            run('is_path_ender', {**data, 'target': target}); run('power_contribution', {**data, 'target': target, 'args': [rng.randrange(0, 12), trial % 2]})
        run('path_attack_power', {**data, 'args': [trial % 2, rng.choice([None, -2, 0, 1, 3, 5, 9])]})
        run('path_colour', {**data, 'args': [rng.choice([-1, 0, 1, 4])]})
        for point in [[-1, 0], [4, 4], [0, 0], [1, 1], [3, 3]]:
            run('is_pathable', {**data, 'path': data['path'][:rng.choice([0, 1, 2, 5])], 'point': point, 'args': [5, 5, rng.choice([-3, -2, 0, 1]), trial % 2, trial % 3 == 0]})
        run('gaps_below', {**data, 'args': [1, rng.randrange(-1, 5), 5]})
        run('enemy_will_attack', data); run('can_heal', {**data, 'args': [trial % 2 == 0]}); run('can_shield', data)
    for mask in range(32):
        for colour in [-4, -3, -2, 0, 1, 2, 3, 4]: run('next_board_colour', {'args': [colour, [i for i in range(5) if mask & (1 << i)]]})
    for kills in range(-2, 51):
        for thresholds, values in [(list(core.CHAIN_THRESHOLDS), list(core.GEM_VALUES)), ([8, 12], [0, 2, 7])]:
            run('gem_class', {'args': [kills, thresholds]}); run('gem_value', {'args': [kills, thresholds, values]})
    for trial in range(80):
        run('agro_start_turn', {'args': [rng.randrange(-1, 10), rng.randrange(-1, 10), trial % 4, trial % 3, bool(trial & 1), bool(trial & 2)]})
        run('process_fall_refill', {'args': [trial % 2, trial % 3], 'state': {'reserved_spawn_count': 7, 'diagonal_offset': 3, 'settle_override': 2},
            'fills': [trial % 4, (trial+1) % 3, 2], 'settled5': bool(trial & 2), 'settled10': bool(trial & 4), 'diagonal': bool(trial & 8)})
        run('can_fire_arrow_hit', {'args': [rng.randrange(-1, 6), rng.randrange(-1, 6), 4, 4]})
        run('boss_update', {'boss': {'subtype': 270+trial % 11, 'state': 9, 'next_state': rng.choice([-1, -1, 0, 5]), 'timer': 4,
            'substate': 2, 'sub_timer': 3, 'next_substate': rng.choice([-2, -1, 0, 3]), 'settle_timer': trial % 3}, 'args': [7], 'handlerSettle': trial % 2})
        run('vine_action', {'args': [5 if trial % 3 else 0, -1, trial % 9-1, 7, trial % 3, 301, 302], 'draw': trial % 2})
        run('ghost_action', {'args': [rng.choice([17, 21, 0]), -1, trial % 3-1, trial % 5], 'numSkelly': trial % 4})
        run('volcano_action', {'args': [rng.choice([30, 36, 39, 0]), -1, trial % 11-5]})
    for trial in range(40):
        es = [entity(i+1) for i in range(6)]; cells = []
        for i, e in enumerate(es):
            e.update(col=i % 3, row=i // 3, y=i*10, properties={p: 0 for p in [13, 15, 16, 17, 77, 82, 214] if rng.random() < .25})
            if rng.random() < .7: cells.append([e['col'], e['row'], e['id']])
        data = {'entities': es, 'cells': cells, 'width': 3, 'height': 4}
        run('bottom_free_row', {**data, 'args': [trial % 3, trial % 5-1, trial % 2+1, trial % 3+1]})
        run('get_fall_layer', {**data, 'args': [trial % 3]})
        run('insert_fall_layer', {**data, 'layer': [1, None if trial % 2 else 2, 3], 'destinations': [trial % 4, 0, 3]})
        run('fall_down', data)
        run('refill', {**data, 'args': [[-1, 0, 1, 2, 8][trial % 5], trial % 3, bool(trial % 2), trial % 9-4, 10], 'draw': trial % 3, 'large': trial % 2 == 0})
    from collections import Counter
    assert len(Counter(v['fn'] for v in vectors)) == 24
    # Only the functions the game still uses are kept (01.10.2026); the rest are generated first so the random
    # draws, and therefore the kept vectors, stay as before.
    LIVE = {'path_colour', 'enemy_will_attack', 'can_heal', 'can_fire_arrow_hit', 'agro_start_turn'}
    vectors = [v for v in vectors if v['fn'] in LIVE]
    counts = dict(Counter(v['fn'] for v in vectors))
    assert len(counts) == len(LIVE)
    provenance = {name: {'path': str(args.source / f'{name}.py'), 'sha256': hashlib.sha256((args.source / f'{name}.py').read_bytes()).hexdigest()}
        for name in ['recovered_core', 'recovered_board', 'recovered_combat']}
    header = json.dumps({'schemaVersion': 1, 'method': 'Actual external Python model invocation, not native execution.', 'provenance': provenance, 'counts': counts}, indent=2)
    args.output.write_bytes((header[:-2] + ',\n  "vectors": [\n' + ',\n'.join('    '+json.dumps(v, separators=(',', ':')) for v in vectors) + '\n  ]\n}\n').replace('\n', '\r\n').encode('utf-8'))
    print(json.dumps({'functions': len(counts), 'vectors': len(vectors), 'counts': counts}))


if __name__ == '__main__': main()
