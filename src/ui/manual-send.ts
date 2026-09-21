/** The same manual Send action progressively hands off to device capabilities.
 * Keep this controller self-contained: it is emitted into server-rendered pages,
 * and tests execute these exact bytes against browser API fixtures.
 */
export function manualSendControls(id: number, alreadySent: boolean): string {
  return `<section class="manual-handoff"><p id="manual-status" role="status" aria-live="polite">Preparing invoice…</p>
<div id="manual-details" hidden>
<details id="manual-recovery"><summary>Still didn’t work? Click here</summary>
  <p>Download the PDF. Create a new email in your mail app, then use the controls below to copy and paste the recipient, subject and body. Attach the downloaded PDF and send the email.</p>
  <p>To: <span id="manual-to"></span> <button type="button" id="manual-copy-to" class="secondary">Copy recipient</button></p>
  <p>Subject: <span id="manual-subject"></span> <button type="button" id="manual-copy-subject" class="secondary">Copy subject</button></p>
  <label for="manual-body">Email body</label><textarea id="manual-body" readonly rows="8" style="width:100%;box-sizing:border-box"></textarea>
  <button type="button" id="manual-copy-body" class="secondary">Copy body</button>
  <a id="manual-open">Open your mail app</a>
</details>
</div>
<div id="manual-confirm" hidden><p>After you have actually sent the email:</p>
<form method="post" action="/invoices/${id}/send"><input type="hidden" name="method" value="mail_app">
${alreadySent ? '<label><input type="checkbox" name="confirmResend" value="1" required> Yes, overwrite the existing sent record with today’s date</label>' : ''}
<button type="submit">Mark as sent manually</button></form></div>
<noscript><p><a href="/invoices/${id}/mail-app">Open manual email instructions</a></p></noscript></section>`;
}

