'use client'
import React from 'react'
import { useEffect , useRef, useState } from 'react'
import Script from 'next/script'

const Page = () => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const liveCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const [model, setmodel] = useState<handTrack.HandTrackModel | null>(null);

  /* ------------  useEffect #1: start webcam  ------------ */
  useEffect(() => {
    navigator.mediaDevices.getUserMedia({ video: true })
    .then((stream: MediaStream) => {
      if (videoRef.current){
        videoRef.current.srcObject = stream;
      }
    })
    .catch((err) => {
      console.error('Error Accessing webcam:',err);
    
    });
  }, []);

  /* ------------  useEffect #2: run detection  ------------ */
  useEffect(() => {
    if (!model) return;
    const video = videoRef.current;
    const liveCanvas = liveCanvasRef.current;
    if(!video || !liveCanvas) return;

    const ctx = liveCanvas.getContext('2d')!;
    liveCanvas.width = video.videoWidth;
    liveCanvas.height = video.videoHeight;

    const interval = setInterval(async () => {
      const predictions = await model.detect(video);
      ctx.clearRect(0,0, liveCanvas.width , liveCanvas.height);
      model.renderPredictions(predictions, liveCanvas, ctx, video);

      if (predictions.length === 0) {
   console.log('No hand detected 🌑');
   } else {
   console.table(predictions.map(p => ({
    label: p.label,
    score: p.score.toFixed(2)
  })));
}
    }, 100);

    return () => clearInterval(interval);
  }, [model])

  return (
    <>
    <Script
    src="https://cdn.jsdelivr.net/npm/handtrackjs/dist/handtrack.min.js"
    strategy='afterInteractive'
    onLoad={async () => {
      const params: handTrack.ModelConfig = {
        flipHorizontal: true,
        maxNumBoxes: 5,
        iouThreshold: 0.5,
        scoreThreshold: 0.4,
      };
      const loadedModel = await handTrack.load(params);
      setmodel(loadedModel);
      console.log('HandTrack model ready');
    }}/>

 
    <div className='flex h-[100vh] w-full'>
    

    <div className='flex w-1/2 relative bg-black'>
      <video
      ref={videoRef}
      autoPlay
      muted
      className='absolute top-0 left-0 w-full h-full object-cover'
      />
      <canvas
      ref={liveCanvasRef}
      className='absolute top-0 left-0 w-full h-full pointer-events-none'/>
    </div>
    <div className=' bg-white w-1/2'>
      <h2 className='text-center mt-20'>
        Drawing Area
      </h2>
    </div>
    </div>
    </>
  )
}

export default Page