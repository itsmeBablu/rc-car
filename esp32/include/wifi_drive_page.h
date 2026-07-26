#pragma once

// Minimal SoftAP drive UI — served at http://192.168.4.1/drive
// iPhone Home Screen / Vercel HTTPS cannot use ws:// to the car; this page can.
static const char WIFI_DRIVE_PAGE[] PROGMEM = R"HTML(<!DOCTYPE html>
<html lang=en>
<head>
<meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">
<meta name=apple-mobile-web-app-capable content=yes>
<title>Drive</title>
<style>
*{box-sizing:border-box;touch-action:none;-webkit-user-select:none;user-select:none}
html,body{height:100%;margin:0;background:#0b0b0c;color:#eee;font:15px system-ui}
body{display:flex;flex-direction:column;padding:max(8px,env(safe-area-inset-top)) 12px max(12px,env(safe-area-inset-bottom))}
h1{font-size:18px;margin:0 0 4px;color:#c9a227;letter-spacing:.12em}
#st{font-size:12px;color:#9ca3af;margin-bottom:8px}
#st.on{color:#6ee7b7}#st.err{color:#f87171}
.row{display:flex;gap:10px;flex:1;min-height:0}
.pad{flex:1;border-radius:16px;border:1px solid #333;background:#151518;position:relative;overflow:hidden}
.pad label{position:absolute;top:8px;left:10px;font-size:10px;text-transform:uppercase;letter-spacing:.14em;color:#666}
#steer{min-height:140px}
#thr{min-height:220px}
.needle{position:absolute;left:50%;top:50%;width:4px;height:40%;background:#c9a227;transform-origin:bottom center;border-radius:2px;margin-left:-2px;margin-top:-40%}
.bar{position:absolute;left:20%;right:20%;bottom:12%;height:0;background:linear-gradient(#c9a227,#854d0e);border-radius:8px 8px 0 0}
.btns{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-top:10px}
button{appearance:none;border:0;border-radius:12px;padding:14px 8px;font-weight:700;font-size:14px;background:#c9a227;color:#111}
button.muted{background:#222;color:#ddd;border:1px solid #333}
button.stop{background:#b91c1c;color:#fff;grid-column:1/-1}
a{color:#c9a227;font-size:12px}
.links{margin-top:8px;display:flex;gap:12px;flex-wrap:wrap}
</style>
</head>
<body>
<h1>PORSCHE DRIVE</h1>
<div id=st>Connecting…</div>
<div class=row>
  <div class=pad id=steer><label>Steer</label><div class=needle id=nSteer></div></div>
  <div class=pad id=thr><label>Throttle</label><div class=bar id=nThr></div></div>
</div>
<div class=btns>
  <button type=button class=muted id=rev>R</button>
  <button type=button class=muted id=gear>D</button>
  <button type=button class=muted id=ctr>Center</button>
  <button type=button class=stop id=stop>STOP</button>
</div>
<div class=links>
  <a href=/>Status</a>
  <a href=/setup>Wi-Fi setup</a>
</div>
<script>
(function(){
  var st=document.getElementById('st');
  var gear=1; // 1=D -1=R
  var angle=90, thr=0, ws=null, tSend=0;
  var host=location.hostname||'192.168.4.1';
  function setSt(t,c){st.textContent=t;st.className=c||'';}
  function send(o){if(ws&&ws.readyState===1)ws.send(JSON.stringify(o));}
  function tick(){
    var now=Date.now();
    if(now-tSend<40)return;
    tSend=now;
    send({cmd:'steer',angle:angle|0});
    var p=Math.max(0,Math.min(100,thr|0));
    var L=gear*p,R=gear*p;
    send({cmd:'drive',left:L,right:R});
    document.getElementById('nSteer').style.transform='rotate('+(angle-90)+'deg)';
    document.getElementById('nThr').style.height=(p*0.7+4)+'%';
  }
  function connect(){
    try{ws=new WebSocket('ws://'+host+':81');}catch(e){setSt('WS failed','err');return;}
    ws.onopen=function(){setSt('Linked — drive','on');};
    ws.onclose=function(){setSt('Disconnected — retry…','err');setTimeout(connect,1200);};
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
    function end(){if(kind==='thr'){thr=0;tick();}else{/* keep steer */}}
    el.addEventListener('touchstart',function(e){e.preventDefault();pt(e);},{passive:false});
    el.addEventListener('touchmove',function(e){e.preventDefault();pt(e);},{passive:false});
    el.addEventListener('touchend',function(e){e.preventDefault();end();},{passive:false});
    el.addEventListener('mousedown',function(e){pt(e);});
    el.addEventListener('mousemove',function(e){if(e.buttons)pt(e);});
    el.addEventListener('mouseup',end);
    el.addEventListener('mouseleave',end);
  }
  bindPad(document.getElementById('steer'),'steer');
  bindPad(document.getElementById('thr'),'thr');
  document.getElementById('stop').onclick=function(){thr=0;angle=90;send({cmd:'stop'});tick();};
  document.getElementById('ctr').onclick=function(){angle=90;send({cmd:'center'});tick();};
  document.getElementById('gear').onclick=function(){gear=1;this.textContent='D';document.getElementById('rev').className='muted';this.className='';};
  document.getElementById('rev').onclick=function(){gear=-1;this.textContent='R';document.getElementById('gear').className='muted';this.className='';};
  document.getElementById('gear').className='';
  setInterval(tick,50);
  connect();
  window.addEventListener('pagehide',function(){send({cmd:'stop'});});
  document.addEventListener('visibilitychange',function(){if(document.hidden)send({cmd:'stop'});});
})();
</script>
</body>
</html>
)HTML";
