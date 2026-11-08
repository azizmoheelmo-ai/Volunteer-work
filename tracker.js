/* متابعة ساعات الطلاب — قاعدة بيانات على الجهاز (IndexedDB). بلا خادم ولا حساب. */
(function(){
'use strict';
const GRADES = {1:'أول ثانوي', 2:'ثاني ثانوي', 3:'ثالث ثانوي'};
const $ = (s, r) => (r || document).querySelector(s);
const esc = t => String(t == null ? '' : t).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const mem = {students:[], batches:[], records:[]};
let target = 40, db = null, dbOk = true, ready = null;

/* ---------------- تخزين ---------------- */
function openDB(){
  return new Promise((res, rej) => {
    if(!window.indexedDB) return rej(new Error('no idb'));
    const r = indexedDB.open('vw-tracker', 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('students', {keyPath:'id', autoIncrement:true});
      d.createObjectStore('batches', {keyPath:'id', autoIncrement:true});
      d.createObjectStore('records', {keyPath:'id', autoIncrement:true}).createIndex('batchId', 'batchId');
      d.createObjectStore('meta', {keyPath:'k'});
    };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
const rq = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const store = (n, m) => db.transaction(n, m || 'readonly').objectStore(n);
async function dbPut(name, obj){ if(!dbOk) return obj; const id = await rq(store(name, 'readwrite').put(obj)); if(obj.id == null) obj.id = id; return obj; }
async function dbDel(name, id){ if(dbOk) await rq(store(name, 'readwrite').delete(id)); }
async function dbClear(){ if(!dbOk) return; for(const n of ['students','batches','records']) await rq(store(n, 'readwrite').clear()); }
async function init(){
  try{ db = await openDB(); for(const n of ['students','batches','records']) mem[n] = await rq(store(n).getAll()); const m = await rq(store('meta').get('target')); if(m) target = m.v; }
  catch(e){ dbOk = false; }
  mem.students.forEach(prep);
  try{ if(navigator.storage && navigator.storage.persist) navigator.storage.persist(); }catch(e){}
}
async function addStudent(name, grade, section){
  const o = await nextId('students', {name, grade, section}); const s = prep(o); mem.students.push(s); return s;
}
async function nextId(name, obj){
  if(dbOk) return dbPut(name, obj);
  obj.id = (mem[name].reduce((m, x) => Math.max(m, x.id || 0), 0)) + 1; return obj;
}

ready = init();
/* ---------------- الأسماء ---------------- */
function norm(s){
  return String(s || '').replace(/[ً-ٰٟـ‌-‏]/g, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
    .replace(/\s+/g, ' ').trim().toLowerCase();
}
const toks = s => norm(s).split(' ').filter(t => t && !/^(بن|ابن|بنت)$/.test(t));
function prep(st){ st.tk = toks(st.name); st.sq = st.tk.join(''); return st; }
function lev(a, b){
  if(a === b) return 0; const m = a.length, n = b.length; if(!m) return n; if(!n) return m;
  let prev = Array.from({length:n + 1}, (_, i) => i);
  for(let i = 1; i <= m; i++){ const cur = [i]; for(let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; }
  return prev[n];
}
function matchName(name){
  const tk = toks(name), sq = tk.join('');
  if(!sq) return {status:'none', cands:[]};
  const exact = mem.students.filter(s => s.sq === sq);
  if(exact.length === 1) return {status:'exact', cands:exact};
  if(exact.length > 1) return {status:'ambiguous', cands:exact};
  const out = [];
  for(const s of mem.students){
    if(Math.abs(s.sq.length - sq.length) > 8) continue;
    let sim = 1 - lev(sq, s.sq) / Math.max(sq.length, s.sq.length);
    const shared = tk.filter(t => s.tk.includes(t)).length;
    if(tk.length >= 2 && s.tk.length >= 2 && tk[0] === s.tk[0] && tk[tk.length - 1] === s.tk[s.tk.length - 1] && shared >= 2) sim = Math.max(sim, 0.9);
    if(sim >= 0.84) out.push({s, sim});
  }
  out.sort((a, b) => b.sim - a.sim);
  return out.length ? {status:'suggest', cands:out.slice(0, 5).map(x => x.s)} : {status:'none', cands:[]};
}
function gradeOf(t){
  const s = norm(t);
  if(/ثالث|3|٣/.test(s)) return 3; if(/ثاني|2|٢/.test(s)) return 2; if(/اول|الاول|1|١/.test(s)) return 1; return 0;
}

/* ---------------- قراءة الملفات (xlsx / csv / لصق) بلا مكتبات ---------------- */
async function unzip(buf){
  const dv = new DataView(buf), u8 = new Uint8Array(buf);
  let e = -1; for(let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--){ if(dv.getUint32(i, true) === 0x06054b50){ e = i; break; } }
  if(e < 0) throw new Error('zip');
  const n = dv.getUint16(e + 10, true); let p = dv.getUint32(e + 16, true); const files = {};
  for(let k = 0; k < n; k++){
    if(dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
    files[new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nl))] = {method, csize, off}; p += 46 + nl + el + cl;
  }
  return {names:Object.keys(files), async read(name){
    const f = files[name]; if(!f) return null;
    const s = f.off + 30 + dv.getUint16(f.off + 26, true) + dv.getUint16(f.off + 28, true), data = u8.subarray(s, s + f.csize);
    if(f.method === 0) return new TextDecoder().decode(data);
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new TextDecoder().decode(await new Response(stream).arrayBuffer());
  }};
}
const colIdx = ref => { const m = /^([A-Z]+)/.exec(ref || ''); if(!m) return 0; let n = 0; for(const ch of m[1]) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
const xml = t => new DOMParser().parseFromString(t, 'application/xml');
const tags = (n, name) => n.getElementsByTagNameNS('*', name);
async function readXlsx(buf){
  const z = await unzip(buf);
  let sheetPath = null;
  try{
    const wb = xml(await z.read('xl/workbook.xml')), rels = xml(await z.read('xl/_rels/workbook.xml.rels'));
    const sh = tags(wb, 'sheet')[0], rid = sh && (sh.getAttribute('r:id') || sh.getAttribute('id'));
    for(const r of tags(rels, 'Relationship')) if(r.getAttribute('Id') === rid){ const t = r.getAttribute('Target'); sheetPath = t.startsWith('/') ? t.slice(1) : 'xl/' + t; }
  }catch(e){}
  if(!sheetPath || !z.names.includes(sheetPath)) sheetPath = z.names.filter(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort()[0];
  if(!sheetPath) throw new Error('sheet');
  const ss = [];
  const sst = await z.read('xl/sharedStrings.xml');
  if(sst) for(const si of tags(xml(sst), 'si')) ss.push([...tags(si, 't')].map(t => t.textContent).join(''));
  const rows = [];
  for(const row of tags(xml(await z.read(sheetPath)), 'row')){
    const arr = [];
    for(const c of tags(row, 'c')){
      const t = c.getAttribute('t'), v = tags(c, 'v')[0];
      let val = '';
      if(t === 's') val = ss[+(v && v.textContent)] || '';
      else if(t === 'inlineStr') val = [...tags(c, 't')].map(x => x.textContent).join('');
      else if(v) val = v.textContent;
      arr[colIdx(c.getAttribute('r'))] = String(val).trim();
    }
    if(arr.some(x => x)) rows.push(Array.from(arr, x => x || ''));
  }
  return rows;
}
function parseDelimited(text){
  text = text.replace(/^﻿/, '');
  const first = text.split(/\r?\n/).find(l => l.trim()) || '';
  const d = [['\t', first.split('\t').length], [',', first.split(',').length], [';', first.split(';').length], ['،', first.split('،').length], ['|', first.split('|').length]].sort((a, b) => b[1] - a[1])[0][0];
  const rows = []; let row = [], cur = '', q = false;
  for(let i = 0; i < text.length; i++){
    const ch = text[i];
    if(q){ if(ch === '"'){ if(text[i + 1] === '"'){ cur += '"'; i++; } else q = false; } else cur += ch; }
    else if(ch === '"') q = true;
    else if(ch === d){ row.push(cur.trim()); cur = ''; }
    else if(ch === '\n' || ch === '\r'){ if(ch === '\r' && text[i + 1] === '\n') i++; row.push(cur.trim()); cur = ''; if(row.some(x => x)) rows.push(row); row = []; }
    else cur += ch;
  }
  row.push(cur.trim()); if(row.some(x => x)) rows.push(row);
  return rows;
}
async function readAny(file){
  const buf = await file.arrayBuffer(), u8 = new Uint8Array(buf.slice(0, 4));
  if(u8[0] === 0x50 && u8[1] === 0x4b) return readXlsx(buf);
  if(u8[0] === 0xD0 && u8[1] === 0xCF) throw new Error('xls');
  let t = new TextDecoder('utf-8').decode(buf);
  if(t.includes('�')){ try{ t = new TextDecoder('windows-1256').decode(buf); }catch(e){} }
  return parseDelimited(t);
}
const readErr = e => e && e.message === 'xls' ? 'هذه صيغة Excel قديمة (xls). افتح الملف واحفظه بصيغة xlsx أو CSV ثم ارفعه.' : 'تعذّرت قراءة الملف. تأكد أنه Excel (xlsx) أو CSV.';

/* ---------------- حسابات ---------------- */
const totals = () => { const m = new Map(); mem.records.forEach(r => m.set(r.studentId, (m.get(r.studentId) || 0) + r.hours)); return m; };
const pctOf = h => Math.round(h / target * 1000) / 10;
const fmt = n => String(Math.round(n * 10) / 10);
const tone = p => p >= 100 ? ['#1c8a5e', '#e6f3ec'] : p >= 50 ? ['#2f6fb0', '#eaf1fa'] : p >= 25 ? ['#b5792a', '#fbf1e2'] : ['#b3402f', '#fbeae7'];
const sections = g => [...new Set(mem.students.filter(s => !g || s.grade === g).map(s => s.section).filter(Boolean))].sort();

/* ---------------- الواجهة ---------------- */
const CSS = `
#tk{position:fixed;inset:0;z-index:1200;background:var(--paper);color:var(--ink);display:flex;flex-direction:column;font-family:var(--font-body);padding-top:env(safe-area-inset-top,0px)}
#tk[hidden]{display:none}
#tk .tk-head{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;max-width:560px;width:100%;margin:0 auto}
#tk .tk-head h2{font:700 1.1rem var(--font-head);color:var(--green-deep);margin:0}
#tk .tk-x{border:0;background:none;font-size:1.3rem;color:var(--ink-soft);cursor:pointer}
#tk .tk-body{flex:1;overflow-y:auto;padding:0 16px 16px;max-width:560px;width:100%;margin:0 auto}
#tk .tk-tabs{display:flex;border-top:1px solid var(--line);background:var(--paper-raised);padding-bottom:env(safe-area-inset-bottom,0px)}
#tk .tk-tabs button{flex:1;border:0;background:none;padding:10px 2px;font:600 .72rem var(--font-body);color:var(--ink-soft);cursor:pointer}
#tk .tk-tabs button b{display:block;font-size:1.15rem}
#tk .tk-tabs button.on{color:var(--green-deep)}
#tk .c{background:var(--paper-raised);border:1px solid var(--line);border-radius:14px;padding:12px;margin-bottom:10px}
#tk .sum{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px}
#tk .sum div{border-radius:12px;padding:8px 10px;font-size:.75rem}#tk .sum b{display:block;font-size:1.4rem;line-height:1.2}
#tk .chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px}
#tk .chip{border:1px solid var(--line);background:var(--paper-raised);color:var(--ink);border-radius:999px;padding:5px 12px;font:600 .78rem var(--font-body);cursor:pointer}
#tk .chip.on{background:var(--green-deep);color:#fff;border-color:var(--green-deep)}
#tk input,#tk select,#tk textarea{width:100%;border:1px solid var(--line);border-radius:10px;padding:10px;font:500 .9rem var(--font-body);background:var(--paper-raised);color:var(--ink);box-sizing:border-box}
#tk label{display:block;font-size:.78rem;color:var(--ink-soft);margin:8px 0 3px}
#tk .st{display:flex;align-items:center;gap:8px;padding:9px 0;border-bottom:1px solid var(--line);cursor:pointer}
#tk .st .n{flex:1;font-weight:600;font-size:.88rem}#tk .st small{display:block;font-weight:400;color:var(--ink-soft);font-size:.7rem}
#tk .bar{width:90px;height:8px;background:var(--line);border-radius:5px;overflow:hidden}#tk .bar i{display:block;height:100%;border-radius:5px}
#tk .pc{width:52px;text-align:left;font-weight:700;font-size:.82rem}
#tk .btn{border:0;background:var(--green-deep);color:#fff;border-radius:12px;padding:12px;font:700 .9rem var(--font-body);cursor:pointer;width:100%}
#tk .btn.g{background:var(--paper-raised);color:var(--ink);border:1px solid var(--line)}
#tk .btn.d{background:#b3402f}
#tk .btn:disabled{opacity:.45}
#tk .row{display:flex;gap:8px}#tk .row>*{flex:1}
#tk .note{font-size:.78rem;color:var(--ink-soft);line-height:1.8;margin:6px 0}
#tk .warn{background:#fbf1e2;border:1px solid #b5792a;color:#7a5218;border-radius:12px;padding:10px;font-size:.8rem;line-height:1.8;margin-bottom:10px}
#tk .ok{background:#e6f3ec;border:1px solid #1c8a5e;color:#0f5c47;border-radius:12px;padding:10px;font-size:.82rem;line-height:1.8;margin-bottom:10px}
#tk table{width:100%;border-collapse:collapse;font-size:.75rem}#tk th{background:var(--green-pale);padding:5px;text-align:right}#tk td{padding:5px;border-bottom:1px solid var(--line)}
#tk .ck{width:20px;height:20px;accent-color:#1c8a5e;flex:none}
#tkm{position:fixed;inset:0;z-index:1300;background:rgba(8,24,21,.55);display:flex;align-items:flex-end;justify-content:center}
#tkm[hidden]{display:none}
#tkm .sheet{background:var(--paper-raised);color:var(--ink);width:100%;max-width:560px;max-height:88vh;overflow-y:auto;border-radius:20px 20px 0 0;padding:16px;font-family:var(--font-body);padding-bottom:calc(20px + env(safe-area-inset-bottom,0px))}
@media print{#tk,#tkm{display:none!important}}`;

let root, modal, tab = 'progress';
const F = {grade:0, section:'', q:''};
const U = {mode:'file', opp:'', oppOther:'', date:'', shift:'1', days:'1', per:'5', fileInfo:null, rows:null, msg:'', manualSel:new Set(), mg:0, ms:'', mq:''};
const IM = {rows:null, header:false, cols:{name:0, grade:-1, section:-1}, fixedGrade:0, fixedSection:'', msg:''};

function build(){
  const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
  root = document.createElement('div'); root.id = 'tk'; root.hidden = true; root.className = 'no-print';
  root.innerHTML = '<div class="tk-head"><h2 id="tkT"></h2><button class="tk-x" id="tkX" aria-label="إغلاق">✕</button></div><div class="tk-body" id="tkB"></div>' +
    '<div class="tk-tabs">' + [['progress','📊','المتابعة'],['upload','⏱','تسجيل ساعات'],['students','👥','الطلاب'],['data','💾','حفظ البيانات']].map(([k, i, l]) => '<button data-t="' + k + '"><b>' + i + '</b>' + l + '</button>').join('') + '</div>';
  document.body.appendChild(root);
  modal = document.createElement('div'); modal.id = 'tkm'; modal.hidden = true; modal.className = 'no-print'; document.body.appendChild(modal);
  modal.addEventListener('click', e => { if(e.target === modal) modal.hidden = true; });
  $('#tkX').addEventListener('click', () => { root.hidden = true; document.body.style.overflow = ''; });
  root.querySelectorAll('.tk-tabs button').forEach(b => b.addEventListener('click', () => { tab = b.dataset.t; render(); }));
}
async function open(t){ await ready; if(!root) build(); if(t) tab = t; root.hidden = false; document.body.style.overflow = 'hidden'; render(); }
function render(){
  root.querySelectorAll('.tk-tabs button').forEach(b => b.classList.toggle('on', b.dataset.t === tab));
  const T = {progress:'متابعة الساعات', upload:'تسجيل ساعات', students:'الطلاب', data:'حفظ البيانات'};
  $('#tkT').textContent = T[tab] + (tab === 'progress' ? ' (100% = ' + target + ' ساعة)' : '');
  const b = $('#tkB'); b.innerHTML = '';
  ({progress:vProgress, upload:vUpload, students:vStudents, data:vData})[tab](b);
  if(!dbOk){ const w = document.createElement('div'); w.className = 'warn'; w.textContent = 'التخزين الدائم غير متاح في هذا المتصفح (ربما وضع التصفح الخاص). ستُحفظ البيانات حتى إغلاق الصفحة فقط.'; b.prepend(w); }
}
const gradeChips = (cur, set) => '<div class="chips">' + [[0, 'الكل'], [1, 'أول'], [2, 'ثاني'], [3, 'ثالث']].map(([g, l]) => '<button class="chip' + (cur === g ? ' on' : '') + '" data-g="' + g + '">' + l + '</button>').join('') + '</div>';
function studentRow(s, tot){
  const h = tot.get(s.id) || 0, p = pctOf(h), [c] = tone(p);
  return '<div class="st" data-id="' + s.id + '"><div class="n">' + esc(s.name) + '<small>' + GRADES[s.grade] + (s.section ? ' · ' + esc(s.section) : '') + ' · ' + fmt(h) + ' ساعة</small></div><div class="bar"><i style="width:' + Math.min(p, 100) + '%;background:' + c + '"></i></div><div class="pc" style="color:' + c + '">' + fmt(p) + '%</div></div>';
}

/* --- المتابعة --- */
function vProgress(b){
  if(!mem.students.length){ b.innerHTML = '<div class="c"><b>لا يوجد طلاب بعد.</b><p class="note">ابدأ من تبويب «الطلاب»: ارفع قائمة الطلاب من Excel أو أضفهم يدوياً، ثم سجّل ساعات الفرص.</p><button class="btn" id="goS">إضافة الطلاب</button></div>'; $('#goS').onclick = () => { tab = 'students'; render(); }; return; }
  const tot = totals(), all = mem.students.filter(s => (!F.grade || s.grade === F.grade) && (!F.section || s.section === F.section));
  const ps = all.map(s => pctOf(tot.get(s.id) || 0));
  const cnt = [ps.filter(p => p >= 100).length, ps.filter(p => p >= 50 && p < 100).length, ps.filter(p => p >= 25 && p < 50).length, ps.filter(p => p < 25).length];
  const T = [['#1c8a5e', '#e6f3ec', 'أكملوا 100%'], ['#2f6fb0', '#eaf1fa', 'من 50% إلى 99%'], ['#b5792a', '#fbf1e2', 'من 25% إلى 49%'], ['#b3402f', '#fbeae7', 'أقل من 25%']];
  const q = norm(F.q), list = all.filter(s => !q || norm(s.name).includes(q)).sort((a, b) => (tot.get(a.id) || 0) - (tot.get(b.id) || 0) || a.name.localeCompare(b.name, 'ar'));
  b.innerHTML = '<div class="sum">' + T.map((t, i) => '<div style="background:' + t[1] + ';color:' + t[0] + '"><b>' + cnt[i] + '</b>' + t[2] + '</div>').join('') + '</div>' + gradeChips(F.grade) +
    '<div class="row" style="margin-bottom:8px"><select id="fS"><option value="">كل الشعب</option>' + sections(F.grade).map(x => '<option' + (x === F.section ? ' selected' : '') + '>' + esc(x) + '</option>').join('') + '</select><input id="fQ" placeholder="🔍 ابحث باسم الطالب" value="' + esc(F.q) + '"></div>' +
    '<div class="note">' + list.length + ' طالب — الأقل إنجازاً أولاً</div><div id="tkList">' + list.slice(0, 300).map(s => studentRow(s, tot)).join('') + '</div>' + (list.length > 300 ? '<div class="note">يُعرض أول 300؛ استخدم البحث.</div>' : '');
  b.querySelectorAll('[data-g]').forEach(x => x.onclick = () => { F.grade = +x.dataset.g; F.section = ''; render(); });
  $('#fS').onchange = e => { F.section = e.target.value; render(); };
  $('#fQ').oninput = e => { F.q = e.target.value; const keep = e.target.selectionStart; render(); const i = $('#fQ'); i.focus(); i.setSelectionRange(keep, keep); };
  b.querySelectorAll('.st').forEach(x => x.onclick = () => studentSheet(+x.dataset.id));
}
function studentSheet(id){
  const s = mem.students.find(x => x.id === id); if(!s) return;
  const tot = totals().get(id) || 0, p = pctOf(tot), [c] = tone(p);
  const recs = mem.records.filter(r => r.studentId === id).map(r => ({r, b:mem.batches.find(x => x.id === r.batchId)})).sort((a, b) => (b.b ? b.b.date : '').localeCompare(a.b ? a.b.date : ''));
  modal.innerHTML = '<div class="sheet"><div style="font:700 1.05rem var(--font-head);color:var(--green-deep)">' + esc(s.name) + '</div><div class="note">' + GRADES[s.grade] + (s.section ? ' · ' + esc(s.section) : '') + '</div>' +
    '<div class="c" style="text-align:center"><div style="font:700 2rem var(--font-head);color:' + c + '">' + fmt(p) + '%</div><div class="note">' + fmt(tot) + ' من ' + target + ' ساعة' + (p < 100 ? ' — المتبقي <b>' + fmt(target - tot) + '</b> ساعة' : ' ✓') + '</div><div class="bar" style="width:100%"><i style="width:' + Math.min(p, 100) + '%;background:' + c + '"></i></div></div>' +
    '<div style="font-weight:700;font-size:.85rem">سجل المشاركات</div>' + (recs.length ? recs.map(x => '<div class="st" style="cursor:default"><div class="n">' + esc(x.b ? x.b.opp : '—') + '<small>' + esc(x.b ? x.b.date : '') + (x.b ? ' · ' + x.b.days + ' يوم × ' + fmt(x.b.per) + ' ساعة' : '') + '</small></div><div class="pc" style="color:#1c8a5e">+' + fmt(x.r.hours) + '</div><button class="chip" data-dr="' + x.r.id + '">حذف</button></div>').join('') : '<div class="note">لا توجد مشاركات.</div>') +
    '<label>الاسم</label><input id="eN" value="' + esc(s.name) + '"><div class="row"><div><label>الصف</label><select id="eG">' + [1, 2, 3].map(g => '<option value="' + g + '"' + (g === s.grade ? ' selected' : '') + '>' + GRADES[g] + '</option>').join('') + '</select></div><div><label>الشعبة</label><input id="eS" value="' + esc(s.section) + '"></div></div>' +
    '<div class="row" style="margin-top:12px"><button class="btn g" id="eD" style="color:#b3402f">حذف الطالب</button><button class="btn" id="eOk">حفظ</button></div></div>';
  modal.hidden = false;
  modal.querySelectorAll('[data-dr]').forEach(x => x.onclick = async () => { const rid = +x.dataset.dr; await dbDel('records', rid); mem.records = mem.records.filter(r => r.id !== rid); modal.hidden = true; render(); studentSheet(id); });
  $('#eOk', modal).onclick = async () => { s.name = $('#eN', modal).value.trim() || s.name; s.grade = +$('#eG', modal).value; s.section = $('#eS', modal).value.trim(); prep(s); await dbPut('students', strip(s)); modal.hidden = true; render(); };
  $('#eD', modal).onclick = async () => { if(!confirm('حذف الطالب وكل ساعاته؟')) return; for(const r of mem.records.filter(r => r.studentId === id)) await dbDel('records', r.id); mem.records = mem.records.filter(r => r.studentId !== id); await dbDel('students', id); mem.students = mem.students.filter(x => x.id !== id); modal.hidden = true; render(); };
}
const strip = s => ({id:s.id, name:s.name, grade:s.grade, section:s.section});

/* --- الطلاب --- */
function vStudents(b){
  const byG = [1, 2, 3].map(g => mem.students.filter(s => s.grade === g).length);
  b.innerHTML = '<div class="c"><b>' + mem.students.length + ' طالب</b><div class="note">' + [1, 2, 3].map((g, i) => GRADES[g] + ': ' + byG[i]).join(' • ') + '</div></div>' +
    '<div class="c"><b>إضافة طالب يدوياً</b><label>الاسم</label><input id="aN" placeholder="الاسم الثلاثي"><div class="row"><div><label>الصف</label><select id="aG">' + [1, 2, 3].map(g => '<option value="' + g + '">' + GRADES[g] + '</option>').join('') + '</select></div><div><label>الشعبة</label><input id="aS" placeholder="مثال: 1/أ"></div></div><button class="btn" id="aOk" style="margin-top:10px">إضافة</button></div>' +
    '<div class="c"><b>استيراد قائمة الطلاب</b><div class="note">ملف Excel (xlsx) أو CSV، أو الصق من Excel. أي ترتيب للأعمدة، وستختارها بنفسك في المعاينة.</div>' +
    '<label class="btn g" style="display:block;text-align:center;margin-bottom:8px">رفع ملف<input type="file" id="iF" accept=".xlsx,.csv,.txt,.tsv" hidden></label><textarea id="iP" rows="3" placeholder="أو الصق هنا"></textarea>' + (IM.msg ? '<div class="warn" style="margin-top:8px">' + esc(IM.msg) + '</div>' : '') + '<div id="iPrev"></div></div>';
  $('#aOk').onclick = async () => {
    const n = $('#aN').value.trim(); if(!n) return;
    await addStudent(n, +$('#aG').value, $('#aS').value.trim()); render();
  };
  $('#iF').onchange = async e => { const f = e.target.files[0]; if(!f) return; IM.msg = ''; try{ setImport(await readAny(f)); }catch(err){ IM.msg = readErr(err); IM.rows = null; } render(); };
  $('#iP').oninput = e => { if(e.target.value.trim()){ IM.msg = ''; setImport(parseDelimited(e.target.value)); drawImport(); } else { IM.rows = null; $('#iPrev').innerHTML = ''; } };
  if(IM.rows) drawImport();
}
const NAME_H = /الاسم|اسم|name|volunteername/i, GRADE_H = /الصف|المرحله|المرحلة|grade|level/i, SEC_H = /الشعبه|الشعبة|الفصل|section|class/i;
function setImport(rows){
  rows = rows.filter(r => r.some(x => x));
  IM.rows = rows; const h = rows[0] || [];
  IM.header = h.some(x => NAME_H.test(x) || GRADE_H.test(x) || SEC_H.test(x));
  const find = re => h.findIndex(x => re.test(String(x).replace(/\s/g, '')));
  let name = IM.header ? find(NAME_H) : 0; if(name < 0) name = 0;
  IM.cols = {name, grade:IM.header ? find(GRADE_H) : -1, section:IM.header ? find(SEC_H) : -1};
  if(!IM.header && h.length >= 3){ IM.cols.grade = 1; IM.cols.section = 2; }
  IM.fixedGrade = 0; IM.fixedSection = '';
}
function importRows(){
  const body = IM.rows.slice(IM.header ? 1 : 0), c = IM.cols;
  return body.map(r => ({name:(r[c.name] || '').trim(), grade:c.grade >= 0 ? gradeOf(r[c.grade]) : 0, section:c.section >= 0 ? (r[c.section] || '').trim() : ''})).filter(x => x.name);
}
function drawImport(){
  const prevEl = $('#iPrev'); if(!prevEl || !IM.rows) return;
  const w = Math.max(...IM.rows.map(r => r.length)), h = IM.rows[0] || [];
  const opts = (cur, none) => (none ? '<option value="-1"' + (cur < 0 ? ' selected' : '') + '>— بدون —</option>' : '') + Array.from({length:w}, (_, i) => '<option value="' + i + '"' + (i === cur ? ' selected' : '') + '>' + (IM.header ? esc(h[i] || 'عمود ' + (i + 1)) : 'عمود ' + (i + 1)) + '</option>').join('');
  const rows = importRows(), c = IM.cols;
  prevEl.innerHTML = '<div class="note" style="margin-top:8px"><b>اختر الأعمدة</b> (وُجد ' + rows.length + ' سطراً):</div>' +
    '<label>عمود الاسم</label><select id="mN">' + opts(c.name) + '</select><div class="row"><div><label>عمود الصف</label><select id="mG">' + opts(c.grade, 1) + '</select></div><div><label>عمود الشعبة</label><select id="mS">' + opts(c.section, 1) + '</select></div></div>' +
    '<div class="row"><div id="fgw"><label>صف ثابت للكل</label><select id="fG"><option value="0">—</option>' + [1, 2, 3].map(g => '<option value="' + g + '"' + (IM.fixedGrade === g ? ' selected' : '') + '>' + GRADES[g] + '</option>').join('') + '</select></div><div><label>شعبة ثابتة للكل</label><input id="fSx" value="' + esc(IM.fixedSection) + '" placeholder="مثال: 1/أ"></div></div>' +
    '<table style="margin-top:8px"><tr><th>الاسم</th><th>الصف</th><th>الشعبة</th></tr>' + rows.slice(0, 5).map(r => '<tr><td>' + esc(r.name) + '</td><td>' + (GRADES[IM.fixedGrade || r.grade] || '<span style="color:#b3402f">؟</span>') + '</td><td>' + esc(IM.fixedSection || r.section) + '</td></tr>').join('') + '</table>' +
    '<button class="btn" id="iGo" style="margin-top:10px">استيراد ' + rows.length + ' طالب</button>';
  const re = () => { IM.cols = {name:+$('#mN').value, grade:+$('#mG').value, section:+$('#mS').value}; IM.fixedGrade = +$('#fG').value; IM.fixedSection = $('#fSx').value.trim(); drawImport(); };
  ['mN', 'mG', 'mS', 'fG'].forEach(id => $('#' + id).onchange = re); $('#fSx').onchange = re;
  $('#iGo').onclick = async () => {
    const rs = importRows(); let added = 0, dup = 0, noG = 0;
    const seen = new Set(mem.students.map(s => s.sq + '|' + s.grade + '|' + s.section));
    const fresh = [];
    for(const r of rs){
      const g = IM.fixedGrade || r.grade; if(!g){ noG++; continue; }
      const sec = IM.fixedSection || r.section, k = toks(r.name).join('') + '|' + g + '|' + sec;
      if(seen.has(k)){ dup++; continue; } seen.add(k); fresh.push({name:r.name, grade:g, section:sec});
    }
    for(const f of fresh){ await addStudent(f.name, f.grade, f.section); added++; }
    IM.rows = null; IM.msg = '';
    render(); const b = $('#tkB'); const o = document.createElement('div'); o.className = 'ok'; o.textContent = 'أُضيف ' + added + ' طالباً' + (dup ? ' • تجاهل ' + dup + ' مكرراً' : '') + (noG ? ' • تعذّر تحديد الصف لـ ' + noG : ''); b.prepend(o);
  };
}

/* --- تسجيل الساعات --- */
const today = () => new Date().toISOString().slice(0, 10);
function oppList(){ try{ return typeof OPPS !== 'undefined' ? OPPS.map(o => o.name) : []; }catch(e){ return []; } }
function vUpload(b){
  if(!mem.students.length){ b.innerHTML = '<div class="warn">أضف الطلاب أولاً من تبويب «الطلاب» ليُسجَّل لهم.</div><button class="btn" id="goS">إضافة الطلاب</button>'; $('#goS').onclick = () => { tab = 'students'; render(); }; return; }
  if(!U.date) U.date = today();
  const opts = oppList();
  b.innerHTML = '<div class="chips"><button class="chip' + (U.mode === 'file' ? ' on' : '') + '" data-m="file">من ملف المنصة</button><button class="chip' + (U.mode === 'manual' ? ' on' : '') + '" data-m="manual">تحديد الطلاب يدوياً</button></div>' +
    '<div class="c"><label>الفرصة</label><select id="uO"><option value="">اختر الفرصة…</option>' + opts.map(o => '<option' + (o === U.opp ? ' selected' : '') + '>' + esc(o) + '</option>').join('') + '<option value="__o"' + (U.opp === '__o' ? ' selected' : '') + '>أخرى (اكتب الاسم)</option></select>' +
    (U.opp === '__o' ? '<input id="uOo" placeholder="اسم الفرصة" value="' + esc(U.oppOther) + '" style="margin-top:6px">' : '') +
    '<div class="row"><div><label>التاريخ</label><input type="date" id="uD" value="' + U.date + '"></div><div><label>عدد الأيام</label><input type="number" min="1" id="uDy" value="' + U.days + '"></div></div>' +
    (U.mode === 'file' ? '<div class="row"><div><label>الفترة</label><select id="uSh"><option value="1"' + (U.shift === '1' ? ' selected' : '') + '>الفترة 1</option><option value="2"' + (U.shift === '2' ? ' selected' : '') + '>الفترة 2</option><option value="3"' + (U.shift === '3' ? ' selected' : '') + '>الفترة 3</option><option value="all"' + (U.shift === 'all' ? ' selected' : '') + '>كل الفترات</option></select></div><div><label>ملف المنصة</label><label class="btn g" style="display:block;text-align:center;margin:0;padding:10px">اختر ملفاً<input type="file" id="uF" accept=".xlsx,.csv,.txt" hidden></label></div></div>' :
      '<label>ساعات اليوم الواحد</label><input type="number" min="0" step="0.5" id="uP" value="' + U.per + '">') + '</div><div id="uBody"></div><div id="uHist"></div>';
  b.querySelectorAll('[data-m]').forEach(x => x.onclick = () => { U.mode = x.dataset.m; U.rows = null; U.msg = ''; render(); });
  const sync = () => { U.opp = $('#uO').value; const o2 = $('#uOo'); if(o2) U.oppOther = o2.value; U.date = $('#uD').value; U.days = $('#uDy').value; const sh = $('#uSh'); if(sh) U.shift = sh.value; const p = $('#uP'); if(p) U.per = p.value; };
  $('#uO').onchange = () => { sync(); render(); };
  // the days / date / hours fields only refresh the summary: re-drawing here would swallow the tap on a button right after typing
  ['uD', 'uDy', 'uP', 'uOo'].forEach(id => { const el = $('#' + id); if(el) el.oninput = () => { sync(); const f = U.mode === 'file' ? drawFile.sum : drawManual.upd; if(f) f(); }; });
  const shEl = $('#uSh'); if(shEl) shEl.onchange = () => { sync(); if(U.rows) drawFile(); };
  const f = $('#uF'); if(f) f.onchange = async e => { const fl = e.target.files[0]; if(!fl) return; sync(); try{ U.rows = await readAny(fl); U.msg = ''; U.fileInfo = fl.name; }catch(err){ U.rows = null; U.msg = readErr(err); } render(); };
  drawFile.sum = null; drawManual.upd = null;
  if(U.mode === 'file') drawFile(); else drawManual();
  drawHist();
}
const oppName = () => U.opp === '__o' ? U.oppOther.trim() : U.opp;
function fileTable(){
  const rows = U.rows; if(!rows || !rows.length) return null;
  const h = rows[0].map(x => String(x).replace(/\s/g, ''));
  const hasH = h.some(x => /name|الاسم|shift|hours|الفتر|ساعات/i.test(x));
  const find = re => h.findIndex(x => re.test(x));
  let n = hasH ? find(/volunteername|name|الاسم|اسم/i) : 0, sh = hasH ? find(/shift|الفتر/i) : -1, hr = hasH ? find(/hours|ساعات|ساعه/i) : -1;
  if(n < 0) n = 0;
  if(hr < 0){ hr = rows[hasH ? 1 : 0].findIndex((x, i) => i !== n && /^\d+(\.\d+)?$/.test(x) && i !== sh && String(x).length <= 3); }
  return {body:rows.slice(hasH ? 1 : 0), n, sh, hr};
}
function drawFile(){
  const el = $('#uBody'); if(!el) return;
  if(U.msg){ el.innerHTML = '<div class="warn">' + esc(U.msg) + '</div>'; return; }
  const t = fileTable();
  if(!t){ el.innerHTML = '<div class="note">اختر ملف الفرصة الذي نزّلته من المنصة (Excel). رقم الهوية يُتجاهل ولا يُحفظ.</div>'; return; }
  const days = +U.days || 1;
  let rows = t.body.filter(r => (r[t.n] || '').trim());
  if(U.shift !== 'all' && t.sh >= 0) rows = rows.filter(r => String(r[t.sh]).trim() === U.shift);
  const items = rows.map(r => ({name:r[t.n].trim(), per:+(t.hr >= 0 ? r[t.hr] : 0) || 0}));
  if(t.hr < 0){ el.innerHTML = '<div class="warn">لم أجد عمود ساعات الفترة في الملف.</div>'; return; }
  items.forEach(it => { it.m = matchName(it.name); it.pick = it.m.status === 'exact' ? it.m.cands[0].id : ''; it.new = null; });
  U.items = items;
  const ex = items.filter(i => i.m.status === 'exact').length, rest = items.filter(i => i.m.status !== 'exact');
  el.innerHTML = '<div class="ok">' + (U.fileInfo ? esc(U.fileInfo) + ' — ' : '') + items.length + ' سطراً في الفترة المختارة: <b>' + ex + '</b> مطابق تماماً' + (rest.length ? '، و<b>' + rest.length + '</b> يحتاج مراجعتك' : '') + '.</div>' +
    (rest.length ? '<div class="c"><b>راجع هذه الأسماء</b><div class="note">اختر الطالب الصحيح، أو تجاهل، أو أضفه طالباً جديداً.</div>' + rest.map((it, i) => reviewRow(it, i)).join('') + '</div>' : '') +
    '<div class="c" id="uSum"></div><button class="btn" id="uSave">حفظ الدفعة</button>';
  el.querySelectorAll('[data-pk]').forEach(s => s.onchange = () => { const it = rest[+s.dataset.pk]; it.pick = s.value === '__n' ? '' : s.value === '' ? '' : +s.value; it.new = s.value === '__n' ? {grade:1, section:''} : null; drawFile.sum(); const nw = el.querySelector('[data-nw="' + s.dataset.pk + '"]'); if(nw) nw.hidden = s.value !== '__n'; });
  el.querySelectorAll('[data-ng]').forEach(s => s.onchange = () => { rest[+s.dataset.ng].new.grade = +s.value; });
  el.querySelectorAll('[data-ns]').forEach(s => s.oninput = () => { rest[+s.dataset.ns].new.section = s.value.trim(); });
  drawFile.sum = () => {
    const ok = items.filter(i => i.pick !== '' || i.new), tot = ok.reduce((a, i) => a + i.per * days, 0);
    $('#uSum', el).innerHTML = '<b>' + ok.length + '</b> طالباً سيُسجَّل لهم، بمعدل ' + (ok.length ? fmt(ok[0].per) : 0) + ' ساعة × ' + days + ' يوم = <b>' + fmt(ok.length ? ok[0].per * days : 0) + '</b> ساعة للطالب (+' + fmt(ok.length ? pctOf(ok[0].per * days) : 0) + '%)' + (items.length - ok.length ? '<div class="note">سيُتجاهل ' + (items.length - ok.length) + ' سطراً.</div>' : '');
    $('#uSave', el).disabled = !ok.length || !oppName() || !U.date;
  };
  drawFile.sum();
  $('#uSave', el).onclick = () => saveBatch(items.filter(i => i.pick !== '' || i.new).map(i => ({student:i.pick !== '' ? i.pick : null, newStudent:i.new ? {name:i.name, grade:i.new.grade, section:i.new.section} : null, per:i.per})), 'file');
}
function reviewRow(it, i){
  const cands = it.m.cands;
  return '<div style="border-top:1px solid var(--line);padding:8px 0"><div style="font-weight:600;font-size:.85rem">' + esc(it.name) + ' <span class="note">(' + fmt(it.per) + ' ساعة)</span></div><select data-pk="' + i + '"><option value="">تجاهل</option>' +
    cands.map(c => '<option value="' + c.id + '"' + (c.id === it.pick ? ' selected' : '') + '>' + esc(c.name) + ' — ' + GRADES[c.grade] + (c.section ? ' ' + esc(c.section) : '') + '</option>').join('') + '<option value="__n">+ إضافته طالباً جديداً</option></select>' +
    '<div class="row" data-nw="' + i + '" hidden style="margin-top:6px"><select data-ng="' + i + '">' + [1, 2, 3].map(g => '<option value="' + g + '">' + GRADES[g] + '</option>').join('') + '</select><input data-ns="' + i + '" placeholder="الشعبة"></div></div>';
}
function drawManual(){
  const el = $('#uBody'); if(!el) return;
  const q = norm(U.mq), tot = totals();
  const list = mem.students.filter(s => (!U.mg || s.grade === U.mg) && (!U.ms || s.section === U.ms) && (!q || norm(s.name).includes(q)));
  el.innerHTML = '<div class="c">' + gradeChips(U.mg) + '<div class="row"><select id="mS2"><option value="">كل الشعب</option>' + sections(U.mg).map(x => '<option' + (x === U.ms ? ' selected' : '') + '>' + esc(x) + '</option>').join('') + '</select><input id="mQ" placeholder="🔍 بحث" value="' + esc(U.mq) + '"></div>' +
    '<div class="row" style="margin:8px 0"><button class="btn g" id="sAll">تحديد الظاهرين (' + list.length + ')</button><button class="btn g" id="sNone">إلغاء التحديد</button></div>' +
    '<div style="max-height:300px;overflow-y:auto">' + list.slice(0, 200).map(s => '<label class="st" style="margin:0"><input type="checkbox" class="ck" data-s="' + s.id + '"' + (U.manualSel.has(s.id) ? ' checked' : '') + '><span class="n">' + esc(s.name) + '<small>' + GRADES[s.grade] + (s.section ? ' · ' + esc(s.section) : '') + '</small></span></label>').join('') + '</div></div>' +
    '<div class="c" id="uSum"></div><button class="btn" id="uSave">حفظ الدفعة</button>';
  const upd = () => { const n = U.manualSel.size, per = +U.per || 0, d = +U.days || 1; $('#uSum', el).innerHTML = 'سيُسجَّل لـ <b>' + n + '</b> طالباً: ' + fmt(per) + ' × ' + d + ' = <b>' + fmt(per * d) + '</b> ساعة للطالب (+' + fmt(pctOf(per * d)) + '%)'; $('#uSave', el).disabled = !n || !per || !oppName() || !U.date; };
  el.querySelectorAll('[data-g]').forEach(x => x.onclick = () => { U.mg = +x.dataset.g; U.ms = ''; drawManual(); });
  $('#mS2', el).onchange = e => { U.ms = e.target.value; drawManual(); };
  $('#mQ', el).oninput = e => { U.mq = e.target.value; const k = e.target.selectionStart; drawManual(); const i = $('#mQ'); i.focus(); i.setSelectionRange(k, k); };
  el.querySelectorAll('[data-s]').forEach(x => x.onchange = () => { x.checked ? U.manualSel.add(+x.dataset.s) : U.manualSel.delete(+x.dataset.s); upd(); });
  $('#sAll', el).onclick = () => { list.forEach(s => U.manualSel.add(s.id)); drawManual(); };
  $('#sNone', el).onclick = () => { U.manualSel.clear(); drawManual(); };
  drawManual.upd = upd; upd();
  $('#uSave', el).onclick = () => saveBatch([...U.manualSel].map(id => ({student:id, per:+U.per || 0})), 'manual');
}
async function saveBatch(items, source){
  const days = +U.days || 1, name = oppName();
  const dup = mem.batches.find(b => b.opp === name && b.date === U.date && String(b.shift) === String(U.mode === 'file' ? U.shift : '-'));
  if(dup && !confirm('سبق تسجيل دفعة بنفس الفرصة والتاريخ والفترة (' + dup.count + ' طالباً). تسجيلها مرة أخرى سيضاعف الساعات. متابعة؟')) return;
  const batch = await nextId('batches', {opp:name, date:U.date, shift:U.mode === 'file' ? U.shift : '-', days, per:items.length ? items[0].per : 0, source, count:0, createdAt:Date.now()});
  mem.batches.push(batch);
  const recs = [];
  for(const it of items){
    let sid = it.student;
    if(sid == null && it.newStudent){ sid = (await addStudent(it.newStudent.name, it.newStudent.grade, it.newStudent.section)).id; }
    if(sid == null) continue;
    const r = await nextId('records', {batchId:batch.id, studentId:sid, hours:it.per * days}); mem.records.push(r); recs.push(r);
  }
  batch.count = recs.length; await dbPut('batches', batch);
  U.rows = null; U.manualSel = new Set(); U.fileInfo = null; U.msg = '';
  tab = 'upload'; render(); const o = document.createElement('div'); o.className = 'ok'; o.textContent = '✓ سُجّلت الدفعة: ' + recs.length + ' طالباً × ' + fmt(items[0] ? items[0].per * days : 0) + ' ساعة'; $('#tkB').prepend(o);
}
function drawHist(){
  const el = $('#uHist'); if(!el || !mem.batches.length) return;
  el.innerHTML = '<div class="c"><b>الدفعات المسجّلة</b>' + mem.batches.slice().sort((a, b) => b.createdAt - a.createdAt).slice(0, 20).map(x => '<div class="st" style="cursor:default"><div class="n">' + esc(x.opp) + '<small>' + esc(x.date) + ' · ' + x.count + ' طالباً · ' + x.days + ' يوم × ' + fmt(x.per) + ' ساعة</small></div><button class="chip" data-db="' + x.id + '">حذف</button></div>').join('') + '</div>';
  el.querySelectorAll('[data-db]').forEach(x => x.onclick = async () => {
    if(!confirm('حذف هذه الدفعة وكل الساعات التي سجّلتها؟')) return;
    const id = +x.dataset.db; for(const r of mem.records.filter(r => r.batchId === id)) await dbDel('records', r.id);
    mem.records = mem.records.filter(r => r.batchId !== id); await dbDel('batches', id); mem.batches = mem.batches.filter(b => b.id !== id); render();
  });
}

/* --- حفظ البيانات --- */
function vData(b){
  const standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone;
  b.innerHTML = '<div class="' + (standalone ? 'ok' : 'warn') + '"><b>' + (standalone ? '✓ التطبيق مثبّت على الشاشة الرئيسية' : '① ثبّت التطبيق') + '</b><div class="note">' + (standalone ? 'بياناتك أكثر أماناً من المسح التلقائي.' : 'آيفون: زر المشاركة ثم «إضافة إلى الشاشة الرئيسية». أندرويد: القائمة ثم «تثبيت التطبيق». يحمي بياناتك من المسح التلقائي.') + '</div></div>' +
    '<div class="c"><b>② نسخة احتياطية</b><div class="note">البيانات على هذا الجهاز فقط. احفظ نسخة في ملف دورياً، واستعدها منه إن تغيّر الجهاز أو مُسحت البيانات.</div><div class="row"><button class="btn" id="bX">حفظ النسخة في ملف</button><label class="btn g" style="text-align:center;margin:0;display:block">استعادة من ملف<input type="file" id="bI" accept=".json" hidden></label></div><div class="note" id="bM"></div></div>' +
    '<div class="c"><b>③ الساعات المطلوبة لتحقيق 100%</b><input type="number" id="tT" min="1" value="' + target + '"><div class="note">كل ساعة = ' + fmt(100 / target) + '%. التراكم على ثلاث سنوات.</div><button class="btn g" id="tS">حفظ</button></div>' +
    '<div class="c"><b>⑤ بداية جديدة</b><div class="note">يمسح كل الطلاب والساعات من هذا الجهاز.</div><button class="btn d" id="bC">مسح كل البيانات</button></div>';
  $('#bX').onclick = () => {
    const blob = new Blob([JSON.stringify({v:1, target, students:mem.students.map(strip), batches:mem.batches, records:mem.records})], {type:'application/json'});
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'volunteer-hours-' + today() + '.json'; document.body.appendChild(a); a.click(); a.remove();
    $('#bM').textContent = '✓ حُفظت النسخة.';
  };
  $('#bI').onchange = async e => {
    const f = e.target.files[0]; if(!f) return;
    try{
      const d = JSON.parse(await f.text()); if(!Array.isArray(d.students) || !Array.isArray(d.records)) throw 0;
      if(!confirm('ستحلّ هذه النسخة (' + d.students.length + ' طالباً) محل البيانات الحالية. متابعة؟')) return;
      await dbClear(); mem.students = []; mem.batches = []; mem.records = [];
      for(const s of d.students) mem.students.push(prep(await dbPut('students', strip(s))));
      for(const x of d.batches || []) mem.batches.push(await dbPut('batches', x));
      for(const x of d.records) mem.records.push(await dbPut('records', x));
      if(d.target){ target = d.target; if(dbOk) await dbPut('meta', {k:'target', v:target}); }
      render(); const o = document.createElement('div'); o.className = 'ok'; o.textContent = '✓ استُعيدت البيانات'; $('#tkB').prepend(o);
    }catch(err){ $('#bM').textContent = 'الملف غير صالح.'; }
  };
  $('#tS').onclick = async () => { const v = +$('#tT').value; if(v > 0){ target = v; if(dbOk) await dbPut('meta', {k:'target', v}); render(); } };
  $('#bC').onclick = async () => { if(!confirm('مسح كل الطلاب والساعات نهائياً؟')) return; if(!confirm('متأكد؟ لا يمكن التراجع.')) return; await dbClear(); mem.students = []; mem.batches = []; mem.records = []; render(); };
}

window.VW = {open, ready, certStudents:() => mem.students.map(s => ({n:s.name, c:s.section || GRADES[s.grade]})), _U:U, _mem:mem, _match:matchName, _norm:norm, _readAny:readAny};
})();
