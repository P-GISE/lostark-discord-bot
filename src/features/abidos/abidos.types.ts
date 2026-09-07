export type AbidosProfessionCode = "HR" | "FS" | "AR" | "CL" | "WL" | "MN";
export type AbidosProductTier = "normal" | "advanced";
export type AbidosResourceKey = "A" | "B" | "C" | "P" | "S";

export interface AbidosResourceInfo {
  name: string;
}

export interface AbidosProfession {
  code: AbidosProfessionCode;
  name: string;
  resources: {
    A: AbidosResourceInfo;
    B: AbidosResourceInfo;
    C: AbidosResourceInfo;
    P: AbidosResourceInfo;
    S?: AbidosResourceInfo;
  };
}

export interface AbidosRecipe {
  productName: string;
  outputCount: number;
  A: number;
  B: number;
  C: number;
}

export interface AbidosInventory {
  A: number;
  B: number;
  C: number;
  P: number;
  S: number;
}

export interface AbidosConversionRate {
  from: AbidosResourceKey;
  to: AbidosResourceKey;
  input: number;
  output: number;
}

export interface AbidosCalculationResult {
  profession: AbidosProfession;
  recipe: AbidosRecipe;
  craftCount: number;
  totalOutput: number;
  conversions: Partial<Record<AbidosConversionKey, number>>;
  consumed: AbidosInventory;
  remaining: AbidosInventory;
}

export type AbidosConversionKey =
  | "StoA"
  | "BtoA"
  | "AtoP"
  | "BtoP"
  | "PtoB"
  | "PtoA"
  | "PtoC";
