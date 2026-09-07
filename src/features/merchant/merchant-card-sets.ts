import type { MerchantAlertMatch, MerchantListing, TrackedCardSet } from "./merchant.types";

const CARD_ALIASES: Record<string, string[]> = {
  "아제나&이난나": [
    "아제나,이난나",
    "아제나이난나",
    "이제나,이난나",
    "이제나이난나",
  ],
  "데런 아만": ["데런아만"],
  "국왕 실리안": ["국왕실리안"],
  "에스더 루테란": ["에스더루테란"],
  "에스더 갈라투르": ["에스더갈라투르"],
  "에스더 시엔": ["에스더시엔"],
  "총사령관 실리안": ["총사령관실리안"],
  "작전을 지휘하는 샨디": ["작전을지휘하는샨디"],
  "선택한 아만": ["선택한아만"],
  "부활하는 카제로스": ["부활하는카제로스"],
  "춤추는 쿠크세이튼": ["춤추는쿠크세이튼"],
  "교활한 카마인": ["교활한카마인"],
  "빛을 맞이하는 샨디&진저웨일": [
    "빛을맞이하는샨디&진저웨일",
    "빛을맞이하는샨디진저웨일",
  ],
  "빛을 맞이하는 카단": ["빛을맞이하는카단"],
  "빛을 맞이하는 실리안": ["빛을맞이하는실리안"],
  "빛을 맞이하는 바훈투르": ["빛을맞이하는바훈투르"],
  "빛을 맞이하는 아제나": ["빛을맞이하는아제나"],
  "레온하트 네리아": ["레온하트네리아"],
  "아이히만 박사": ["아이히만박사"],
};

export const DEFAULT_TRACKED_CARD_SETS: TrackedCardSet[] = [
  {
    name: "세구빛",
    cards: [
      "샨디",
      "아제나&이난나",
      "니나브",
      "카단",
      "바훈투르",
      "실리안",
      "웨이",
    ],
  },
  {
    name: "남바절",
    cards: [
      "아만",
      "세리아",
      "집행관 솔라스",
      "국왕 실리안",
      "카마인",
      "데런 아만",
    ],
  },
  {
    name: "토구빛-굳대숨",
    cards: [
      "가디언 루",
      "에버그레이스",
      "니나브",
      "심연의 방랑자",
      "각성한 진저웨일",
      "유적을 찾은 카단",
    ],
  },
  {
    name: "토구빛-잠대가",
    cards: [
      "진저웨일",
      "광기를 잃은 쿠크세이튼",
      "찢겨진 발탄",
      "피요르긴을 휘두르는 바훈투르",
      "모르페",
      "악몽의 헬카서스",
    ],
  },
  {
    name: "뇌구빛-뇌전숨",
    cards: [
      "발탄",
      "에키드나",
      "에스더 루테란",
      "악몽의 아브렐슈드",
      "라제니스를 이끄는 니나브",
      "절망의 카멘",
    ],
  },
  {
    name: "뇌구빛-몰뇌가",
    cards: [
      "데런 아만",
      "폭풍의 베히모스",
      "전장을 지배하는 아제나",
      "도철을 다루는 웨이",
      "칠흑의 숭배자 킬리네사",
      "타무트",
    ],
  },
  {
    name: "수구빛-거파숨",
    cards: [
      "카단",
      "아브렐슈드",
      "에스더 갈라투르",
      "총사령관 실리안",
      "작전을 지휘하는 샨디",
      "선택한 아만",
    ],
  },
  {
    name: "수구빛-노파가",
    cards: [
      "베아트리스",
      "아만",
      "부패의 일리아칸",
      "욕망의 비아키스",
      "렌",
      "세트",
    ],
  },
  {
    name: "화구빛-힘화숨",
    cards: [
      "샨디",
      "일리아칸",
      "에스더 시엔",
      "부활하는 카제로스",
      "춤추는 쿠크세이튼",
      "교활한 카마인",
    ],
  },
  {
    name: "화구빛-피화가",
    cards: [
      "국왕 실리안",
      "바르칸",
      "바실리오",
      "구스토",
      "아슈타로테",
      "악몽의 게헤나",
    ],
  },
  {
    name: "암구빛-카제군단장",
    cards: [
      "발탄",
      "일리아칸",
      "비아키스",
      "아브렐슈드",
      "카멘",
      "쿠크세이튼",
    ],
  },
  {
    name: "암구빛-신념의길",
    cards: [
      "베아트리스",
      "에스더 루테란",
      "웨이",
      "에버그레이스",
      "페데리코",
      "미한",
    ],
  },
  {
    name: "운명의별",
    cards: [
      "빛을 맞이하는 샨디&진저웨일",
      "빛을 맞이하는 카단",
      "빛을 맞이하는 실리안",
      "빛을 맞이하는 바훈투르",
      "빛을 맞이하는 아제나",
    ],
  },
  {
    name: "알고보면",
    cards: [
      "바훈투르",
      "아제나&이난나",
      "카인",
      "레온하트 네리아",
      "미한",
      "바루투",
      "천둥",
    ],
  },
  {
    name: "너는계획이있구나",
    cards: [
      "카마인",
      "데런 아만",
      "카인",
      "페데리코",
      "아이히만 박사",
      "시안",
      "피에르",
    ],
  },
  {
    name: "대사부",
    cards: [
      "가디언루",
      "파한",
      "호동",
      "객주도사",
      "월향도사",
      "수령도사",
    ],
  },
];

