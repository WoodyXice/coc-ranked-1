import { useLayoutEffect, useMemo, useRef } from "react";
import { buildPopulationLayer } from "./atlas-population.mjs";

export default function AtlasPopulation({ players, anchors, width, height, hitRef }) {
  const canvasRef = useRef(null);
  const layer = useMemo(() => buildPopulationLayer(players, anchors, width, height), [players, anchors, width, height]);
  useLayoutEffect(() => {
    hitRef.current = layer.hitTest;
    const canvas = canvasRef.current;
    function paint() {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const ratio = Math.min(window.devicePixelRatio || 1, 3);
      canvas.width = Math.max(1, Math.round(rect.width * ratio));
      canvas.height = Math.max(1, Math.round(rect.height * ratio));
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);
      for (const known of [false, true]) {
        ctx.fillStyle = known ? "#3f859bc2" : "#859ba5ae";
        ctx.beginPath();
        for (const point of layer.points) {
          if (point.known !== known) continue;
          ctx.moveTo(point.x + layer.radius, point.y);
          ctx.arc(point.x, point.y, layer.radius, 0, Math.PI * 2);
        }
        ctx.fill();
      }
    }
    paint();
    const observer = new ResizeObserver(paint);
    observer.observe(canvas);
    window.addEventListener("resize", paint);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", paint);
      hitRef.current = null;
    };
  }, [layer, width, height, hitRef]);
  return <foreignObject width={width} height={height} pointerEvents="none" aria-hidden="true" data-population-count={layer.points.length}>
    <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block", pointerEvents: "none" }} />
  </foreignObject>;
}