export function manualSendScript(id: number): string {
  // IDs come from the database, but reject invalid arguments at this boundary
  // rather than allowing script interpolation to become a second input channel.
  if (!Number.isSafeInteger(id) || id < 1) throw new Error('Invalid invoice ID');
  return `<script>${String.raw`
(function () {
 var el = function(id) { return document.getElementById(id); };
 var button=el('manual-send'), status=el('manual-status'), details=el('manual-details'), body=el('manual-body');
 var draft=null, pdf=null, base64=null, busy=false, ready=false, generation=0, controller=null, fallbackOnly=false, skipNative=false;
 // Capability detection keeps incomplete/older shells on the usable web fallback.
 var canCompose=function(){var n=window.native;return !!(n&&n.capabilities&&((n.capabilities.invoiceHandoff===2&&typeof n.handoffInvoice==='function')||(n.capabilities.mailCompose&&typeof n.composeMail==='function')));};
 // Shell identity persists even after composition fails or a manual retry begins.
 var inShell=!!(window.native&&(window.native.platform==='ios'||canCompose()));
 var reminder=el('manual-attachment-reminder');
 var fallbackSteps='download the PDF, choose Send again to copy the formatted body to the clipboard and open a new email with the recipient and subject filled in. In that email, paste the body, attach the PDF, then send.';
 var firstSteps='Download the PDF, choose Send to copy the formatted body and open a new email with the recipient and subject filled in. Paste the body, attach the PDF, then send.';
 var say=function(message){status.textContent=message;};
 var show=function(){reminder.hidden=inShell;details.hidden=false;el('manual-confirm').hidden=false;};
 var mailto=function(){return 'mailto:'+encodeURIComponent(draft.to||'')+'?subject='+encodeURIComponent(draft.subject);};
 async function prepare(){
  var version=++generation;ready=false;pdf=null;base64=null;draft=null;fallbackOnly=false;skipNative=false;
  reminder.hidden=inShell;
  if(controller)controller.abort();controller=new AbortController();var abort=controller;
  button.disabled=true;button.textContent='Preparing…';say('Preparing invoice…');
  var timer=setTimeout(function(){abort.abort();},30000);
  try {
   var response=await fetch('/invoices/INVOICE_ID/mail-app/compose',{signal:abort.signal,cache:'no-store',redirect:'error'});
   if(!response.ok||!String(response.headers.get('content-type')).includes('application/json'))throw Error('Invoice details unavailable');
   var data=await response.json();if(version!==generation)return;
   if(typeof data.body!=='string'||typeof data.html!=='string'||typeof data.subject!=='string'||(data.to!==null&&typeof data.to!=='string'))throw Error('Invalid invoice details');
   draft=data;body.value=data.body;el('manual-to').textContent=data.to||'Add the recipient in your mail app';el('manual-subject').textContent=data.subject;el('manual-open').href=mailto();
   // Browsers attach the PDF manually: do not render/fetch it just to copy an email.
   if(!canCompose()){say(inShell?'The integrated composer is unavailable. '+firstSteps:'');return;}
   var url=new URL(data.pdfUrl,location.origin);
   if(url.origin!==location.origin||url.pathname!=='/invoices/INVOICE_ID/pdf'||url.search||url.hash||url.username||url.password)throw Error('Invalid PDF location');
   if(!/^[A-Za-z0-9][A-Za-z0-9._-]*\.pdf$/i.test(data.pdfFilename))throw Error('Invalid PDF filename');
   var result=await fetch(url.href,{signal:abort.signal,cache:'no-store',redirect:'error'});
   if(!result.ok||String(result.headers.get('content-type')).split(';')[0]!=='application/pdf')throw Error('PDF could not be prepared');
   if(Number(result.headers.get('content-length'))>5242880)throw Error('PDF too large for automatic handoff');
   var blob=await result.blob();if(blob.size===0||blob.size>5242880||!(await blob.slice(0,5).text()).startsWith('%PDF-'))throw Error('PDF could not be prepared');
   if(version!==generation)return;
   pdf=new File([blob],data.pdfFilename,{type:'application/pdf'});
   // Prepare native bytes now; no async conversion may consume the fresh
   // click activation needed by native presentation or clipboard writing later.
   var bytes=new Uint8Array(await blob.arrayBuffer()),binary='';
   for(var i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode.apply(null,bytes.subarray(i,i+8192));
   if(version!==generation)return;base64=btoa(binary);say('Ready. Choose Send to open your mail app with the invoice and PDF.');
  } catch(error) {
   if(version!==generation)return;pdf=null;base64=null;reminder.hidden=inShell;
   say(draft?'Automatic attachment unavailable. '+firstSteps:'Invoice preparation failed. Choose Send to retry, or use the manual email instructions.');
   if(draft)show();
  } finally {clearTimeout(timer);if(version===generation){ready=true;button.disabled=false;button.textContent='Send';}}
 }
 async function copyAndOpen(version,openMail=true){
  reminder.hidden=inShell;show();var rich=false;
  try {
   if(navigator.clipboard&&navigator.clipboard.write&&typeof ClipboardItem!=='undefined'){
    try {await navigator.clipboard.write([new ClipboardItem({'text/html':new Blob([draft.html],{type:'text/html'}),'text/plain':new Blob([draft.body],{type:'text/plain'})})]);rich=true;}catch(_){}
   }
   if(!rich){if(!navigator.clipboard||!navigator.clipboard.writeText)throw Error('Clipboard unavailable');await navigator.clipboard.writeText(draft.body);}
   if(version!==generation)return;
   say(rich?(openMail?'':'Body copied.'):'Formatting could not be copied; plain text is on the clipboard.');
   if(openMail)location.href=mailto();
  } catch(_) {if(version!==generation)return;el('manual-recovery').open=true;body.focus();body.select();say('Automatic copying is unavailable. Copy the selected body, open your mail app using the link, and attach the downloaded PDF.');}
 }
 button.addEventListener('click',async function(event){
  event.preventDefault();if(busy||!ready)return;if(!draft){prepare();return;}
  busy=true;button.disabled=true;var version=generation,native=window.native;
  try {
   if(pdf&&!fallbackOnly&&!skipNative&&native&&native.capabilities&&native.capabilities.invoiceHandoff===2&&typeof native.handoffInvoice==='function'){
    var requestId=crypto.randomUUID();var result;
    try{result=await native.handoffInvoice({version:2,requestId:requestId,to:draft.to,subject:draft.subject,body:draft.body,html:draft.html,pdfBase64:base64,pdfFilename:draft.pdfFilename});}
    catch(_){if(version!==generation)return;fallbackOnly=true;show();say('Before retrying, confirm that no email was already sent or saved. If no composer opened, '+fallbackSteps);return;}
    if(version!==generation)return;
    if(!result||result.requestId!==requestId||!['handedOff','cancelled','savedDraft','unavailable','failed'].includes(result.status)){fallbackOnly=true;show();say('Before retrying, confirm that no email was already sent or saved. If no composer opened, '+fallbackSteps);return;}
    if(result.status==='cancelled'){say('Mail handoff cancelled. Nothing was marked sent.');return;}
    if(result.status==='handedOff'||result.status==='savedDraft'){show();say(result.status==='savedDraft'?'Draft saved. Send it from your mail app before marking this invoice sent.':'Mark as sent manually only after you send the email.');return;}
    // A fresh click is required after an async native failure: attempting
    // another handoff here might duplicate UI.
    if(result.status==='unavailable')skipNative=true;else fallbackOnly=true;show();say('The integrated composer is unavailable. To send manually, '+fallbackSteps);return;
   }
   if(pdf&&!fallbackOnly&&!skipNative&&native&&native.capabilities&&native.capabilities.mailCompose&&typeof native.composeMail==='function'){
    fallbackOnly=true;native.composeMail({to:draft.to,subject:draft.subject,body:draft.html,bodyIsHtml:true,pdfBase64:base64,pdfFilename:draft.pdfFilename});show();say('If no composer opened, '+fallbackSteps);return;
   }
   await copyAndOpen(version);
  }catch(_){if(version!==generation)return;fallbackOnly=true;show();say('Before retrying, confirm that no email was already sent or saved. If no composer opened, '+fallbackSteps);}
  finally{if(version===generation){busy=false;button.disabled=false;}}
 });
 el('manual-copy-body').addEventListener('click',async function(){if(!draft||busy)return;busy=true;var version=generation;try{await copyAndOpen(version,false);}finally{if(version===generation)busy=false;}});
 ['to','subject'].forEach(function(field){el('manual-copy-'+field).addEventListener('click',async function(){
  if(!draft)return;try{await navigator.clipboard.writeText(draft[field]||'');say(field==='to'?'Recipient copied.':'Subject copied.');}catch(_){say('Copy the '+(field==='to'?'recipient':'subject')+' shown above using your device’s Copy command.');}
 });});
 window.addEventListener('pagehide',function(){generation++;if(controller)controller.abort();pdf=null;base64=null;draft=null;ready=false;});
 window.addEventListener('pageshow',function(event){if(event.persisted){busy=false;prepare();}});
 prepare();
})();`.replaceAll('INVOICE_ID', String(id))}</script>`;
}
