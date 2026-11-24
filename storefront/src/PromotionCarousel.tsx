import {useEffect, useRef, useState} from 'react';
import {ArrowRight} from 'lucide-react';
import {collectionHref, collectionKeys, collections} from './collections';
import {CarouselDots} from './ui';
import './promotions.css';

const rotationDelay = 6500;
const reducedMotionQuery = '(prefers-reduced-motion: reduce)';
const bannerLabels = collectionKeys.map(key => collections[key].title);

export default function PromotionCarousel() {
  const track = useRef<HTMLDivElement>(null);
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
    setPaused(true);
    const element = track.current;
    element?.scrollTo({left: position * element.clientWidth, behavior: reducedMotion || Math.abs(position - index) > 1 ? 'instant' : 'smooth'});
  }

  return <section className="promotion-area" aria-label="Подборки магазина" aria-roledescription="карусель"
    onPointerEnter={event => { if (event.pointerType === 'mouse') setHovered(true); }}
    onPointerLeave={() => setHovered(false)}
    onFocus={() => setFocused(true)}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}>
    <div className="container promotion">
      <h1 className="promotion-heading">Курортные товары оптом</h1>
      <div className="promotion-track" ref={track} onPointerDown={() => setPaused(true)} onScroll={event => {
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
      <CarouselDots label="Выбрать баннер" slides={bannerLabels} active={index} onSelect={select}/>
    </div>
  </section>;
}
