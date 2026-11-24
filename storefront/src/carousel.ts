import {useCallback, useLayoutEffect, useRef, useState} from 'react';

export function carouselFrames(length:number) {
  const frames = Array.from({length}, (_, index) => ({index, clone:false}));
  if (length < 2) return frames;
  return [{index:length-1, clone:true}, ...frames, {index:0, clone:true}];
}

export function useLoopingCarousel(length:number) {
  const track = useRef<HTMLDivElement>(null);
  const current = useRef(0);
  const [active, setActive] = useState(0);

  useLayoutEffect(() => {
    const element = track.current;
    if (!element) return;
    current.current = Math.min(current.current, Math.max(0, length-1));
    setActive(current.current);
    if (length < 2) return;

    let width = element.clientWidth;
    let timeout: number | undefined;
    const goToOriginal = () => element.scrollTo({left:(current.current+1)*width, behavior:'instant'});
    const settle = () => {
      window.clearTimeout(timeout);
      if (width && (element.scrollLeft <= 1 || element.scrollLeft >= width*(length+1)-1)) goToOriginal();
    };
    const scroll = () => {
      if (!width || width !== element.clientWidth) return;
      const frame = Math.min(length+1, Math.max(0, Math.round(element.scrollLeft/width)));
      current.current = (frame+length-1)%length;
      setActive(current.current);
      window.clearTimeout(timeout);
      timeout = window.setTimeout(settle, 140);
    };
    const resize = new ResizeObserver(() => {
      if (width === element.clientWidth) return;
      width = element.clientWidth;
      goToOriginal();
    });

    goToOriginal();
    element.addEventListener('scroll', scroll, {passive:true});
    element.addEventListener('scrollend', settle);
    resize.observe(element);
    return () => {
      window.clearTimeout(timeout);
      resize.disconnect();
      element.removeEventListener('scroll', scroll);
      element.removeEventListener('scrollend', settle);
    };
  }, [length]);

  function select(index:number, behavior:ScrollBehavior) {
    const element = track.current;
    element?.scrollTo({left:(index+1)*element.clientWidth, behavior});
  }

  const advance = useCallback(() => {
    const element = track.current;
    element?.scrollTo({left:(current.current+2)*element.clientWidth, behavior:'smooth'});
  }, []);

  return {track, active, select, advance};
}
