import { $, h, api, chrome } from './common.js';
await chrome('');
const next = new URLSearchParams(location.search).get('next');
const destination = next?.startsWith('/') && !next.startsWith('//') ? next : '/account.html';
const face = person => person.photo ? `<img src="${h(person.photo)}" alt="Generated demo portrait">` : `<span class="ini" aria-hidden="true">${h(person.name.split(' ').map(part=>part[0]).join(''))}</span>`;
const buttons = () => [...document.querySelectorAll('#resident,#admin,[data-id]')];
async function signIn(role, userId) {
  buttons().forEach(button => button.disabled=true); $('#signin-status').textContent = 'Opening your demo role…';
  try { await api('/api/session',{role,...(userId ? {userId} : {})}); location.href = role==='admin' ? '/admin.html' : destination; }
  catch(error) { $('#signin-status').textContent = `Could not open the demo: ${error.message}`; buttons().forEach(button=>button.disabled=false); }
}
$('#admin').onclick = () => signIn('admin');
try {
  const people = await api('/api/public/residents');
  const preferred = people.find(person=>person.id==='nadia' || /^Nadia\b/i.test(person.name)) || people[0];
  if (!preferred) throw new Error('No demo residents are available');
  $('#resident-person').innerHTML = `${face(preferred)}<span><b>${h(preferred.name)}</b><small>Fictional demo resident · sample account</small></span>`;
  $('#resident').disabled=false; $('#resident').onclick=()=>signIn('resident',preferred.id);
  $('#people').innerHTML=people.map(person=>`<button class="community-person-choice" data-id="${h(person.id)}">${face(person)}<b>${h(person.name)}</b></button>`).join('');
  document.querySelectorAll('[data-id]').forEach(button=>button.onclick=()=>signIn('resident',button.dataset.id));
} catch(error) { $('#signin-status').textContent=`Demo residents could not be loaded: ${error.message}`; }
