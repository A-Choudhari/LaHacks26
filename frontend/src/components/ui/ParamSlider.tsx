import { motion } from 'framer-motion'
import * as SliderPrimitive from '@radix-ui/react-slider'

interface ParamSliderProps {
  label: string
  value: number
  min: number
  max: number
  step: number
  unit: string
  onChange: (v: number) => void
}

export function ParamSlider({ label, value, min, max, step, unit, onChange }: ParamSliderProps) {
  return (
    <div className="param-item">
      <div className="param-row">
        <span className="param-label">{label}</span>
        <motion.span
          key={value}
          className="param-value"
          initial={{ scale: 1.18, opacity: 0.55 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 520, damping: 22 }}
        >
          {value}<span className="param-unit">{unit}</span>
        </motion.span>
      </div>
      <SliderPrimitive.Root
        className="slider-root"
        min={min} max={max} step={step} value={[value]}
        onValueChange={([v]) => onChange(v)}
      >
        <SliderPrimitive.Track className="slider-track">
          <SliderPrimitive.Range className="slider-range" />
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb className="slider-thumb" aria-label={label} />
      </SliderPrimitive.Root>
    </div>
  )
}
