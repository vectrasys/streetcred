import { $, h, money, api, chrome } from './common.js';
await chrome('heroes');
const face = person => person.photo ? `<img src="${h(person.photo)}" alt="Generated demo portrait of ${h(person.name)}" loading="lazy">` : `<span class="ini" aria-hidden="true">${h(person.name.split(' ').map(part => part[0]).join(''))}</span>`;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
try {
  const [response, city] = await Promise.all([api('/api/public/heroes'), api('/api/public/city')]);
  const deeds = person => Number(person.confirmedDeeds ?? 0);
  const sample = person => Number(person.demoHistoryDeeds ?? 0);
  // Rank: verified deeds, then fictional demo-history deeds, then name. Reward amounts never decide rank.
  const people = (Array.isArray(response) ? response : response.contributors).slice().sort((a,b) => deeds(b) - deeds(a) || sample(b) - sample(a) || a.name.localeCompare(b.name));
  const districts = Object.fromEntries(city.districts.map(d => [d.id,d.name]));
  const verified = people.filter(person => deeds(person) > 0);
  const first = people[0] || {}, day = d => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const period = first.demoHistoryFrom ? `${day(first.demoHistoryFrom)} – ${day(first.demoHistoryTo)}, ${first.demoHistoryTo.slice(0,4)}` : 'last 90 days';
  $('#demo-period').textContent = period;
  const examples = city.tasks.filter(task => task.status === 'completed');
  $('#neighborhood').insertAdjacentHTML('beforeend',city.districts.map(d => `<option value="${h(d.id)}">${h(d.name)}</option>`).join(''));
  $('#verified-summary').innerHTML = verified.length ? `<p class="community-empty-compact"><b>${plural(verified.reduce((sum,person)=>sum+deeds(person),0), 'verified deed', 'verified deeds')} in this session</b> · ${plural(verified.length, 'contributor', 'contributors')}</p>` : '<p class="community-empty-compact"><b>0 verified deeds yet.</b> <a href="/signin.html">Try the resident demo ↗</a></p>';
  $('#sample-examples').innerHTML = examples.length ? `<div class="community-examples-head"><div><div class="eyebrow">Sample activity · no verification evidence</div><h2 id="examples-heading">Demo program examples</h2></div><span>${examples.length} sample completed tasks</span></div><p class="small muted">Existing completed examples from the fictional city. They have no attached verification or before/after evidence and do not count as verified deeds.</p><div class="community-examples">${examples.map(task=>`<article class="community-example"><span class="community-example-kind">${h(task.kind.replaceAll('_',' '))} · sample task</span><h3>${h(task.title)}</h3><p>${h(districts[task.district])} · ${h(task.id)}</p><p class="community-sample">Sample reward ${money(task.reward)}</p></article>`).join('')}</div>` : '';
  // Competition ranking: equal verified and demo deeds share a rank (1, 2, 2, 4).
  const ranked = list => list.map((person, i) => ({ person, rank: list.findIndex(other => deeds(other) === deeds(person) && sample(other) === sample(person)) + 1, i }))
    .map((entry, _, all) => ({ ...entry, tied: all.filter(other => other.rank === entry.rank).length > 1 }));
  const rankLabel = ({ rank, tied }) => `#${rank}${tied ? ' <span class="community-tied">tied</span>' : ''}`;
  const counts = person => `<span class="community-count community-count-sample"><b>${sample(person)}</b> demo deeds</span>`;
  const card = entry => { const person = entry.person; return `<li class="community-feature-card"><span class="community-rank" aria-label="Rank ${entry.rank}${entry.tied ? ', tied' : ''}">${rankLabel(entry)}</span>${face(person)}<div><h3>${h(person.name)}</h3><p class="small muted">${h(districts[person.district])}</p><div class="community-counts">${counts(person)}</div><p class="community-sample">Demo rewards ${money(person.demoHistoryRewards ?? 0)}</p></div></li>`; };
  const row = entry => { const person = entry.person; return `<tr><td data-label="Rank" class="community-rank-cell">${rankLabel(entry)}</td><td data-label="Hero"><div class="community-person">${face(person)}<b>${h(person.name)}</b></div></td><td data-label="Neighborhood">${h(districts[person.district])}</td><td data-label="Demo deeds" class="num"><b>${sample(person)}</b></td><td data-label="Demo rewards" class="num community-sample">${money(person.demoHistoryRewards ?? 0)}</td></tr>`; };
  const draw = () => {
    const hood = $('#neighborhood').value, scope = hood ? districts[hood] ?? 'this neighborhood' : 'all neighborhoods';
    const list = ranked(people.filter(person => !hood || person.district === hood));
    $('#contributor-count').textContent = list.length ? `${plural(list.length, 'hero', 'heroes')} in ${scope} · ranks are within ${scope}` : `No demo heroes in ${scope}.`;
    $('#featured').innerHTML = list.slice(0,3).map(card).join(''); $('#featured').hidden = !list.length;
    $('#contributors').innerHTML = list.slice(0,10).map(row).join(''); $('#verified-ranking').hidden = !list.length;
    const rest = list.slice(10);
    $('#rest-contributors').innerHTML = rest.map(row).join(''); $('#all-contributors').hidden = !rest.length;
    $('#all-contributors summary').textContent = `Show all heroes (${rest.length} more)`;
    const by = {}; list.forEach(({ person }) => { by[person.district] = (by[person.district] || 0) + sample(person); });
    const max = Math.max(1, ...Object.values(by));
    $('#hoods').innerHTML = Object.entries(by).filter(([,n]) => n > 0).sort((a,b) => b[1] - a[1] || districts[a[0]].localeCompare(districts[b[0]])).map(([id,n]) => `<div class="community-hood"><div><span>${h(districts[id])}</span><b>${n} demo deeds</b></div><div class="community-bar" aria-hidden="true"><i class="community-bar-sample" style="width:${n/max*100}%"></i></div></div>`).join('') || '<p class="small muted">No demo-history deeds here yet.</p>';
  };
  $('#neighborhood').onchange = draw; draw();
  $('#impact-source').textContent = `Source: verified deeds recorded in this demo session; demo history ${period} from the StreetCred demo dataset.`;
} catch(error) { $('#featured').hidden = true; $('#verified-ranking').hidden = true; $('#all-contributors').hidden = true; $('#contributor-count').textContent = ''; $('#impact-source').textContent = `Heroes could not be loaded: ${error.message}. Reload the page to try again.`; $('#impact-source').setAttribute('role','alert'); }
