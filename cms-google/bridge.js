(() => {
  'use strict';
  const rpc = (action, payload) => new Promise((resolve, reject) => {
    let timer;
    const fail = error => {clearTimeout(timer);reject(error);};
    if (['session','posts','post','media','site-status'].includes(action)) timer = setTimeout(() => fail(new Error('Google 응답을 20초 동안 받지 못했습니다. 진단 코드: CMS-RPC-'+action)),20000);
    try {
    if(!window.google || !google.script || !google.script.run)throw new Error('Google 연결 도구를 불러오지 못했습니다. 진단 코드: CMS-RPC-MISSING');
    google.script.run.withSuccessHandler(result => {
      clearTimeout(timer);
      if (!result || !result.ok) reject(new Error(result?.error || '구글 연결을 확인해 주세요.'));
      else resolve(result.value);
    }).withFailureHandler(() => fail(new Error('구글 요청을 완료하지 못했습니다. 진단 코드: CMS-RPC-FAILED-'+action))).cmsRequest(action, payload);
    } catch(error) {fail(error);}
  });
  const base64 = blob => new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = () => reject(new Error('파일을 읽지 못했습니다.')); reader.readAsDataURL(blob);
  });
  const jpeg = (element, width, height, edge, quality) => new Promise((resolve, reject) => {
    const ratio = Math.min(1, edge / Math.max(width, height));
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1,Math.round(width*ratio));canvas.height=Math.max(1,Math.round(height*ratio));
    canvas.getContext('2d').drawImage(element,0,0,canvas.width,canvas.height);
    canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('사진을 변환하지 못했습니다.')),'image/jpeg',quality);
  });
  async function prepare(file,kind) {
    if(file.size>25*1024*1024)throw new Error('온라인 업로드는 파일당 25MB까지입니다. 큰 영상은 유튜브 링크를 사용해 주세요.');
    const source=URL.createObjectURL(file);
    try {
      if(kind==='image') {
        const img=new Image();img.src=source;await img.decode();
        if(img.naturalWidth*img.naturalHeight>40000000)throw new Error('사진 크기를 줄여 주세요.');
        const image=await jpeg(img,img.naturalWidth,img.naturalHeight,2200,0.84);
        const thumbnail=await jpeg(img,img.naturalWidth,img.naturalHeight,480,0.65);
        return {kind,base64:await base64(image),thumbnail:await base64(thumbnail)};
      }
      if(!/\.mp4$/i.test(file.name)&&file.type!=='video/mp4')throw new Error('온라인 영상은 MP4 파일 또는 유튜브 링크를 사용해 주세요.');
      const video=document.createElement('video');video.muted=true;video.playsInline=true;video.preload='auto';video.src=source;
      await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('영상 미리보기를 읽지 못했습니다. MP4/H.264 파일 또는 유튜브 링크를 사용해 주세요.')),15000);video.onloadeddata=()=>{clearTimeout(timer);resolve();};video.onerror=()=>{clearTimeout(timer);reject(new Error('이 브라우저에서 재생할 수 없는 영상입니다. MP4/H.264로 변환해 주세요.'));};});
      const thumbnail=await jpeg(video,video.videoWidth,video.videoHeight,480,0.7);video.removeAttribute('src');video.load();
      return {kind,base64:await base64(file),thumbnail:await base64(thumbnail)};
    } finally {URL.revokeObjectURL(source);}
  }
  window.PLIE_CMS_TRANSPORT = {
    google:true,
    async call(path,body,csrf){const [action,id]=path.split('/');return rpc(action,Object.assign({},body||{},id?{id}:{},{csrf:csrf||''}));},
    async upload(file,kind,csrf){const payload=await prepare(file,kind);return rpc('upload',Object.assign(payload,{csrf}));}
  };
})();
