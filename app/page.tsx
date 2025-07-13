'use client'

import { useEffect, useRef, useState, useCallback } from 'react'

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
  const drawCtxRef = useRef<CanvasRenderingContext2D | null>(null)
  const lastPointRef = useRef<{x: number, y: number} | null>(null)
  const detectionTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const gestureStateRef = useRef<{
    lastGesture: string;
    gestureStartTime: number;
    gestureConfidence: number;
  }>({ lastGesture: 'none', gestureStartTime: 0, gestureConfidence: 0 })

  const [model, setModel] = useState<HandTrackModel | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [color, setColor] = useState('#ff0000')
  const [handTrackLoaded, setHandTrackLoaded] = useState(false)
  const [cameraStatus, setCameraStatus] = useState('Not started')
  const [detectionRunning, setDetectionRunning] = useState(false)
  const [fps, setFps] = useState(0)
  const [isDrawing, setIsDrawing] = useState(false)

  const MODEL_PARAMS = {
    flipHorizontal: true,
    maxNumBoxes: 1, // Reduced to 1 for better performance
    iouThreshold: 0.6,
    scoreThreshold: 0.6, // Higher threshold for more stable detection
  }

  // Load HandTrack script
  useEffect(() => {
    if (typeof window !== 'undefined' && !window.handTrack) {
      const script = document.createElement('script')
      script.src = 'https://cdn.jsdelivr.net/npm/handtrackjs/dist/handtrack.min.js'
      script.onload = () => setHandTrackLoaded(true)
      script.onerror = () => setError('Failed to load HandTrack.js')
      document.head.appendChild(script)
    } else if (window.handTrack) {
      setHandTrackLoaded(true)
    }
    
    return () => {
      if (detectionTimeoutRef.current) {
        clearTimeout(detectionTimeoutRef.current)
      }
    }
  }, [])

  // Initialize drawing canvas
  useEffect(() => {
    if (drawCanvasRef.current) {
      const ctx = drawCanvasRef.current.getContext('2d')
      if (ctx) {
        drawCtxRef.current = ctx
        ctx.lineWidth = 8
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        ctx.strokeStyle = color
        ctx.fillStyle = color
        // Set canvas size
        drawCanvasRef.current.width = drawCanvasRef.current.offsetWidth
        drawCanvasRef.current.height = drawCanvasRef.current.offsetHeight
      }
    }
  }, [color])

  // Start camera and load model
  const start = useCallback(async () => {
    if (!videoRef.current) {
      setError('Video element not found')
      return
    }

    const video = videoRef.current
    const ht = window.handTrack
    if (!ht) {
      setError('HandTrack.js not loaded')
      return
    }

    try {
      setIsLoading(true)
      setError(null)
      setCameraStatus('Starting...')

      // Stop any existing stream
      if (video.srcObject) {
        const stream = video.srcObject as MediaStream
        stream.getTracks().forEach(track => track.stop())
        video.srcObject = null
      }

      const okay = await ht.startVideo(video)
      
      if (!okay) {
        setError('Camera denied or not found')
        setCameraStatus('Failed')
        return
      }

      setCameraStatus('Camera started')

      // Wait for video to be ready
      await new Promise<void>((resolve, reject) => {
        const onLoadedMetadata = () => {
          video.removeEventListener('loadedmetadata', onLoadedMetadata)
          resolve()
        }
        
        video.addEventListener('loadedmetadata', onLoadedMetadata)
        
        if (video.readyState >= 1) {
          resolve()
        }
        
        setTimeout(() => reject(new Error('Video timeout')), 5000)
      })

      if (!model) {
        setCameraStatus('Loading model...')
        const loaded = await ht.load(MODEL_PARAMS)
        setModel(loaded)
      }
      
      setCameraStatus('Ready')
      setDetectionRunning(true)
    } catch (err) {
      console.error('Initialization error:', err)
      setError(`Failed to initialize: ${err instanceof Error ? err.message : 'Unknown error'}`)
      setCameraStatus('Failed')
      setModel(null)
    } finally {
      setIsLoading(false)
    }
  }, [model])

  // Clear drawing canvas
  const clearCanvas = useCallback(() => {
    if (drawCanvasRef.current && drawCtxRef.current) {
      drawCtxRef.current.clearRect(0, 0, drawCanvasRef.current.width, drawCanvasRef.current.height)
    }
    lastPointRef.current = null
    setIsDrawing(false)
  }, [])

  // Change drawing color
  const changeColor = useCallback(() => {
    const colors = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff', '#ffffff', '#ffa500']
    const currentIndex = colors.indexOf(color)
    const nextColor = colors[(currentIndex + 1) % colors.length]
    setColor(nextColor)
    if (drawCtxRef.current) {
      drawCtxRef.current.strokeStyle = nextColor
      drawCtxRef.current.fillStyle = nextColor
    }
  }, [color])

  // Gesture detection with stability
  const processGesture = useCallback((predictions: HandTrackPrediction[]) => {
    const now = Date.now()
    const gestureState = gestureStateRef.current
    
    let currentGesture = 'none'
    let confidence = 0
    
    // Find the most confident gesture
    for (const prediction of predictions) {
      const score = typeof prediction.score === 'number' ? prediction.score : parseFloat(prediction.score as string)
      if (score > confidence) {
        confidence = score
        currentGesture = prediction.label
      }
    }
    
    // Require minimum confidence and consistency
    if (confidence < 0.7) {
      currentGesture = 'none'
    }
    
    // Gesture stability check
    if (currentGesture === gestureState.lastGesture) {
      gestureState.gestureConfidence = Math.min(gestureState.gestureConfidence + 0.1, 1.0)
    } else {
      gestureState.gestureConfidence = 0.1
      gestureState.lastGesture = currentGesture
      gestureState.gestureStartTime = now
    }
    
    // Only act on stable gestures
    if (gestureState.gestureConfidence > 0.5 && (now - gestureState.gestureStartTime) > 500) {
      if (currentGesture === 'open' && gestureState.lastGesture !== 'open_processed') {
        clearCanvas()
        gestureState.lastGesture = 'open_processed'
      } else if (currentGesture === 'closed' && gestureState.lastGesture !== 'closed_processed') {
        changeColor()
        gestureState.lastGesture = 'closed_processed'
      }
    }
  }, [clearCanvas, changeColor])

  // Draw line between two points
  const drawLine = useCallback((from: {x: number, y: number}, to: {x: number, y: number}) => {
    if (!drawCtxRef.current) return
    
    const ctx = drawCtxRef.current
    ctx.beginPath()
    ctx.moveTo(from.x, from.y)
    ctx.lineTo(to.x, to.y)
    ctx.stroke()
  }, [])

  // Main detection loop with better stability
  useEffect(() => {
    if (!model || !videoRef.current || !canvasRef.current || !detectionRunning) return

    const video = videoRef.current
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Update canvas sizes
    const updateCanvasSize = () => {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        
        // Update drawing canvas size to match video aspect ratio
        if (drawCanvasRef.current) {
          const container = drawCanvasRef.current.parentElement
          if (container) {
            const containerWidth = container.offsetWidth
            const containerHeight = container.offsetHeight
            const videoAspect = video.videoWidth / video.videoHeight
            const containerAspect = containerWidth / containerHeight
            
            if (videoAspect > containerAspect) {
              drawCanvasRef.current.width = containerWidth
              drawCanvasRef.current.height = containerWidth / videoAspect
            } else {
              drawCanvasRef.current.width = containerHeight * videoAspect
              drawCanvasRef.current.height = containerHeight
            }
          }
        }
      }
    }

    video.addEventListener('loadedmetadata', updateCanvasSize)
    updateCanvasSize()

    let frameCount = 0
    let lastFpsUpdate = Date.now()
    let isDetecting = false

    const updateFps = () => {
      const now = Date.now()
      if (now - lastFpsUpdate > 1000) {
        setFps(Math.round(frameCount * 1000 / (now - lastFpsUpdate)))
        frameCount = 0
        lastFpsUpdate = now
      }
    }

    const detect = async () => {
      if (isDetecting || video.paused || video.ended) return
      
      isDetecting = true
      
      try {
        const predictions = await model.detect(video)
        
        // Clear detection canvas (but NOT the drawing canvas)
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        
        // Render predictions on detection canvas
        if (predictions.length > 0) {
          model.renderPredictions(predictions, canvas, ctx, video)
        }

        // Process gestures
        processGesture(predictions)
        
        // Handle drawing for point gesture
        const pointPrediction = predictions.find(p => p.label === 'point')
        if (pointPrediction && drawCanvasRef.current) {
          const [x, y, w, h] = pointPrediction.bbox
          const cx = (x + w / 2) / video.videoWidth
          const cy = (y + h / 2) / video.videoHeight
          const dx = cx * drawCanvasRef.current.width
          const dy = cy * drawCanvasRef.current.height
          
          const currentPoint = { x: dx, y: dy }
          
          if (lastPointRef.current) {
            // Calculate distance to prevent jagged lines
            const distance = Math.sqrt(
              Math.pow(currentPoint.x - lastPointRef.current.x, 2) + 
              Math.pow(currentPoint.y - lastPointRef.current.y, 2)
            )
            
            // Only draw if movement is reasonable (not too big jumps)
            if (distance < 100 && distance > 2) {
              drawLine(lastPointRef.current, currentPoint)
            }
          }
          
          lastPointRef.current = currentPoint
          setIsDrawing(true)
        } else {
          lastPointRef.current = null
          setIsDrawing(false)
        }
        
        frameCount++
        updateFps()
      } catch (err) {
        console.error('Detection error:', err)
      } finally {
        isDetecting = false
      }
    }

    // Use recursive timeout instead of interval for better control
    const scheduleDetection = () => {
      if (detectionRunning) {
        detect().finally(() => {
          detectionTimeoutRef.current = setTimeout(scheduleDetection, 100) // 10fps
        })
      }
    }

    scheduleDetection()

    return () => {
      if (detectionTimeoutRef.current) {
        clearTimeout(detectionTimeoutRef.current)
      }
      video.removeEventListener('loadedmetadata', updateCanvasSize)
    }
  }, [model, detectionRunning, processGesture, drawLine])

  return (
    <div className="flex flex-col md:flex-row h-screen bg-gray-900 text-white">
      {/* Drawing Canvas */}
      <div className="relative w-full md:w-1/2 bg-gray-800">
        <div className="absolute inset-0 flex flex-col">
          <div className="p-4 bg-gray-900 bg-opacity-80 flex justify-between items-center">
            <div>
              <h1 className="text-xl font-bold">Hand Tracking Drawing</h1>
              <p className="text-sm text-gray-400">Point: Draw | Open Hand: Clear | Fist: Change Color</p>
            </div>
            <div className="flex items-center space-x-4">
              <div className="flex items-center">
                <span className="mr-2">Color:</span>
                <div 
                  className="w-8 h-8 rounded-full border-2 border-white" 
                  style={{ backgroundColor: color }}
                />
              </div>
              <div className="flex items-center">
                <span className="mr-2">Drawing:</span>
                <div className={`w-3 h-3 rounded-full ${isDrawing ? 'bg-green-500' : 'bg-gray-500'}`} />
              </div>
              <button 
                onClick={clearCanvas}
                className="px-3 py-1 bg-blue-600 hover:bg-blue-500 rounded text-sm"
              >
                Clear Canvas
              </button>
            </div>
          </div>
          <div className="flex-1 flex items-center justify-center">
            <canvas 
              ref={drawCanvasRef} 
              className="bg-gray-900 border border-gray-700 max-w-full max-h-full"
              style={{ width: '100%', height: '100%' }}
            />
          </div>
        </div>
      </div>

      {/* Video Feed */}
      <div className="relative w-full md:w-1/2 bg-black">
        {error && (
          <div className="absolute top-4 left-4 z-10 bg-red-500 text-white px-4 py-2 rounded max-w-xs">
            {error}
          </div>
        )}
        
        {isLoading && (
          <div className="absolute top-4 right-4 z-10 bg-blue-500 text-white px-4 py-2 rounded">
            Loading...
          </div>
        )}

        {/* Status indicators */}
        <div className="absolute top-4 right-4 z-10 bg-black bg-opacity-70 text-white px-3 py-2 rounded text-sm">
          <div className="flex items-center">
            <span className={`w-3 h-3 rounded-full mr-2 ${detectionRunning ? 'bg-green-500 animate-pulse' : 'bg-gray-500'}`}></span>
            <span>FPS: {fps}</span>
          </div>
          <div>Camera: {cameraStatus}</div>
          <div>Model: {model ? 'Loaded' : 'Not Loaded'}</div>
        </div>

        {/* Camera controls */}
        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-10">
          <button 
            onClick={start}
            disabled={isLoading || !handTrackLoaded}
            className="px-4 py-2 bg-green-600 hover:bg-green-500 disabled:bg-gray-600 rounded text-sm"
          >
            {isLoading ? 'Starting...' : 'Start Camera'}
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
        
        {/* Instructions */}
        <div className="absolute bottom-4 left-4 right-4 bg-black bg-opacity-70 text-white p-3 rounded text-sm">
          <h3 className="font-bold mb-1">How to use:</h3>
          
        </div>
      </div>
    </div>
  )
}