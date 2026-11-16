let sequenceListVersion=0,sequenceBusy=false;
async function refreshSequences(){
 const version=++sequenceListVersion,folder=dir,select=$('#sequenceFile'),previous=select.value;
 select.replaceChildren(new Option(folder?'Loading sequences…':'Connect a folder to see sequences',''));select.disabled=true;$('#createSequenceVideo').disabled=true;
 if(!folder)return;
 try{
  const sequences=[];
  for await(const entry of folder.values()) if(entry.kind==='directory') {
   try{const file=await(await entry.getFileHandle('metadata.json')).getFile(),meta=JSON.parse(await file.text());if(meta.format==='screen-capture-png-frames'&&Array.isArray(meta.frames)&&meta.frames.length)sequences.push({name:entry.name,modified:file.lastModified})}catch(e){if(e.name!=='NotFoundError'&&!(e instanceof SyntaxError))throw e}
  }
  if(version!==sequenceListVersion||folder!==dir)return;
  sequences.sort((a,b)=>b.modified-a.modified||a.name.localeCompare(b.name));
  select.replaceChildren(new Option(sequences.length?'Select a sequence':'No PNG sequences in this folder',''));
  for(const sequence of sequences)select.add(new Option(sequence.name,sequence.name));
  if(sequences.some(x=>x.name===previous))select.value=previous;
  select.disabled=!sequences.length||sequenceBusy;$('#createSequenceVideo').disabled=!select.value||sequenceBusy;
  $('#sequenceStatus').textContent=select.value?'Ready to create video.':sequences.length?'Select a sequence to get started.':'No PNG sequences in the connected folder.';
 }catch(e){if(version===sequenceListVersion){select.replaceChildren(new Option('Could not read folder',''));$('#sequenceStatus').textContent='Could not read sequences: '+e.message}}
}
$('#refreshSequences').onclick=refreshSequences;
$('#sequenceFile').onchange=()=>{$('#createSequenceVideo').disabled=!$('#sequenceFile').value||sequenceBusy;$('#sequenceStatus').textContent=$('#sequenceFile').value?'Ready to create video.':'Select a sequence to get started.'};
$('#createSequenceVideo').onclick=async()=>{
 const folder=dir,name=$('#sequenceFile').value,status=$('#sequenceStatus');if(!folder||!name||sequenceBusy)return;
 sequenceBusy=true;let cancelled=false,output,writer,outName,created=false;
 const controls=[$('#sequenceFile'),$('#refreshSequences'),$('#createSequenceVideo'),$('#connect')],cancel=$('#cancelSequenceVideo');controls.forEach(x=>x.disabled=true);cancel.hidden=false;cancel.disabled=false;cancel.onclick=()=>{cancelled=true;cancel.disabled=true;status.textContent='Cancelling…'};
 const check=()=>{if(cancelled)throw new DOMException('Cancelled','AbortError')};
 try{
  status.textContent='Reading sequence…';const sub=await folder.getDirectoryHandle(name),meta=JSON.parse(await(await(await sub.getFileHandle('metadata.json')).getFile()).text()),frames=meta.frames;
  if(meta.format!=='screen-capture-png-frames'||!Array.isArray(frames)||!frames.length)throw new Error('This sequence has no frames.');
  const times=frames.map(f=>Number(f.relativeMicroseconds)/1e6);
  if(times.some((t,i)=>!Number.isFinite(t)||t<0||(i>0&&t<=times[i-1])))throw new Error('Frame timestamps must be finite and strictly increasing.');
  const firstImage=await createImageBitmap(await(await sub.getFileHandle(frames[0].file)).getFile());let width=firstImage.width,height=firstImage.height;firstImage.close();
  const m=await import('./mediabunny.mjs');check();
  if(!await m.canEncodeVideo('vp9',{width,height,bitrate:20000000}))throw new Error('This browser cannot encode VP9 at these dimensions.');
  outName=await uniqueName(folder,name+'_video.webm');const handle=await folder.getFileHandle(outName,{create:true});created=true;writer=await handle.createWritable();
  const target=new m.StreamTarget(writer);output=new m.Output({format:new m.WebMOutputFormat(),target});
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d',{alpha:false}),source=new m.CanvasSource(canvas,{codec:'vp9',bitrate:20000000});output.addVideoTrack(source);await output.start();
  const recent=times.slice(1).map((t,i)=>t-times[i]).sort((a,b)=>a-b);const fallback=recent.length?recent[Math.floor(recent.length/2)]:1/(Number(meta.diagnostics?.trackSettings?.frameRate)||30),base=times[0];
  for(let i=0;i<frames.length;i++){
   check();const image=await createImageBitmap(await(await sub.getFileHandle(frames[i].file)).getFile());try{if(image.width!==width||image.height!==height)throw new Error(`Frame ${i+1} has different dimensions.`);ctx.drawImage(image,0,0)}finally{image.close()}
   const duration=i+1<times.length?times[i+1]-times[i]:fallback;await source.add(times[i]-base,duration);if(i%10===0){status.textContent=`Creating video: ${i+1} / ${frames.length} frames…`;await new Promise(resolve=>setTimeout(resolve,0))}
  }
  check();status.textContent='Finishing video…';await output.finalize();check();writer=null;
  status.textContent=`Saved “${outName}” in ${folder.name}. The PNG sequence was kept.`;
  await Promise.all([refreshFiles(),refreshEditFiles(),refreshVideoTrackFiles(),refreshProcessFiles()]);
 }catch(e){if(output?.state==='started')try{await output.cancel()}catch{}if(writer)try{await writer.abort()}catch{}if(created&&outName)try{await folder.removeEntry(outName)}catch{}status.textContent=cancelled?'Video creation cancelled.':'Could not create video: '+e.message}
 finally{sequenceBusy=false;cancel.hidden=true;cancel.onclick=null;controls.forEach(x=>x.disabled=false);$('#sequenceFile').disabled=$('#sequenceFile').options.length<=1;$('#createSequenceVideo').disabled=!$('#sequenceFile').value}
};
