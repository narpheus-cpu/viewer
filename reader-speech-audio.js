/* Local PCM playback with native pitch-preserving time stretching. */
(function(){
'use strict';
function wav(samples,sampleRate){
  const pcm=samples instanceof Float32Array?samples:new Float32Array(samples);
  const bytes=new ArrayBuffer(44+pcm.length*2),view=new DataView(bytes);
  const text=(offset,value)=>{for(let i=0;i<value.length;i++)view.setUint8(offset+i,value.charCodeAt(i));};
  text(0,'RIFF');view.setUint32(4,36+pcm.length*2,true);text(8,'WAVE');text(12,'fmt ');
  view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);
  view.setUint32(24,sampleRate,true);view.setUint32(28,sampleRate*2,true);
  view.setUint16(32,2,true);view.setUint16(34,16,true);text(36,'data');view.setUint32(40,pcm.length*2,true);
  for(let i=0;i<pcm.length;i++){
    const value=Math.max(-1,Math.min(1,pcm[i]));view.setInt16(44+i*2,Math.round(value*(value<0?32768:32767)),true);
  }
  return new Blob([bytes],{type:'audio/wav'});
}
class ReaderSpeechAudio{
  constructor(context){
    this.context=context;this.speed=1;this.active=null;this.clips=new Set();this.unlocking=null;
    this.players=Array.from({length:2},()=>{
      const media=document.createElement('audio');media.preload='auto';media.crossOrigin='anonymous';
      media.setAttribute('playsinline','');media.setAttribute('aria-hidden','true');media.hidden=true;
      if(!['preservesPitch','webkitPreservesPitch','mozPreservesPitch'].some(key=>key in media))
        throw Error('이 브라우저에서는 음높이를 유지하는 낭독을 지원하지 않습니다. 브라우저를 업데이트해 주세요.');
      for(const key of ['preservesPitch','webkitPreservesPitch','mozPreservesPitch'])if(key in media)media[key]=true;
      document.body.append(media);
      const output=context.createMediaElementSource(media);output.connect(context.destination);
      return{media,output,clip:null};
    });
  }
  unlock(){
    if(this.unlocking)return this.unlocking;
    const url=URL.createObjectURL(wav(new Float32Array(1600),16000));
    // Both reusable elements are primed by the actual Listen/Resume gesture.
    const plays=this.players.map(({media})=>{media.src=url;media.load();return media.play();});
    this.unlocking=Promise.all(plays).then(()=>{
      for(const{media}of this.players){media.pause();media.removeAttribute('src');media.load();}
    }).catch(error=>{this.unlocking=null;throw error;}).finally(()=>URL.revokeObjectURL(url));
    return this.unlocking;
  }
  setSpeed(value){
    this.speed=value;
    for(const{media}of this.players){media.defaultPlaybackRate=value;media.playbackRate=value;}
  }
  prepare(audio){
    const slot=this.players.find(player=>!player.clip);
    if(!slot)throw Error('낭독 재생 대기 한도를 초과했습니다.');
    const url=URL.createObjectURL(wav(audio.samples,audio.sampleRate));
    const clip={slot,media:slot.media,url,duration:audio.samples.byteLength/4/audio.sampleRate,finish:null,
      stop:()=>slot.media.pause()};
    slot.clip=clip;this.clips.add(clip);slot.media.src=url;slot.media.load();
    slot.media.defaultPlaybackRate=this.speed;slot.media.playbackRate=this.speed;
    return clip;
  }
  play(clip,paused=false){
    this.active=clip;
    return new Promise((resolve,reject)=>{
      const{media}=clip;
      const finish=error=>{
        if(!clip.finish)return;
        clip.finish=null;media.onended=null;media.onerror=null;
        if(this.active===clip)this.active=null;
        this.release(clip);error?reject(error):resolve();
      };
      clip.finish=finish;
      media.onended=()=>{if(media.currentSrc===clip.url&&media.ended)finish();};
      media.onerror=()=>{if(media.currentSrc===clip.url&&media.error)finish(Error('낭독 음성을 재생할 수 없습니다. '+media.error.message));};
      if(!paused)media.play().catch(error=>{
        if(clip.finish&&this.active===clip&&!(error.name==='AbortError'&&media.paused))finish(error);
      });
    });
  }
  pause(){this.active?.media.pause();}
  async resume(){if(this.active)await this.active.media.play();}
  release(clip){
    if(!this.clips.delete(clip))return;
    const{slot,media}=clip;
    if(slot.clip===clip){media.pause();media.removeAttribute('src');media.load();slot.clip=null;}
    URL.revokeObjectURL(clip.url);
  }
  stop(){
    for(const clip of [...this.clips]){
      if(clip.finish)clip.finish();else this.release(clip);
    }
    this.active=null;
  }
}
window.ReaderSpeechAudio=ReaderSpeechAudio;
})();
