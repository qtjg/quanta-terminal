/* QUANTA themes — token-based palettes shared by the terminal and the palette.
   Adding a theme = add one entry here; every UI surface picks it up. */

export interface Theme {
  bg: string; panel: string; text: string; dim: string;
  accent: string; err: string; ok: string; warn: string; sel: string;
}

export const THEMES: Record<string, Theme> = {
  /* "carbon" (was "tokyo") — renamed: QUANTA is a standalone terminal, no Tokyo branding */
  carbon: { bg: "#0D0F12", panel: "#151A21", text: "#E6EAF2", dim: "#8E95A5", accent: "#FF5722", err: "#FF5370", ok: "#4AF6C3", warn: "#FFCB6B", sel: "#233043" },
  matrix: { bg: "#030A03", panel: "#061206", text: "#B7FFC6", dim: "#3D7A4A", accent: "#00FF41", err: "#FF4B4B", ok: "#00FF41", warn: "#B0FF00", sel: "#0B2A0B" },
  amber:  { bg: "#100A02", panel: "#1A1206", text: "#FFC88A", dim: "#8A6A3A", accent: "#FFAA00", err: "#FF6B4A", ok: "#FFD75E", warn: "#FFE08A", sel: "#2A1E08" },
  ocean:  { bg: "#04121F", panel: "#082036", text: "#C8E6FF", dim: "#5B7E9E", accent: "#40C4FF", err: "#FF5370", ok: "#69F0AE", warn: "#FFD740", sel: "#0E2C47" },
  light:  { bg: "#F4F1EA", panel: "#E9E4D8", text: "#26221B", dim: "#7A7264", accent: "#C64300", err: "#C62828", ok: "#1B7A4A", warn: "#A15C00", sel: "#DDD5C4" },
};

export const THEME_NAMES = Object.keys(THEMES);
