/* app/page.tsx (Next.js 13 "app" router) */
'use client'

import { useEffect, useRef, useState } from 'react'
import Script from 'next/script'

// Define types for HandTrack.js (keeping it flexible since the actual structure may vary)
interface HandTrackPrediction {
  label: string
  score: number | string // HandTrack.js might return string or number
  bbox: [number, number, number, number] // [x, y, width, height]
  [key: string]: unknown // Allow other properties
}

interface HandTrackModel {
  detect: (video: HTMLVideoElement) => Promise<HandTrackPrediction[]>
  renderPredictions: (
    predictions: HandTrackPrediction[],
    canvas: HTMLCanvasElement,
    ctx: CanvasRenderingContext2D,
    video: HTMLVideoElement
  ) => void
}

interface HandTrackAPI {
  startVideo: (video: HTMLVideoElement) => Promise<boolean>
  load: (params: unknown) => Promise<HandTrackModel>
}

// Extend Window interface to include handTrack
declare global {
  interface Window {
    handTrack?: HandTrackAPI
  }
}

export default function HandTrackDemo() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const [model, setModel] = useState<HandTrackModel | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const MODEL_PARAMS = {
    flipHorizontal: true,
    maxNumBoxes: 5,
    iouThreshold: 0.5,
    scoreThreshold: 0.05,
  }
// ──────────────────────── 1.webcam & load model ─────────────────────────────
  const start = async () => {
    if (!videoRef.current) {
      setError('Video element not found')
      return
    }

    const ht = window.handTrack
    if (!ht) {
      setError('HandTrack.js not loaded')
      return
    }

    try {
      setIsLoading(true)
      setError(null)

      const okay = await ht.startVideo(videoRef.current)
      if (!okay) {
        setError('Camera denied or not found')
        return
      }

      if (!model) {
        const loaded = await ht.load(MODEL_PARAMS)
        setModel(loaded)
        console.log('HandTrack model ready ✅')
      }
    } catch (err) {
      setError(`Failed to initialize: ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    if (!model || !videoRef.current || !canvasRef.current) return

    const video = videoRef.current
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const updateCanvasSize = () => {
      if (video.videoWidth && video.videoHeight) {
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
      }
    }

    video.addEventListener('loadedmetadata', updateCanvasSize)
    updateCanvasSize() 

    const timer = setInterval(async () => {
      try {
        if (video.videoWidth === 0 || video.videoHeight === 0) return

        const predictions = await model.detect(video)
        let best: HandTrackPrediction | undefined

      for (const p of predictions) {
      const sc = typeof p.score === 'number' ? p.score : parseFloat(p.score)
      if (!best || sc > (typeof best.score === 'number' ? best.score : +best.score)) {
      best = p
      }
      }

      const filtered = best ? [best] : []

        ctx.clearRect(0, 0, canvas.width, canvas.height)
        model.renderPredictions(filtered, canvas, ctx, video)

        if (predictions.length > 0) {
          console.log('Predictions:')
          console.table(
            predictions.map((p: HandTrackPrediction) => ({
              label: p.label,
              score: typeof p.score === 'number' ? p.score.toFixed(2) : p.score,
              bbox: p.bbox,
            }))
          )
        } else {
          console.log('No hand detected 🌑')
        }
      } catch (err) {
        console.error('Detection error:', err)
      }
    }, 150)

    return () => {
      clearInterval(timer)
      const stream = video.srcObject as MediaStream | null;
     if (stream) {
     stream.getTracks().forEach(t => t.stop());
     }
      video.removeEventListener('loadedmetadata', updateCanvasSize)
    }
  }, [model])

  return (
    <>
      <Script
        src="https://cdn.jsdelivr.net/npm/handtrackjs/dist/handtrack.min.js"
        strategy="afterInteractive"
        onLoad={start}
        onError={() => setError('Failed to load HandTrack.js')}
      />

      <div className="flex h-screen">
        <div className="relative w-1/2 bg-black">
          {error && (
            <div className="absolute top-4 left-4 z-10 bg-red-500 text-white px-4 py-2 rounded">
              {error}
            </div>
          )}
          
          {isLoading && (
            <div className="absolute top-4 right-4 z-10 bg-blue-500 text-white px-4 py-2 rounded">
              Loading...
            </div>
          )}

          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            className="absolute inset-0 h-full w-full object-cover"
          />
          <canvas
            ref={canvasRef}
            className="absolute inset-0 h-full w-full pointer-events-none"
          />
        </div>

        <div className="flex w-1/2 items-center justify-center bg-white">
          <h2 className="text-xl">Drawing Area</h2>
        </div>
      </div>
    </>
  )
}