// Align consecutive frames at reduced resolution, then render at source resolution.
let videoTrackListVersion = 0, videoTrackUrl = null, videoAverageUrl = null, videoTrackBlob = null, videoTrackName = null;
async function refreshVideoTrackFiles() {
  const version = ++videoTrackListVersion, folder = dir, select = $('#videoTrackFile'), previous = select.value;
  select.replaceChildren(new Option(folder ? 'Loading videos…' : 'Connect a folder to see videos', ''));
  select.disabled = true; $('#runVideoTrack').disabled = true;
  if (!folder) return;
  try {
    const entries = [];
    for await (const entry of folder.values()) if (entry.kind === 'file' && /\.(webm|mp4|mov|mkv|ogv)$/i.test(entry.name)) entries.push(entry);
    const videos = await Promise.all(entries.map(async entry => ({name: entry.name, modified: (await entry.getFile()).lastModified})));
    if (version !== videoTrackListVersion || folder !== dir) return;
    videos.sort((a, b) => b.modified - a.modified || a.name.localeCompare(b.name));
    select.replaceChildren(new Option(videos.length ? 'Select a video' : 'No videos in this folder', ''));
    for (const video of videos) select.add(new Option(video.name, video.name));
    if (videos.some(video => video.name === previous)) select.value = previous;
    select.disabled = !videos.length; $('#runVideoTrack').disabled = !select.value;
    $('#videoTrackStatus').textContent = select.value ? 'Ready to process.' : videos.length ? 'Select a video to get started.' : 'No videos in the connected folder.';
  } catch (error) {
    if (version !== videoTrackListVersion) return;
    select.replaceChildren(new Option('Could not read folder', ''));
    $('#videoTrackStatus').textContent = 'Could not read the folder: ' + error.message;
  }
}
$('#refreshVideoTrackFiles').onclick = refreshVideoTrackFiles;
function clearVideoTrackResult() {
  if (videoTrackUrl) URL.revokeObjectURL(videoTrackUrl);
  if (videoAverageUrl) URL.revokeObjectURL(videoAverageUrl);
  videoTrackUrl = videoAverageUrl = videoTrackBlob = videoTrackName = null;
  $('#videoTrackPreview').removeAttribute('src'); $('#videoTrackPreview').style.display = 'none';
  $('#videoAverageSection').hidden = true; $('#videoTrackLiveSection').hidden = true; $('#videoTrackUncertain').hidden = true; $('#videoTrackUncertainList').textContent = '';
  $('#downloadVideoTrack').disabled = $('#saveVideoTrack').disabled = $('#downloadVideoAverage').disabled = true;
}
$('#videoTrackFile').onchange = () => { clearVideoTrackResult(); $('#runVideoTrack').disabled = !$('#videoTrackFile').value; $('#videoTrackStatus').textContent = $('#videoTrackFile').value ? 'Ready to process.' : 'Select a video to get started.'; };
const videoTrackYield = () => new Promise(resolve => setTimeout(resolve, 0));
function videoTrackGray(canvas, width, height) {
  const c = document.createElement('canvas'); c.width = width; c.height = height;
  const ctx = c.getContext('2d', {willReadFrequently:true}); ctx.drawImage(canvas, 0, 0, width, height);
  const data = ctx.getImageData(0, 0, width, height).data, result = new Uint8Array(width * height);
  for (let i = 0; i < result.length; i++) result[i] = Math.round(.299 * data[i*4] + .587 * data[i*4+1] + .114 * data[i*4+2]);
  return result;
}
// Sample high-contrast points throughout the frame, so blank areas do not dominate.
function videoTrackFeatures(image,w,h) {
  const points=[];
  for(let ty=2;ty<h-2;ty+=24) for(let tx=2;tx<w-2;tx+=24) {
    const candidates=[];
    for(let y=ty;y<Math.min(ty+24,h-2);y+=2) for(let x=tx;x<Math.min(tx+24,w-2);x+=2) {
      const i=y*w+x, strength=Math.abs(image[i+1]-image[i-1])+Math.abs(image[i+w]-image[i-w]);
      if(strength>=8) candidates.push({x,y,value:image[i],strength});
    }
    candidates.sort((a,b)=>b.strength-a.strength);
    points.push(...candidates.slice(0,4));
  }
  return points;
}
// Current (x,y) maps to reference (dx + scale*x, dy + scale*y).
function videoTrackFeatureScore(reference,points,w,h,dx,dy,scale=1) {
  let total=0,count=0; const regions=new Float64Array(8),regionCounts=new Uint16Array(8);
  for(const p of points) {
    const x=Math.round(dx+scale*p.x),y=Math.round(dy+scale*p.y);
    if(x<1||x>=w-1||y<1||y>=h-1)continue;
    const diff=Math.min(60,Math.abs(p.value-reference[y*w+x]));
    const region=Math.min(3,Math.floor(p.x*4/w))+4*Math.min(1,Math.floor(p.y*2/h));
    total+=diff;count++;regions[region]+=diff;regionCounts[region]++;
  }
  if(count<Math.max(12,points.length*.5))return {score:Infinity,regions,regionCounts};
  return {score:total/count,regions,regionCounts};
}
function videoTrackMatch(reference,current,w,h,predicted={dx:0,dy:0,scale:1},threshold=10) {
  const points=videoTrackFeatures(current,w,h);
  if(points.length<12)return {dx:predicted.dx,dy:predicted.dy,scale:predicted.scale,uncertain:true,score:Infinity};
  let best={dx:Math.round(predicted.dx),dy:Math.round(predicted.dy),scale:predicted.scale,score:Infinity};
  const radius=Math.max(10,Math.round(Math.min(w,h)*.05)), cx=Math.round(predicted.dx),cy=Math.round(predicted.dy);
  function search(scale,range,step) {
    for(let dy=cy-range;dy<=cy+range;dy+=step)for(let dx=cx-range;dx<=cx+range;dx+=step){
      const result=videoTrackFeatureScore(reference,points,w,h,dx,dy,scale);
      // Penalize scale changes and large jumps slightly when several matches are similar.
      const adjusted=result.score+Math.hypot(dx-predicted.dx,dy-predicted.dy)*.12;
      if(adjusted<best.score)best={dx,dy,scale,score:adjusted,raw:result};
    }
  }
  search(predicted.scale,radius,1);
  // If the local match is weak, search farther along both axes for a fast move.
  if(best.score>10) {
    const rangeX=Math.round(w*.4),rangeY=Math.round(h*.4);
    for(let dy=-rangeY;dy<=rangeY;dy++)for(let dx=cx-2;dx<=cx+2;dx++){
      const raw=videoTrackFeatureScore(reference,points,w,h,dx,dy,predicted.scale);
      if(raw.score+Math.hypot(dx-cx,dy-cy)*.12<best.score)best={dx,dy,scale:predicted.scale,score:raw.score+Math.hypot(dx-cx,dy-cy)*.12,raw};
    }
    for(let dx=-rangeX;dx<=rangeX;dx++)for(let dy=cy-2;dy<=cy+2;dy++){
      const raw=videoTrackFeatureScore(reference,points,w,h,dx,dy,predicted.scale);
      if(raw.score+Math.hypot(dx-cx,dy-cy)*.12<best.score)best={dx,dy,scale:predicted.scale,score:raw.score+Math.hypot(dx-cx,dy-cy)*.12,raw};
    }
  }
  // Test zoom only at the best translation; it must win clearly across independent regions.
  const translation={...best}, alternatives=[];
  for(const factor of [.94,.97,1.03,1.06]) {
    const scale=predicted.scale*factor;
    for(let dy=translation.dy-2;dy<=translation.dy+2;dy++)for(let dx=translation.dx-2;dx<=translation.dx+2;dx++){
      const raw=videoTrackFeatureScore(reference,points,w,h,dx,dy,scale);
      alternatives.push({dx,dy,scale,score:raw.score,raw});
    }
  }
  alternatives.sort((a,b)=>a.score-b.score);
  const zoom=alternatives[0];
  if(zoom && zoom.score+1<translation.raw.score*.8){
    let improved=0,eligible=0;
    for(let i=0;i<8;i++)if(translation.raw.regionCounts[i]>=3&&zoom.raw.regionCounts[i]>=3){eligible++;if(zoom.raw.regions[i]/zoom.raw.regionCounts[i]+1<translation.raw.regions[i]/translation.raw.regionCounts[i]*.85)improved++;}
    if(eligible>=3&&improved>=Math.max(3,Math.ceil(eligible*.6)))best=zoom;
  }
  // A similarly good distant match or a high residual means the estimate is ambiguous.
  let rival=Infinity;
  for(let dy=cy-radius;dy<=cy+radius;dy+=2)for(let dx=cx-radius;dx<=cx+radius;dx+=2){
    if(Math.hypot(dx-best.dx,dy-best.dy)<3)continue;
    rival=Math.min(rival,videoTrackFeatureScore(reference,points,w,h,dx,dy,best.scale).score);
  }
  const uncertain=!Number.isFinite(best.score)||best.score>threshold*2+4||rival<best.score+Math.max(.7,best.score*.08);
  return {...best,uncertain,featureCount:points.length};
}
$('#runVideoTrack').onclick = async () => {
  const name = $('#videoTrackFile').value, folder = dir, threshold = Number($('#videoTrackThreshold').value), status = $('#videoTrackStatus');
  if (!name || !folder) return;
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 255 || $('#videoTrackThreshold').value === '') { status.textContent = 'Enter a threshold between 0 and 255.'; return; }
  clearVideoTrackResult();
  const controls = ['#runVideoTrack','#videoTrackFile','#videoTrackThreshold','#refreshVideoTrackFiles']; controls.forEach(id => $(id).disabled = true);
  let input, output;
  try {
    const file = await (await folder.getFileHandle(name)).getFile(), m = await import('./mediabunny.mjs');
    input = new m.Input({formats:m.ALL_FORMATS,source:new m.BlobSource(file)});
    const track = await input.getPrimaryVideoTrack(); if (!track || !await track.canDecode()) throw new Error('This browser cannot decode the selected video.');
    const sink = new m.CanvasSink(track,{poolSize:1}), positions = [];
    let reference, referenceTransform, predicted={dx:0,dy:0,scale:1}, uncertainFrames=0, uncertainTimes=[], width, height, sw, sh, transform = {x:0,y:0,scale:1};
    const live=$('#videoTrackLive'), liveCtx=live.getContext('2d'), snapshot=document.createElement('canvas');
    snapshot.width=live.width;snapshot.height=live.height;const snapshotCtx=snapshot.getContext('2d');
    liveCtx.clearRect(0,0,live.width,live.height);$('#videoTrackLiveSection').hidden=false;
    let bounds=null, view=null;
    function showTrackedFrame(frame, p) {
      const right=p.x+width*p.scale,bottom=p.y+height*p.scale;
      bounds=bounds ? {left:Math.min(bounds.left,p.x),top:Math.min(bounds.top,p.y),right:Math.max(bounds.right,right),bottom:Math.max(bounds.bottom,bottom)} : {left:p.x,top:p.y,right,bottom};
      const scale=Math.min(live.width/(bounds.right-bounds.left),live.height/(bounds.bottom-bounds.top))*.9;
      const next={scale,x:(live.width-(bounds.right-bounds.left)*scale)/2-bounds.left*scale,y:(live.height-(bounds.bottom-bounds.top)*scale)/2-bounds.top*scale};
      if(view && (next.scale!==view.scale || next.x!==view.x || next.y!==view.y)){snapshotCtx.clearRect(0,0,live.width,live.height);snapshotCtx.drawImage(live,0,0);liveCtx.clearRect(0,0,live.width,live.height);const ratio=next.scale/view.scale;liveCtx.drawImage(snapshot,next.x-view.x*ratio,next.y-view.y*ratio,live.width*ratio,live.height*ratio);}
      liveCtx.drawImage(frame.canvas,next.x+p.x*scale,next.y+p.y*scale,width*p.scale*scale,height*p.scale*scale);view=next;
    }
    for await (const frame of sink.canvases()) {
      if (!width) { width=frame.canvas.width; height=frame.canvas.height; const ratio=Math.min(1,384/Math.max(width,height)); sw=Math.max(1,Math.round(width*ratio)); sh=Math.max(1,Math.round(height*ratio)); }
      if (frame.canvas.width !== width || frame.canvas.height !== height) throw new Error('Video dimensions changed during processing.');
      const current = videoTrackGray(frame.canvas,sw,sh);
      if (reference) {
        const match=videoTrackMatch(reference,current,sw,sh,predicted,threshold);
        if(match.uncertain){uncertainFrames++;uncertainTimes.push(Math.max(0,frame.timestamp-positions[0].timestamp));}
        transform={x:referenceTransform.x+referenceTransform.scale*match.dx*width/sw,y:referenceTransform.y+referenceTransform.scale*match.dy*height/sh,scale:referenceTransform.scale*match.scale};
        predicted={dx:match.dx,dy:match.dy,scale:match.scale};
        // Keep a stable reference until overlap becomes small, then start a new one.
        if(!match.uncertain && (Math.abs(match.dx)>sw*.08||Math.abs(match.dy)>sh*.08||Math.abs(match.scale-1)>.15)) {reference=current;referenceTransform={...transform};predicted={dx:0,dy:0,scale:1};}
      } else {reference=current;referenceTransform={...transform};}
      if (!Number.isFinite(transform.scale) || transform.scale < .02 || transform.scale > 50) throw new Error('Tracking produced an impractical scale. Try a different threshold or video.');
      positions.push({...transform,timestamp:frame.timestamp,duration:frame.duration});
      showTrackedFrame(frame,transform); status.textContent=`Tracking frame ${positions.length}… ${uncertainFrames} uncertain matches.`; await videoTrackYield();
    }
    if (!positions.length) throw new Error('The video contains no decodable frames.');
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity,minScale=Infinity;
    for(const p of positions){minX=Math.min(minX,p.x);minY=Math.min(minY,p.y);maxX=Math.max(maxX,p.x+width*p.scale);maxY=Math.max(maxY,p.y+height*p.scale);minScale=Math.min(minScale,p.scale);}
    const outWidth=Math.ceil((maxX-minX)/minScale/2)*2, outHeight=Math.ceil((maxY-minY)/minScale/2)*2;
    // Accumulators, canvas and encoder all need memory proportional to output area.
    if (!Number.isFinite(outWidth*outHeight) || outWidth>16384 || outHeight>16384 || outWidth*outHeight>16000000) throw new Error(`The tracked canvas (${outWidth} × ${outHeight}) is too large for this browser. Try a shorter video or a different threshold.`);
    const groups=new Map();
    positions.forEach((p,i)=>{const key=`${Math.round(p.x/2)},${Math.round(p.y/2)},${Math.round(p.scale*1000)}`; if(!groups.has(key)) groups.set(key,[]); groups.get(key).push(i)});
    const chosen=new Set(); for(const indices of groups.values()) {const n=Math.min(10,indices.length); for(let i=0;i<n;i++) chosen.add(indices[Math.floor((i+.5)*indices.length/n)]);}
    const sums=new Float32Array(outWidth*outHeight*3), counts=new Uint32Array(outWidth*outHeight), temp=document.createElement('canvas'); temp.width=outWidth;temp.height=outHeight;
    const tctx=temp.getContext('2d',{willReadFrequently:true}); let index=0;
    status.textContent=`Averaging ${chosen.size} sampled frames…`; await videoTrackYield();
    for await (const frame of sink.canvases()) {
      const p=positions[index]; if (chosen.has(index)) {
        const x=(p.x-minX)/minScale,y=(p.y-minY)/minScale,w=width*p.scale/minScale,h=height*p.scale/minScale;
        const left=Math.max(0,Math.floor(x)),top=Math.max(0,Math.floor(y)),right=Math.min(outWidth,Math.ceil(x+w)),bottom=Math.min(outHeight,Math.ceil(y+h));
        tctx.clearRect(left,top,right-left,bottom-top); tctx.drawImage(frame.canvas,x,y,w,h);
        const pixels=tctx.getImageData(left,top,right-left,bottom-top).data;
        for(let yy=top;yy<bottom;yy++) for(let xx=left;xx<right;xx++){const j=((yy-top)*(right-left)+xx-left)*4;if(!pixels[j+3])continue;const k=yy*outWidth+xx;counts[k]++;sums[k*3]+=pixels[j];sums[k*3+1]+=pixels[j+1];sums[k*3+2]+=pixels[j+2];}
      }
      index++; if(index%10===0){status.textContent=`Averaging frames: ${index} / ${positions.length}…`;await videoTrackYield();}
    }
    const average=$('#videoAverage'); average.width=outWidth;average.height=outHeight;const actx=average.getContext('2d'), image=actx.createImageData(outWidth,outHeight);
    for(let i=0;i<counts.length;i++){if(counts[i]){image.data[i*4]=sums[i*3]/counts[i];image.data[i*4+1]=sums[i*3+1]/counts[i];image.data[i*4+2]=sums[i*3+2]/counts[i];image.data[i*4+3]=255;}}
    actx.putImageData(image,0,0); const png=await new Promise(resolve=>average.toBlob(resolve,'image/png')); if(!png)throw new Error('Could not create the averaged image.');
    const canvas=document.createElement('canvas');canvas.width=outWidth;canvas.height=outHeight;const ctx=canvas.getContext('2d'),target=new m.BufferTarget();
    output=new m.Output({format:new m.WebMOutputFormat(),target});const source=new m.CanvasSource(canvas,{codec:'vp9',bitrate:m.QUALITY_HIGH});output.addVideoTrack(source);await output.start();index=0;
    for await (const frame of sink.canvases()) {const p=positions[index];ctx.fillStyle='#000';ctx.fillRect(0,0,outWidth,outHeight);ctx.drawImage(average,0,0);ctx.drawImage(frame.canvas,(p.x-minX)/minScale,(p.y-minY)/minScale,width*p.scale/minScale,height*p.scale/minScale);liveCtx.clearRect(0,0,live.width,live.height);const fit=Math.min(live.width/outWidth,live.height/outHeight);liveCtx.drawImage(canvas,(live.width-outWidth*fit)/2,(live.height-outHeight*fit)/2,outWidth*fit,outHeight*fit);await source.add(Math.max(0,frame.timestamp-positions[0].timestamp),frame.duration);index++;if(index%10===0){status.textContent=`Rendering frame ${index} / ${positions.length}…`;await videoTrackYield();}}
    status.textContent='Finishing video…';await output.finalize();
    videoTrackBlob=new Blob([target.buffer],{type:'video/webm'});videoTrackUrl=URL.createObjectURL(videoTrackBlob);videoAverageUrl=URL.createObjectURL(png);
    $('#videoTrackPreview').src=videoTrackUrl;$('#videoTrackPreview').style.display='block';$('#videoAverageSection').hidden=false;
    const base=file.name.replace(/\.[^.]+$/,'');videoTrackName='Video_tracked_'+base+'.webm';
    $('#downloadVideoTrack').onclick=()=>{const a=document.createElement('a');a.href=videoTrackUrl;a.download=base+'_tracked.webm';a.click()};
    $('#downloadVideoAverage').onclick=()=>{const a=document.createElement('a');a.href=videoAverageUrl;a.download=base+'_average.png';a.click()};
    $('#downloadVideoTrack').disabled=$('#saveVideoTrack').disabled=$('#downloadVideoAverage').disabled=false;
    if(uncertainTimes.length){$('#videoTrackUncertain').hidden=false;$('#videoTrackUncertainList').textContent=uncertainTimes.map(t=>t.toFixed(2)+' s').join(', ');}
    status.textContent=`Finished ${positions.length} frames at ${outWidth} × ${outHeight} pixels. The background uses ${chosen.size} sampled frames. ${uncertainFrames} frames had uncertain matches.`;
  } catch(error) {if(output && output.state==='started')try{await output.cancel()}catch{} status.textContent='Could not track video: '+error.message;console.error(error);}
  finally {input?.dispose();controls.forEach(id=>$(id).disabled=false);$('#runVideoTrack').disabled=!$('#videoTrackFile').value;}
};

$('#saveVideoTrack').onclick = async () => {
  const result = videoTrackBlob, name = videoTrackName, folder = dir, button = $('#saveVideoTrack'), status = $('#videoTrackStatus');
  if (!result || !name) return;
  if (!folder) { status.textContent = 'Connect a folder before saving.'; return; }
  button.disabled = true;
  try {
    const filename = await uniqueName(folder, name);
    const handle = await folder.getFileHandle(filename, {create:true});
    const writer = await handle.createWritable();
    try { await writer.write(result); await writer.close(); }
    catch (error) { try { await writer.abort(); } catch {} throw error; }
    status.textContent = 'Saved “' + filename + '” to ' + folder.name + '.';
  } catch (error) { status.textContent = 'Could not save tracked video: ' + error.message; }
  finally { button.disabled = !videoTrackBlob; }
};
