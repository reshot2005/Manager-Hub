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
import { cn } from '@/lib/utils';

const DOCK_SIZE = 128;
const DEFAULT_MAGNIFICATION = 72;
const DEFAULT_DISTANCE = 140;
const DEFAULT_PANEL_SIZE = 64;

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
        'flex max-h-full max-w-full',
        isVertical ? 'flex-row items-center overflow-y-auto' : 'flex-col items-end overflow-x-auto'
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
          'mx-auto flex w-fit gap-3 rounded-2xl bg-white/90 px-3 py-3 shadow-[0_8px_32px_rgba(99,70,255,0.12)] ring-1 ring-[#EDEDF5] backdrop-blur-md dark:bg-neutral-900',
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
    [40, magnification, 40]
  );
  const size = useSpring(sizeTransform, spring);

  return (
    <motion.div
      ref={ref}
      style={{
        ...(isVertical ? { height: size, width: size } : { width: size }),
        ...style,
      }}
      onHoverStart={() => isHovered.set(1)}
      onHoverEnd={() => isHovered.set(0)}
      onFocus={() => isHovered.set(1)}
      onBlur={() => isHovered.set(0)}
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
          ? 'ring-2 ring-[#6c4dff]/35'
          : 'bg-gray-100/90 hover:bg-gray-200',
        className
      )}
      tabIndex={0}
      role="button"
      aria-current={active ? 'page' : undefined}
      aria-haspopup="true"
    >
      {Children.map(children, (child) => {
        if (!child || typeof child !== 'object') return child;
        return cloneElement(child, { width: size, isHovered });
      })}
    </motion.div>
  );
}

function DockLabel({ children, className, ...rest }) {
  const { orientation } = useDock();
  const isVertical = orientation === 'vertical';
  const isHovered = rest.isHovered;
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (!isHovered?.on) return undefined;
    const unsubscribe = isHovered.on('change', (latest) => {
      setIsVisible(latest === 1);
    });
    return () => unsubscribe();
  }, [isHovered]);

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0, ...(isVertical ? { x: -4 } : { y: 0 }) }}
          animate={{ opacity: 1, ...(isVertical ? { x: 8 } : { y: -10 }) }}
          exit={{ opacity: 0, ...(isVertical ? { x: -4 } : { y: 0 }) }}
          transition={{ duration: 0.18 }}
          className={cn(
            'pointer-events-none absolute z-50 w-fit whitespace-pre rounded-md border border-gray-200 bg-white px-2 py-0.5 text-xs font-medium text-neutral-700 shadow-sm dark:border-neutral-800 dark:bg-neutral-800 dark:text-white',
            isVertical
              ? 'left-full top-1/2 -translate-y-1/2'
              : 'left-1/2 top-0 -translate-x-1/2 -translate-y-full',
            className
          )}
          role="tooltip"
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function DockIcon({ children, className, ...rest }) {
  const width = rest.width;
  const widthTransform = useTransform(width, (val) => val / 2);

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
