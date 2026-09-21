import { expect, it, vi } from 'vitest';
import { runInNewContext } from 'node:vm';
import { manualSendScript } from '../src/ui/manual-send';

const draft = { to:'client@example.test', subject:'Invoice', body:'Full invoice', html:'<p>Full invoice</p>', pdfUrl:'/invoices/1/pdf', pdfFilename:'INV-1.pdf' };
async function setup(options: { native?: any; share?: any; clipboard?: any; pdf?: Response; canShare?: boolean } = {}) {
 const events: Record<string,Function> = {}, listeners:Record<string,Function> = {};
 const elements:Record<string,any> = {};
 for(const id of ['manual-send','manual-status','manual-details','manual-body','manual-to','manual-subject','manual-open','manual-confirm','manual-copy-to','manual-copy-subject']) elements[id] = {disabled:false,hidden:true,textContent:'',value:'',href:'',focus:vi.fn(),select:vi.fn(),addEventListener:(name:string,fn:Function)=>{events[id+name]=fn;}};
 const fetch = vi.fn(async (url:string) => url.endsWith('/compose') ? new Response(JSON.stringify(draft),{headers:{'Content-Type':'application/json'}}) : options.pdf ?? new Response('%PDF-1.7\nfixture',{headers:{'Content-Type':'application/pdf'}}));
 const location={origin:'https://tarnsby.example.test',href:''};
 class Item {constructor(public data:any){}}
 runInNewContext(manualSendScript(1).replace(/^<script>|<\/script>$/g,''),{document:{getElementById:(id:string)=>elements[id]},window:{native:options.native,addEventListener:(name:string,fn:Function)=>{listeners[name]=fn;}},navigator:{share:options.share,canShare:()=>options.canShare!==false,clipboard:options.clipboard},location,fetch,URL,Blob,File,AbortController,setTimeout,clearTimeout,ClipboardItem:Item,crypto:{randomUUID:()=> 'test-id'},btoa:(s:string)=>Buffer.from(s,'binary').toString('base64'),Uint8Array,console});
 for(let n=0;n<15;n++) await new Promise(r=>setTimeout(r,0));
 return {elements,fetch,location,listeners,click:()=>events['manual-sendclick']({preventDefault(){}})};
}
it('shares actual PDF, body and title without a send mutation',async()=>{
 const share=vi.fn().mockResolvedValue(undefined),s=await setup({share}); await s.click();
 expect(share).toHaveBeenCalledOnce();const payload=share.mock.calls[0][0];
 expect(payload.text).toBe(draft.body);expect(payload.title).toBe(draft.subject);expect(await payload.files[0].text()).toContain('%PDF-');
 expect(s.fetch.mock.calls.every(c=>!c[0].endsWith('/send')&&!c[0].endsWith('/email'))).toBe(true);
 expect(s.elements['manual-confirm'].hidden).toBe(false);
});
it('prefers native v2 and leaves cancellation terminal',async()=>{
 const share=vi.fn(),handoffInvoice=vi.fn().mockResolvedValue({requestId:'test-id',status:'cancelled'}),copy=vi.fn();
 const s=await setup({share,native:{capabilities:{invoiceHandoff:2},handoffInvoice},clipboard:{write:copy}});await s.click();
 expect(handoffInvoice).toHaveBeenCalledOnce();expect(share).not.toHaveBeenCalled();expect(copy).not.toHaveBeenCalled();expect(s.location.href).toBe('');
});
it('does not cascade after share cancellation',async()=>{
 const write=vi.fn(),s=await setup({share:vi.fn().mockRejectedValue({name:'AbortError'}),clipboard:{write}});await s.click();expect(write).not.toHaveBeenCalled();expect(s.location.href).toBe('');
});
it('copies formatted/plain text then opens recipient and subject',async()=>{
 const write=vi.fn().mockResolvedValue(undefined),s=await setup({clipboard:{write}});await s.click();
 const data=write.mock.calls[0][0][0].data;expect(await data['text/html'].text()).toBe(draft.html);expect(await data['text/plain'].text()).toBe(draft.body);
 expect(s.location.href).toBe('mailto:client%40example.test?subject=Invoice');expect(s.elements['manual-status'].textContent).toContain('attach');
});
it('selects text when clipboard is denied, never claiming copy success',async()=>{
 const s=await setup({clipboard:{write:vi.fn().mockRejectedValue(Error()),writeText:vi.fn().mockRejectedValue(Error())}});await s.click();expect(s.elements['manual-body'].select).toHaveBeenCalled();expect(s.elements['manual-status'].textContent).not.toContain('Body copied');
});
it.each([['text/html','<html>Login</html>'],['application/pdf',''],['application/pdf','not a pdf']])('never shares invalid attachment %s',async(type,bytes)=>{
 const share=vi.fn(),s=await setup({share,pdf:new Response(bytes,{headers:{'Content-Type':type}})});await s.click();expect(share).not.toHaveBeenCalled();expect(s.elements['manual-details'].hidden).toBe(false);
});
it('does not retry another composer after uncertain native outcome',async()=>{
 const share=vi.fn(),s=await setup({share,native:{capabilities:{invoiceHandoff:2},handoffInvoice:vi.fn().mockRejectedValue(Error('timeout'))}});await s.click();expect(share).not.toHaveBeenCalled();expect(s.elements['manual-status'].textContent).toContain('Check');
});
it('clears prepared attachment on pagehide',async()=>{
 const share=vi.fn(),s=await setup({share});s.listeners.pagehide();await s.click();expect(share).not.toHaveBeenCalled();
});
it('uses legacy composer once without cascading an uncertain result',async()=>{
 const composeMail=vi.fn(),share=vi.fn(),s=await setup({share,native:{capabilities:{mailCompose:true},composeMail}});await s.click();expect(composeMail).toHaveBeenCalledOnce();expect(composeMail.mock.calls[0][0].bodyIsHtml).toBe(true);expect(share).not.toHaveBeenCalled();
});
it('requires another deliberate click after native unavailable',async()=>{
 const write=vi.fn().mockResolvedValue(undefined),s=await setup({native:{capabilities:{invoiceHandoff:2},handoffInvoice:vi.fn().mockResolvedValue({requestId:'test-id',status:'unavailable'})},clipboard:{write}});await s.click();expect(write).not.toHaveBeenCalled();await s.click();expect(write).toHaveBeenCalledOnce();
});
it('does not launch a duplicate while sharing is active',async()=>{
 let resolve!:()=>void;const share=vi.fn(()=>new Promise<void>(r=>{resolve=r})),s=await setup({share});const first=s.click();await s.click();expect(share).toHaveBeenCalledOnce();resolve();await first;
});
it('rejects oversized PDF before native or browser handoff',async()=>{
 const share=vi.fn(),s=await setup({share,pdf:new Response('%PDF-fixture',{headers:{'Content-Type':'application/pdf','Content-Length':'5242881'}})});await s.click();expect(share).not.toHaveBeenCalled();
});
it.each([403,404,500])('falls back without sharing an HTTP %s attachment',async(code)=>{
 const share=vi.fn(),s=await setup({share,pdf:new Response('Error',{status:code,headers:{'Content-Type':'application/pdf'}})});await s.click();expect(share).not.toHaveBeenCalled();
});
it('reports saved native drafts without implying sent',async()=>{
 const s=await setup({native:{capabilities:{invoiceHandoff:2},handoffInvoice:vi.fn().mockResolvedValue({requestId:'test-id',status:'savedDraft'})}});await s.click();expect(s.elements['manual-status'].textContent).toContain('Draft saved');expect(s.location.href).toBe('');
});
it('uses plain text when rich clipboard is unavailable',async()=>{
 const writeText=vi.fn().mockResolvedValue(undefined),s=await setup({clipboard:{write:vi.fn().mockRejectedValue(Error()),writeText}});await s.click();expect(writeText).toHaveBeenCalledWith(draft.body);expect(s.elements['manual-status'].textContent).toContain('plain text');
});
it('uses a fresh click for Web Share after confirmed native unavailable',async()=>{
 const share=vi.fn().mockResolvedValue(undefined),handoffInvoice=vi.fn().mockResolvedValue({requestId:'test-id',status:'unavailable'});
 const s=await setup({share,native:{capabilities:{invoiceHandoff:2},handoffInvoice}});await s.click();expect(share).not.toHaveBeenCalled();await s.click();expect(share).toHaveBeenCalledOnce();expect(handoffInvoice).toHaveBeenCalledOnce();
});
it('ignores a handoff completion from before page restoration',async()=>{
 let resolve!:()=>void;const share=vi.fn(()=>new Promise<void>(r=>{resolve=r})),s=await setup({share});const pending=s.click();s.listeners.pagehide();s.listeners.pageshow({persisted:true});for(let i=0;i<15;i++)await new Promise(r=>setTimeout(r,0));const before=s.elements['manual-status'].textContent;resolve();await pending;expect(s.elements['manual-status'].textContent).toBe(before);
});
