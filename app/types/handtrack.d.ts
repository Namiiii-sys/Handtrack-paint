declare namespace handTrack {
  export interface Prediction {
    label: "open" | "closed" | "point" | string;
    score: number;
    bbox: [number, number, number, number]; 
  }

  export interface ModelConfig {
    flipHorizontal?: boolean;
    maxNumBoxes?: number;
    iouThreshold?: number;
    scoreThreshold?: number;
  }

  export interface HandTrackModel {
    detect: (input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement) => Promise<Prediction[]>;
    renderPredictions: (
      predictions: Prediction[],
      canvas: HTMLCanvasElement,
      ctx: CanvasRenderingContext2D,
      scale: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement
    ) => void;
  }

  export function load(config?: ModelConfig): Promise<HandTrackModel>;
}
