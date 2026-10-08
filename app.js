/* WashWiz v2: app.js
   Vanilla JavaScript. The page asks PHP for everything with fetch(), and PHP talks to MySQL.
   Nothing is saved in the browser.

   API map (every call below uses an existing PHP file, unchanged):
   GET  check_auth.php  get_services.php  get_customers.php  get_orders.php
   POST login.php {username,password}     logout.php {}      set_admin_password.php {password,confirm_password}
   POST add_order.php {customer_name,phone,service_id,quantity,fulfillment,address,due_date,notes,paid}
   POST update_status.php {order_id,new_status}   update_payment.php {order_id,is_paid}
   POST delete_order.php {order_id}               delete_customer.php {customer_id}
   POST add_service.php {service_name,price,unit} update_service.php {service_id,service_name,price,unit}
   POST delete_service.php {service_id}
*/

/* ===== 1. Constants and small helpers ===== */
const CUR='₱';
const STAGES=[
  {key:'received',label:'Received',hint:'Waiting to be washed',action:'Start washing'},
  {key:'washing',label:'Washing',hint:'In the machine',action:'Mark ready'},
  {key:'ready',label:'Ready',hint:'Ready for pickup or delivery',action:'Complete'},
  {key:'done',label:'Done',hint:'Picked up or delivered',action:''}
];
const VIEWS={dashboard:'Dashboard',orders:'Orders',customers:'Customers',services:'Services'};
const ROLE_LABELS={Admin:'Administrator',Cashier:'Cashier',Staff:'Staff'};
const IDLE_MS=10*60*1000;  // log out after 10 minutes without activity (the same rule PHP uses)
const PING_MS=3*60*1000;   // while the user is active, tell PHP "still here" at most every 3 minutes

