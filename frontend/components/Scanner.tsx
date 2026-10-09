"use client";
import { useEffect, useRef, useState } from "react";
type Detector = {
  detect: (source: HTMLVideoElement) => Promise<{ rawValue: string }[]>;
};
export default function Scanner({
  onRead,
}: {
  onRead: (ticket: string) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    const Constructor = (
      window as unknown as {
        BarcodeDetector?: new (options: { formats: string[] }) => Detector;
      }
    ).BarcodeDetector;
    if (!Constructor) {
      setError(
        "Camera scanning is unavailable in this browser. Paste the ticket code below.",
      );
      return;
    }
    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
        if (stopped) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        video.current!.srcObject = stream;
        await video.current!.play();
        const detector = new Constructor!({ formats: ["qr_code"] });
        async function scan() {
          if (stopped || !video.current) return;
          try {
            const result = await detector.detect(video.current);
            if (result[0]) {
              onRead(result[0].rawValue);
              return;
            }
          } catch {
            /* Camera can still be acquiring its first frame. */
          }
          timer = setTimeout(scan, 300);
        }
        await scan();
      } catch {
        setError(
          "Camera access was unavailable. You can paste the ticket code instead.",
        );
      }
    }
    void start();
    return () => {
      stopped = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onRead]);
  return (
    <div className="scanner">
      {error ? (
        <p role="status">{error}</p>
      ) : (
        <video ref={video} playsInline muted aria-label="QR ticket camera" />
      )}
    </div>
  );
}
