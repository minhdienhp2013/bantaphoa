import { useEffect, useRef, useState } from 'react';

type ProductNameMarqueeProps = {
  name: string;
  continuous?: boolean;
};

export default function ProductNameMarquee({ name, continuous = false }: ProductNameMarqueeProps) {
  const viewportRef = useRef<HTMLElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [overflowing, setOverflowing] = useState(false);

  useEffect(() => {
    const viewport = viewportRef.current;
    const text = textRef.current;
    if (!viewport || !text) return undefined;

    const measure = () => {
      const textWidth = Math.ceil(text.scrollWidth);
      const overflow = Math.max(0, textWidth - viewport.clientWidth);
      viewport.style.setProperty('--sales-product-name-shift', `${overflow}px`);
      viewport.style.setProperty('--sales-product-name-loop-shift', `${textWidth + 28}px`);
      setOverflowing(overflow > 4);
    };

    measure();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }

    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    observer.observe(text);
    return () => observer.disconnect();
  }, [name]);

  return (
    <strong
      ref={viewportRef}
      className={`sales-product-name-marquee${overflowing ? ' is-overflowing' : ''}${continuous ? ' is-continuous' : ''}`}
      title={name}
    >
      {continuous ? (
        <span className="sales-product-name-marquee__track">
          <span ref={textRef}>{name}</span>
          <span aria-hidden="true">{name}</span>
        </span>
      ) : (
        <span ref={textRef}>{name}</span>
      )}
    </strong>
  );
}
