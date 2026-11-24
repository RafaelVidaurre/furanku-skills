import type { ImageCropInput } from "../contract/sources.ts"
import type { Sheet } from "./sheet.ts"

export interface ImagePresentation {
  readonly sheet?: Sheet
  readonly crop?: ImageCropInput
}

const MAX_PIXELS = 1 << 20

/** Image coordinates and dimensions in whole source pixels. */
export const isImageCrop = (value: unknown): value is ImageCropInput =>
  Array.isArray(value) && value.length === 4 &&
  [...value].every((n, i) => Number.isInteger(n) && n >= (i < 2 ? 0 : 1) && n <= MAX_PIXELS)

export const imagePresentation = ({ sheet, crop }: ImagePresentation): ImagePresentation => {
  if (sheet !== undefined) return { sheet }
  return crop === undefined ? {} : { crop }
}
