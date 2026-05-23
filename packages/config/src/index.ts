import type { RiskBand } from '@sigma/shared';

export const PRICE_INDEX_CATEGORIES = ['храни', 'строителство'] as const;
export type PriceIndexCategory = (typeof PRICE_INDEX_CATEGORIES)[number];

// ── Sector classification (CPV division → sector) ──────────────────────────────────
//
// A contract's sector is its CPV *division* — the first 2 digits of the 8-digit CPV code. CPV
// (Common Procurement Vocabulary, Reg. (EC) No 213/2008) nests strictly left-to-right, so the
// 2-digit division IS a deterministic, catalog-grounded sector taxonomy — no name/keyword heuristics.
// Labels are the official Bulgarian CPV division names, as they appear in our `cpv_description` data
// and the TED catalog (https://ted.europa.eu/en/simap/cpv — machine-readable cpv_2008_xml, all langs).
//
// Coverage verified against the local corpus (May 2026): every one of the 45 divisions below is
// present, together covering 190,422 contracts / 50.8 bn EUR. The two `curated` divisions — 45
// Строителство and 15 Храни — are the featured sectors that also drive the price index
// (PRICE_INDEX_CATEGORIES). See docs/mock-coverage.md.

export interface CpvSector {
  /** 2-digit CPV division code. */
  code: string;
  /** Official Bulgarian CPV division label. */
  label: string;
  /** Short display name for featured sectors (falls back to `label`). */
  short?: string;
  /** Featured sector — also drives the price index. */
  curated?: boolean;
}

// Full CPV-division taxonomy (every division seen in the corpus), in code order. Label = the division
// header's official BG name (division 14 carries the official "minerals/metals" name; the corpus only
// happens to hold its salt subgroup 14400000).
export const CPV_SECTORS: readonly CpvSector[] = [
  { code: '03', label: 'Продукти на земеделието, животновъдството, рибарството, лесовъдството и свързани с тях продукти' },
  { code: '09', label: 'Нефтопродукти, горива, електричество и други енергоизточници' },
  { code: '14', label: 'Продукти на минното дело, основни метали и свързани с тях продукти' },
  { code: '15', label: 'Хранителни продукти, напитки, тютюн и свързани с него продукти', short: 'Храни', curated: true },
  { code: '16', label: 'Селскостопански машини' },
  { code: '18', label: 'Облекло, обувни изделия, пътни артикули и аксесоари' },
  { code: '19', label: 'Кожени и текстилни изделия, пластмасови и каучукови материали' },
  { code: '22', label: 'Печатни материали и свързани с тях продукти' },
  { code: '24', label: 'Химически продукти' },
  { code: '30', label: 'Компютърни и офис машини, оборудване и принадлежности, с изключение на мебели и софтуерни пакети' },
  { code: '31', label: 'Електрически машини, уреди, оборудване и консумативи; осветление' },
  { code: '32', label: 'Радио-, телевизионно, съобщително, далекосъобщително и сродни видове оборудване' },
  { code: '33', label: 'Медицинско оборудване, фармацевтични продукти и продукти за лични грижи' },
  { code: '34', label: 'Транспортно оборудване и помощни продукти за транспортиране' },
  { code: '35', label: 'Оборудване за безопасност, противопожарно, полицейско и отбранително оборудване' },
  { code: '37', label: 'Музикални инструменти, спортни артикули, игри, играчки, занаятчийски изделия, предмети на изкуството и принадлежности' },
  { code: '38', label: 'Лабораторно, оптично и прецизно оборудване (без стъклени изделия)' },
  { code: '39', label: 'Обзавеждане (включително офис обзавеждане), мебелировка, електродомакински уреди (с изключение на осветителни тела) и продукти за почистване' },
  { code: '41', label: 'Събрана и пречистена вода' },
  { code: '42', label: 'Машини за промишлена употреба' },
  { code: '43', label: 'Минни машини, оборудване за разработване на кариери и строително оборудване' },
  { code: '44', label: 'Строителни конструкции и материали; помощни строителни материали (без електрически апарати)' },
  { code: '45', label: 'Строителни и монтажни работи', short: 'Строителство', curated: true },
  { code: '48', label: 'Софтуерни пакети и информационни системи' },
  { code: '50', label: 'Услуги по ремонт и поддръжка' },
  { code: '51', label: 'Услуги по инсталиране (с изключение на софтуер)' },
  { code: '55', label: 'Хотелиерски и ресторантьорски услуги и услуги в областта на търговията на дребно' },
  { code: '60', label: 'Транспортни услуги (с изключение на извозването на отпадъци)' },
  { code: '63', label: 'Спомагателни услуги в транспорта; услуги на туристически агенции' },
  { code: '64', label: 'Услуги на пощата и далекосъобщенията' },
  { code: '65', label: 'Обществени услуги' },
  { code: '66', label: 'Финансови и застрахователни услуги' },
  { code: '70', label: 'Услуги, свързани с недвижими имоти' },
  { code: '71', label: 'Архитектурни, строителни, инженерни и инспекционни услуги' },
  { code: '72', label: 'ИТ услуги: консултации, разработване на софтуер, Интернет и поддръжка' },
  { code: '73', label: 'Научни изследвания и експериментални разработки и свързаните с тях консултантски услуги' },
  { code: '75', label: 'Услуги на държавното управление за обществото като цяло' },
  { code: '76', label: 'Услуги, свързани с добива на нефт и газ' },
  { code: '77', label: 'Услуги, свързани със селското и горското стопанство, овощарството, аквакултурите и пчеларството' },
  { code: '79', label: 'Бизнес услуги: право, маркетинг, консултиране, набиране на персонал, печат и охрана' },
  { code: '80', label: 'Образователни и учебно-тренировъчни услуги' },
  { code: '85', label: 'Услуги на здравеопазването и социалните дейности' },
  { code: '90', label: 'Услуги, свързани с отпадъчните води, битовите отпадъци, чистотата и околната среда' },
  { code: '92', label: 'Услуги в областта на културата, спорта и развлеченията' },
  { code: '98', label: 'Други обществени, социални и персонални услуги' },
];

const CPV_SECTOR_BY_CODE = new Map<string, CpvSector>(CPV_SECTORS.map((s) => [s.code, s]));

/** Map an 8-digit CPV code to its sector (CPV division), or null if missing/unknown. Deterministic. */
export function sectorForCpv(cpvCode: string | null | undefined): CpvSector | null {
  if (!cpvCode) return null;
  return CPV_SECTOR_BY_CODE.get(cpvCode.replace(/\D/g, '').slice(0, 2)) ?? null;
}

/** The featured sectors (45 Строителство, 15 Храни) — these also drive the price index. */
export const CURATED_SECTORS: readonly CpvSector[] = CPV_SECTORS.filter((s) => s.curated);

export interface RiskWeights {
  spec: number;
  price: number;
  competition: number;
  cartel: number;
  process: number;
}

// Weights sum to 1.0 so a fully-saturated tender scores exactly 100.
export const DEFAULT_RISK_WEIGHTS: RiskWeights = {
  spec: 0.25,
  price: 0.25,
  competition: 0.2,
  cartel: 0.2,
  process: 0.1,
};

export const RISK_BAND_LABELS: Record<RiskBand, string> = {
  low: 'Нисък',
  medium: 'Среден',
  high: 'Висок',
  critical: 'Критичен',
};

export function requireEnv(env: Record<string, unknown>, key: string): string {
  const value = env[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}