export function normalizeCardName(cardName: string): string {
  return cardName
    .trim()
    .toLocaleLowerCase("ko-KR")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function getCandidateNames(cardName: string): string[] {
  return [cardName, ...(CARD_ALIASES[cardName] ?? [])];
}

function findMatchedListingCard(
  listingCards: Map<string, string>,
  targetCard: string,
): string | null {
  for (const candidate of getCandidateNames(targetCard)) {
    const matchedCard = listingCards.get(normalizeCardName(candidate));

    if (matchedCard) {
      return matchedCard;
    }
  }

  return null;
}

export function buildMerchantFingerprint(listing: MerchantListing): string {
  const normalizedCards = listing.cards
    .map(normalizeCardName)
    .sort((left, right) => left.localeCompare(right, "ko-KR"))
    .join("|");

  const merchantName = listing.merchantName?.trim() ?? "";
  const rotationKey = listing.rotationKey?.trim() ?? "";

  return [
    normalizeCardName(listing.server),
    normalizeCardName(merchantName),
    normalizeCardName(rotationKey),
    normalizedCards,
  ].join("::");
}

export function findMerchantAlertMatch(
  listing: MerchantListing,
  extraTrackedCards: string[] = [],
): MerchantAlertMatch | null {
  const listingCards = new Map(
    listing.cards.map((card) => [normalizeCardName(card), card.trim()]),
  );

  const matchedCards = new Set<string>();
  const matchedSetNames: string[] = [];

  for (const cardSet of DEFAULT_TRACKED_CARD_SETS) {
    const cardsInSet = cardSet.cards
      .map((card) => findMatchedListingCard(listingCards, card))
      .filter((card): card is string => Boolean(card));

    if (cardsInSet.length === 0) {
      continue;
    }

    matchedSetNames.push(cardSet.name);

    for (const card of cardsInSet) {
      matchedCards.add(card);
    }
  }

  for (const card of extraTrackedCards) {
    const matchedCard = findMatchedListingCard(listingCards, card);

    if (matchedCard) {
      matchedCards.add(matchedCard);
    }
  }

  if (matchedCards.size === 0) {
    return null;
  }

  return {
    fingerprint: buildMerchantFingerprint(listing),
    matchedCards: [...matchedCards].sort((left, right) =>
      left.localeCompare(right, "ko-KR"),
    ),
    matchedSetNames,
  };
}
