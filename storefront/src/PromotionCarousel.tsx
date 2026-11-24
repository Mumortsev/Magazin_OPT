import {useEffect, useRef, useState} from 'react';
import {ArrowRight, ChevronLeft, ChevronRight, Pause, Play} from 'lucide-react';
import {collectionHref, collectionKeys, collections} from './collections';
import './promotions.css';

const rotationDelay = 6500;
const reducedMotionQuery = '(prefers-reduced-motion: reduce)';

export default function PromotionCarousel() {
  const track = useRef<HTMLDivElement>(null);
  const rotation = useRef<HTMLButtonElement>(null);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [visible, setVisible] = useState(false);
  const [pageVisible, setPageVisible] = useState(!document.hidden);
  const [reducedMotion, setReducedMotion] = useState(() => matchMedia(reducedMotionQuery).matches);

  useEffect(() => {
    const motion = matchMedia(reducedMotionQuery);
    const motionChanged = () => setReducedMotion(motion.matches);
    const visibilityChanged = () => setPageVisible(!document.hidden);
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.intersectionRatio >= 0.5), {threshold: 0.5});
    if (track.current) observer.observe(track.current);
    motion.addEventListener('change', motionChanged);
    document.addEventListener('visibilitychange', visibilityChanged);
    return () => {
      observer.disconnect();
      motion.removeEventListener('change', motionChanged);
      document.removeEventListener('visibilitychange', visibilityChanged);
    };
  }, []);

  useEffect(() => {
    if (paused || hovered || focused || !visible || !pageVisible || reducedMotion) return;
    const timer = window.setTimeout(() => {
      const element = track.current;
      const next = (index + 1) % collectionKeys.length;
      element?.scrollTo({left: next * element.clientWidth, behavior: next === 0 ? 'instant' : 'smooth'});
    }, rotationDelay);
    return () => window.clearTimeout(timer);
  }, [index, paused, hovered, focused, visible, pageVisible, reducedMotion]);

  function select(position: number) {
    const element = track.current;
    const next = (position + collectionKeys.length) % collectionKeys.length;
    element?.scrollTo({left: next * element.clientWidth, behavior: reducedMotion || Math.abs(next - index) > 1 ? 'instant' : 'smooth'});
  }

  return <section className="promotion-area" aria-label="Подборки магазина" aria-roledescription="карусель"
    onPointerEnter={event => { if (event.pointerType === 'mouse') setHovered(true); }}
    onPointerLeave={() => setHovered(false)}
    onFocus={event => setFocused(event.target !== rotation.current)}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}>
    <div className="container promotion">
      <h1 className="promotion-heading">Курортные товары оптом</h1>
      <div className="promotion-track" ref={track} onScroll={event => {
        const {scrollLeft, clientWidth} = event.currentTarget;
        if (clientWidth) setIndex(Math.min(collectionKeys.length - 1, Math.max(0, Math.round(scrollLeft / clientWidth))));
      }}>
        {collectionKeys.map((key, position) => {
          const {title, text, action} = collections[key];
          return <article key={key} className={`promotion-slide promotion-slide--${key}`} aria-hidden={position !== index}>
            <div className="promotion-copy">
              <h2>{title}</h2>
              <p>{text}</p>
              <a className="button" href={collectionHref(key)} tabIndex={position === index ? undefined : -1}>{action}<ArrowRight size={20}/></a>
            </div>
            <img className="promotion-image" src={`${import.meta.env.BASE_URL}images/promotions/${key}.webp`} alt=""
              fetchPriority={position === 0 ? 'high' : 'auto'} decoding="async" draggable={false}/>
          </article>;
        })}
      </div>
      <div className="promotion-controls">
        <button type="button" className="promotion-arrow" onClick={() => select(index - 1)} aria-label="Предыдущий баннер"><ChevronLeft size={22}/></button>
        <div className="promotion-dots" role="group" aria-label="Выбрать баннер">
          {collectionKeys.map((key, position) => <button key={key} type="button" onClick={() => select(position)}
            aria-label={collections[key].title} aria-current={position === index ? 'true' : undefined}><span/></button>)}
        </div>
        <button type="button" className="promotion-arrow" onClick={() => select(index + 1)} aria-label="Следующий баннер"><ChevronRight size={22}/></button>
        {!reducedMotion && <button ref={rotation} type="button" className="promotion-pause" onClick={() => setPaused(value => !value)}
          aria-label={paused ? 'Включить прокрутку баннеров' : 'Приостановить прокрутку баннеров'}>{paused ? <Play size={17}/> : <Pause size={17}/>}</button>}
      </div>
    </div>
  </section>;
}
