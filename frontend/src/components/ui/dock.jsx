'use client';

import {
  motion,
  useMotionValue,
  useSpring,
  useTransform,
  AnimatePresence,
} from 'framer-motion';
import {
  Children,
  cloneElement,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';

const DOCK_SIZE = 96;
const DEFAULT_MAGNIFICATION = 48;
const DEFAULT_DISTANCE = 110;
const DEFAULT_PANEL_SIZE = 48;

const DockContext = createContext(undefined);

function DockProvider({ children, value }) {
  return <DockContext.Provider value={value}>{children}</DockContext.Provider>;
}

function useDock() {
  const context = useContext(DockContext);
  if (!context) {
    throw new Error('useDock must be used within a DockProvider');
  }
  return context;
}

/**
 * Apple-style dock. Use orientation="vertical" for a left sidebar rail.
 */
function Dock({
  children,
  className,
  spring = { mass: 0.1, stiffness: 150, damping: 12 },
  magnification = DEFAULT_MAGNIFICATION,
  distance = DEFAULT_DISTANCE,
  panelHeight = DEFAULT_PANEL_SIZE,
  panelWidth = DEFAULT_PANEL_SIZE,
  orientation = 'horizontal',
}) {
  const isVertical = orientation === 'vertical';
  const mousePos = useMotionValue(Infinity);
  const isHovered = useMotionValue(0);

  const maxSize = useMemo(() => {
    return Math.max(DOCK_SIZE, magnification + magnification / 2 + 4);
  }, [magnification]);

  const panelBase = isVertical ? panelWidth : panelHeight;
  const sizeRow = useTransform(isHovered, [0, 1], [panelBase, maxSize]);
  const animatedSize = useSpring(sizeRow, spring);

  return (
    <motion.div
      style={
        isVertical
          ? { width: animatedSize, scrollbarWidth: 'none' }
          : { height: animatedSize, scrollbarWidth: 'none' }
      }
      className={cn(
        'flex max-h-full max-w-full overflow-visible',
        isVertical ? 'flex-row items-center' : 'flex-col items-end'
      )}
    >
      <motion.div
        onMouseMove={(e) => {
          isHovered.set(1);
          mousePos.set(isVertical ? e.pageY : e.pageX);
        }}
        onMouseLeave={() => {
          isHovered.set(0);
          mousePos.set(Infinity);
        }}
        className={cn(
          'mx-auto flex w-fit gap-2.5 overflow-visible rounded-2xl bg-white/90 px-2.5 py-2.5 shadow-[0_8px_32px_rgba(15,118,110,0.1)] ring-1 ring-[#EDEDF5] backdrop-blur-md dark:bg-neutral-900',
          isVertical ? 'flex-col items-center' : 'flex-row items-end',
          className
        )}
        style={isVertical ? { width: panelWidth } : { height: panelHeight }}
        role="toolbar"
        aria-label="Application dock"
      >
        <DockProvider
          value={{
            mousePos,
            spring,
            distance,
            magnification,
            orientation,
          }}
        >
          {children}
        </DockProvider>
      </motion.div>
    </motion.div>
  );
}

function DockItem({ children, className, onClick, active, style }) {
  const ref = useRef(null);
  const { distance, magnification, mousePos, spring, orientation } = useDock();
  const isVertical = orientation === 'vertical';
  const isHovered = useMotionValue(0);
  const [anchor, setAnchor] = useState(null);

  const updateAnchor = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    setAnchor({
      top: r.top + r.height / 2,
      left: r.right,
      bottom: r.top,
      centerX: r.left + r.width / 2,
    });
  };

  const mouseDistance = useTransform(mousePos, (val) => {
    const domRect = ref.current?.getBoundingClientRect() ?? {
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    };
    if (isVertical) {
      return val - domRect.y - domRect.height / 2;
    }
    return val - domRect.x - domRect.width / 2;
  });

  const sizeTransform = useTransform(
    mouseDistance,
    [-distance, 0, distance],
    [32, magnification, 32]
  );
  const size = useSpring(sizeTransform, spring);

  return (
    <motion.div
      ref={ref}
      style={{
        ...(isVertical ? { height: size, width: size } : { width: size }),
        ...style,
      }}
      onHoverStart={() => {
        isHovered.set(1);
        updateAnchor();
      }}
      onHoverEnd={() => {
        isHovered.set(0);
        setAnchor(null);
      }}
      onFocus={() => {
        isHovered.set(1);
        updateAnchor();
      }}
      onBlur={() => {
        isHovered.set(0);
        setAnchor(null);
      }}
      onClick={onClick}
      onKeyDown={(e) => {
        if (onClick && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onClick(e);
        }
      }}
      className={cn(
        'relative inline-flex aspect-square cursor-pointer items-center justify-center rounded-full transition-colors',
        active
          ? 'ring-2 ring-[#0F766E]/35'
          : 'bg-white/55 hover:bg-white/90',
        className
      )}
      tabIndex={0}
      role="button"
      aria-current={active ? 'page' : undefined}
      aria-haspopup="true"
    >
      {Children.map(children, (child) => {
        if (!child || typeof child !== 'object') return child;
        return cloneElement(child, { width: size, isHovered, anchor });
      })}
    </motion.div>
  );
}

function DockLabel({ children, className, ...rest }) {
  const { orientation } = useDock();
  const isVertical = orientation === 'vertical';
  const isHovered = rest.isHovered;
  const anchor = rest.anchor;
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (!isHovered?.on) return undefined;
    const unsubscribe = isHovered.on('change', (latest) => {
      setIsVisible(latest === 1);
    });
    return () => unsubscribe();
  }, [isHovered]);

  const label = (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0, ...(isVertical ? { x: -6 } : { y: 4 }) }}
          animate={{ opacity: 1, ...(isVertical ? { x: 0 } : { y: -10 }) }}
          exit={{ opacity: 0, ...(isVertical ? { x: -6 } : { y: 4 }) }}
          transition={{ duration: 0.16 }}
          className={cn(
            'pointer-events-none z-[9999] w-fit whitespace-nowrap rounded-lg bg-neutral-900 px-2.5 py-1 text-xs font-medium text-white shadow-lg',
            !isVertical && 'absolute left-1/2 top-0 -translate-x-1/2 -translate-y-full',
            className
          )}
          style={
            isVertical && anchor
              ? {
                  position: 'fixed',
                  top: anchor.top,
                  left: anchor.left + 12,
                  transform: 'translateY(-50%)',
                }
              : undefined
          }
          role="tooltip"
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );

  if (isVertical && typeof document !== 'undefined') {
    return createPortal(label, document.body);
  }

  return label;
}

function DockIcon({ children, className, ...rest }) {
  const width = rest.width;
  const widthTransform = useTransform(width, (val) => val * 0.42);

  return (
    <motion.div
      style={{ width: widthTransform, height: widthTransform }}
      className={cn('flex items-center justify-center', className)}
    >
      {children}
    </motion.div>
  );
}

export { Dock, DockIcon, DockItem, DockLabel };
