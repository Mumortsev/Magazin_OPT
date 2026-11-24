import {useEffect, useState} from 'react';
import {ArrowRight} from 'lucide-react';
import {collectionHref, collectionKeys, collections} from './collections';
import {CarouselDots} from './ui';
import {carouselFrames, useLoopingCarousel} from './carousel';
import './promotions.css';

const rotationDelay = 6500;
const reducedMotionQuery = '(prefers-reduced-motion: reduce)';
const bannerLabels = collectionKeys.map(key => collections[key].title);
const bannerFrames = carouselFrames(collectionKeys.length);

export default function PromotionCarousel() {
  const {track, active, select, advance} = useLoopingCarousel(collectionKeys.length);
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
  }, [track]);

  useEffect(() => {
    if (paused || hovered || focused || !visible || !pageVisible || reducedMotion) return;
    const timer = window.setTimeout(advance, rotationDelay);
    return () => window.clearTimeout(timer);
  }, [active, advance, paused, hovered, focused, visible, pageVisible, reducedMotion]);

  function choose(position: number) {
    setPaused(true);
    select(position, reducedMotion || Math.abs(position-active)>1 ? 'instant' : 'smooth');
  }

  return <section className="promotion-area" aria-label="Подборки магазина" aria-roledescription="карусель"
    onPointerEnter={event => { if (event.pointerType === 'mouse') setHovered(true); }}
    onPointerLeave={() => setHovered(false)}
    onFocus={() => setFocused(true)}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}>
    <div className="container promotion">
      <h1 className="promotion-heading">Курортные товары оптом</h1>
      <div className="promotion-track" ref={track} onPointerDown={() => setPaused(true)}>
        {bannerFrames.map(({index, clone}, frame) => {
          const key = collectionKeys[index];
          const {title, text, action} = collections[key];
          return <article key={frame} className={`promotion-slide promotion-slide--${key}`} aria-hidden={clone || active!==index}>
            <div className="promotion-copy">
              <h2>{title}</h2>
              <p>{text}</p>
              <a className="button" href={collectionHref(key)} tabIndex={!clone && active===index ? undefined : -1}>{action}<ArrowRight size={20}/></a>
            </div>
            <img className="promotion-image" src={`${import.meta.env.BASE_URL}images/promotions/${key}.webp`} alt=""
              fetchPriority={!clone && index===0 ? 'high' : 'auto'} decoding="async" draggable={false}/>
          </article>;
        })}
      </div>
      <CarouselDots label="Выбрать баннер" slides={bannerLabels} active={active} onSelect={choose}/>
    </div>
  </section>;
}
