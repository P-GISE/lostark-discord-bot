import {
  ABIDOS_RECIPES,
  getAbidosProfession,
} from "./abidos.data";
import type {
  AbidosCalculationResult,
  AbidosInventory,
  AbidosProductTier,
  AbidosProfessionCode,
} from "./abidos.types";

function createInventory(input?: Partial<AbidosInventory>): AbidosInventory {
  return {
    A: Math.max(0, Math.floor(input?.A ?? 0)),
    B: Math.max(0, Math.floor(input?.B ?? 0)),
    C: Math.max(0, Math.floor(input?.C ?? 0)),
    P: Math.max(0, Math.floor(input?.P ?? 0)),
    S: Math.max(0, Math.floor(input?.S ?? 0)),
  };
}

function cloneInventory(inventory: AbidosInventory): AbidosInventory {
  return { ...inventory };
}

function getDirectCraftCount(
  inventory: AbidosInventory,
  recipe: (typeof ABIDOS_RECIPES)[AbidosProductTier],
): number {
  return Math.min(
    Math.floor(inventory.A / recipe.A),
    Math.floor(inventory.B / recipe.B),
    Math.floor(inventory.C / recipe.C),
  );
}

function consumeCrafts(
  inventory: AbidosInventory,
  recipe: (typeof ABIDOS_RECIPES)[AbidosProductTier],
  craftCount: number,
): void {
  if (craftCount <= 0) {
    return;
  }

  inventory.A -= craftCount * recipe.A;
  inventory.B -= craftCount * recipe.B;
  inventory.C -= craftCount * recipe.C;
}

function getConsumed(
  original: AbidosInventory,
  remaining: AbidosInventory,
): AbidosInventory {
  return {
    A: Math.max(0, original.A - remaining.A),
    B: Math.max(0, original.B - remaining.B),
    C: Math.max(0, original.C - remaining.C),
    P: Math.max(0, original.P - remaining.P),
    S: Math.max(0, original.S - remaining.S),
  };
}

export function calculateAbidosCraft(input: {
  professionCode: AbidosProfessionCode;
  productTier?: AbidosProductTier;
  inventory: Partial<AbidosInventory>;
}): AbidosCalculationResult {
  const profession = getAbidosProfession(input.professionCode);
  const recipe = ABIDOS_RECIPES[input.productTier ?? "normal"];
  const originalInventory = createInventory(input.inventory);
  const remaining = cloneInventory(originalInventory);
  let craftCount = 0;

  let rareToNormalCount = 0;
  let normalToPowderCount = 0;
  let highGradeToPowderCount = 0;
  let powderToAbyssCount = 0;

  if (remaining.S > 0) {
    rareToNormalCount = Math.floor(remaining.S / 5);
    remaining.S -= rareToNormalCount * 5;
    remaining.A += rareToNormalCount * 50;
  }

  const initialCraftCount = getDirectCraftCount(remaining, recipe);

  if (initialCraftCount > 0) {
    craftCount += initialCraftCount;
    consumeCrafts(remaining, recipe, initialCraftCount);
  }

  const normalThreshold = 100 + recipe.A;
  const highGradeThreshold = 50 + recipe.B;

  while (true) {
    if (remaining.A >= normalThreshold || remaining.B >= highGradeThreshold) {
      if (
        remaining.A >= normalThreshold &&
        remaining.A / 100 >= remaining.B / 50
      ) {
        remaining.A -= 100;
        remaining.P += 80;
        normalToPowderCount += 1;
      } else if (remaining.B >= highGradeThreshold) {
        remaining.B -= 50;
        remaining.P += 80;
        highGradeToPowderCount += 1;
      }
    }

    if (remaining.P >= 100) {
      const convertiblePowder = Math.floor(remaining.P / 100);
      remaining.P -= convertiblePowder * 100;
      remaining.C += convertiblePowder * 10;
      powderToAbyssCount += convertiblePowder;
    }

    const nextCraftCount = getDirectCraftCount(remaining, recipe);

    if (nextCraftCount >= 1) {
      craftCount += nextCraftCount;
      consumeCrafts(remaining, recipe, nextCraftCount);
      continue;
    }

    if (remaining.A < normalThreshold && remaining.B < highGradeThreshold) {
      break;
    }
  }

  return {
    profession,
    recipe,
    craftCount,
    totalOutput: craftCount * recipe.outputCount,
    conversions: {
      ...(rareToNormalCount > 0 ? { StoA: rareToNormalCount } : {}),
      ...(normalToPowderCount > 0 ? { AtoP: normalToPowderCount } : {}),
      ...(highGradeToPowderCount > 0 ? { BtoP: highGradeToPowderCount } : {}),
      ...(powderToAbyssCount > 0 ? { PtoC: powderToAbyssCount } : {}),
    },
    consumed: getConsumed(originalInventory, remaining),
    remaining,
  };
}
