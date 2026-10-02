'use strict';
const form=document.getElementById('unlock-form'),input=document.getElementById('gift-password');
const status=document.getElementById('unlock-status'),button=document.getElementById('unlock-button');
const frame=document.getElementById('gift-frame'),lockButton=document.getElementById('lock-gift');
let urls=[], busy=false, unlocked=false;
const linkKey=new URLSearchParams(location.hash.slice(1)).get('k');
const encoder=new TextEncoder(),decoder=new TextDecoder();
async function fetchBytes(path){const response=await fetch(path.replace(/^locked\//,''));if(!response.ok)throw new Error('network');return new Uint8Array(await response.arrayBuffer());}
async function decrypt(key,path){const bytes=await fetchBytes(path);return crypto.subtle.decrypt({name:'AES-GCM',iv:bytes.slice(0,12),additionalData:encoder.encode('birthday-v1')},key,bytes.slice(12));}
function blobURL(data,type){const url=URL.createObjectURL(new Blob([data],{type}));urls.push(url);return url;}
function lock(){
  location.reload();
}
lockButton.addEventListener('click',lock);
window.addEventListener('pagehide',()=>{urls.forEach(url=>URL.revokeObjectURL(url));});
form.addEventListener('submit',async event=>{
  event.preventDefault();if(busy)return;
  if(!linkKey||!/^[-_A-Za-z0-9]{32}$/.test(linkKey)){status.textContent='Нужна полная личная ссылка из сообщения. Открой её целиком.';return;}
  if(!crypto.subtle){status.textContent='Открой ссылку в Safari через HTTPS, чтобы открыть подарок.';return;}
  busy=true;button.disabled=true;status.textContent='Открываем сюрприз…';
  let verifiedPassword=false;
  try{
    const response=await fetch('config.json');if(!response.ok)throw new Error('network');const config=await response.json();
    const material=await crypto.subtle.importKey('raw',encoder.encode(linkKey+':'+input.value.trim()),'PBKDF2',false,['deriveKey']);
    input.value='';
    const key=await crypto.subtle.deriveKey({name:'PBKDF2',salt:Uint8Array.from(atob(config.salt),c=>c.charCodeAt(0)),iterations:config.iterations,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['decrypt']);
    const manifest=JSON.parse(decoder.decode(await decrypt(key,config.manifest)));verifiedPassword=true;
    const entries=Object.entries(manifest.assets),replacements={};let completed=0;
    // Bounded parallel downloads keep memory and request pressure predictable.
    let next=0;
    async function worker(){while(next<entries.length){const [name,asset]=entries[next++];
      replacements[name]=blobURL(await decrypt(key,asset.file),asset.type);
      status.textContent=`Готовим фотографии и музыку… ${++completed} / ${entries.length}`;
    }}
    const workers=await Promise.allSettled([worker(),worker(),worker()]);
    if(workers.some(result=>result.status==='rejected'))throw new Error('network');
    const replace=text=>Object.entries(replacements).reduce((value,[name,url])=>value.split(name).join(url),text);
    const album=JSON.stringify(manifest.album.map(photo=>({...photo,src:replacements[photo.src],thumb:replacements[photo.thumb]})));
    if(!manifest.js.includes("fetch('album.json')"))throw new Error('format');
    const app=replace(manifest.js).replace("fetch('album.json')",`Promise.resolve({ok:true,json:()=>Promise.resolve(${album})})`);
    const appURL=blobURL(app,'text/javascript'),styleURL=blobURL(manifest.css,'text/css');
    let html=replace(manifest.html).replace('href="style.css"',`href="${styleURL}"`).replace('src="app.js"',`src="${appURL}"`);
    const parsed=new DOMParser().parseFromString(html,'text/html');
    // Render in the existing HTTPS document; avoid blob-frame navigation quirks.
    document.title=parsed.title;
    const style=document.createElement('link');style.rel='stylesheet';style.href=styleURL;document.head.append(style);
    document.body.replaceChildren(...parsed.body.childNodes,lockButton);
    lockButton.hidden=false;
    const script=document.createElement('script');script.src=appURL;document.body.append(script);
    unlocked=true;
  }catch(error){
    urls.forEach(url=>URL.revokeObjectURL(url));urls=[];
    status.textContent=verifiedPassword||error.message==='network'?'Не удалось загрузить подарок. Проверь соединение и попробуй ещё раз.':'Пароль не подошёл. Проверь его и попробуй ещё раз.';
    input.focus();
  }finally{busy=false;button.disabled=false;}
});
