export interface PlumeSimData {
  fields: { alkalinity: number[][]; aragonite_saturation: number[][] }
  coordinates: { x: number[]; y: number[]; z: number[] }
}

export class PlumeThreeLayer {
  readonly id = 'plume-three-layer'
  readonly type = 'custom' as const

  constructor(_: null) {}
  onAdd(_map: unknown, _gl: WebGLRenderingContext): void {}
  render(_gl: WebGLRenderingContext, _matrix: number[]): void {}
  updateData(_: PlumeSimData): void {}
  setDepthLevel(_: number): void {}
}
