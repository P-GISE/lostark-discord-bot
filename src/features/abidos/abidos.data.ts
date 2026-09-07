import type {
  AbidosConversionKey,
  AbidosConversionRate,
  AbidosProductTier,
  AbidosProfession,
  AbidosProfessionCode,
  AbidosRecipe,
} from "./abidos.types";

export const ABIDOS_PROFESSIONS: AbidosProfession[] = [
  {
    code: "HR",
    name: "수렵",
    resources: {
      A: { name: "두툼한 생고기" },
      B: { name: "다듬은 생고기" },
      C: { name: "아비도스 두툼한 생고기" },
      P: { name: "수렵의 가루" },
    },
  },
  {
    code: "FS",
    name: "낚시",
    resources: {
      A: { name: "생선" },
      B: { name: "붉은 살 생선" },
      C: { name: "아비도스 태양 잉어" },
      P: { name: "낚시의 가루" },
    },
  },
  {
    code: "AR",
    name: "고고학",
    resources: {
      A: { name: "고대 유물" },
      B: { name: "희귀한 유물" },
      C: { name: "아비도스 유물" },
      P: { name: "고고학의 가루" },
    },
  },
  {
    code: "CL",
    name: "채집",
    resources: {
      A: { name: "들꽃" },
      B: { name: "수줍은 들꽃" },
      C: { name: "아비도스 들꽃" },
      P: { name: "채집의 가루" },
    },
  },
  {
    code: "WL",
    name: "벌목",
    resources: {
      A: { name: "목재" },
      B: { name: "부드러운 목재" },
      C: { name: "아비도스 목재" },
      P: { name: "벌목의 가루" },
      S: { name: "튼튼한 목재" },
    },
  },
  {
    code: "MN",
    name: "채광",
    resources: {
      A: { name: "철광석" },
      B: { name: "묵직한 철광석" },
      C: { name: "아비도스 철광석" },
      P: { name: "채광의 가루" },
      S: { name: "단단한 철광석" },
    },
  },
];

export const ABIDOS_PROFESSION_MAP = new Map(
  ABIDOS_PROFESSIONS.map((profession) => [profession.code, profession]),
);

export const ABIDOS_RECIPES: Record<AbidosProductTier, AbidosRecipe> = {
  normal: {
    productName: "아비도스 융화 재료",
    outputCount: 10,
    A: 86,
    B: 45,
    C: 33,
  },
  advanced: {
    productName: "고급 아비도스 융화 재료",
    outputCount: 10,
    A: 112,
    B: 59,
    C: 43,
  },
};

export const ABIDOS_CONVERSION_RATES: Record<
  AbidosConversionKey,
  AbidosConversionRate
> = {
  StoA: { from: "S", to: "A", input: 5, output: 50 },
  BtoA: { from: "B", to: "A", input: 25, output: 50 },
  AtoP: { from: "A", to: "P", input: 100, output: 80 },
  BtoP: { from: "B", to: "P", input: 50, output: 80 },
  PtoB: { from: "P", to: "B", input: 100, output: 50 },
  PtoA: { from: "P", to: "A", input: 100, output: 100 },
  PtoC: { from: "P", to: "C", input: 100, output: 10 },
};

export const ABIDOS_CONVERSION_ORDER: AbidosConversionKey[] = [
  "StoA",
  "BtoA",
  "AtoP",
  "BtoP",
  "PtoB",
  "PtoA",
  "PtoC",
];

export function getAbidosProfession(
  code: AbidosProfessionCode,
): AbidosProfession {
  const profession = ABIDOS_PROFESSION_MAP.get(code);

  if (!profession) {
    throw new Error(`Unknown Abidos profession: ${code}`);
  }

  return profession;
}
