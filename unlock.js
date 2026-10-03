'use strict';
const form=document.getElementById('unlock-form'),input=document.getElementById('gift-password');
const status=document.getElementById('unlock-status'),button=document.getElementById('unlock-button');
const lockButton=document.getElementById('lock-gift');
const linkKey=new URLSearchParams(location.hash.slice(1)).get('k');
const encoder=new TextEncoder(),decoder=new TextDecoder();
let busy=false,disposeAssets=()=>{};
lockButton.addEventListener('click',()=>location.reload());
window.addEventListener('pagehide',()=>disposeAssets());
async function fetchBytes(path,signal){
  const controller=signal?null:new AbortController();
  const timer=controller?setTimeout(()=>controller.abort(),25000):null;
  try{
    const response=await fetch(path.replace(/^locked\//,''),{cache:'no-store',signal:signal||controller.signal});
    if(!response.ok)throw new Error('network');return new Uint8Array(await response.arrayBuffer());
  }finally{if(timer)clearTimeout(timer);}
}
async function decrypt(key,path,signal){
  const bytes=await fetchBytes(path,signal);
  return crypto.subtle.decrypt({name:'AES-GCM',iv:bytes.slice(0,12),additionalData:encoder.encode('birthday-v1')},key,bytes.slice(12));
}
function createAssetLoader(key,assets){
  const cache=new Map(),queue=[],urls=[],controllers=new Set();let active=0,closed=false;
  function blob(data,type){const url=URL.createObjectURL(new Blob([data],{type}));urls.push(url);return url;}
  function pump(){
    while(!closed&&active<3&&queue.length){
      queue.sort((a,b)=>a.priority-b.priority);const job=queue.shift();active++;
      const controller=new AbortController();controllers.add(controller);
      const timer=setTimeout(()=>controller.abort(),25000);
      decrypt(key,assets[job.name].file,controller.signal).then(data=>{
        if(closed)throw new DOMException('Closed','AbortError');
        job.resolve(blob(data,assets[job.name].type));
      }).catch(error=>{cache.delete(job.name);job.reject(error);}).finally(()=>{clearTimeout(timer);controllers.delete(controller);active--;pump();});
    }
  }
  function loadAsset(name,priority=0){
    if(closed)return Promise.reject(new DOMException('Closed','AbortError'));
    if(!Object.hasOwn(assets,name))return Promise.reject(new Error('Unknown asset'));
    if(cache.has(name)){const pending=queue.find(job=>job.name===name);if(pending)pending.priority=Math.min(pending.priority,priority);return cache.get(name);}
    const promise=new Promise((resolve,reject)=>queue.push({name,priority,resolve,reject}));cache.set(name,promise);pump();return promise;
  }
  function dispose(){closed=true;controllers.forEach(controller=>controller.abort());queue.splice(0).forEach(job=>job.reject(new DOMException('Closed','AbortError')));urls.forEach(URL.revokeObjectURL);cache.clear();}
  return {loadAsset,blob,dispose};
}
form.addEventListener('submit',async event=>{
  event.preventDefault();if(busy)return;
  if(!linkKey||!/^[-_A-Za-z0-9]{32}$/.test(linkKey)){status.textContent='Нужна полная личная ссылка из сообщения. Открой её целиком.';return;}
  if(!crypto.subtle){status.textContent='Открой ссылку в Safari через HTTPS, чтобы открыть подарок.';return;}
  busy=true;button.disabled=true;button.textContent='Открываем…';status.textContent='Открываем твою открытку…';
  let verifiedPassword=false,loader;
  try{
    const config=JSON.parse(decoder.decode(await fetchBytes('config.json')));
    const material=await crypto.subtle.importKey('raw',encoder.encode(linkKey+':'+input.value.trim()),'PBKDF2',false,['deriveKey']);input.value='';
    const key=await crypto.subtle.deriveKey({name:'PBKDF2',salt:Uint8Array.from(atob(config.salt),c=>c.charCodeAt(0)),iterations:config.iterations,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['decrypt']);
    const manifest=JSON.parse(decoder.decode(await decrypt(key,config.manifest)));verifiedPassword=true;
    loader=createAssetLoader(key,manifest.assets);disposeAssets=loader.dispose;
    const parsed=new DOMParser().parseFromString(manifest.html,'text/html');
    const critical=[...parsed.querySelectorAll('.people img[src],img[data-critical],audio[id^="voice-"][src]')];
    const names=[...new Set(critical.map(node=>node.getAttribute('src')))];let complete=0;
    const outcomes=await Promise.allSettled(names.map(async name=>{const src=await loader.loadAsset(name);status.textContent=`Готовим открытку… ${++complete} / ${names.length}`;return [name,src];}));
    if(outcomes.some(result=>result.status==='rejected'))throw new Error('network');
    const ready=new Map(outcomes.map(result=>result.value));
    parsed.querySelectorAll('img[src],audio[src]').forEach(node=>{
      const name=node.getAttribute('src');node.dataset.asset=name;
      if(ready.has(name))node.setAttribute('src',ready.get(name));else node.removeAttribute('src');
    });
    window.giftRuntime=Object.freeze({album:manifest.album,loadAsset:loader.loadAsset});
    document.title=parsed.title;document.body.className=parsed.body.className;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content','#faf6ee');
    const style=document.createElement('link');style.rel='stylesheet';style.href=loader.blob(manifest.css,'text/css');
    await new Promise((resolve,reject)=>{style.onload=resolve;style.onerror=reject;document.head.append(style);});
    document.body.replaceChildren(...parsed.body.childNodes,lockButton);lockButton.hidden=false;
    const script=document.createElement('script');script.src=loader.blob(manifest.js,'text/javascript');document.body.append(script);
  }catch(error){
    loader?.dispose();
    status.textContent=!verifiedPassword&&error.name==='OperationError'?'ПИН не подошёл. Проверь его и попробуй ещё раз.':'Не удалось загрузить открытку. Проверь соединение и нажми «Открыть подарок» ещё раз.';input.focus();
  }finally{busy=false;button.disabled=false;button.textContent='Открыть подарок';}
});
