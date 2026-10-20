/** Standalone SVG illustration, not a simulation or a collision preview. */
export function renderArena(a, options = {}) {
  const opt = { enemies: true, routes: false, spawns: false, grid: false, ...options };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const uid = String(a.id + '-' + (a.variant || 'current') + '-' + (opt.prefix || 'map')).replace(/[^a-z0-9-]/gi, '');
  const ref = n => `url(#${uid}-${n})`;
  const w = a.width, h = a.height, pad = .7;
  const path = points => points.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ');
  const labels = { basic:'', wolf:'В', boar:'К', shield:'Щ', archer:'Л', sapper:'С', porcupine:'Д', lynx:'Р', shaman:'Ш' };
  const title = a.name || a.id;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-pad} ${-pad} ${w+pad*2} ${h+pad*2}" role="img" aria-label="${esc(title)}" style="width:100%;height:100%;display:block"><title>${esc(title)} · ${w}×${h}</title><defs>
    <pattern id="${uid}-earth" width="1.6" height="1.4" patternUnits="userSpaceOnUse"><circle cx=".3" cy=".25" r=".018" fill="#766b50"/><path d="M1 .7l.06-.12m-.06.12-.06-.08M.45 1.1l.04-.08" stroke="#788270" stroke-width=".025" opacity=".35"/></pattern>
    <pattern id="${uid}-thorn" width=".55" height=".55" patternUnits="userSpaceOnUse"><path d="M.1.5L.4.05M.22.32L.08.2M.32.16L.48.24" stroke="#725265" stroke-width=".06" fill="none"/></pattern>
    <pattern id="${uid}-grid" width="1" height="1" patternUnits="userSpaceOnUse"><path d="M1 0H0V1" fill="none" stroke="#5d6f65" stroke-opacity=".22" stroke-width=".022"/></pattern>
    <marker id="${uid}-arrowA" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse"><path d="M1 1L9 5L1 9Z" fill="#387f95"/></marker>
    <marker id="${uid}-arrowB" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse"><path d="M1 1L9 5L1 9Z" fill="#9a623c"/></marker>
    <clipPath id="${uid}-clip"><rect width="${w}" height="${h}" rx=".12"/></clipPath>
    </defs><g font-family="Segoe UI,Arial,sans-serif"><rect x="-.12" y="-.12" width="${w+.24}" height="${h+.24}" rx=".22" fill="#273937"/>
    <rect width="${w}" height="${h}" rx=".12" fill="#e8dfc5"/><g clip-path="${ref('clip')}"><rect width="${w}" height="${h}" fill="${ref('earth')}"/>`;
  const zoneShape = (z, fill, stroke, sw=.08) => {
    const style = `fill="${fill}" stroke="${stroke}" stroke-width="${sw}"`;
    if (z.shape === 'rect') return `<rect x="${z.x}" y="${z.y}" width="${z.w}" height="${z.h}" ${style}/>`;
    if (z.shape === 'circle') return `<circle cx="${z.x}" cy="${z.y}" r="${z.r}" ${style}/>`;
    if (z.shape === 'poly') return `<path d="${path(z.points)}Z" ${style}/>`;
    if (z.shape === 'band') return `<path d="${path(z.points)}" fill="none" stroke="${stroke}" stroke-width="${z.width+.12}" stroke-linejoin="round" stroke-linecap="round"/><path d="${path(z.points)}" fill="none" stroke="${fill}" stroke-width="${z.width}" stroke-linejoin="round" stroke-linecap="round"/>`;
    return '';
  };
  for (const z of a.terrain || []) {
    const colors = z.kind === 'river' ? ['#94b9b3','#527d7c'] : z.kind === 'cliff' ? ['#2f3f46','#8e9382'] : ['#a48b92','#735c69'];
    s += zoneShape(z, ...colors);
    if (z.kind === 'thorns' && z.shape !== 'band') s += zoneShape(z, ref('thorn'), 'none', 0);
    if (z.kind === 'river' && z.shape === 'band') s += `<path d="${path(z.points)}" fill="none" stroke="#d1e1ce" stroke-width=".05" stroke-dasharray=".45 .6" opacity=".55"/>`;
  }
  for (const o of a.obstacles || []) {
    if (o.kind === 'wall') {
      s += `<rect x="${o.x}" y="${o.y}" width="${o.w}" height="${o.h}" fill="#657064" stroke="#35473e" stroke-width=".09"/>`;
      if (o.w > o.h) for (let x=o.x+.4; x<o.x+o.w-.15; x+=.65) s+=`<path d="M${x} ${o.y+.06}v${o.h-.12}" stroke="#9da08b" stroke-width=".045" opacity=".5"/>`;
      else for (let y=o.y+.4; y<o.y+o.h-.15; y+=.65) s+=`<path d="M${o.x+.06} ${y}h${o.w-.12}" stroke="#9da08b" stroke-width=".045" opacity=".5"/>`;
    } else if (o.kind === 'pond') {
      s += `<circle cx="${o.x}" cy="${o.y}" r="${o.r}" fill="#94b9b3" stroke="#527d7c" stroke-width=".08"/><path d="M${o.x-o.r*.5} ${o.y}q${o.r*.25} -.15 ${o.r*.5} 0t${o.r*.5} 0" fill="none" stroke="#dce8d8" stroke-width=".045"/>`;
    } else s += `<circle cx="${o.x}" cy="${o.y}" r="${o.r}" fill="#516f58" stroke="#2e5140" stroke-width=".08"/><path d="M${o.x} ${o.y-o.r*.65}v${o.r*1.3}m${-o.r*.45} ${-o.r*.7}l${o.r*.45} ${o.r*.25} ${o.r*.45} ${-o.r*.25}" fill="none" stroke="#8b9e74" stroke-width=".06"/>`;
  }
  if (opt.grid) s+=`<rect width="${w}" height="${h}" fill="${ref('grid')}"/>`;
  if (opt.spawns) for (let i=0;i<(a.spawnAreas||[]).length;i++) {
    const p=a.spawnAreas[i]; s+=`<circle cx="${p.x}" cy="${p.y}" r="${p.r||1}" fill="#629c7d" fill-opacity=".13" stroke="#477b66" stroke-width=".06" stroke-dasharray=".15 .11"/><text x="${p.x}" y="${p.y-(p.r||1)-.1}" text-anchor="middle" font-size=".27" fill="#315f4f" paint-order="stroke" stroke="#f0e8d1" stroke-width=".08">${esc(p.label||`Пополнение ${i+1}`)}</text>`;
  }
  if (opt.routes) for (let i=0;i<(a.routes||[]).length;i++) {
    const r=a.routes[i], color=i?'#9a623c':'#387f95';
    s+=`<path d="${path(r.points)}" fill="none" stroke="#fff9e9" stroke-width=".19" opacity=".85" stroke-linejoin="round"/><path d="${path(r.points)}" fill="none" stroke="${color}" stroke-width=".085" stroke-linejoin="round" ${r.mode==='mixed'?'stroke-dasharray=".19 .12"':''} marker-end="${ref(i?'arrowB':'arrowA')}"/>`;
    const p=r.points[Math.min(1,r.points.length-1)]; if(p)s+=`<circle cx="${p.x}" cy="${p.y}" r=".23" fill="${color}" stroke="#fff9e9" stroke-width=".04"/><text x="${p.x}" y="${p.y+.1}" text-anchor="middle" font-size=".28" font-weight="700" fill="white">${i+1}</text>`;
  }
  for (const p of a.braziers||[]) s+=`<g transform="translate(${p.x},${p.y})"><circle r=".36" fill="#a56635" stroke="#684c35" stroke-width=".07"/><path d="M-.17 .1Q-.27-.12 .02-.4Q0-.1 .16-.18Q.35.08 .13.2Z" fill="#f2bc63"/><path d="M-.07 .13Q-.11-.02 .06-.15L.11.12Z" fill="#fff2b4"/></g>`;
  for (let i=0;i<(a.buttons||[]).length;i++) {const p=a.buttons[i];s+=`<g transform="translate(${p.x},${p.y})"><rect x="-.3" y="-.3" width=".6" height=".6" rx=".09" fill="#ae90ba" stroke="#644f79" stroke-width=".07"/><text y=".1" text-anchor="middle" font-size=".3" fill="#342a41" font-weight="700">${i+1}</text></g>`;}
  for (const p of a.gates||[]) s+=`<path d="M${p.x-.28} ${p.y+.22}v-.42q.28-.35 .56 0v.42" fill="#b9b49a" stroke="#797a60" stroke-width=".07"/>`;
  if (a.chest) {const p=a.chest;s+=`<g transform="translate(${p.x},${p.y})"><rect x="-.36" y="-.24" width=".72" height=".48" rx=".08" fill="#bb9250" stroke="#6e5430" stroke-width=".06"/><path d="M-.34 0h.68M0-.22v.44" stroke="#e9c879" stroke-width=".08"/></g>`;}
  if (a.door) {const p=a.door;s+=`<g transform="translate(${p.x},${p.y})"><rect x="-.38" y="-.28" width=".76" height=".56" rx=".1" fill="#58876a" stroke="#f3edda" stroke-width=".07"/><path d="M-.17 0h.34m-.12-.12.12.12-.12.12" fill="none" stroke="#fff9df" stroke-width=".07"/></g>`;}
  if (opt.enemies) for (const e of a.enemies||[]) {
    const kind=e.kind||'basic', special=kind!=='basic';
    const boss=/^(jailer|troll)$/.test(kind), part=/jailer|troll/.test(kind)&&!boss;
    const r=boss?.59:part?.32:special?.27:.19;
    const glyph=boss?'Б':part?'Ч':labels[kind]??'?';
    const fill=boss?'#594966':part?'#89758d':special?'#9d5145':'#b17b4c';
    s+=`<g transform="translate(${e.x},${e.y})"><circle r="${r+.05}" fill="#efead8"/>`;
    if(e.elite||e.leader||e.marked)s+=`<circle r="${r+.105}" fill="none" stroke="${e.elite?'#b57923':'#d29b3b'}" stroke-width=".065" ${e.marked&&!e.elite&&!e.leader?'stroke-dasharray=".07 .05"':''}/>`;
    s+=`<circle r="${r}" fill="${fill}" stroke="#4d3f39" stroke-width=".035"/>`;
    if(glyph)s+=`<text y="${boss?.15:.095}" text-anchor="middle" font-size="${boss?.43:.26}" font-weight="700" fill="#fff6e1">${glyph}</text>`;
    else if((e.hp||0)>0)s+=`<circle r=".08" fill="#f1d9a4"/>`;
    if(e.elite||e.leader)s+=`<path d="M-.16 ${-r-.15}l-.03-.17.16.09.08-.17.09.17.16-.09-.04.17Z" fill="#c99330" stroke="#fff3c6" stroke-width=".025"/>`;
    s+='</g>';
  }
  if (a.heroStart) {const p=a.heroStart;s+=`<g transform="translate(${p.x},${p.y})"><circle r=".37" fill="#397e9a" stroke="#fff8e4" stroke-width=".09"/><text y=".12" text-anchor="middle" font-size=".32" fill="white" font-weight="700">Я</text></g>`;}
  s+=`</g><text x="0" y="${h+.48}" font-size=".27" fill="#708177">${w} × ${h} ед. · ${a.variant ? 'эскиз предложения' : 'текущий шаблон'}</text><path d="M${w-3} ${h+.35}h2m-2-.1v.2m2-.2v.2" stroke="#708177" stroke-width=".04"/><text x="${w-1}" y="${h+.45}" font-size=".24" fill="#708177">2 ед.</text></g></svg>`;
  return s;
}
