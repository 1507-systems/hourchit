/** The same manual Send action progressively hands off to device capabilities.
 * Keep this controller self-contained: it is emitted into server-rendered pages,
 * and tests execute these exact bytes against browser API fixtures.
 */
export function manualSendControls(id: number, alreadySent: boolean): string {
  return `<section class="manual-handoff"><p id="manual-status" role="status" aria-live="polite">Preparing invoice…</p>
<div id="manual-details" hidden>
  <p>Check the recipient, subject, body and attachment in your chosen app before sending.</p>
  <p>To: <span id="manual-to"></span> <button type="button" id="manual-copy-to" class="secondary">Copy recipient</button></p>
  <p>Subject: <span id="manual-subject"></span> <button type="button" id="manual-copy-subject" class="secondary">Copy subject</button></p>
  <label for="manual-body">Email body</label><textarea id="manual-body" readonly rows="8" style="width:100%;box-sizing:border-box"></textarea>
  <a id="manual-open">Open your mail app</a>
  <p>Paste the body, then use Download PDF above and attach it to your email.</p>
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
 var say=function(message){status.textContent=message;};
 var show=function(){details.hidden=false;el('manual-confirm').hidden=false;};
 var mailto=function(){return 'mailto:'+encodeURIComponent(draft.to||'')+'?subject='+encodeURIComponent(draft.subject);};
 async function prepare(){
  var version=++generation;ready=false;pdf=null;base64=null;draft=null;fallbackOnly=false;skipNative=false;
  if(controller)controller.abort();controller=new AbortController();var abort=controller;
  button.disabled=true;button.textContent='Preparing…';say('Preparing invoice…');
  var timer=setTimeout(function(){abort.abort();},30000);
  try {
   var response=await fetch('/invoices/INVOICE_ID/mail-app/compose',{signal:abort.signal,cache:'no-store',redirect:'error'});
   if(!response.ok||!String(response.headers.get('content-type')).includes('application/json'))throw Error('Invoice details unavailable');
   var data=await response.json();if(version!==generation)return;
   if(typeof data.body!=='string'||typeof data.html!=='string'||typeof data.subject!=='string'||(data.to!==null&&typeof data.to!=='string'))throw Error('Invalid invoice details');
   draft=data;body.value=data.body;el('manual-to').textContent=data.to||'Add the recipient in your mail app';el('manual-subject').textContent=data.subject;el('manual-open').href=mailto();
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
   // click activation needed by Web Share or clipboard writing later.
   var bytes=new Uint8Array(await blob.arrayBuffer()),binary='';
   for(var i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode.apply(null,bytes.subarray(i,i+8192));
   if(version!==generation)return;base64=btoa(binary);say('Ready. Choose Send to open your mail app or sharing options.');
  } catch(error) {
   if(version!==generation)return;pdf=null;base64=null;
   say(draft?'Automatic attachment unavailable. Send will copy the body; download and attach the PDF manually.':'Invoice preparation failed. Choose Send to retry, or use the manual email instructions.');
   if(draft)show();
  } finally {clearTimeout(timer);if(version===generation){ready=true;button.disabled=false;button.textContent='Send';}}
 }
 async function copyAndOpen(version){
  show();var rich=false;
  try {
   if(navigator.clipboard&&navigator.clipboard.write&&typeof ClipboardItem!=='undefined'){
    try {await navigator.clipboard.write([new ClipboardItem({'text/html':new Blob([draft.html],{type:'text/html'}),'text/plain':new Blob([draft.body],{type:'text/plain'})})]);rich=true;}catch(_){}
   }
   if(!rich){if(!navigator.clipboard||!navigator.clipboard.writeText)throw Error('Clipboard unavailable');await navigator.clipboard.writeText(draft.body);}
   if(version!==generation)return;
   say(rich?'Body copied. Paste it into your email, then download and attach the PDF.':'Body copied as plain text; formatting could not be copied. Paste it, then download and attach the PDF.');
   location.href=mailto();
  } catch(_) {if(version!==generation)return;body.focus();body.select();say('Automatic copying is unavailable. Copy the selected body, open your mail app using the link, and attach the downloaded PDF.');}
 }
 button.addEventListener('click',async function(event){
  event.preventDefault();if(busy||!ready)return;if(!draft){prepare();return;}
  busy=true;button.disabled=true;var version=generation,native=window.native;
  try {
   if(pdf&&!fallbackOnly&&!skipNative&&native&&native.capabilities&&native.capabilities.invoiceHandoff===2&&typeof native.handoffInvoice==='function'){
    var requestId=crypto.randomUUID();var result;
    try{result=await native.handoffInvoice({version:2,requestId:requestId,to:draft.to,subject:draft.subject,body:draft.body,html:draft.html,pdfBase64:base64,pdfFilename:draft.pdfFilename});}
    catch(_){if(version!==generation)return;fallbackOnly=true;show();say('Check your mail app before retrying: the handoff outcome is unknown. Send again uses manual copy and attachment.');return;}
    if(version!==generation)return;
    if(!result||result.requestId!==requestId||!['handedOff','cancelled','savedDraft','unavailable','failed'].includes(result.status)){fallbackOnly=true;show();say('Check your mail app before retrying: the handoff outcome is unknown.');return;}
    if(result.status==='cancelled'){say('Mail handoff cancelled. Nothing was marked sent.');return;}
    if(result.status==='handedOff'||result.status==='savedDraft'){show();say(result.status==='savedDraft'?'Draft saved. Send it from your mail app before marking this invoice sent.':'Check your mail app. Mark as sent manually only after you send the email.');return;}
    // A fresh click is required after an async native failure: attempting
    // Web Share here would use an expired activation and might duplicate UI.
    if(result.status==='unavailable')skipNative=true;else fallbackOnly=true;show();say('Mail handoff unavailable. Choose Send again to use the next available sharing or manual-copy option.');return;
   }
   if(pdf&&!fallbackOnly&&!skipNative&&native&&native.capabilities&&native.capabilities.mailCompose&&typeof native.composeMail==='function'){
    fallbackOnly=true;native.composeMail({to:draft.to,subject:draft.subject,body:draft.html,bodyIsHtml:true,pdfBase64:base64,pdfFilename:draft.pdfFilename});show();say('Check your mail app. If no composer opened, choose Send again for manual copy and attachment.');return;
   }
   var payload=pdf?{files:[pdf],title:draft.subject,text:draft.body}:null;
   if(payload&&!fallbackOnly&&navigator.share&&navigator.canShare&&navigator.canShare({files:[pdf]})&&navigator.canShare(payload)){
    try{await navigator.share(payload);if(version!==generation)return;show();say('Check the recipient, subject, body and PDF in your chosen app. Mark as sent manually only after sending.');}
    catch(error){if(version!==generation)return;if(error.name==='AbortError'){say('Sharing cancelled or no destination available. Nothing was marked sent.');}else{fallbackOnly=true;show();say('Sharing unavailable. Choose Send again to copy the body and attach the PDF manually.');}}return;
   }
   await copyAndOpen(version);
  }catch(_){if(version!==generation)return;fallbackOnly=true;show();say('Check your mail app before retrying. Choose Send again for manual copy and attachment.');}
  finally{if(version===generation){busy=false;button.disabled=false;}}
 });
 ['to','subject'].forEach(function(field){el('manual-copy-'+field).addEventListener('click',async function(){
  if(!draft)return;try{await navigator.clipboard.writeText(draft[field]||'');say(field==='to'?'Recipient copied.':'Subject copied.');}catch(_){say('Copy the '+(field==='to'?'recipient':'subject')+' shown above using your device’s Copy command.');}
 });});
 window.addEventListener('pagehide',function(){generation++;if(controller)controller.abort();pdf=null;base64=null;draft=null;ready=false;});
 window.addEventListener('pageshow',function(event){if(event.persisted){busy=false;prepare();}});
 prepare();
})();`.replaceAll('INVOICE_ID', String(id))}</script>`;
}
