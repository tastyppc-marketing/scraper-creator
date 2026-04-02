interface ScraperCreatorAPI {
  enableHighlighting: () => void;
  disableHighlighting: () => void;
  getElementInfo: (x: number, y: number) => any;
  getAllSelectors: (element: Element) => any;
  generateSelectors: (element: Element) => any;
  capturedClicks: any[];
  getCapturedClicks: () => any[];
  clearCapturedClicks: () => void;
  getCapturedInputs: () => any[];
  clearCapturedInputs: () => void;
  startRecording: () => void;
  stopRecording: () => void;
  isRecording: () => boolean;
}

declare global {
  interface Window {
    __scraperCreator?: ScraperCreatorAPI;
  }
}

export {};
