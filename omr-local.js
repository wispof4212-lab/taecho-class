/* Answer-bubble reader for the 45-question red-print Korean OMR sheet.
   Runs entirely in the teacher's browser; no image is sent to an AI service. */
async function scanOmrLocally(file){
  const image=await createImageBitmap(file);
  try{
    let best=null;
    for(const angle of [0,180,90,270]){
      const ow=angle%180===0?image.width:image.height;
      const oh=angle%180===0?image.height:image.width;
      const width=2020,height=Math.round(oh*width/ow);
      const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
      const ctx=canvas.getContext('2d',{willReadFrequently:true});
      ctx.scale(width/ow,height/oh);
      if(angle===90){ctx.translate(ow,0);ctx.rotate(Math.PI/2);}
      else if(angle===180){ctx.translate(ow,oh);ctx.rotate(Math.PI);}
      else if(angle===270){ctx.translate(0,oh);ctx.rotate(-Math.PI/2);}
      ctx.drawImage(image,0,0);
      const scan=scanOmrPixels(ctx.getImageData(0,0,width,height));
      if(scan && (!best || scan.readCount>best.readCount))best=Object.assign({angle:angle},scan);
      if(best&&best.readCount>=43)break;
    }
    if(!best)throw new Error('이 OMR 양식의 45문항 마킹 칸을 찾지 못했어요. 종이 전체가 선명하게 보이도록 찍어 주세요.');
    if(best.readCount<35)throw new Error('마킹을 '+best.readCount+'/45개만 판독했어요. 밝은 곳에서 종이를 평평하게 놓고 다시 찍어 주세요.');
    return best;
  }finally{if(image.close)image.close();}
}

function scanOmrPixels(imageData){
  const w=imageData.width,h=imageData.height,p=imageData.data;
  const red=new Uint8Array(w*h),columnTotals=new Uint32Array(w);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const i=(y*w+x)*4,r=p[i],g=p[i+1],b=p[i+2];
    if(r>95 && r-g>15 && r-b>10 && g<210){red[y*w+x]=1;columnTotals[x]++;}
  }
  function spans(counts,threshold,gap){
    const out=[];let start=-1,last=-1,mass=0,peak=0;
    for(let i=0;i<counts.length;i++){
      if(counts[i]>threshold){
        if(start>=0&&i-last>gap+1){out.push({start:start,end:last,mass:mass,peak:peak,center:Math.round((start+last)/2)});start=-1;mass=0;peak=0;}
        if(start<0)start=i;
        last=i;mass+=counts[i];peak=Math.max(peak,counts[i]);
      }
    }
    if(start>=0)out.push({start:start,end:last,mass:mass,peak:peak,center:Math.round((start+last)/2)});
    return out;
  }
  const scale=h/1515;
  const lanes=spans(columnTotals,Math.max(8,25*scale),4)
    .filter(s=>s.end-s.start>=6&&s.end-s.start<=72&&s.mass>450*scale);
  const groups=[];let current=[];
  for(const lane of lanes){
    if(current.length && lane.center-current[current.length-1].center>90){groups.push(current);current=[];}
    current.push(lane);
  }
  if(current.length)groups.push(current);
  const five=groups.filter(g=>g.length===5);
  if(five.length!==3)return null;
  const expected=[20,14,11],allRows=[];
  for(let block=0;block<3;block++){
    const group=five[block],x0=Math.max(0,group[0].start-8),x1=Math.min(w,group[4].end+9);
    const totals=new Uint32Array(h);
    for(let y=0;y<h;y++)for(let x=x0;x<x1;x++)totals[y]+=red[y*w+x];
    const max=Math.max(...totals);
    let chosen=null;
    for(const fraction of [0.065,0.05,0.08,0.1,0.12,0.04]){
      const rows=spans(totals,Math.max(5,max*fraction),6)
        .filter(s=>s.end-s.start>=4&&s.mass>35);
      if(rows.length===expected[block]){chosen=rows;break;}
    }
    if(!chosen)return null;
    // A regular line of answer bubbles distinguishes the 45-question fields from number grids.
    const gaps=chosen.slice(1).map((r,i)=>r.center-chosen[i].center);
    const mean=gaps.reduce((a,b)=>a+b,0)/gaps.length;
    if(mean<28||mean>110||gaps.some(g=>Math.abs(g-mean)>mean*0.32))return null;
    allRows.push(chosen);
  }
  const answers={},uncertain=[];let readCount=0;
  for(let block=0,question=0;block<3;block++){
    const group=five[block];
    for(const row of allRows[block]){
      const scores=group.map(lane=>{
        let dark=0,total=0;
        for(let y=Math.max(0,row.center-8);y<=Math.min(h-1,row.center+8);y++)
          for(let x=Math.max(0,lane.center-8);x<=Math.min(w-1,lane.center+8);x++){
            const i=(y*w+x)*4;
            if((p[i]+p[i+1]+p[i+2])/3<95)dark++;
            total++;
          }
        return dark/total;
      });
      const order=[0,1,2,3,4].sort((a,b)=>scores[b]-scores[a]);
      const first=scores[order[0]],second=scores[order[1]];
      answers[question]=first>=0.18&&first-second>=0.13?String(order[0]+1):'';
      if(answers[question])readCount++;else uncertain.push(question+1);
      question++;
    }
  }
  return {answers:answers,readCount:readCount,uncertain:uncertain};
}
