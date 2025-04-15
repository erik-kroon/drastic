import {
  createContext,
  useContext,
  useRef,
  useMemo,
  type HTMLAttributes,
  type PropsWithChildren,
} from "react"
import {
  motion,
  useScroll,
  useTransform,
  type MotionValue,
  type UseScrollOptions,
} from "motion/react"

import { cn } from "src/lib/utils"

interface StackingCardsProps
  extends PropsWithChildren,
    HTMLAttributes<HTMLDivElement> {
  scrollOptons?: UseScrollOptions
  scaleMultiplier?: number
  totalCards: number
}

interface StackingCardItemProps
  extends HTMLAttributes<HTMLDivElement>,
    PropsWithChildren {
  index: number
  topPosition?: string
}

interface StackingCardsContextType {
  progress: MotionValue<number>
  scaleMultiplier?: number
  totalCards?: number
}

const StackingCardsContext = createContext<StackingCardsContextType | null>(null)

export default function StackingCards({
  children,
  className,
  scrollOptons,
  scaleMultiplier,
  totalCards,
  ...props
}: StackingCardsProps) {
  const targetRef = useRef<HTMLDivElement>(null)
  const { scrollYProgress } = useScroll({
    offset: ["start start", "end end"],
    ...scrollOptons,
    target: targetRef,
  })

  const contextValue = useMemo(
    () => ({ progress: scrollYProgress, scaleMultiplier, totalCards }),
    [scrollYProgress, scaleMultiplier, totalCards]
  )

  return (
    <StackingCardsContext.Provider value={contextValue}>
      <div className={cn(className)} ref={targetRef} {...props}>
        {children}
      </div>
    </StackingCardsContext.Provider>
  )
}

const StackingCardItem = ({
  index,
  topPosition,
  className,
  children,
  ...props
}: StackingCardItemProps) => {
  const context = useContext(StackingCardsContext)
  if (!context) {
    throw new Error("StackingCardItem must be used within StackingCards")
  }
  const { progress, scaleMultiplier, totalCards = 0 } = context
  const scaleTo = 1 - (totalCards - index) * (scaleMultiplier ?? 0.03)
  const rangeScale = [index * (1 / totalCards), 1]
  const scale = useTransform(progress, rangeScale, [1, scaleTo])
  const top = topPosition ?? `${5 + index * 3}%`

  return (
    <div className={cn("h-full sticky top-0", className)} {...props}>
      <motion.div
        className={"origin-top relative h-full"}
        style={{ top, scale }}
      >
        {children}
      </motion.div>
    </div>
  )
}

export { StackingCardItem }
