'use client'

import { useEffect, useRef, useState } from 'react'

interface HandTrackPrediction {
  label: string
  score: number | string 
  bbox: [number, number, number, number] // [x, y, width, height]
  [key: string]: unknown 
}

interface HandTrackModel {
  detect: (video: HTMLVideoElement) => Promise<HandTrackPrediction[]>
  renderPredictions: (
    predictions: HandTrackPrediction[],
    canvas: HTMLCanvasElement,
    ctx: CanvasRenderingContext2D,
    video: HTMLVideoElement
  ) => void;
}

interface HandTrackAPI {
  startVideo: (video: HTMLVideoElement) => Promise<boolean>
  load: (params: unknown) => Promise<HandTrackModel>
}

declare global {
  interface Window {
    handTrack?: HandTrackAPI
  }
}

export default function HandTrackDemo() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawCanvasRef = useRef<HTMLCanvasElement>(null)

  const [model, setModel] = useState<HandTrackModel | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [color, setColor] = useState('#ff0000')
  const [lastX, setLastX] = useState(0)
  const [lastY, setLastY] = useState(0)
  const [handTrackLoaded, setHandTrackLoaded] = useState(false)
  const [cameraStatus, setCameraStatus] = useState('Not started')
  const [detectionLog, setDetectionLog] = useState<string[]>([])

  const MODEL_PARAMS = {
    flipHorizontal: true,
    maxNumBoxes: 5,
    iouThreshold: 0.5,
    scoreThreshold: 0.2, // Lowered from 0.3 for better detection
  }

  // Add log function
  const addLog = (message: string) => {
    setDetectionLog(prev => [...prev.slice(-9), `${new Date().toLocaleTimeString()}: ${message}`])
  }

  // Load HandTrack script manually
  useEffect(() => {
    if (typeof window !== 'undefined' && !window.handTrack) {
      const script = document.createElement('script')
      script.src = 'https://cdn.jsdelivr.net/npm/handtrackjs/dist/handtrack.min.js'
      script.onload = () => {
        setHandTrackLoaded(true)
        addLog('HandTrack.js loaded successfully')
      }
      script.onerror = () => {
        setError('Failed to load HandTrack.js')
        addLog('Failed to load HandTrack.js')
      }
      document.head.appendChild(script)
    } else if (window.handTrack) {
      setHandTrackLoaded(true)
      addLog('HandTrack.js already loaded')
    }
  }, [])

  // ──────────────────────── 1.webcam & load model ─────────────────────────────
  const start = async () => {
    if (!videoRef.current) {
      setError('Video element not found')
      addLog('Error: Video element not found')
      return
    }

    const ht = window.handTrack
    if (!ht) {
      setError('HandTrack.js not loaded')
      addLog('Error: HandTrack.js not loaded')
      return
    }

    try {
      setIsLoading(true)
      setError(null)
      setCameraStatus('Starting...')
      addLog('Starting camera...')

      const okay = await ht.startVideo(videoRef.current)
      addLog(`Camera start result: ${okay}`)
      
      if (!okay) {
        setError('Camera denied or not found')
        setCameraStatus('Failed')
        addLog('Camera access denied or not found')
        return
      }

      setCameraStatus('Camera started')
      addLog('Camera started successfully')

      // Wait a bit for video to initialize
      await new Promise(resolve => setTimeout(resolve, 1000))

      if (!model) {
        addLog('Loading HandTrack model...')
        const loaded = await ht.load(MODEL_PARAMS)
        setModel(loaded)
        addLog('HandTrack model loaded successfully')
        setCameraStatus('Ready')
      }
    } catch (err) {
      console.error('Initialization error:', err)
      const errorMsg = `Failed to initialize: ${err instanceof Error ? err.message : 'Unknown error'}`
      setError(errorMsg)
      addLog(`Error: ${errorMsg}`)
      setCameraStatus('Failed')
    } finally {
      setIsLoading(false)
    }
  }

  // Manual camera restart function
  const restartCamera = async () => {
    const video = videoRef.current
    if (!video) return

    try {
      addLog('Restarting camera...')
      setCameraStatus('Restarting...')
      
      // Stop existing stream
      const stream = video.srcObject as MediaStream | null
      if (stream) {
        stream.getTracks().forEach(track => track.stop())
      }

      // Request new camera access
      const newStream = await navigator.mediaDevices.getUserMedia({ 
        video: { 
          width: { ideal: 640 }, 
          height: { ideal: 480 } 
        } 
      })
      
      video.srcObject = newStream
      video.play()
      
      setCameraStatus('Camera restarted')
      addLog('Camera restarted successfully')
    } catch (err) {
      console.error('Camera restart failed:', err)
      setError('Failed to restart camera')
      setCameraStatus('Failed')
      addLog('Camera restart failed')
    }
  }

  // ───────── Drawing helper ───────── 
  const resetStroke = () => { 
    setLastX(0)
    setLastY(0)
  }
  
  const rndColor = () => '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0')

  /* ──────────────────  Run Detection loop ─────────────────────── */
  useEffect(() => {
    if (!model || !videoRef.current || !canvasRef.current || !drawCanvasRef.current) return

    const video = videoRef.current
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const drawC = drawCanvasRef.current
    const drawctx = drawC.getContext('2d')
    if (!ctx || !drawctx) return

    addLog('Starting detection loop')

    let lastGesture = 'none'

    const updateCanvasSize = () => {
      if (video.videoWidth && video.videoHeight) {
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        addLog(`Canvas size: ${video.videoWidth}x${video.videoHeight}`)
      }
      const { width, height } = drawC.getBoundingClientRect()
      drawC.width = width
      drawC.height = height
      addLog(`Draw canvas size: ${width}x${height}`)
    }

    video.addEventListener('loadedmetadata', updateCanvasSize)
    updateCanvasSize() 

    let detectionCount = 0
    const timer = setInterval(async () => {
      try {
        if (video.videoWidth === 0 || video.videoHeight === 0) return
        if (video.paused || video.ended) return

        const predictions = (await model.detect(video))
        detectionCount++

        // Log ALL predictions to see what's being detected
        if (predictions.length > 0) {
          addLog(`Raw predictions: ${predictions.map(p => `${p.label}(${typeof p.score === 'number' ? p.score.toFixed(2) : p.score})`).join(', ')}`)
        }

        // Filter out pinch but keep everything else
        const filtered = predictions.filter(p => p.label !== 'pinch')

        // Log every 10th detection to avoid spam
        if (detectionCount % 10 === 0) {
          addLog(`Filtered predictions: ${filtered.map(p => `${p.label}(${typeof p.score === 'number' ? p.score.toFixed(2) : p.score})`).join(', ') || 'none'}`)
        }

        // Use all filtered predictions instead of just the best one
        let best: HandTrackPrediction | undefined
        for (const p of filtered) {
          const sc = typeof p.score === 'number' ? p.score : parseFloat(p.score)
          if (!best || sc > (typeof best.score === 'number' ? best.score : +best.score)) {
            best = p
          }
        }
        const finalPredictions = best ? [best] : []

        // Clear and render predictions
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        if (finalPredictions.length > 0) {
          model.renderPredictions(finalPredictions, canvas, ctx, video)
        }
 
        /*──────────────────  gesture mapping on the drawing canvas ──────────────────  */

        const point = finalPredictions.find(p => p.label === 'point')
        const open = finalPredictions.find(p => p.label === 'open')
        const closed = finalPredictions.find(p => p.label === 'closed')
        const face = finalPredictions.find(p => p.label === 'face')

        let currentGesture = 'none'
        if (face) currentGesture = 'face'
        if (open) currentGesture = 'open'
        if (closed) currentGesture = 'closed'
        if (point) currentGesture = 'point'

        // Log gesture changes
        if (currentGesture !== lastGesture) {
          addLog(`Gesture changed: ${lastGesture} → ${currentGesture}`)
          lastGesture = currentGesture
        }

        if (face) {
          // Only log occasionally to avoid spam
          if (detectionCount % 20 === 0) {
            addLog('Face detected')
          }
        }

        if (open) {
          drawctx.clearRect(0, 0, drawC.width, drawC.height)
          resetStroke()
          addLog('Open hand - clearing canvas')
        } else if (closed) {
          const newColor = rndColor()
          setColor(newColor)
          resetStroke()
          addLog(`Closed fist - changing color to ${newColor}`)
        } else if (point) {
          const [x, y, w, h] = point.bbox
          const cx = (x + w / 2) / video.videoWidth
          const cy = (y + h / 2) / video.videoHeight
          const dx = cx * drawC.width
          const dy = cy * drawC.height

          drawctx.strokeStyle = color
          drawctx.lineWidth = 4
          drawctx.lineCap = 'round'

          if (!lastX && !lastY) {
            setLastX(dx)
            setLastY(dy)
          } else {
            drawctx.beginPath()
            drawctx.moveTo(lastX, lastY)
            drawctx.lineTo(dx, dy)
            drawctx.stroke()

            setLastX(dx)
            setLastY(dy)
          }
          
          // Log occasionally
          if (detectionCount % 20 === 0) {
            addLog(`Drawing at (${dx.toFixed(0)}, ${dy.toFixed(0)})`)
          }
        } else {
          resetStroke()
        }
      } catch (err) {
        console.error('Detection error:', err)
        addLog(`Detection error: ${err instanceof Error ? err.message : 'Unknown error'}`)
        
        // If there's an error, try to restart the detection
        if (err instanceof Error && err.message.includes('canvas')) {
          addLog('Canvas error detected - attempting to recover')
          // Don't break the loop, just skip this iteration
          return
        }
      }
    }, 150)
    
    return () => {
      clearInterval(timer)
      const stream = video.srcObject as MediaStream | null
      if (stream) {
        stream.getTracks().forEach(t => t.stop())
      }
      video.removeEventListener('loadedmetadata', updateCanvasSize)
      addLog('Detection loop stopped')
    }
  }, [model, color, lastX, lastY])

  return (
    <div className="flex h-screen">
      {/* Drawing Canvas */}
      <div className="relative w-1/2 bg-gray-100">
        <canvas 
          ref={drawCanvasRef} 
          className="absolute inset-0 w-full h-full border-2 border-gray-300" 
        />
        <div className="absolute bottom-4 left-4 text-sm text-gray-600 bg-white px-2 py-1 rounded">
          Current Color: <span style={{color: color}}>●</span>
        </div>
        <div className="absolute top-4 left-4 text-sm text-gray-600 bg-white px-2 py-1 rounded">
          Point: Draw | Open: Clear | Closed: Change Color
        </div>
        
        {/* Tips for better detection */}
        <div className="absolute bottom-16 left-4 text-sm text-gray-600 bg-white px-2 py-1 rounded max-w-xs">
          <div className="font-bold">Tips:</div>
          <div>• Hold hand 1-2 feet from camera</div>
          <div>• Ensure good lighting</div>
          <div>• Make clear, distinct gestures</div>
          <div>• Point finger should be extended</div>
        </div>
        
        {/* Debug log */}
        <div className="absolute bottom-4 right-4 w-80 max-h-40 overflow-y-auto bg-black bg-opacity-80 text-green-400 text-xs p-2 rounded font-mono">
          <div className="font-bold mb-1">Debug Log:</div>
          {detectionLog.map((log, i) => (
            <div key={i}>{log}</div>
          ))}
        </div>
      </div>

      {/* Video Feed */}
      <div className="relative w-1/2 bg-black">
        {error && (
          <div className="absolute top-4 left-4 z-10 bg-red-500 text-white px-4 py-2 rounded max-w-xs">
            {error}
            <button 
              onClick={restartCamera}
              className="ml-2 px-2 py-1 bg-red-700 hover:bg-red-600 rounded text-xs"
            >
              Restart Camera
            </button>
          </div>
        )}
        
        {isLoading && (
          <div className="absolute top-4 right-4 z-10 bg-blue-500 text-white px-4 py-2 rounded">
            Loading...
          </div>
        )}

        {/* Status indicators */}
        <div className="absolute top-16 right-4 z-10 bg-black bg-opacity-70 text-white px-3 py-2 rounded text-sm">
          <div>HandTrack: {handTrackLoaded ? '✅' : '❌'}</div>
          <div>Camera: {cameraStatus}</div>
          <div>Model: {model ? '✅' : '❌'}</div>
        </div>

        {/* Camera controls */}
        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-10 bg-black bg-opacity-50 text-white px-4 py-2 rounded">
          <button 
            onClick={start}
            disabled={isLoading || !handTrackLoaded}
            className="mr-2 px-3 py-1 bg-green-600 hover:bg-green-500 disabled:bg-gray-600 rounded text-sm"
          >
            {isLoading ? 'Starting...' : 'Start Camera'}
          </button>
          <button 
            onClick={restartCamera}
            className="px-3 py-1 bg-blue-600 hover:bg-blue-500 rounded text-sm"
          >
            Restart Camera
          </button>
        </div>

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
    </div>
  )
}