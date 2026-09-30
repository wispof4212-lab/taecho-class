/* Korean handwriting phrase recognition. Only the cropped phrase is OCR'd in this browser. */
const OMR_FINGERPRINTS={
  'sep26-01':'가장 넓은 길은 언제나 내 마음속에',
  'sep26-02':'밝고 맑게 살아가는 희망의 사람이 되게',
  'sep26-04':'희망은 삶을 견고하게 지탱해주는 동아줄',
  'sep26-05':'해맑은 밤바람이 이마에 나리는',
  'sep26-06':'초록의 잎새 사이로 얇게 비친 햇살',
  'sep26-07':'희망을 속삭이는 아침이 밝아오니',
  'sep26-08':'하나뿐인 삶에서 너라는 행운을 만나',
  'sep26-09':'꿈을 향한 열정은 그 무엇보다 뜨겁게 타오른다',
  'sep26-10':'어둠이 없으면 별의 반짝임도 없으리',
  'sep26-11':'젊은이여 그 길은 너의 것이다',
  'sep26-12':'싱그럽고 푸르른 젊음이어라',
  'sep26-13':'행복하다 말하면 맑아지는 마음',
  'sep26-14':'물 먹는 소 목덜미에 할머니 손이 얹혀졌다',
  'sep26-15':'아침 이슬처럼 맑고 투명한 당신을',
  'sep26-16':'고요한 강물처럼 깊고 단단한 마음을 가질 것',
  'sep26-17':'저 넓은 세상에서 큰 꿈을 펼쳐라',
  'sep26-18':'많고 많은 사람 중에 그대 한 사람',
  'sep26-19':'맑은 햇빛으로 반짝반짝 물들이며',
  'sep26-20':'잊히지 않는 하나의 눈짓이 되고 싶다',
  'sep26-21':'푸른 목청으로 넓은 하늘을 물들이며'
};

function omrLocalAlignment(token,phrase){
  const a=Array.from(token.normalize('NFD')),b=Array.from(phrase.normalize('NFD'));
  let previous=new Float32Array(b.length+1),best=0;
  for(let i=1;i<=a.length;i++){
    const next=new Float32Array(b.length+1);
    for(let j=1;j<=b.length;j++){
      next[j]=Math.max(0,previous[j-1]+(a[i-1]===b[j-1]?2:-1),previous[j]-1,next[j-1]-1);
      if(next[j]>best)best=next[j];
    }
    previous=next;
  }
  return best;
}

function rankOmrFingerprints(text){
  const tokens=String(text||'').match(/[가-힣]{2,}/g)||[];
  const ranked=Object.entries(OMR_FINGERPRINTS).map(function([id,phrase]){
    const scores=tokens.map(function(token){return omrLocalAlignment(token,phrase);}).sort(function(a,b){return b-a;});
    return {id:id,phrase:phrase,score:(scores[0]||0)+(scores[1]||0)*0.35+
      omrLocalAlignment(tokens.join(''),phrase)*0.25};
  });
  // The 2027 September KICE cover phrase is unavailable. A handwritten exam title
  // in the same box is an explicit substitute; require year, month and issuer.
  const compact=String(text||'').normalize('NFKC').replace(/[\s.,·-]/g,'');
  if(/(?:2027|27)(?:학년도|년도|년)?(?:9|구)월?(?:모의평가|평가원)/.test(compact))
    ranked.push({id:'sep26-03',phrase:'27년 9월 평가원',score:120});
  return ranked.sort(function(a,b){return b.score-a.score;});
}

let omrKoreanModelPromise=null;
let omrKoreanScriptPromise=null;
function loadOmrKoreanScript(){
  if(window.ort)return Promise.resolve();
  if(!omrKoreanScriptPromise){
    omrKoreanScriptPromise=new Promise(function(resolve,reject){
      const script=document.createElement('script');
      script.src='https://cdn.jsdelivr.net/npm/onnxruntime-web@1.23.2/dist/ort.min.js';
      script.onload=resolve;
      script.onerror=function(){reject(new Error('기기 내 한국어 필적 모델을 불러오지 못했어요.'));};
      document.head.appendChild(script);
    }).catch(function(error){omrKoreanScriptPromise=null;throw error;});
  }
  return omrKoreanScriptPromise;
}

