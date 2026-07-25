"use client";

import { LiquidGlass, type LiquidGlassProps } from "@liquidglass/react";
import type { ReactNode } from "react";

type Props = Omit<LiquidGlassProps, "children"> & {
  children?: ReactNode;
  /** Stretch children instead of centering (LiquidGlass default). */
  fill?: boolean;
};

const defaults = {
  borderRadius: 18,
  blur: 0.45,
  contrast: 1.18,
  brightness: 1.06,
  saturation: 1.25,
  shadowIntensity: 0.22,
  displacementScale: 0.65,
  elasticity: 0.5,
  zIndex: 1,
} as const;

/** Cockpit wrapper around `@liquidglass/react` with safe stacking + layout. */
export function Glass({
  children,
  className,
  fill = true,
  borderRadius = defaults.borderRadius,
  blur = defaults.blur,
  contrast = defaults.contrast,
  brightness = defaults.brightness,
  saturation = defaults.saturation,
  shadowIntensity = defaults.shadowIntensity,
  displacementScale = defaults.displacementScale,
  elasticity = defaults.elasticity,
  zIndex = defaults.zIndex,
}: Props) {
  return (
    <LiquidGlass
      borderRadius={borderRadius}
      blur={blur}
      contrast={contrast}
      brightness={brightness}
      saturation={saturation}
      shadowIntensity={shadowIntensity}
      displacementScale={displacementScale}
      elasticity={elasticity}
      zIndex={zIndex}
      className={className}
    >
      {fill ? (
        <div className="lg-fill">{children}</div>
      ) : (
        children
      )}
    </LiquidGlass>
  );
}
