const fs=require('node:fs'), vm=require('node:vm'), assert=require('node:assert/strict'), path=require('node:path');
const root=__dirname;
const source=name=>fs.readFileSync(path.join(root,name),'utf8');
function fixture(){
  let timer,shown;
  const events={};
  const node=()=>({children:[],appendChild(n){this.children.push(n);},replaceChildren(n){shown=n;}});
  const c=vm.createContext({document:{getElementById:()=>node(),createElement:node},setTimeout:fn=>{timer=fn;return 1;},clearTimeout:()=>{timer=null;}});
  c.window=c;c.addEventListener=(name,fn)=>{events[name]=fn;};
  return {c,events,tick:()=>timer&&timer(),shown:()=>JSON.stringify(shown)};
}
async function main(){
  let f=fixture();vm.runInContext(source('boot.js'),f.c);f.c.PLIE_CMS_BOOT.stage('Google 계정 확인');f.tick();assert.match(f.shown(),/CMS-WAIT-30/);assert.match(f.shown(),/Google 계정 확인/);
  f=fixture();vm.runInContext(source('boot.js'),f.c);f.events.error({target:vm.runInContext('window',f.c),lineno:88});assert.match(f.shown(),/CMS-JS-88/);
  f=fixture();vm.runInContext(source('boot.js'),f.c);f.c.PLIE_CMS_BOOT.done();f.tick();assert.equal(f.shown(),undefined);
  f=fixture();vm.runInContext(source('bridge.js'),f.c);await assert.rejects(f.c.PLIE_CMS_TRANSPORT.call('session'),/CMS-RPC-MISSING/);
  f=fixture();const runner={withSuccessHandler(fn){this.success=fn;return this;},withFailureHandler(fn){this.failure=fn;return this;},cmsRequest(){}};f.c.google={script:{run:runner}};
  vm.runInContext(source('bridge.js'),f.c);let pending=f.c.PLIE_CMS_TRANSPORT.call('session');f.tick();await assert.rejects(pending,/CMS-RPC-session/);
  pending=f.c.PLIE_CMS_TRANSPORT.call('session');runner.success({ok:true,value:{authenticated:true}});assert.equal((await pending).authenticated,true);
  f.c.Session={getActiveUser:()=>({getEmail:()=> 'plie0312@gmail.com'}),getEffectiveUser:()=>({getEmail:()=> 'plie0312@gmail.com'})};
  f.c.HtmlService={createHtmlOutput:s=>({getContent:()=>s,setTitle(){return this;},addMetaTag(){return this;}})};
  vm.runInContext(source('Install.gs'),f.c);const html=f.c.doGet().getContent();assert.equal(html,source('Admin.html').replace(/\r\n/g,'\n'));
  for(const s of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))new vm.Script(s[1]);
  const loader=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)][1][1];
  let restored;
  const loaderContext=vm.createContext({atob:s=>Buffer.from(s,'base64').toString('binary'),Uint8Array,TextDecoder,document:{createElement:()=>({}),body:{appendChild:s=>{restored=s.textContent;}}},PLIE_CMS_BOOT:{stage:()=>{},fail:code=>{throw Error(code);}}});
  loaderContext.window=loaderContext;
  vm.runInContext(loader,loaderContext);
  assert.equal(restored,source('bridge.js').replace(/\r\n/g,'\n')+'\n'+source('../cms-app/web/cms.js').replace(/\r\n/g,'\n'));
  new vm.Script(restored);
  assert.ok(!loader.includes('`'));assert.ok(!loader.includes('querySelector'));
  console.log('PASS: loading timeout, script error notice, successful boot, missing/slow/successful Google RPC, installed HTML integrity.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
