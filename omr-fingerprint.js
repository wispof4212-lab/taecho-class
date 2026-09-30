/* Korean handwriting phrase recognition. Only the cropped phrase is OCR'd in this browser. */
const OMR_FINGERPRINTS={
  'sep26-02':'밝고 맑게 살아가는 희망의 사람이 되게',
  'sep26-04':'희망은 삶을 견고하게 지탱해주는 동아줄',
  'sep26-05':'해맑은 밤바람이 이마에 나리는',
  'sep26-06':'초록의 잎새 사이로 얇게 비친 햇살',
  'sep26-08':'하나뿐인 삶에서 너라는 행운을 만나',
  'sep26-09':'꿈을 향한 열정은 그 무엇보다 뜨겁게 타오른다',
  'sep26-10':'어둠이 없으면 별의 반짝임도 없으리',
  'sep26-11':'젊은이여 그 길은 너의 것이다',
  'sep26-13':'행복하다 말하면 맑아지는 마음',
  'sep26-14':'물 먹는 소 목덜미에 할머니 손이 얹혀졌다',
  'sep26-15':'아침 이슬처럼 맑고 투명한 당신을',
  'sep26-16':'고요한 강물처럼 깊고 단단한 마음을 가질 것',
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
  return Object.entries(OMR_FINGERPRINTS).map(function([id,phrase]){
    const scores=tokens.map(function(token){return omrLocalAlignment(token,phrase);}).sort(function(a,b){return b-a;});
    return {id:id,phrase:phrase,score:(scores[0]||0)+(scores[1]||0)*0.35};
  }).sort(function(a,b){return b.score-a.score;});
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

async function readOmrFingerprint(imageUrl){
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
