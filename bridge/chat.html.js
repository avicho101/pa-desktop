// chat.html.js — single-file mobile/desktop web chat UI served at the bridge root.
// Talks only to the bridge's own /api/* endpoints (same daemon as the desktop app).
export const CHAT_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>pa-desktop · chat</title>
<style>
:root{--bg:#0d0f14;--bg2:#12151c;--bg3:#181c25;--bd:#232936;--txt:#e7eaf3;--dim:#9aa3b5;--faint:#5f6880;--ac:#8ab4ff;--ac2:#5b8def;--grn:#34d399;--red:#f87171}
*{box-sizing:border-box}
html,body{height:100%;margin:0}
body{background:var(--bg);color:var(--txt);font-family:-apple-system,"Segoe UI",Inter,Roboto,sans-serif;font-size:14px;display:flex;flex-direction:column;height:100dvh;overflow:hidden;-webkit-font-smoothing:antialiased}
header{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--bd);background:var(--bg2)}
.logo{width:26px;height:26px;border-radius:7px;background:linear-gradient(135deg,var(--ac2),#7c5bff);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:12px;color:#fff;flex-shrink:0}
.brand{font-weight:700;font-size:14px}
.brand small{display:block;font-size:10px;color:var(--faint);font-weight:500}
.spacer{flex:1}
select{background:var(--bg3);color:var(--txt);border:1px solid var(--bd);border-radius:8px;padding:6px 8px;font-size:12px;max-width:42vw;outline:none}
#newBtn{background:var(--ac);border:none;color:#0d0f14;font-weight:700;border-radius:8px;padding:6px 10px;font-size:12px;cursor:pointer}
#modelBtn{background:var(--bg3);color:var(--ac);border:1px solid rgba(138,180,255,.35);border-radius:999px;padding:5px 12px;font-size:11px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:38vw}
#messages{flex:1;overflow-y:auto;padding:14px 12px}
.msg{max-width:88%;margin:0 auto 14px}
.msg .who{font-size:11px;font-weight:700;color:var(--faint);margin-bottom:3px}
.msg .bubble{background:var(--bg3);border:1px solid var(--bd);border-radius:12px;padding:10px 13px;font-size:14px;line-height:1.5;white-space:pre-wrap;word-wrap:break-word}
.msg.user .bubble{background:var(--ac);border-color:var(--ac);color:#0d0f14;margin-left:auto}
.msg.user{display:flex;flex-direction:column;align-items:flex-end}
.msg.user .who{order:-1}
.thinking{background:var(--bg2);border-left:2px solid var(--ac2);border-radius:8px;padding:6px 10px;font-size:12px;color:var(--faint);white-space:pre-wrap;margin-bottom:6px}
.tool{font-family:ui-monospace,Menlo,monospace;font-size:11px;color:var(--dim);background:var(--bg2);border:1px solid var(--bd);border-radius:8px;padding:4px 8px;margin-bottom:5px;display:inline-block}
.tool b{color:var(--ac)}
pre{background:var(--bg);border:1px solid var(--bd);border-radius:8px;padding:10px;overflow-x:auto}
code{font-family:ui-monospace,Menlo,monospace;font-size:12px;background:var(--bg);padding:1px 5px;border-radius:4px}
pre code{background:none;padding:0}
.typing{display:inline-flex;gap:4px;padding:6px}
.typing span{width:7px;height:7px;border-radius:50%;background:var(--faint);animation:blink 1.4s infinite both}
.typing span:nth-child(2){animation-delay:.2s}.typing span:nth-child(3){animation-delay:.4s}
@keyframes blink{0%,80%,100%{opacity:.2}40%{opacity:1}}
.composer{display:flex;align-items:flex-end;gap:8px;padding:10px 12px calc(10px + env(safe-area-inset-bottom));border-top:1px solid var(--bd);background:var(--bg2)}
textarea{flex:1;background:var(--bg3);color:var(--txt);border:1px solid var(--bd);border-radius:12px;padding:10px 12px;font-size:14px;font-family:inherit;resize:none;outline:none;max-height:140px}
textarea:focus{border-color:var(--ac2)}
#sendBtn{width:42px;height:42px;border-radius:12px;background:var(--ac2);border:none;color:#fff;font-size:18px;cursor:pointer;flex-shrink:0}
#sendBtn:disabled{opacity:.4}
.banner{background:rgba(248,113,113,.12);border:1px solid rgba(248,113,113,.3);color:var(--red);padding:8px 12px;font-size:13px;text-align:center}
</style>
</head>
<body>
<div id="err" class="banner" style="display:none"></div>
<header>
  <div class="logo">PA</div>
  <div class="brand">pa-desktop<small>Prime Agent · web chat</small></div>
  <div class="spacer"></div>
  <select id="agentSel" title="Session"></select>
  <button id="newBtn" title="New session">+</button>
</header>
<div id="messages"><div style="text-align:center;color:var(--faint);padding:30px;font-size:13px">Loading sessions…</div></div>
<div class="composer">
  <textarea id="input" rows="1" placeholder="Message the agent…" disabled></textarea>
  <button id="sendBtn" disabled>↑</button>
</div>

<script>
const $=s=>document.querySelector(s);
let agentId=null, streaming=false, agentMap={};

function showErr(m){const e=$("#err");if(m){e.style.display="block";e.textContent="⚠ "+m}else{e.style.display="none"}}
async function j(url,opts){const r=await fetch(url,opts);const d=await r.json();if(!r.ok)throw new Error(d.error||("HTTP "+r.status));return d}
async function loadAgents(selectNew){
  const d=await j("/api/agents?v="+Date.now());
  agentMap={};d.agents.forEach(a=>agentMap[a.id]=a);
  const sel=$("#agentSel");sel.innerHTML="";
  d.agents.forEach(a=>{const o=document.createElement("option");o.value=a.id;o.textContent=(a.name||a.model||a.id.slice(0,8))+(" · "+a.messages);sel.appendChild(o)});
  if(selectNew&&d.agents[0])agentId=d.agents[0].id;else if(!agentId&&d.agents[0])agentId=d.agents[0].id;
  sel.value=agentId;updateComposer();
}
function updateComposer(){
  $("#input").disabled=!agentId; $("#sendBtn").disabled=!agentId||streaming;
  if(agentMap[agentId])$("#modelBtn").textContent="◉ "+(agentMap[agentId].model||"choose model");
}
function renderMessage(m){
  const wrap=document.createElement("div");wrap.className="msg "+(m.role==="user"?"user":"assistant");
  const who=document.createElement("div");who.className="who";who.textContent=m.role==="user"?"You":"pa-desktop";
  wrap.appendChild(who);
  if(m.thinking&&m.thinking.trim()){const t=document.createElement("div");t.className="thinking";t.textContent="🧠 "+m.thinking;wrap.appendChild(t)}
  (m.tools||[]).forEach(t=>{const d=document.createElement("div");d.className="tool";d.innerHTML="⚙ <b>"+escapeHtml(t.name)+"</b>";wrap.appendChild(d)});
  const b=document.createElement("div");b.className="bubble";b.innerHTML=markdown(m.text||"");
  wrap.appendChild(b);$("#messages").appendChild(wrap);
}
function addTyping(){const w=document.createElement("div");w.id="typing";w.className="msg assistant";w.innerHTML='<div class="who">pa-desktop</div><div class="bubble"><div class="typing"><span></span><span></span><span></span></div></div>';$("#messages").appendChild(w);scrollB()}
function rmTyping(){const t=$("#typing");if(t)t.remove()}
function scrollB(){$("#messages").scrollTop=$("#messages").scrollHeight}
function escapeHtml(s){return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}
function markdown(t){
  t=escapeHtml(t);
  // fenced code blocks first
  t=t.replace(/~~~([\\s\\S]*?)~~~/g,'<pre><code>$1</code></pre>');
  t=t.replace(/\`\`\`([\\s\\S]*?)\`\`\`/g,'<pre><code>$1</code></pre>');
  t=t.replace(/\`([^\`\n]+)\`/g,'<code>$1</code>');
  t=t.replace(/\\*\\*([^*]+)\\*\\*/g,'<b>$1</b>');
  t=t.replace(/\\*([^*]+)\\*/g,'<i>$1</i>');
  return t;
}
async function loadMessages(){
  if(!agentId)return;
  const d=await j("/api/messages?agent="+encodeURIComponent(agentId)+"&v="+Date.now());
  $("#messages").innerHTML="";
  (d.messages||[]).forEach(renderMessage);scrollB();
}
async function send(){
  const t=$("#input").value.trim();if(!t||!agentId||streaming)return;
  $("#input").value="";streaming=true;updateComposer();
  renderMessage({role:"user",text:t});addTyping();
  showErr();
  try{
    // SSE stream
    const resp=await fetch("/api/chat-stream?v="+Date.now(),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({agent:agentId,message:t})});
    const reader=resp.body.getReader();const dec=new TextDecoder();let buf="";
    const fresh=[];let gotAny=false;
    while(true){
      const {done,value}=await reader.read();if(done)break;
      buf+=dec.decode(value,{stream:true});
      let i;while((i=buf.indexOf("\\n\\n"))>=0){
        const block=buf.slice(0,i);buf=buf.slice(i+2);
        for(const line of block.split("\\n")){
          if(line.startsWith("data:")){
            const data=line.slice(5).trim();if(!data||data==="{}")continue;
            let ev;try{ev=JSON.parse(data)}catch{continue}
            if(ev.messages){gotAny=true;fresh.length=0;fresh.push(...ev.messages)}
          }
        }
      }
      if(gotAny){rmTyping();renderFresh(fresh)}
      scrollB();
    }
    if(gotAny){rmTyping();renderFresh(fresh)}else{rmTyping();renderMessage({role:"assistant",text:"(no response)"})}
  }catch(e){rmTyping();renderMessage({role:"assistant",text:"⚠ "+e.message})}
  streaming=false;updateComposer();loadAgents(false);
}
function renderFresh(msgs){
  // re-render last N messages: remove assistant/user tail, redraw
  const total=msgs.length;
  // remove everything after the user's last message
  const all=$("#messages").querySelectorAll(".msg");
  const userCount=[...$("#messages").querySelectorAll(".msg.user")].length;
  const toRemove=Math.max(0,all.length-userCount);
  for(let k=0;k<toRemove;k++)all[all.length-1-k].remove();
  msgs.forEach(renderMessage);
}
$("#newBtn").onclick=async()=>{try{await j("/api/new-session",{method:"POST",body:"{}"});await loadAgents(true);await loadMessages()}catch(e){showErr(e.message)}};
$("#agentSel").onchange=()=>{agentId=$("#agentSel").value;loadMessages()};
$("#sendBtn").onclick=send;
$("#input").addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send()}});
$("#input").addEventListener("input",()=>{const t=$("#input");t.style.height="auto";t.style.height=Math.min(t.scrollHeight,140)+"px"});
// model picker (simple dropdown)
(async function init(){
  try{await loadAgents(false);await loadMessages();}catch(e){showErr("Bridge unreachable: "+e.message)}
})();
</script>
</body>
</html>
`;
