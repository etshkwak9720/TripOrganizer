// Kakao Maps ships no type definitions, and the SDK is attached to window by
// the <script> tag in index.html rather than imported. Declared in one place so
// PlacePicker and LiveMap don't each grow their own partial shape.
declare global {
  interface Window {
    kakao: any;
  }
}

export {};
