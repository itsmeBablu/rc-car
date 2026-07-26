#pragma once

// Full HTTP cockpit — SoftAP http://192.168.4.1/drive AND home http://CAR_IP/drive
// Live cam + steer/throttle. HTTPS apps cannot do this; this page can.
static const char WIFI_DRIVE_PAGE[] PROGMEM = R"HTML(<!DOCTYPE html>
<html lang=en>
<head>
<meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">
<meta name=apple-mobile-web-app-capable content=yes>
<meta name=apple-mobile-web-app-status-bar-style content=black-translucent>
<title>GT2 RS</title>
<style>
*{box-sizing:border-box;touch-action:none;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent}
html,body{height:100%;margin:0;background:#050505;color:#f5f5f4;font:14px system-ui,sans-serif;overflow:hidden}
#cam{position:fixed;inset:0;width:100%;height:100%;object-fit:cover;background:#111;z-index:0}
.dim{position:fixed;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.55),transparent 28%,transparent 55%,rgba(0,0,0,.75));z-index:1;pointer-events:none}
.ui{position:fixed;inset:0;z-index:2;display:flex;flex-direction:column;padding:max(10px,env(safe-area-inset-top)) 12px max(12px,env(safe-area-inset-bottom))}
.head{display:flex;justify-content:space-between;align-items:flex-start;gap:8px}
.brand{font-size:11px;letter-spacing:.28em;color:#c9a227;font-weight:700}
#st{font-size:11px;color:#a3a3a3;margin-top:2px}
#st.on{color:#6ee7b7}#st.err{color:#f87171}
.meta{text-align:right;font-size:10px;color:#a3a3a3;font-family:ui-monospace,monospace}
.mid{flex:1;display:flex;gap:10px;min-height:0;margin:10px 0}
.pad{flex:1;border-radius:18px;border:1px solid rgba(255,255,255,.14);background:rgba(0,0,0,.28);backdrop-filter:blur(8px);position:relative;overflow:hidden}
.pad label{position:absolute;top:10px;left:12px;font-size:9px;letter-spacing:.16em;text-transform:uppercase;color:rgba(255,255,255,.45)}
#steer{max-width:42%}
.needle{position:absolute;left:50%;bottom:18%;width:3px;height:48%;background:#c9a227;transform-origin:bottom center;border-radius:2px;margin-left:-1.5px;box-shadow:0 0 12px rgba(201,162,39,.5)}
.bar{position:absolute;left:22%;right:22%;bottom:14%;height:4%;min-height:8px;background:linear-gradient(#f5d56e,#c9a227);border-radius:8px 8px 0 0;box-shadow:0 0 16px rgba(201,162,39,.35)}
.foot{display:grid;grid-template-columns:1fr 1fr 1fr 1.4fr;gap:8px}
button{appearance:none;border:0;border-radius:14px;padding:16px 8px;font-weight:700;font-size:13px;background:rgba(201,162,39,.92);color:#111}
button.muted{background:rgba(255,255,255,.08);color:#eee;border:1px solid rgba(255,255,255,.12)}
button.stop{background:#b91c1c;color:#fff}
.links{display:flex;gap:14px;margin-top:8px;justify-content:center}
.links a{color:#c9a227;font-size:11px;text-decoration:none}
</style>
</head>
<body>
<img id=cam alt="">
<div class=dim></div>
<div class=ui>
  <div class=head>
    <div>
      <div class=brand>GT2 RS</div>
      <div id=st>Connecting…</div>
    </div>
    <div class=meta>
      <div id=net>—</div>
      <div id=spd>0%</div>
    </div>
  </div>
  <div class=mid>
    <div class=pad id=steer><label>Steer</label><div class=needle id=nSteer></div></div>
    <div class=pad id=thr><label>Throttle</label><div class=bar id=nThr></div></div>
  </div>
  <div class=foot>
    <button type=button class=muted id=rev>R</button>
    <button type=button id=gear>D</button>
    <button type=button class=muted id=ctr>Center</button>
    <button type=button class=stop id=stop>STOP</button>
  </div>
  <div class=links>
    <a href=/setup>Wi-Fi setup</a>
    <a href=/status>Status</a>
  </div>
</div>
<script>
(function(){
  var host=location.hostname||'192.168.4.1';
  var st=document.getElementById('st');
  var cam=document.getElementById('cam');
  var gear=1, angle=90, thr=0, ws=null, tSend=0, camT=0;
  function setSt(t,c){st.textContent=t;st.className=c||'';}
  function send(o){if(ws&&ws.readyState===1)ws.send(JSON.stringify(o));}
  function tick(){
    var now=Date.now();
    if(now-tSend<45)return;
    tSend=now;
    send({cmd:'steer',angle:angle|0});
    var p=Math.max(0,Math.min(100,thr|0));
    send({cmd:'drive',left:gear*p,right:gear*p});
    document.getElementById('nSteer').style.transform='rotate('+(angle-90)+'deg)';
    document.getElementById('nThr').style.height=Math.max(4,p*0.72)+'%';
    document.getElementById('spd').textContent=p+'%';
  }
  function camPoll(){
    if(document.hidden)return;
    var u='http://'+host+'/jpg?t='+Date.now();
    cam.src=u;
  }
  function connect(){
    try{ws=new WebSocket('ws://'+host+':81');}catch(e){setSt('WS failed','err');return;}
    ws.onopen=function(){setSt('Linked — drive','on');};
    ws.onclose=function(){setSt('Reconnecting…','err');setTimeout(connect,1000);};
    ws.onerror=function(){setSt('WS error','err');};
  }
  function bindPad(el,kind){
    function pt(e){
      var t=e.touches?e.touches[0]:e;
      var r=el.getBoundingClientRect();
      if(kind==='steer'){
        var x=(t.clientX-r.left)/r.width;
        angle=Math.round(20+x*140);
        if(angle<20)angle=20;if(angle>160)angle=160;
      }else{
        var y=1-((t.clientY-r.top)/r.height);
        thr=Math.round(Math.max(0,Math.min(1,y))*100);
      }
      tick();
    }
    function end(){if(kind==='thr'){thr=0;tick();}}
    el.addEventListener('touchstart',function(e){e.preventDefault();pt(e);},{passive:false});
    el.addEventListener('touchmove',function(e){e.preventDefault();pt(e);},{passive:false});
    el.addEventListener('touchend',function(e){e.preventDefault();end();},{passive:false});
    el.addEventListener('mousedown',pt);
    el.addEventListener('mousemove',function(e){if(e.buttons)pt(e);});
    el.addEventListener('mouseup',end);
    el.addEventListener('mouseleave',end);
  }
  bindPad(document.getElementById('steer'),'steer');
  bindPad(document.getElementById('thr'),'thr');
  document.getElementById('stop').onclick=function(){thr=0;angle=90;send({cmd:'stop'});tick();};
  document.getElementById('ctr').onclick=function(){angle=90;send({cmd:'center'});tick();};
  document.getElementById('gear').onclick=function(){gear=1;this.className='';document.getElementById('rev').className='muted';};
  document.getElementById('rev').onclick=function(){gear=-1;this.className='';document.getElementById('gear').className='muted';};
  fetch('/status').then(function(r){return r.json();}).then(function(j){
    var t=(j.home&&j.ssid)?(j.ssid+' · '+j.ip):(j.hotspot||'SoftAP');
    document.getElementById('net').textContent=t;
  }).catch(function(){});
  setInterval(tick,50);
  setInterval(camPoll,220);
  camPoll();
  connect();
  document.addEventListener('visibilitychange',function(){if(document.hidden)send({cmd:'stop'});});
  window.addEventListener('pagehide',function(){send({cmd:'stop'});});
})();
</script>
</body>
</html>
)HTML";
