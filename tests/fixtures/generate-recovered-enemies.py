"""Read-only oracle: execute the reviewed recovered Python functions; never native binaries."""
import sys, json, random, hashlib
from pathlib import Path
from dataclasses import asdict

SOURCE = Path('D:/GameResearch/Grindstone/Recovery')
sys.dont_write_bytecode = True
sys.path.insert(0, str(SOURCE))
import recovered_enemies as recovered

def actor(**kwargs):
    return {k: v for k, v in asdict(recovered.Actor(**kwargs)).items()
            if k in ('subtype', 'power', 'kind', 'col', 'row', 'face_dir', 'attack_mode', 'properties')}

class Ops:
    def __init__(self, world):
        self.w = world; self.trace = []; self.draw = 0; self.done = 0
    def record(self, *args): self.trace.append(list(args))
    def valid(self, x, y):
        self.record('valid', x, y); return 0 <= x < self.w['width'] and 0 <= y < self.w['height']
    def cell(self, x, y):
        self.record('cell', x, y)
        value = self.w['cells'].get(f'{x},{y}')
        return None if value is None else recovered.Actor(**value)
    def playable_move(self, sx, sy, x, y):
        self.record('playableMove', sx, sy, x, y); return [x,y] not in self.w['blocked']
    def marsh_at(self, x, y):
        self.record('marshAt', x, y); return [x,y] in self.w['marsh']
    def playable_spawn(self, x, y, power):
        self.record('playableSpawn', x, y, power); return [x,y] not in self.w['blocked']
    def boss_level(self): self.record('bossLevel'); return self.w['boss']
    def rand(self, lo, hi):
        self.record('rand', lo, hi)
        result = lo + self.w['draws'][self.draw] % (hi-lo); self.draw += 1; return result
    def remove(self, e, p): self.record('remove',p); e.properties.pop(p,None)
    def set(self, e, p, v): self.record('set',p,v); e.properties[p]=v
    def sprite_index(self,e,name):
        self.record('spriteIndex',name)
        return ['side','front','back'].index(name.split('_')[0])*4+['idle','ready','attack','hit'].index(name.split('_')[1])+10
    def set_anim(self,e,anim,restart,reverse): self.record('setAnim',anim,restart,reverse)
    def sound(self,e,sound): self.record('sound',sound)
    def anim_done(self,e):
        self.record('animDone'); result=self.w['done'][self.done%len(self.w['done'])]; self.done+=1; return result
    def idle(self,e): self.record('idle')
    def melee_damage(self,e): self.record('meleeDamage')
    def next_state(self,e,s): self.record('nextState',s)

rng=random.Random(920260924)
vectors=[]
def world():
    w={'width':rng.randrange(2,6),'height':rng.randrange(2,6),'cells':{},'marsh':[],'blocked':[],
       'boss':bool(rng.randrange(2)),'draws':[rng.randrange(100) for _ in range(8)],'done':[bool(rng.randrange(2)),bool(rng.randrange(2))]}
    for x in range(w['width']):
        for y in range(w['height']):
            if rng.randrange(4):
                props={p:0 for p in [21,23,24,37,38,79,140,185,254] if rng.randrange(15)==0}
                w['cells'][f'{x},{y}']=actor(col=x,row=y,kind=rng.choice([0,1,3,5]),subtype=rng.choice([2,4,28,36,112,114,118,151]),power=rng.randrange(4),properties=props)
            if rng.randrange(15)==0:w['marsh'].append([x,y])
            if rng.randrange(7)==0:w['blocked'].append([x,y])
    return w
def add(fn,args,w=None,a=None):
    w=w or world(); ops=Ops(w); e=None if a is None else recovered.Actor(**a)
    if fn=='grid_distance':result=getattr(recovered,fn)(*args)
    elif fn=='is_visibly_agro':result=getattr(recovered,fn)(e)
    elif fn in ['update_shield_dir','update_basic_attack','will_stop_osmium_missile']:result=getattr(recovered,fn)(e,*args,ops)
    else:result=getattr(recovered,fn)(*args,ops)
    vectors.append({'id':f'{fn}-{len(vectors)}','fn':fn,'args':args,'world':w,'actor':a,'expected':result,
                    'actorAfter':None if e is None else {'properties':e.properties,'face_dir':e.face_dir},'trace':ops.trace})
for _ in range(128):
    w=world(); x=rng.randrange(-1,w['width']+1); y=rng.randrange(-1,w['height']+1)
    sx=rng.randrange(w['width']); sy=rng.randrange(w['height'])
    add('grid_distance',[sx,sy,x,y],w)
    add('can_move_to',[sx,sy,x,y,bool(rng.randrange(2)),bool(rng.randrange(2))],w)
    add('can_random_attack',[x,y,*[bool(rng.randrange(2)) for _ in range(4)]],w)
    add('can_land_fire_on',[x,y,bool(rng.randrange(2))],w)
    add('is_trapped',[sx,sy],w)
    add('move_towards',[sx,sy,x,y,rng.randrange(3),bool(rng.randrange(2))],w)
    add('random_land_cell',[sx,sy,rng.randrange(3),rng.choice([-1,x]),rng.choice([-1,y]),rng.randrange(4)],w)
    add('random_launch_cell',[sx,sy,rng.choice([-1,x]),rng.choice([-1,y]),w['width'],w['height']],w)
    a=None if rng.randrange(7)==0 else actor(col=x,row=y,kind=rng.choice([0,1,3,5]),subtype=rng.choice([2,151]),power=rng.randrange(4),properties={rng.choice([21,23,24,79,185]):0})
    add('will_stop_osmium_missile',[],w,a)
for mode in range(-1,4):
    for wait in [False,True]:add('is_visibly_agro',[],a=actor(attack_mode=mode,properties={185:0} if wait else {}))
for mask in range(256):
    w=world();w.update(width=3,height=3,cells={})
    positions=[(x,y) for x in range(3) for y in range(3) if (x,y)!=(1,1)]
    for bit,(x,y) in enumerate(positions):
        if mask & (1<<bit):w['cells'][f'{x},{y}']=actor(col=x,row=y,subtype=36 if bit%2 else 114)
    add('is_trapped',[1,1],w)
for dx in range(-4,5):
    for dy in range(-4,5):
        for face in [-1,1]:add('update_shield_dir',[dx,dy],a=actor(face_dir=face,properties={249:8,250:-8,53:23}))
for state in [-1,0,1,2]:
    for timer in [-1,0,1,9]:
        for follow in [False,True]:
            for first in [False,True]:
                for second in [False,True]:
                    w=world();w['done']=[first,second]
                    add('update_basic_attack',[state,timer],w,actor(properties={53:12,**({54:13} if follow else {})}))
out={'provenance':{'source':str(SOURCE/'recovered_enemies.py'),'sha256':hashlib.sha256((SOURCE/'recovered_enemies.py').read_bytes()).hexdigest(),'oracle':'Actual recovered Python functions; no native execution'},'vectors':vectors}
Path(__file__).with_name('recovered-enemies.json').write_text(json.dumps(out,separators=(',',':')),encoding='utf-8')
print(f'Generated {len(vectors)} enemy reference cases across 12 functions')