const $=(s,root=document)=>root.querySelector(s);
const $$=(s,root=document)=>[...root.querySelectorAll(s)];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=n=>CUR+Number(n).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});
const pad=n=>String(n).padStart(2,'0');
const today=()=>{const d=new Date();return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())};
const orderNo=id=>'ORD-'+String(id).padStart(4,'0');   // MySQL keeps the plain number, the screen shows ORD-0015
const icon=name=>`<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const plural=(n,word)=>n+' '+word+(n===1?'':'s');
const fmtDate=iso=>{const [y,m,d]=iso.split('-').map(Number);return new Date(y,m-1,d).toLocaleDateString('en-PH',{month:'short',day:'numeric'})};
const initials=name=>(String(name).split(/[\s_.-]+/).filter(Boolean).map(w=>w[0]).slice(0,2).join('')||'?').toUpperCase();
const sk=(w,h)=>`<span class="skeleton" style="width:${w};height:${h}"></span>`;

/* ===== 2. State: only a temporary copy of what PHP/MySQL last sent, so the screen can be drawn ===== */
const state={
  user:null,                                   // {username, role} while logged in (the data comes from PHP)
  services:[],customers:[],orders:[],fee:0,
  loaded:{orders:false,customers:false,services:false},
  errors:{orders:null,customers:null,services:null},   // {title, detail} when a load failed
  filters:{q:'',fulfillment:'',payment:''},customerQuery:'',stageTab:'received',
  pending:new Set(),                           // ids of orders waiting for PHP to answer
  editingService:null
};
const isAdmin=()=>!!state.user&&state.user.role==='Admin';
const isOverdue=o=>o.status!=='done'&&!!o.due&&o.due<today();
const stageOf=key=>STAGES.find(s=>s.key===key)||STAGES[0];

/* ===== 3. Talking to PHP ===== */
// Makes an Error whose message is safe to show to the user.
function makeError(message,status){const e=new Error(message);e.friendly=true;e.status=status;return e}
// Reads PHP's JSON answer: {success:true,data:...} or {success:false,message:...}.
// Returns the data part, or throws an error if the request failed.
async function readReply(response){
  let reply;
  try{reply=await response.json()}
  catch(e){throw makeError('The server sent an answer the page could not read.',response.status)}
  if(!response.ok||!reply.success)throw makeError(reply.message||'Something went wrong. Please try again.',response.status);
  return reply.data;
}
// Sends data to a PHP file as JSON (POST). Every "change something" action uses this, so the fetch options are written once.
async function postJSON(url,body){
  const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  return readReply(response);
}
const errorText=err=>err.friendly?err.message:'Cannot reach the server. Check that Apache and MySQL are running.';
// Shows a problem in a toast, so the user is never left with a silent failure.
function showError(err){
  // 401/403 = PHP says "no admin session" (for example the 10 minutes ran out): go back to the login screen.
  if((err.status===401||err.status===403)&&state.user){endSession('Your session has ended. Please log in again.',false);return}
  toast(errorText(err),'error');
}

/* ===== 4. Small UI helpers: toast, busy bar, button spinner ===== */
function toast(message,type='info'){
  const box=$('#toasts');
  while(box.children.length>=3)box.firstElementChild.remove();
  const t=document.createElement('div');
  t.className='toast toast--'+type;
  t.setAttribute('role',type==='error'?'alert':'status');
  t.innerHTML=icon(type==='success'?'check-circle':type==='error'?'alert-circle':'info')+'<span>'+esc(message)+'</span><button type="button" class="toast__close" aria-label="Dismiss message">'+icon('x')+'</button>';
  box.append(t);
  requestAnimationFrame(()=>t.classList.add('is-in'));
  let timer;
  const remove=()=>{clearTimeout(timer);t.classList.remove('is-in');setTimeout(()=>t.remove(),200)};
  $('button',t).addEventListener('click',remove);
  timer=setTimeout(remove,type==='error'?6000:3500);
}
let busyCount=0;
function setBusy(delta){busyCount=Math.max(0,busyCount+delta);document.body.classList.toggle('is-busy',busyCount>0)}
function setLoading(btn,on,text){
  if(on){btn.dataset.html=btn.innerHTML;btn.disabled=true;btn.innerHTML='<span class="spinner spinner--sm"></span>'+esc(text)}
  else{btn.disabled=false;if(btn.dataset.html!==undefined)btn.innerHTML=btn.dataset.html}
}
function setInvalid(input,msg){
  const field=input.closest('.field');field.classList.add('is-invalid');
  let err=$('.field__error',field);
  if(!err){err=document.createElement('p');err.className='field__error';err.id=input.id+'-error';field.append(err)}
  err.textContent=msg;input.setAttribute('aria-invalid','true');input.setAttribute('aria-describedby',err.id);
}
function clearInvalid(root){
  $$('.field.is-invalid',root).forEach(f=>f.classList.remove('is-invalid'));
  $$('.field__error',root).forEach(e=>e.remove());
  $$('[aria-invalid]',root).forEach(i=>{i.removeAttribute('aria-invalid');i.removeAttribute('aria-describedby')});
}
function setPwVisible(btn,show){
  const input=$('input',btn.parentElement);
  input.type=show?'text':'password';
  btn.setAttribute('aria-pressed',String(show));
  btn.setAttribute('aria-label',show?'Hide password':'Show password');
  $('use',btn).setAttribute('href',show?'#i-eye-off':'#i-eye');
}

/* ===== 5. Modals (open, close, keep keyboard focus inside) and the confirm dialog ===== */
let activeModal=null,lastFocus=null,confirmResolve=null;
const FOCUSABLE='a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
const sidebarOpen=()=>$('#sidebar').classList.contains('is-open');
function openModal(id){
  const m=document.getElementById(id);
  lastFocus=document.activeElement;activeModal=m;
  m.classList.add('is-open');m.setAttribute('aria-hidden','false');
  document.body.classList.add('no-scroll');
  const first=$('[data-autofocus]',m)||$(FOCUSABLE,m);   // move keyboard focus into the dialog right away
  if(first)first.focus();
}
function closeModal(){
  if(!activeModal)return;
  const m=activeModal;activeModal=null;
  m.classList.remove('is-open');m.setAttribute('aria-hidden','true');
  if(!sidebarOpen())document.body.classList.remove('no-scroll');
  if(confirmResolve){const r=confirmResolve;confirmResolve=null;r(false)}   // closed without confirming = "no"
  if(lastFocus&&lastFocus.focus)lastFocus.focus();
}
// Asks "are you sure?" in the shared dialog. Returns true only when the user presses the red button.
function confirmAction({title,message,confirmLabel}){
  return new Promise(resolve=>{
    $('#confirm-title').textContent=title;$('#confirm-message').textContent=message;$('#confirm-ok').textContent=confirmLabel;
    confirmResolve=resolve;openModal('confirm-modal');
  });
}

/* ===== 6. Mobile drawer and page navigation (the URL part after # picks the page) ===== */
function openMenu(){
  $('#sidebar').classList.add('is-open');$('#scrim').classList.add('is-open');
  $('#menu-btn').setAttribute('aria-expanded','true');document.body.classList.add('no-scroll');
  const a=$('.nav__link.is-active')||$('.nav__link');if(a)a.focus();
}
function closeMenu(returnFocus){
  if(!sidebarOpen())return;
  $('#sidebar').classList.remove('is-open');$('#scrim').classList.remove('is-open');
  $('#menu-btn').setAttribute('aria-expanded','false');
  if(!activeModal)document.body.classList.remove('no-scroll');
  if(returnFocus)$('#menu-btn').focus();
}
function route(){
  const name=location.hash.slice(1),view=VIEWS[name]?name:'dashboard';
  $$('.view').forEach(v=>{v.hidden=v.id!=='view-'+view});
  $$('.nav__link').forEach(a=>{
    const on=a.dataset.view===view;a.classList.toggle('is-active',on);
    if(on)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');
  });
  document.title=VIEWS[view]+' | WashWiz';
  closeMenu();window.scrollTo(0,0);
  const h=$('#view-'+view+' h1');if(h)h.focus({preventScroll:true});
}
function goTo(view){if(location.hash==='#'+view)route();else location.hash=view}

/* ===== 7. Login, first-time setup, logout and the session watch ===== */
let idleTimer=null,lastPing=0;
const setUser=auth=>{state.user={username:auth.username||'',role:auth.role||'Admin'}};
// check_auth.php does not send a role (only Admins can log in), so a missing role means Admin.

function showBoot(text,failed){
  $('#auth').hidden=true;$('#app').hidden=true;$('#boot').hidden=false;
  $('#boot-text').textContent=text;$('#boot-spinner').hidden=!!failed;$('#boot-retry').hidden=!failed;
}
function showAuth(mode,notice){
  state.user=null;clearTimeout(idleTimer);
  $('#boot').hidden=true;$('#app').hidden=true;$('#auth').hidden=false;
  const setup=mode==='setup';
  $('#login-form').hidden=setup;$('#setup-form').hidden=!setup;
  $('#auth-title').textContent=setup?'Set up WashWiz':'Log in';
  $('#auth-sub').textContent=setup?'Create the administrator password. You will use it every time you log in.':'Enter your username and password to continue.';
  $('#auth-error').hidden=true;
  $('#auth-notice').hidden=!notice;if(notice)$('#auth-notice-text').textContent=notice;
  $('#login-form').reset();$('#setup-form').reset();
  $$('.pw-toggle').forEach(b=>setPwVisible(b,false));
  document.title=(setup?'Set up':'Log in')+' | WashWiz';
  $(setup?'#setup-password':'#login-username').focus();
}
function showAuthError(msg){$('#auth-notice').hidden=true;$('#auth-error-text').textContent=msg;$('#auth-error').hidden=false}

async function startSession(){
  showBoot('Loading WashWiz');
  try{
    // Ask PHP if someone is already logged in (PHP remembers it in its session) and if an admin password exists yet.
    const auth=await loadAuth();
    if(auth.logged_in){setUser(auth);await enterApp()}
    else showAuth(auth.password_set?'login':'setup');
  }catch(err){showBoot(errorText(err),true)}
}
async function enterApp(){
  $('#boot').hidden=true;$('#auth').hidden=true;$('#app').hidden=false;
  Object.keys(state.loaded).forEach(k=>{state.loaded[k]=false;state.errors[k]=null});
  state.orders=[];state.customers=[];state.services=[];
  renderShell();renderAll();route();
  lastPing=Date.now();noteActivity();
  await refreshAll();
}
async function onLogin(e){
  e.preventDefault();
  const username=$('#login-username').value.trim(),password=$('#login-password').value;
  if(!username){showAuthError('Enter your username.');$('#login-username').focus();return}
  if(!password){showAuthError('Enter your password.');$('#login-password').focus();return}
  const btn=$('#login-submit'),fields=$$('#login-form input');
  $('#auth-error').hidden=true;
  setLoading(btn,true,'Logging in');fields.forEach(i=>{i.disabled=true});
  try{
    // Ask PHP to check the password against the Admin accounts in the staff table (password_verify) and start the session.
    const data=await postJSON('login.php',{username,password});
    setUser(data);
    await enterApp();
    toast('Logged in as '+state.user.username,'success');
  }catch(err){
    showAuthError(err.status===401?'Incorrect username or password.':errorText(err));
    fields.forEach(i=>{i.disabled=false});
    $('#login-password').focus();$('#login-password').select();
  }finally{setLoading(btn,false);fields.forEach(i=>{i.disabled=false})}
}
async function onSetup(e){
  e.preventDefault();
  const pw=$('#setup-password').value,confirm=$('#setup-confirm').value;
  if(pw.length<6){showAuthError('Use at least 6 characters.');$('#setup-password').focus();return}
  if(pw!==confirm){showAuthError('The passwords do not match.');$('#setup-confirm').focus();return}
  const btn=$('#setup-submit');$('#auth-error').hidden=true;setLoading(btn,true,'Saving');
  try{
    // Ask PHP to hash the new password (password_hash) and save the hash in the staff table. PHP also logs us in.
    const data=await postJSON('set_admin_password.php',{password:pw,confirm_password:confirm});
    setUser(data);
    await enterApp();
    toast('Password created. Logged in as '+state.user.username,'success');
  }catch(err){
    if(err.status===403)showAuth('login','An admin password already exists. Please log in.');
    else showAuthError(errorText(err));
  }finally{setLoading(btn,false)}
}
async function logout(){
  try{
    // Ask PHP to end the session (session_destroy), so logging out is real and not only on screen.
    await postJSON('logout.php',{});
    endSession('You have been logged out.',false);
  }catch(err){showError(err)}
}
async function endSession(message,callLogout){
  if(callLogout){try{await postJSON('logout.php',{})}catch(e){}}
  closeModal();closeMenu();
  state.orders=[];state.customers=[];state.services=[];
  showAuth('login',message);
}
// Called on every click/key press: restarts the idle timer and now and then tells PHP the user is still active.
function noteActivity(){
  if(!state.user)return;
  clearTimeout(idleTimer);
  idleTimer=setTimeout(()=>endSession('Logged out after 10 minutes of inactivity.',true),IDLE_MS);
  if(Date.now()-lastPing>PING_MS)pingServer();
}
async function pingServer(){
  lastPing=Date.now();
  try{
    // Ask PHP if the session is still valid. PHP also counts this as activity, so the two 10-minute timers stay in step.
    const auth=await loadAuth();
    if(!auth.logged_in)endSession('Your session has ended. Please log in again.',false);
  }catch(err){}
}

/* ===== 8. Loading data from MySQL (through PHP) ===== */
async function loadAuth(){
  // Ask the PHP backend who is logged in: {logged_in, username, password_set}.
  const response=await fetch('check_auth.php');
  return readReply(response);
}
async function loadServices(){
  // Ask the PHP backend for all services (and the delivery fee) so the dropdown and price table show the latest data.
  const response=await fetch('get_services.php');
  const data=await readReply(response);
  state.services=data.services;state.fee=data.delivery_fee;
}
async function loadCustomers(){
  // Ask the PHP backend for every customer, with their number of orders and total spent.
  const response=await fetch('get_customers.php');
  state.customers=await readReply(response);
}
async function loadOrders(){
  // Ask the PHP backend for the latest orders from MySQL (already joined with customers, services and payments).
  const response=await fetch('get_orders.php');
  state.orders=await readReply(response);
}
// Runs one loader and remembers whether it worked, so each page can show its own error message.
async function loadSection(key,loader,title){
  try{await loader();state.loaded[key]=true;state.errors[key]=null;return null}
  catch(err){state.errors[key]={title,detail:errorText(err)};return errorText(err)}
}
// Reloads everything from MySQL and redraws the screen. Used after every change, so the screen always matches the database.
async function refreshAll(){
  setBusy(1);
  const failures=(await Promise.all([
    loadSection('orders',loadOrders,'Unable to load orders. Please try again.'),
    loadSection('customers',loadCustomers,'Unable to load customers. Please try again.'),
    loadSection('services',loadServices,'Unable to load services. Please try again.')
  ])).filter(Boolean);
  setBusy(-1);
  renderAll();
  // If we already had data on screen, the pages keep showing it, so tell the user the refresh failed.
  if(failures.length&&Object.values(state.loaded).some(Boolean))toast(failures[0],'error');
}

/* ===== 9. Rendering ===== */
const stageBadge=key=>`<span class="badge badge--dot badge--${key}">${stageOf(key).label}</span>`;
const payBadge=paid=>`<span class="badge badge--${paid?'paid':'unpaid'}">${paid?'Paid':'Unpaid'}</span>`;
function dueInfo(o){
  if(!o.due)return null;
  if(isOverdue(o))return{text:'Overdue since '+fmtDate(o.due),cls:'overdue'};
  if(o.due===today()&&o.status!=='done')return{text:'Due today',cls:'today'};
  return{text:'Due '+fmtDate(o.due),cls:'neutral'};
}
const dueBadge=o=>{const d=dueInfo(o);return d?`<span class="badge badge--${d.cls}">${d.text}</span>`:''};
const emptyBlock=(name,title,text,action='')=>`<div class="empty"><span class="empty__icon">${icon(name)}</span><h2>${esc(title)}</h2><p>${esc(text)}</p>${action}</div>`;
const errorBlock=key=>`<div class="empty empty--error" role="alert"><span class="empty__icon">${icon('alert-circle')}</span><h2>${esc(state.errors[key].title)}</h2><p>${esc(state.errors[key].detail)}</p><button type="button" class="btn btn-secondary" data-act="retry">Try again</button></div>`;
const tableSkeleton=()=>`<div class="panel">${[1,2,3,4].map(()=>`<div class="list__row">${sk('40%','16px')}${sk('20%','16px')}</div>`).join('')}</div>`;

function renderAll(){renderShell();renderFormLists();renderDashboard();renderBoard();renderCustomers();renderServices()}

// Who is logged in (name and role come from PHP) and which admin-only controls to show.
function renderShell(){
  const u=state.user;if(!u)return;
  $('#user-name').textContent=u.username||'Signed in';
  $('#user-role').textContent=ROLE_LABELS[u.role]||u.role;
  $('#user-avatar').textContent=initials(u.username);
  $$('[data-admin]').forEach(el=>{el.hidden=!isAdmin()});
  $('#dash-sub').textContent='Welcome back, '+u.username+'. Today is '+new Date().toLocaleDateString('en-PH',{weekday:'long',month:'long',day:'numeric'})+'.';
}
// The service dropdown and the customer suggestions inside the "New order" form.
function renderFormLists(){
  $('#of-service').innerHTML=state.services.map(s=>`<option value="${s.id}">${esc(s.name)} (${money(s.price)}/${esc(s.unit)})</option>`).join('');
  $('#customer-list').innerHTML=state.customers.map(c=>`<option value="${esc(c.name)}">`).join('');
}

function renderDashboard(){
  const box=$('#dash-body');
  if(!state.loaded.orders){
    if(state.errors.orders){box.innerHTML=errorBlock('orders');return}
    box.innerHTML=`<div class="stats">${[1,2,3,4,5,6].map(()=>`<div class="stat">${sk('55%','13px')}${sk('40%','26px')}${sk('65%','12px')}</div>`).join('')}</div>
      <section class="panel"><div class="panel__head">${sk('140px','18px')}</div><div class="stage-grid">${[1,2,3,4].map(()=>`<div class="stage-tile">${sk('50%','13px')}${sk('30%','24px')}${sk('100%','4px')}</div>`).join('')}</div></section>`;
    return;
  }
  const orders=state.orders,t=today();
  const sum=list=>list.reduce((a,o)=>a+o.total,0);
  const paid=orders.filter(o=>o.paid),unpaid=orders.filter(o=>!o.paid);
  const active=orders.filter(o=>o.status!=='done'),overdue=orders.filter(isOverdue);
  const customers=state.loaded.customers?String(state.customers.length):'-';
  const tile=(label,value,hint,cls='')=>`<div class="stat"><span class="stat__label">${label}</span><strong class="stat__value ${cls}">${value}</strong><span class="stat__hint">${hint}</span></div>`;
  const stats=[
    tile('Total orders',orders.length,'All time'),
    tile('Active orders',active.length,'Not done yet'),
    tile('Overdue',overdue.length,'Past the due date',overdue.length?'is-danger':''),
    tile('Unpaid',money(sum(unpaid)),plural(unpaid.length,'order')),
    tile('Revenue collected',money(sum(paid)),plural(paid.length,'paid order')),
    tile('Customers',customers,'In the system')
  ].join('');
  const share=orders.length||1;
  const stages=STAGES.map(s=>{
    const n=orders.filter(o=>o.status===s.key).length;
    return `<button type="button" class="stage-tile" data-act="open-stage" data-stage="${s.key}"><span class="stage-tile__name"><i class="dot dot--${s.key}"></i>${s.label}</span><strong>${n}</strong><span class="bar"><i class="bar__fill bar__fill--${s.key}" style="width:${Math.round(n/share*100)}%"></i></span></button>`;
  }).join('');
  const attention=active.filter(o=>o.due&&o.due<=t).sort((a,b)=>a.due.localeCompare(b.due)||a.id-b.id).slice(0,5);
  const attentionRows=attention.length?attention.map(o=>`<li class="list__row"><div class="list__main"><span class="list__title"><strong>${orderNo(o.id)}</strong> ${esc(o.customer)}</span><span class="list__sub">${esc(o.service)}, ${o.qty} ${esc(o.unit)}</span></div><div class="list__side">${dueBadge(o)}${stageBadge(o.status)}</div></li>`).join('')
    :'<li class="list__empty">Nothing is overdue or due today.</li>';
  const recent=[...orders].sort((a,b)=>b.id-a.id).slice(0,5);
  const recentRows=recent.length?recent.map(o=>`<li class="list__row"><div class="list__main"><span class="list__title"><strong>${orderNo(o.id)}</strong> ${esc(o.customer)}</span><span class="list__sub">${esc(o.service)}, ${o.qty} ${esc(o.unit)}</span></div><div class="list__side"><strong>${money(o.total)}</strong>${stageBadge(o.status)}</div></li>`).join('')
    :'<li class="list__empty">No orders yet. Save your first order to see it here.</li>';
  box.innerHTML=`<div class="stats">${stats}</div>
    <section class="panel" aria-labelledby="h-overview"><div class="panel__head"><div><h2 id="h-overview">Order overview</h2><p>Where every order is right now</p></div><button type="button" class="btn btn-ghost btn-sm" data-act="goto" data-view="orders">View orders</button></div><div class="stage-grid">${stages}</div></section>
    <div class="dash-grid">
      <section class="panel" aria-labelledby="h-attention"><div class="panel__head"><div><h2 id="h-attention">Needs attention</h2><p>Open orders that are overdue or due today</p></div></div><ul class="list">${attentionRows}</ul></section>
      <section class="panel" aria-labelledby="h-recent"><div class="panel__head"><div><h2 id="h-recent">Recent orders</h2><p>The latest five orders</p></div><button type="button" class="btn btn-ghost btn-sm" data-act="goto" data-view="orders">View all</button></div><ul class="list">${recentRows}</ul></section>
    </div>`;
}

function visibleOrders(){
  const f=state.filters,q=f.q.trim().toLowerCase();
  return state.orders.filter(o=>(!q||(orderNo(o.id)+' '+o.customer+' '+o.phone).toLowerCase().includes(q))&&(!f.fulfillment||o.fulfillment===f.fulfillment)&&(!f.payment||(f.payment==='paid')===o.paid));
}
function card(o){
  const idx=Math.max(0,STAGES.findIndex(s=>s.key===o.status)),stage=STAGES[idx],busy=state.pending.has(o.id);
  const d=dueInfo(o),home=o.fulfillment==='Home Delivery';
  const steps=STAGES.map((s,i)=>`<i class="${i<=idx?'on':''}"></i>`).join('');
  const details=[
    `<li>${icon(home?'truck':'store')}<span>${esc(o.fulfillment)}</span></li>`,
    d?`<li>${icon('calendar')}<span class="due due--${d.cls}">${d.text}</span></li>`:'',
    o.address?`<li>${icon('map-pin')}<span>${esc(o.address)}</span></li>`:'',
    o.notes?`<li>${icon('note')}<span>${esc(o.notes)}</span></li>`:''
  ].join('');
  const main=busy?'<button type="button" class="btn btn-secondary btn-block" disabled><span class="spinner spinner--sm"></span>Updating</button>'
    :idx<3?`<button type="button" class="btn btn-primary btn-block" data-act="next" data-id="${o.id}">${stage.action}</button>`:'';
  const sub=busy?'':`<div class="order__sub">${idx>0?`<button type="button" class="btn btn-ghost btn-sm" data-act="back" data-id="${o.id}">${icon('chevron-left')}Back</button>`:''}<button type="button" class="btn btn-ghost btn-sm" data-act="pay" data-id="${o.id}">${o.paid?'Mark unpaid':'Mark paid'}</button><button type="button" class="btn btn-ghost btn-sm is-danger" data-act="delete-order" data-id="${o.id}" aria-label="Delete order ${orderNo(o.id)}">${icon('trash')}</button></div>`;
  return `<article class="order${busy?' is-pending':''}" aria-busy="${busy}">
    <div class="order__top"><span class="order__no">${orderNo(o.id)}</span>${stageBadge(o.status)}</div>
    <div class="steps" aria-hidden="true">${steps}</div>
    <div><h3 class="order__customer">${esc(o.customer)}</h3><p class="order__phone">${esc(o.phone)}</p></div>
    <div class="order__service">${esc(o.service)}<span>${o.qty} ${esc(o.unit)}</span></div>
    <ul class="order__details">${details}</ul>
    <div class="order__foot">${payBadge(o.paid)}<span class="order__total">${money(o.total)}</span></div>
    <div class="order__actions">${main}${sub}</div>
  </article>`;
}
function renderBoard(){
  const board=$('#board'),tabs=$('#stage-tabs');
  if(!state.loaded.orders){
    tabs.hidden=true;
    if(state.errors.orders){board.innerHTML=errorBlock('orders');return}
    board.innerHTML=STAGES.map(()=>`<section class="col is-current"><div class="col__list"><div class="order">${sk('45%','13px')}${sk('70%','18px')}${sk('90%','13px')}${sk('100%','40px')}</div></div></section>`).join('');
    return;
  }
  if(!state.orders.length){
    tabs.hidden=true;
    board.innerHTML=emptyBlock('clipboard','No orders yet','Save your first order to start tracking laundry.','<button type="button" class="btn btn-primary" data-act="new-order">New order</button>');
    return;
  }
  const list=visibleOrders();
  if(!list.length){
    tabs.hidden=true;
    board.innerHTML=emptyBlock('search','No orders found','Try a different search or clear the filters.','<button type="button" class="btn btn-secondary" data-act="clear-filters">Clear filters</button>');
    return;
  }
  tabs.hidden=false;
  tabs.innerHTML=STAGES.map(s=>`<button type="button" class="stage-tab${s.key===state.stageTab?' is-active':''}" aria-pressed="${s.key===state.stageTab}" data-act="stage-tab" data-stage="${s.key}"><span>${s.label}</span><strong>${list.filter(o=>o.status===s.key).length}</strong></button>`).join('');
  board.innerHTML=STAGES.map(s=>{
    const cards=list.filter(o=>o.status===s.key);
    return `<section class="col${s.key===state.stageTab?' is-current':''}" aria-label="${s.label} orders"><header class="col__head"><i class="dot dot--${s.key}"></i><h2>${s.label}</h2><span class="count">${cards.length}</span></header><p class="col__hint">${s.hint}</p><div class="col__list">${cards.map(card).join('')||'<p class="col__empty">No orders</p>'}</div></section>`;
  }).join('');
}

function renderCustomers(){
  const box=$('#customers-body');
  if(!state.loaded.customers){box.innerHTML=state.errors.customers?errorBlock('customers'):tableSkeleton();return}
  if(!state.customers.length){box.innerHTML=emptyBlock('users','No customers yet','Customers appear here automatically when you save an order.');return}
  const q=state.customerQuery.trim().toLowerCase();
  const list=state.customers.filter(c=>!q||(c.name+' '+c.phone).toLowerCase().includes(q));
  if(!list.length){box.innerHTML=emptyBlock('search','No customers found','Try a different name or phone number.');return}
  box.innerHTML=`<div class="panel table-panel"><table class="table"><thead><tr><th scope="col">Customer</th><th scope="col">Phone</th><th scope="col">Preferred</th><th scope="col" class="num">Orders</th><th scope="col" class="num">Total spent</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead><tbody>${list.map(c=>
    `<tr><td class="cell-main" data-label="Customer">${esc(c.name)}</td><td data-label="Phone">${esc(c.phone)}</td><td data-label="Preferred">${c.fulfillment?`<span class="badge badge--neutral">${esc(c.fulfillment)}</span>`:'-'}</td><td class="num" data-label="Orders">${c.order_count}</td><td class="num" data-label="Total spent">${money(c.total_spent)}</td><td class="cell-actions"><button type="button" class="btn btn-ghost btn-sm is-danger" data-act="delete-customer" data-id="${c.id}" aria-label="Remove ${esc(c.name)}">${icon('trash')}Remove</button></td></tr>`).join('')}</tbody></table></div>`;
}

function renderServices(){
  const box=$('#services-body'),admin=isAdmin();
  if(!state.loaded.services){box.innerHTML=state.errors.services?errorBlock('services'):tableSkeleton();return}
  // The delivery fee is read-only: the finished schema has no table to save a changed fee in. It is set in db.php.
  const fee=`<div class="panel fee"><div><strong>Home delivery fee</strong><span>Added to every Home Delivery order. It is set on the server.</span></div><b>${money(state.fee)}</b></div>`;
  if(!state.services.length){
    box.innerHTML=fee+emptyBlock('tag','No services available',admin?'Add a service to start taking orders.':'An administrator needs to add a service first.',admin?'<button type="button" class="btn btn-primary" data-act="add-service">Add service</button>':'');
    return;
  }
  box.innerHTML=fee+`<div class="panel table-panel"><table class="table"><thead><tr><th scope="col">Service</th><th scope="col">Price</th>${admin?'<th scope="col"><span class="sr-only">Actions</span></th>':''}</tr></thead><tbody>${state.services.map(s=>
    `<tr><td class="cell-main" data-label="Service">${esc(s.name)}</td><td data-label="Price">${money(s.price)} per ${esc(s.unit)}</td>${admin?`<td class="cell-actions"><button type="button" class="btn btn-ghost btn-sm" data-act="edit-service" data-id="${s.id}" aria-label="Edit ${esc(s.name)}">${icon('edit')}Edit</button><button type="button" class="btn btn-ghost btn-sm is-danger" data-act="delete-service" data-id="${s.id}" aria-label="Delete ${esc(s.name)}">${icon('trash')}Delete</button></td>`:''}</tr>`).join('')}</tbody></table></div>`;
}

/* ===== 10. New order form ===== */
const selectedFulfillment=()=>$('input[name=fulfillment]:checked').value;
function setFulfillment(value){const r=$$('input[name=fulfillment]').find(x=>x.value===value);if(r){r.checked=true;syncFulfillment()}}
function syncFulfillment(){$('#of-address-field').hidden=selectedFulfillment()!=='Home Delivery';calcOrder()}
// Fills in the summary box for the user. PHP calculates the real subtotal again from the price in MySQL.
function calcOrder(){
  const s=state.services.find(x=>String(x.id)===$('#of-service').value);
  if(!s)return null;
  const qty=parseFloat($('#of-qty').value)||0,home=selectedFulfillment()==='Home Delivery';
  const sub=s.price*qty,fee=home?state.fee:0;
  $('#of-qty-label').textContent=s.unit==='kg'?'Weight (kg)':'Pieces';
  $('#of-qty').step=s.unit==='kg'?'0.5':'1';$('#of-qty').min=s.unit==='kg'?'0.5':'1';
  $('#sum-sub').textContent=money(sub);$('#sum-fee').textContent=money(fee);$('#sum-total').textContent=money(sub+fee);
  return{s,qty,home};
}
function openOrderModal(){
  if(!state.services.length){toast('Add a service first on the Services page.','info');return}
  $('#order-form').reset();$('#of-due').min=today();
  clearInvalid($('#order-form'));syncFulfillment();
  openModal('order-modal');
}
function validateOrder(){
  clearInvalid($('#order-form'));
  let first=null;const bad=(el,msg)=>{setInvalid(el,msg);first=first||el};
  if(!$('#of-name').value.trim())bad($('#of-name'),'Enter the customer name.');
  if($('#of-phone').value.replace(/\D/g,'').length<7)bad($('#of-phone'),'Enter a phone number with at least 7 digits.');
  if(!(parseFloat($('#of-qty').value)>0))bad($('#of-qty'),'Enter a quantity greater than 0.');
  if(selectedFulfillment()==='Home Delivery'&&!$('#of-address').value.trim())bad($('#of-address'),'Enter the delivery address.');
  if(first)first.focus();
  return !first;
}
async function onOrderSubmit(e){
  e.preventDefault();
  if(!validateOrder())return;
  const c=calcOrder();
  if(!c){toast('Add a service first on the Services page.','info');return}
  const btn=$('#order-submit');setLoading(btn,true,'Saving');   // also stops a double click from saving the order twice
  try{
    // Send the new order to PHP. PHP finds or creates the customer, then saves the order, its item and its payment in one transaction.
    const created=await postJSON('add_order.php',{
      customer_name:$('#of-name').value.trim(),phone:$('#of-phone').value.trim(),service_id:c.s.id,quantity:c.qty,
      fulfillment:selectedFulfillment(),address:c.home?$('#of-address').value.trim():'',
      due_date:$('#of-due').value,notes:$('#of-notes').value.trim(),paid:$('#of-paid').checked});
    closeModal();
    await refreshAll();
    toast('Order '+orderNo(created.order_id)+' saved','success');
  }catch(err){showError(err)}
  finally{setLoading(btn,false)}
}

/* ===== 11. Actions on orders, customers, services and the password ===== */
// Runs one change on one order: the card shows "Updating" until PHP answers and the data is reloaded.
async function runOrderAction(id,work,okMessage){
  state.pending.add(id);renderBoard();setBusy(1);
  try{await work();await refreshAll();toast(okMessage,'success')}
  catch(err){showError(err)}
  finally{state.pending.delete(id);setBusy(-1);renderBoard()}
}
function moveOrder(id,dir){
  const o=state.orders.find(x=>x.id===id);if(!o)return;
  const target=STAGES[STAGES.findIndex(s=>s.key===o.status)+dir];if(!target)return;
  return runOrderAction(id,()=>
    // Tell PHP the order's new stage. PHP checks it is a valid status, then runs an UPDATE on orders.status.
    postJSON('update_status.php',{order_id:id,new_status:target.key}),orderNo(id)+' moved to '+target.label);
}
function togglePaid(id){
  const o=state.orders.find(x=>x.id===id);if(!o)return;
  return runOrderAction(id,()=>
    // Tell PHP to mark this order paid or unpaid. PHP creates or updates the order's single row in payments.
    postJSON('update_payment.php',{order_id:id,is_paid:!o.paid}),orderNo(id)+(o.paid?' marked unpaid':' marked paid'));
}
async function deleteOrder(id){
  const o=state.orders.find(x=>x.id===id);if(!o)return;
  const ok=await confirmAction({title:'Delete order '+orderNo(id)+'?',message:'This permanently deletes the order for '+o.customer+' together with its payment record. This cannot be undone.',confirmLabel:'Delete order'});
  if(!ok)return;
  return runOrderAction(id,()=>
    // Ask PHP to DELETE this order. MySQL also deletes its order_items and payment rows (ON DELETE CASCADE).
    postJSON('delete_order.php',{order_id:id}),'Order '+orderNo(id)+' deleted');
}
async function deleteCustomer(id){
  const c=state.customers.find(x=>x.id===id);if(!c)return;
  const ok=await confirmAction({title:'Remove '+c.name+'?',message:'This removes the customer record. A customer who still has orders cannot be removed.',confirmLabel:'Remove customer'});
  if(!ok)return;
  setBusy(1);
  try{
    // Ask PHP to DELETE this customer row. PHP refuses if the customer still has orders.
    await postJSON('delete_customer.php',{customer_id:id});
    await refreshAll();toast('Customer removed','success');
  }catch(err){showError(err)}
  finally{setBusy(-1)}
}
function openServiceModal(id){
  if(!isAdmin())return;
  const s=id?state.services.find(x=>x.id===id):null;
  state.editingService=s?s.id:null;
  $('#service-modal-title').textContent=s?'Edit service':'Add service';
  $('#sv-name').value=s?s.name:'';$('#sv-price').value=s?s.price:'';$('#sv-unit').value=s?s.unit:'kg';
  clearInvalid($('#service-form'));openModal('service-modal');
}
async function onServiceSubmit(e){
  e.preventDefault();
  if(!isAdmin())return;
  clearInvalid($('#service-form'));
  const name=$('#sv-name').value.trim(),price=parseFloat($('#sv-price').value),unit=$('#sv-unit').value;
  let first=null;
  if(!name){setInvalid($('#sv-name'),'Enter a service name.');first=$('#sv-name')}
  if(isNaN(price)||price<0){setInvalid($('#sv-price'),'Enter a price of 0 or more.');first=first||$('#sv-price')}
  if(first){first.focus();return}
  const btn=$('#service-submit');setLoading(btn,true,'Saving');
  try{
    if(state.editingService){
      // Ask PHP to UPDATE this service's row in MySQL (PHP also checks that an admin is logged in).
      await postJSON('update_service.php',{service_id:state.editingService,service_name:name,price,unit});
    }else{
      // Ask PHP to INSERT a new service row. MySQL creates the service_id by itself (AUTO_INCREMENT).
      await postJSON('add_service.php',{service_name:name,price,unit});
    }
    closeModal();await refreshAll();toast('Service saved','success');
  }catch(err){showError(err)}
  finally{setLoading(btn,false)}
}
async function deleteService(id){
  const s=state.services.find(x=>x.id===id);if(!s)return;
  const ok=await confirmAction({title:'Delete '+s.name+'?',message:'A service that existing orders use cannot be deleted.',confirmLabel:'Delete service'});
  if(!ok)return;
  setBusy(1);
  try{
    // Ask PHP to DELETE this service row. PHP refuses if existing orders still use the service.
    await postJSON('delete_service.php',{service_id:id});
    await refreshAll();toast('Service deleted','success');
  }catch(err){showError(err)}
  finally{setBusy(-1)}
}
function openPasswordModal(){
  $('#password-form').reset();clearInvalid($('#password-form'));
  $$('#password-form .pw-toggle').forEach(b=>setPwVisible(b,false));
  openModal('password-modal');
}
async function onPasswordSubmit(e){
  e.preventDefault();
  clearInvalid($('#password-form'));
  const pw=$('#pw-new').value,confirm=$('#pw-confirm').value;
  if(pw.length<6){setInvalid($('#pw-new'),'Use at least 6 characters.');$('#pw-new').focus();return}
  if(pw!==confirm){setInvalid($('#pw-confirm'),'The passwords do not match.');$('#pw-confirm').focus();return}
  const btn=$('#password-submit');setLoading(btn,true,'Saving');
  try{
    // Ask PHP to hash the new password (password_hash) and save the hash in the staff table.
    await postJSON('set_admin_password.php',{password:pw,confirm_password:confirm});
    closeModal();toast('Password saved','success');
  }catch(err){showError(err)}
  finally{setLoading(btn,false)}
}

/* ===== 12. Wiring: one click handler for every button, plus the forms and filters ===== */
async function onClick(e){
  const toggle=e.target.closest('.pw-toggle');
  if(toggle){setPwVisible(toggle,toggle.getAttribute('aria-pressed')!=='true');return}
  if(e.target.closest('[data-close]')){closeModal();return}
  if(e.target.closest('#confirm-ok')){const r=confirmResolve;confirmResolve=null;closeModal();if(r)r(true);return}
  if(e.target.closest('.nav__link'))closeMenu();
  const el=e.target.closest('[data-act]');if(!el)return;
  const id=Number(el.dataset.id);
  switch(el.dataset.act){
    case 'new-order':openOrderModal();break;
    case 'open-menu':openMenu();break;
    case 'close-menu':closeMenu(true);break;
    case 'logout':await logout();break;
    case 'change-password':if(isAdmin())openPasswordModal();break;
    case 'goto':goTo(el.dataset.view);break;
    case 'open-stage':state.stageTab=el.dataset.stage;renderBoard();goTo('orders');break;
    case 'stage-tab':state.stageTab=el.dataset.stage;renderBoard();break;
    case 'next':await moveOrder(id,1);break;
    case 'back':await moveOrder(id,-1);break;
    case 'pay':await togglePaid(id);break;
    case 'delete-order':await deleteOrder(id);break;
    case 'delete-customer':await deleteCustomer(id);break;
    case 'add-service':openServiceModal(null);break;
    case 'edit-service':openServiceModal(id);break;
    case 'delete-service':await deleteService(id);break;
    case 'retry':await refreshAll();break;
    case 'clear-filters':
      state.filters={q:'',fulfillment:'',payment:''};
      $('#order-search').value='';$('#filter-fulfillment').value='';$('#filter-payment').value='';
      renderBoard();break;
  }
}
function onKeydown(e){
  if(e.key==='Escape'){if(activeModal)closeModal();else if(sidebarOpen())closeMenu(true);return}
  if(e.key==='Tab'&&activeModal){   // keep Tab inside the open modal
    const items=$$(FOCUSABLE,activeModal).filter(el=>el.offsetParent!==null);
    if(!items.length)return;
    const first=items[0],last=items[items.length-1];
    if(!activeModal.contains(document.activeElement)){e.preventDefault();first.focus();return}
    if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}
    else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}
  }
}
function init(){
  document.addEventListener('click',onClick);
  document.addEventListener('keydown',onKeydown);
  ['click','keydown','touchstart'].forEach(t=>document.addEventListener(t,noteActivity,{passive:true}));
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&state.user)pingServer()});
  window.addEventListener('hashchange',()=>{if(state.user)route()});
  matchMedia('(min-width:1024px)').addEventListener('change',e=>{if(e.matches)closeMenu()});
  $('#boot-retry').addEventListener('click',startSession);
  $('#login-form').addEventListener('submit',onLogin);
  $('#setup-form').addEventListener('submit',onSetup);
  $('#order-form').addEventListener('submit',onOrderSubmit);
  $('#service-form').addEventListener('submit',onServiceSubmit);
  $('#password-form').addEventListener('submit',onPasswordSubmit);
  // typing in a field removes its red error message
  document.addEventListener('input',e=>{
    const f=e.target.closest&&e.target.closest('.field.is-invalid');
    if(f){f.classList.remove('is-invalid');const m=$('.field__error',f);if(m)m.remove();e.target.removeAttribute('aria-invalid')}
  });
  $('#order-search').addEventListener('input',e=>{state.filters.q=e.target.value;renderBoard()});
  $('#filter-fulfillment').addEventListener('change',e=>{state.filters.fulfillment=e.target.value;renderBoard()});
  $('#filter-payment').addEventListener('change',e=>{state.filters.payment=e.target.value;renderBoard()});
  $('#customer-search').addEventListener('input',e=>{state.customerQuery=e.target.value;renderCustomers()});
  $('#of-service').addEventListener('change',calcOrder);
  $('#of-qty').addEventListener('input',calcOrder);
  $$('input[name=fulfillment]').forEach(r=>r.addEventListener('change',syncFulfillment));
  // typing a known customer's name fills in their phone, preferred fulfillment and address
  $('#of-name').addEventListener('input',()=>{
    const c=state.customers.find(x=>x.name.toLowerCase()===$('#of-name').value.trim().toLowerCase());
    if(!c)return;
    $('#of-phone').value=c.phone;
    if(c.fulfillment)setFulfillment(c.fulfillment);
    if(c.address)$('#of-address').value=c.address;
  });
  startSession();
}
init();