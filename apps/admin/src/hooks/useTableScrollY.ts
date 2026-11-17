import { useEffect, useRef, useState, type RefObject } from 'react';

/** 表头 + 分页条默认预留高度 */
export const DEFAULT_TABLE_CHROME_RESERVE_PX = 104;

/**
 * 按表格容器实际高度计算 Ant Design Table 的 scroll.y，
 * 避免 flush 布局下固定 100vh 过高导致分页被裁切。
 */
export function useTableScrollY(
  reservePx: number = DEFAULT_TABLE_CHROME_RESERVE_PX,
  minY = 200,
): {
  wrapRef: RefObject<HTMLDivElement | null>;
  scrollY: number;
} {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scrollY, setScrollY] = useState(Math.max(minY, 360));

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;

    const update = () => {
      setScrollY(Math.max(minY, el.clientHeight - reservePx));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [minY, reservePx]);

  return { wrapRef, scrollY };
}