async function loadOmrKoreanModel(){
  if(!omrKoreanModelPromise){
    omrKoreanModelPromise=(async function(){
      await loadOmrKoreanScript();
      const base=new URL('.',document.baseURI);
      const runtime='https://cdn.jsdelivr.net/npm/onnxruntime-web@1.23.2/dist/';
      window.ort.env.wasm.wasmPaths=runtime;
      window.ort.env.wasm.numThreads=1;
      const [session,response]=await Promise.all([
        window.ort.InferenceSession.create(new URL('korean_rec.onnx',base).href,{executionProviders:['wasm']}),
        fetch(new URL('korean_dict.txt',base))
      ]);
      if(!response.ok)throw new Error('한국어 판독 문자표를 불러오지 못했어요.');
      const dictionary=['',...(await response.text()).trimEnd().split(/\r?\n/)];
      return {session:session,dictionary:dictionary};
    })().catch(function(error){omrKoreanModelPromise=null;throw error;});
  }
  return omrKoreanModelPromise;
}

async function readOmrKoreanLine(imageUrl){
  const model=await loadOmrKoreanModel();
  const image=new Image();
  image.src=imageUrl;
  await image.decode();
  const sourceHeight=Math.round(image.height*.57);
  const width=Math.round(image.width*48/sourceHeight);
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=48;
  const context=canvas.getContext('2d',{willReadFrequently:true});
  context.imageSmoothingQuality='high';
  context.drawImage(image,0,0,image.width,sourceHeight,0,0,width,48);
  const pixels=context.getImageData(0,0,width,48).data;
  const values=new Float32Array(3*48*width);
  for(let y=0;y<48;y++)for(let x=0;x<width;x++)
    for(let channel=0;channel<3;channel++)
      values[channel*48*width+y*width+x]=(pixels[(y*width+x)*4+channel]/255-.5)/.5;
  const result=await model.session.run({x:new window.ort.Tensor('float32',values,[1,3,48,width])});
  const output=result[model.session.outputNames[0]],classes=output.dims[2],steps=output.dims[1];
  let previous=-1,raw='';
  for(let step=0;step<steps;step++){
    let best=0,value=-Infinity;
    for(let index=0;index<classes;index++){
      const next=output.data[step*classes+index];
      if(next>value){value=next;best=index;}
    }
    if(best&&best!==previous)raw+=model.dictionary[best]||'';
    previous=best;
  }
  return raw.normalize('NFC');
}

let omrFingerprintWorkerPromise=null;
function loadOmrFingerprintScript(){
  if(window.Tesseract)return Promise.resolve();
  return new Promise(function(resolve,reject){
    const script=document.createElement('script');
    script.src=new URL('tesseract.min.js',document.baseURI).href;
    script.onload=resolve;script.onerror=function(){reject(new Error('기기 내 필적 판독 기능을 불러오지 못했어요.'));};
    document.head.appendChild(script);
  });
}

async function readOmrFingerprintTesseract(imageUrl){
  if(!imageUrl)throw new Error('필적 확인란을 사진에서 찾지 못했어요.');
  await loadOmrFingerprintScript();
  if(!omrFingerprintWorkerPromise){
    const base=new URL('.',document.baseURI).href.replace(/\/$/,'');
    omrFingerprintWorkerPromise=window.Tesseract.createWorker('kor',1,{
      langPath:base,workerPath:base+'/tesseract-worker.min.js',gzip:true
    });
  }
  let worker;
  try{worker=await omrFingerprintWorkerPromise;}
  catch(error){omrFingerprintWorkerPromise=null;throw error;}
  await worker.setParameters({tessedit_pageseg_mode:window.Tesseract.PSM.SINGLE_BLOCK});
  const result=await worker.recognize(imageUrl);
  return result.data.text||'';
}

async function readOmrFingerprint(imageUrl){
  if(!imageUrl)throw new Error('필적 확인란을 사진에서 찾지 못했어요.');
  let firstError=null;
  try{
    const text=await readOmrKoreanLine(imageUrl);
    const ranked=rankOmrFingerprints(text);
    if(ranked[0]&&ranked[0].score>=16&&ranked[0].score-(ranked[1]?ranked[1].score:0)>=5)return text;
  }catch(error){firstError=error;}
  try{return await readOmrFingerprintTesseract(imageUrl);}
  catch(error){throw firstError||error;}
}
