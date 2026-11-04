import React, { useEffect, useRef, useState } from 'react';
import { RotateCcw, RotateCw, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';

interface Props {
  src: string;
  alt: string;
  onError?: () => void;
  /** Position and size of the frame (default: fills its parent). */
  className?: string;
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 6;
const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

/**
 * Photo of a label that can be turned a quarter at a time and zoomed (wheel,
 * buttons, double click), then moved by dragging. Remount it (key) for
 * another photo to start straight and unzoomed.
 */
export const ZoomableImage: React.FC<Props> = ({ src, alt, onError, className = 'relative h-full w-full' }) => {
  const box = useRef<HTMLDivElement>(null);
  const img = useRef<HTMLImageElement>(null);
  const [rotation, setRotation] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  // Turned a quarter: the image is shrunk so that it still fits the frame
  const [fit, setFit] = useState(1);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  const quarter = rotation % 180 !== 0;
  useEffect(() => {
    const b = box.current?.getBoundingClientRect();
    const i = img.current;
    if (!b || !i || !i.offsetWidth || !i.offsetHeight) return;
    setFit(quarter ? Math.min(1, b.width / i.offsetHeight, b.height / i.offsetWidth) : 1);
  }, [quarter]);

  const reset = () => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  };
  const zoomBy = (factor: number) =>
    setZoom((z) => {
      const next = clampZoom(z * factor);
      if (next === 1) setOffset({ x: 0, y: 0 });
      return next;
    });
  const rotate = (deg: number) => {
    setRotation((r) => (r + deg + 360) % 360);
    reset();
  };

  // Wheel zoom without scrolling the page (React wheel listeners are passive)
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomBy(e.deltaY < 0 ? 1.2 : 1 / 1.2);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const button =
    'rounded-lg p-1.5 text-white transition hover:bg-white/20 disabled:opacity-30';

  return (
    <div
      ref={box}
      className={`flex items-center justify-center overflow-hidden ${zoom > 1 ? 'cursor-grab active:cursor-grabbing' : 'cursor-zoom-in'} ${className}`}
      onDoubleClick={() => (zoom > 1 ? reset() : setZoom(2.5))}
      onPointerDown={(e) => {
        if (zoom <= 1) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (d) setOffset({ x: d.ox + e.clientX - d.x, y: d.oy + e.clientY - d.y });
      }}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
    >
      <img
        ref={img}
        src={src}
        alt={alt}
        onError={onError}
        draggable={false}
        style={{
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom * fit}) rotate(${rotation}deg)`,
          transition: drag.current ? 'none' : 'transform 120ms ease-out',
        }}
        className="max-h-full max-w-full select-none object-contain"
      />
      <div
        className="absolute right-3 top-3 flex items-center gap-0.5 rounded-xl bg-black/60 p-1"
        onPointerDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" onClick={() => rotate(-90)} title="Tourner à gauche" className={button}>
          <RotateCcw className="h-4 w-4" />
        </button>
        <button type="button" onClick={() => rotate(90)} title="Tourner à droite" className={button}>
          <RotateCw className="h-4 w-4" />
        </button>
        <span className="mx-0.5 h-4 w-px bg-white/30" />
        <button type="button" onClick={() => zoomBy(1 / 1.5)} disabled={zoom <= MIN_ZOOM} title="Dézoomer" className={button}>
          <ZoomOut className="h-4 w-4" />
        </button>
        <span className="w-9 text-center text-[11px] font-semibold text-white">{Math.round(zoom * 100)}%</span>
        <button type="button" onClick={() => zoomBy(1.5)} disabled={zoom >= MAX_ZOOM} title="Zoomer (molette, double-clic)" className={button}>
          <ZoomIn className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => {
            reset();
            setRotation(0);
          }}
          disabled={zoom === 1 && rotation === 0}
          title="Taille et sens d'origine"
          className={button}
        >
          <Maximize2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
};
