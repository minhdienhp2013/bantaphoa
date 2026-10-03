export interface LabelPaperConfig {
  id: string;
  name: string;
  labelWidthMm: number;
  labelHeightMm: number;
  columns: number;
  gapHorizontalMm: number;
  gapVerticalMm: number;
  marginMm: number;
}

export const LABEL_74X22_PRESET_ID = '74x22-2';
export const LABEL_74X22_PAGE_WIDTH_MM = 74;
export const LABEL_74X22_PAGE_HEIGHT_MM = 22;
export const LABEL_74X22_QR_MIN_MM = 12;
export const LABEL_74X22_QR_MAX_MM = 19;
export const LABEL_74X22_QR_DEFAULT_MM = 19;

export const LABEL_PRESETS: LabelPaperConfig[] = [
  {
    id: LABEL_74X22_PRESET_ID,
    name: 'Giấy 74 × 22 mm · 2 tem 35 × 22 mm',
    labelWidthMm: 35,
    labelHeightMm: 22,
    columns: 2,
    gapHorizontalMm: 0.1,
    gapVerticalMm: 0,
    marginMm: 1.95,
  },
  {
    id: '72x22-2',
    name: '72 × 22 mm · 2 nhãn/hàng',
    labelWidthMm: 72,
    labelHeightMm: 22,
    columns: 2,
    gapHorizontalMm: 2,
    gapVerticalMm: 2,
    marginMm: 0,
  },
  {
    id: '50x30-1',
    name: '50 × 30 mm · 1 nhãn/hàng',
    labelWidthMm: 50,
    labelHeightMm: 30,
    columns: 1,
    gapHorizontalMm: 0,
    gapVerticalMm: 2,
    marginMm: 0,
  },
];

export const DEFAULT_LABEL_CONFIG = LABEL_PRESETS[0];

export function is74x22RowPage(config: LabelPaperConfig): boolean {
  return config.id === LABEL_74X22_PRESET_ID;
}

export function getSheetWidthMm(config: LabelPaperConfig): number {
  return config.columns * config.labelWidthMm
    + Math.max(0, config.columns - 1) * config.gapHorizontalMm
    + config.marginMm * 2;
}

export function clamp74x22QrSizeMm(value: number): number {
  if (!Number.isFinite(value)) return LABEL_74X22_QR_DEFAULT_MM;
  return Math.max(LABEL_74X22_QR_MIN_MM, Math.min(LABEL_74X22_QR_MAX_MM, value));
}

export function validateLabelConfig(config: LabelPaperConfig): string[] {
  const errors: string[] = [];
  if (config.labelWidthMm <= 0) errors.push('Chiều rộng tem phải lớn hơn 0 mm.');
  if (config.labelHeightMm <= 0) errors.push('Chiều cao tem phải lớn hơn 0 mm.');
  if (!Number.isInteger(config.columns) || config.columns <= 0 || config.columns > 8) {
    errors.push('Số cột phải là số nguyên từ 1 đến 8.');
  }
  if (config.gapHorizontalMm < 0 || config.gapVerticalMm < 0) errors.push('Khoảng cách giữa tem không được âm.');
  if (config.marginMm < 0) errors.push('Lề giấy không được âm.');
  if (is74x22RowPage(config)) {
    const width = getSheetWidthMm(config);
    if (Math.abs(width - LABEL_74X22_PAGE_WIDTH_MM) > 0.001) {
      errors.push('Preset 74 × 22 phải có tổng chiều rộng đúng 74 mm.');
    }
    if (config.labelHeightMm !== LABEL_74X22_PAGE_HEIGHT_MM) {
      errors.push('Preset 74 × 22 phải có chiều cao đúng 22 mm.');
    }
  }
  return errors;
}
