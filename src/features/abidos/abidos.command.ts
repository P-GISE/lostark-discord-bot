import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChatInputCommandInteraction,
  Client,
  EmbedBuilder,
  ModalBuilder,
  ModalSubmitInteraction,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";

import type { SlashCommand } from "../../types/command";
import { calculateAbidosCraft } from "./abidos-calculator";
import {
  ABIDOS_CONVERSION_ORDER,
  ABIDOS_CONVERSION_RATES,
  ABIDOS_PROFESSIONS,
  ABIDOS_RECIPES,
  getAbidosProfession,
} from "./abidos.data";
import type {
  AbidosCalculationResult,
  AbidosConversionKey,
  AbidosInventory,
  AbidosProductTier,
  AbidosProfession,
  AbidosProfessionCode,
} from "./abidos.types";

interface AbidosPanelSession {
  ownerId: string;
  professionCode: AbidosProfessionCode;
  productTier: AbidosProductTier;
  inventory: AbidosInventory;
  lastResult: AbidosCalculationResult | null;
  updatedAt: number;
}

const ABIDOS_CUSTOM_ID_PREFIX = "abidos:";
const ABIDOS_MODAL_ID = `${ABIDOS_CUSTOM_ID_PREFIX}inventory-modal`;
const ABIDOS_SESSION_TTL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_PROFESSION_CODE =
  ABIDOS_PROFESSIONS.find((profession) => profession.code === "AR")?.code ??
  ABIDOS_PROFESSIONS[0]?.code ??
  "HR";

const abidosSessions = new Map<string, AbidosPanelSession>();

function formatNumber(value: number): string {
  return value.toLocaleString("ko-KR");
}

function createEmptyInventory(): AbidosInventory {
  return {
    A: 0,
    B: 0,
    C: 0,
    P: 0,
    S: 0,
  };
}

function sanitizeInventory(input?: Partial<AbidosInventory>): AbidosInventory {
  return {
    A: Math.max(0, Math.floor(input?.A ?? 0)),
    B: Math.max(0, Math.floor(input?.B ?? 0)),
    C: Math.max(0, Math.floor(input?.C ?? 0)),
    P: Math.max(0, Math.floor(input?.P ?? 0)),
    S: Math.max(0, Math.floor(input?.S ?? 0)),
  };
}

function createSession(
  ownerId: string,
  input?: Partial<Omit<AbidosPanelSession, "ownerId" | "updatedAt">>,
): AbidosPanelSession {
  return {
    ownerId,
    professionCode: input?.professionCode ?? DEFAULT_PROFESSION_CODE,
    productTier: input?.productTier ?? "normal",
    inventory: sanitizeInventory(input?.inventory),
    lastResult: input?.lastResult ?? null,
    updatedAt: Date.now(),
  };
}

function cleanupAbidosSessions(): void {
  const now = Date.now();

  for (const [ownerId, session] of abidosSessions.entries()) {
    if (now - session.updatedAt > ABIDOS_SESSION_TTL_MS) {
      abidosSessions.delete(ownerId);
    }
  }
}

function getSession(ownerId: string): AbidosPanelSession | undefined {
  cleanupAbidosSessions();
  return abidosSessions.get(ownerId);
}

function saveSession(session: AbidosPanelSession): void {
  session.updatedAt = Date.now();
  abidosSessions.set(session.ownerId, session);
}

function getTierLabel(tier: AbidosProductTier): string {
  return tier === "advanced" ? "고급 제작" : "일반 제작";
}

function getEmbedColor(tier: AbidosProductTier): number {
  return tier === "advanced" ? 0xd97706 : 0x2563eb;
}

function getInfoButtonStyle(active?: boolean): ButtonStyle {
  return active ? ButtonStyle.Primary : ButtonStyle.Secondary;
}

function createInfoButton(
  label: string,
  style: ButtonStyle = ButtonStyle.Secondary,
): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(
      `${ABIDOS_CUSTOM_ID_PREFIX}info:${Buffer.from(label)
        .toString("hex")
        .slice(0, 24)}`,
    )
    .setLabel(label)
    .setStyle(style)
    .setDisabled(true);
}

function createInventoryFieldLines(
  profession: AbidosProfession,
  inventory: AbidosInventory,
): string[] {
  const lines = [
    `• ${profession.resources.A.name}: ${formatNumber(inventory.A)}개`,
    `• ${profession.resources.B.name}: ${formatNumber(inventory.B)}개`,
    `• ${profession.resources.C.name}: ${formatNumber(inventory.C)}개`,
    `• ${profession.resources.P.name}: ${formatNumber(inventory.P)}개`,
  ];

  if (profession.resources.S) {
    lines.push(`• ${profession.resources.S.name}: ${formatNumber(inventory.S)}개`);
  }

  return lines;
}

function buildRecipeLines(
  profession: AbidosProfession,
  productTier: AbidosProductTier,
): string[] {
  const recipe = ABIDOS_RECIPES[productTier];

  return [
    `• 결과물: ${recipe.productName} ${formatNumber(recipe.outputCount)}개`,
    `• ${profession.resources.A.name}: ${formatNumber(recipe.A)}개`,
    `• ${profession.resources.B.name}: ${formatNumber(recipe.B)}개`,
    `• ${profession.resources.C.name}: ${formatNumber(recipe.C)}개`,
  ];
}

function buildConversionLines(
  professionCode: AbidosProfessionCode,
  conversions: Partial<Record<AbidosConversionKey, number>>,
): string[] {
  const profession = getAbidosProfession(professionCode);

  return ABIDOS_CONVERSION_ORDER.flatMap((key) => {
    const count = conversions[key] ?? 0;

    if (count <= 0) {
      return [];
    }

    const rate = ABIDOS_CONVERSION_RATES[key];
    const fromName = profession.resources[rate.from]?.name ?? rate.from;
    const toName = profession.resources[rate.to]?.name ?? rate.to;

    return [
      `• ${fromName} ${formatNumber(count * rate.input)}개 -> ${toName} ${formatNumber(count * rate.output)}개`,
    ];
  });
}

function hasAnyInventory(inventory: AbidosInventory): boolean {
  return Object.values(inventory).some((value) => value > 0);
}

function getConversionKindsCount(
  conversions: Partial<Record<AbidosConversionKey, number>>,
): number {
  return Object.values(conversions).filter((count) => (count ?? 0) > 0).length;
}

function buildPanelEmbed(session: AbidosPanelSession, avatarUrl?: string): EmbedBuilder {
  const profession = getAbidosProfession(session.professionCode);
  const embed = new EmbedBuilder()
    .setColor(getEmbedColor(session.productTier))
    .setTitle(`${profession.name} 아비도스 제작 계산기`)
    .setThumbnail(avatarUrl ?? null);

  if (!session.lastResult) {
    embed
      .setDescription(
        [
          `생활을 고르고 재료를 입력한 뒤 **계산하기**를 눌러 주세요.`,
          `버튼으로 제작 종류를 바꾸고, **재료 입력**에서 일반/희귀/아비도스/가루/상위 재료 수량을 한번에 넣을 수 있어요.`,
        ].join("\n"),
      )
      .addFields(
        {
          name: "제작 정보",
          value: buildRecipeLines(profession, session.productTier).join("\n"),
          inline: false,
        },
        {
          name: "현재 입력 재료",
          value: createInventoryFieldLines(profession, session.inventory).join("\n"),
          inline: false,
        },
      )
      .setFooter({ text: "재료 입력 후 계산하기를 누르면 결과가 갱신됩니다." });

    return embed;
  }

  const result = session.lastResult;
  const conversionLines = buildConversionLines(
    session.professionCode,
    result.conversions,
  );

  embed
    .setDescription(
      [
        `현재 보유 재료 기준으로 **${formatNumber(result.craftCount)}회** 제작할 수 있어요.`,
        `최종 결과물은 **${result.recipe.productName} ${formatNumber(result.totalOutput)}개**입니다.`,
      ].join("\n"),
    )
    .addFields(
      {
        name: "제작 정보",
        value: buildRecipeLines(profession, session.productTier).join("\n"),
        inline: false,
      },
      {
        name: "보유 재료",
        value: createInventoryFieldLines(profession, session.inventory).join("\n"),
        inline: true,
      },
      {
        name: "사용 재료",
        value: createInventoryFieldLines(profession, result.consumed).join("\n"),
        inline: true,
      },
      {
        name: "남은 재료",
        value: createInventoryFieldLines(profession, result.remaining).join("\n"),
        inline: true,
      },
      {
        name: "자동 변환",
        value: conversionLines.length > 0 ? conversionLines.join("\n") : "변환 없음",
        inline: false,
      },
    )
    .setFooter({ text: "직업이나 재료를 바꾸면 다시 계산하기를 눌러 주세요." });

  return embed;
}

function buildProfessionRows(
  session: AbidosPanelSession,
): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  const chunkSize = 3;

  for (let startIndex = 0; startIndex < ABIDOS_PROFESSIONS.length; startIndex += chunkSize) {
    const professions = ABIDOS_PROFESSIONS.slice(startIndex, startIndex + chunkSize);
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      professions.map((profession) =>
        new ButtonBuilder()
          .setCustomId(`${ABIDOS_CUSTOM_ID_PREFIX}profession:${profession.code}`)
          .setLabel(profession.name)
          .setStyle(
            profession.code === session.professionCode
              ? ButtonStyle.Success
              : ButtonStyle.Secondary,
          ),
      ),
    );

    rows.push(row);
  }

  return rows;
}

function buildControlRow(
  session: AbidosPanelSession,
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${ABIDOS_CUSTOM_ID_PREFIX}tier:normal`)
      .setLabel("일반 제작")
      .setStyle(
        session.productTier === "normal" ? ButtonStyle.Primary : ButtonStyle.Secondary,
      ),
    new ButtonBuilder()
      .setCustomId(`${ABIDOS_CUSTOM_ID_PREFIX}tier:advanced`)
      .setLabel("고급 제작")
      .setStyle(
        session.productTier === "advanced"
          ? ButtonStyle.Primary
          : ButtonStyle.Secondary,
      ),
    new ButtonBuilder()
      .setCustomId(`${ABIDOS_CUSTOM_ID_PREFIX}inventory`)
      .setLabel("재료 입력")
      .setStyle(
        hasAnyInventory(session.inventory) ? ButtonStyle.Success : ButtonStyle.Secondary,
      ),
    new ButtonBuilder()
      .setCustomId(`${ABIDOS_CUSTOM_ID_PREFIX}calculate`)
      .setLabel("계산하기")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`${ABIDOS_CUSTOM_ID_PREFIX}reset`)
      .setLabel("초기화")
      .setStyle(ButtonStyle.Danger),
  );
}

function buildInfoRows(
  session: AbidosPanelSession,
): ActionRowBuilder<ButtonBuilder>[] {
  const profession = getAbidosProfession(session.professionCode);
  const conversionCount = session.lastResult
    ? getConversionKindsCount(session.lastResult.conversions)
    : 0;

  const rowOne = new ActionRowBuilder<ButtonBuilder>().addComponents(
    createInfoButton(profession.name, ButtonStyle.Success),
    createInfoButton(getTierLabel(session.productTier), ButtonStyle.Primary),
    createInfoButton(`일반 ${formatNumber(session.inventory.A)}개`),
    createInfoButton(`희귀 ${formatNumber(session.inventory.B)}개`),
    createInfoButton(`아비도스 ${formatNumber(session.inventory.C)}개`),
  );

  const rowTwo = new ActionRowBuilder<ButtonBuilder>().addComponents(
    createInfoButton(`가루 ${formatNumber(session.inventory.P)}개`),
    createInfoButton(
      `${profession.resources.S ? "상위" : "상위 0"} ${formatNumber(session.inventory.S)}개`,
    ),
    createInfoButton(
      `제작 ${formatNumber(session.lastResult?.craftCount ?? 0)}회`,
      getInfoButtonStyle((session.lastResult?.craftCount ?? 0) > 0),
    ),
    createInfoButton(
      `총 ${formatNumber(session.lastResult?.totalOutput ?? 0)}개`,
      getInfoButtonStyle((session.lastResult?.totalOutput ?? 0) > 0),
    ),
    createInfoButton(
      `변환 ${formatNumber(conversionCount)}종`,
      getInfoButtonStyle(conversionCount > 0),
    ),
  );

  return [rowOne, rowTwo];
}

function buildPanelMessage(
  session: AbidosPanelSession,
  avatarUrl?: string,
): {
  embeds: [EmbedBuilder];
  components: ActionRowBuilder<ButtonBuilder>[];
} {
  return {
    embeds: [buildPanelEmbed(session, avatarUrl)],
    components: [
      ...buildProfessionRows(session),
      buildControlRow(session),
      ...buildInfoRows(session),
    ],
  };
}

function buildInventoryModal(session: AbidosPanelSession): ModalBuilder {
  const profession = getAbidosProfession(session.professionCode);

  return new ModalBuilder()
    .setCustomId(ABIDOS_MODAL_ID)
    .setTitle("아비도스 재료 입력")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("inventory:A")
          .setLabel(`일반 재료 (${profession.resources.A.name})`)
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue(String(session.inventory.A)),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("inventory:B")
          .setLabel(`희귀 재료 (${profession.resources.B.name})`)
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue(String(session.inventory.B)),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("inventory:C")
          .setLabel(`아비도스 재료 (${profession.resources.C.name})`)
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue(String(session.inventory.C)),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("inventory:P")
          .setLabel(`생활 가루 (${profession.resources.P.name})`)
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue(String(session.inventory.P)),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("inventory:S")
          .setLabel(
            profession.resources.S
              ? `상위 재료 (${profession.resources.S.name})`
              : "상위 재료 (없으면 0)",
          )
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue(String(session.inventory.S)),
      ),
    );
}

function parseInventoryValue(rawValue: string): number | null {
  const trimmed = rawValue.trim();

  if (!/^\d+$/.test(trimmed)) {
    return null;
  }

  return Number(trimmed);
}

function createQuickResultSession(
  ownerId: string,
  input: {
    professionCode: AbidosProfessionCode;
    productTier: AbidosProductTier;
    inventory: AbidosInventory;
  },
): AbidosPanelSession {
  const session = createSession(ownerId, input);
  session.lastResult = calculateAbidosCraft({
    professionCode: session.professionCode,
    productTier: session.productTier,
    inventory: session.inventory,
  });
  return session;
}

function getPanelAvatarUrl(client: Client): string | undefined {
  return client.user?.displayAvatarURL();
}

async function replyWithPanel(
  interaction: ChatInputCommandInteraction,
  session: AbidosPanelSession,
): Promise<void> {
  saveSession(session);

  await interaction.reply({
    ...buildPanelMessage(session, getPanelAvatarUrl(interaction.client)),
    ephemeral: true,
  });
}

async function updatePanel(
  interaction: ButtonInteraction | ModalSubmitInteraction,
  session: AbidosPanelSession,
): Promise<void> {
  saveSession(session);

  if (interaction.isButton()) {
    await interaction.update(
      buildPanelMessage(session, getPanelAvatarUrl(interaction.client)),
    );
    return;
  }

  if (interaction.isFromMessage()) {
    await interaction.update(
      buildPanelMessage(session, getPanelAvatarUrl(interaction.client)),
    );
    return;
  }

  await interaction.reply({
    content: "패널을 갱신할 수 없어요. `/abidos calc`를 다시 실행해 주세요.",
    ephemeral: true,
  });
}

function ensureSessionOwner(
  session: AbidosPanelSession | undefined,
  ownerId: string,
): session is AbidosPanelSession {
  return Boolean(session && session.ownerId === ownerId);
}

async function handleAbidosButtonInteraction(
  interaction: ButtonInteraction,
): Promise<void> {
  const session = getSession(interaction.user.id);

  if (!ensureSessionOwner(session, interaction.user.id)) {
    await interaction.reply({
      content: "아비도스 계산 패널이 만료됐어요. `/abidos calc`를 다시 실행해 주세요.",
      ephemeral: true,
    });
    return;
  }

  const action = interaction.customId.slice(ABIDOS_CUSTOM_ID_PREFIX.length);

  if (action.startsWith("profession:")) {
    session.professionCode = action.replace("profession:", "") as AbidosProfessionCode;
    session.lastResult = null;
    await updatePanel(interaction, session);
    return;
  }

  if (action.startsWith("tier:")) {
    session.productTier = action.replace("tier:", "") as AbidosProductTier;
    session.lastResult = null;
    await updatePanel(interaction, session);
    return;
  }

  if (action === "inventory") {
    await interaction.showModal(buildInventoryModal(session));
    return;
  }

  if (action === "calculate") {
    session.lastResult = calculateAbidosCraft({
      professionCode: session.professionCode,
      productTier: session.productTier,
      inventory: session.inventory,
    });
    await updatePanel(interaction, session);
    return;
  }

  if (action === "reset") {
    session.inventory = createEmptyInventory();
    session.lastResult = null;
    await updatePanel(interaction, session);
    return;
  }

  await interaction.reply({
    content: "지원하지 않는 아비도스 버튼이에요.",
    ephemeral: true,
  });
}

async function handleAbidosModalInteraction(
  interaction: ModalSubmitInteraction,
): Promise<void> {
  const session = getSession(interaction.user.id);

  if (!ensureSessionOwner(session, interaction.user.id)) {
    await interaction.reply({
      content: "아비도스 계산 패널이 만료됐어요. `/abidos calc`를 다시 실행해 주세요.",
      ephemeral: true,
    });
    return;
  }

  const parsedInventory = {
    A: parseInventoryValue(interaction.fields.getTextInputValue("inventory:A")),
    B: parseInventoryValue(interaction.fields.getTextInputValue("inventory:B")),
    C: parseInventoryValue(interaction.fields.getTextInputValue("inventory:C")),
    P: parseInventoryValue(interaction.fields.getTextInputValue("inventory:P")),
    S: parseInventoryValue(interaction.fields.getTextInputValue("inventory:S")),
  };

  if (Object.values(parsedInventory).some((value) => value === null)) {
    await interaction.reply({
      content: "재료 수량은 0 이상의 정수만 입력할 수 있어요.",
      ephemeral: true,
    });
    return;
  }

  session.inventory = sanitizeInventory(parsedInventory as AbidosInventory);
  session.lastResult = null;
  await updatePanel(interaction, session);
}

export async function handleAbidosInteraction(
  interaction: ButtonInteraction | ModalSubmitInteraction,
  client: Client,
): Promise<void> {
  void client;

  if (interaction.isButton()) {
    await handleAbidosButtonInteraction(interaction);
    return;
  }

  if (interaction.isModalSubmit()) {
    await handleAbidosModalInteraction(interaction);
  }
}

function getQuickInputValues(interaction: ChatInputCommandInteraction): {
  professionCode: AbidosProfessionCode | null;
  productTier: AbidosProductTier;
  inventory: AbidosInventory;
  hasAnyQuickOption: boolean;
  hasCompleteQuickOption: boolean;
} {
  const professionCode =
    (interaction.options.getString("profession") as AbidosProfessionCode | null) ?? null;
  const base = interaction.options.getInteger("base");
  const rare = interaction.options.getInteger("rare");
  const abidos = interaction.options.getInteger("abidos");
  const powder = interaction.options.getInteger("powder") ?? 0;
  const tier3 = interaction.options.getInteger("tier3") ?? 0;
  const productTier =
    (interaction.options.getString("tier") as AbidosProductTier | null) ?? "normal";
  const hasAnyQuickOption =
    professionCode !== null ||
    base !== null ||
    rare !== null ||
    abidos !== null ||
    powder > 0 ||
    tier3 > 0 ||
    productTier !== "normal";
  const hasCompleteQuickOption =
    professionCode !== null && base !== null && rare !== null && abidos !== null;

  return {
    professionCode,
    productTier,
    inventory: {
      A: base ?? 0,
      B: rare ?? 0,
      C: abidos ?? 0,
      P: powder,
      S: tier3,
    },
    hasAnyQuickOption,
    hasCompleteQuickOption,
  };
}

export const abidosCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("abidos")
    .setNameLocalizations({
      ko: "아비도스",
    })
    .setDescription("생활 재료로 아비도스 제작 가능 수량을 계산합니다.")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("calc")
        .setNameLocalizations({
          ko: "계산",
        })
        .setDescription("버튼 패널 또는 빠른 입력으로 아비도스 제작 수량을 계산합니다.")
        .addStringOption((option) =>
          option
            .setName("profession")
            .setNameLocalizations({
              ko: "생활",
            })
            .setDescription("빠르게 계산할 생활 종류")
            .setRequired(false)
            .addChoices(
              ...ABIDOS_PROFESSIONS.map((profession) => ({
                name: profession.name,
                value: profession.code,
              })),
            ),
        )
        .addIntegerOption((option) =>
          option
            .setName("base")
            .setNameLocalizations({
              ko: "일반",
            })
            .setDescription("빠른 계산용 일반 재료 수량")
            .setRequired(false)
            .setMinValue(0),
        )
        .addIntegerOption((option) =>
          option
            .setName("rare")
            .setNameLocalizations({
              ko: "희귀",
            })
            .setDescription("빠른 계산용 희귀 재료 수량")
            .setRequired(false)
            .setMinValue(0),
        )
        .addIntegerOption((option) =>
          option
            .setName("abidos")
            .setNameLocalizations({
              ko: "아비도스",
            })
            .setDescription("빠른 계산용 아비도스 재료 수량")
            .setRequired(false)
            .setMinValue(0),
        )
        .addStringOption((option) =>
          option
            .setName("tier")
            .setNameLocalizations({
              ko: "종류",
            })
            .setDescription("빠른 계산용 제작 종류")
            .setRequired(false)
            .addChoices(
              { name: ABIDOS_RECIPES.normal.productName, value: "normal" },
              { name: ABIDOS_RECIPES.advanced.productName, value: "advanced" },
            ),
        )
        .addIntegerOption((option) =>
          option
            .setName("powder")
            .setNameLocalizations({
              ko: "가루",
            })
            .setDescription("빠른 계산용 생활 가루 수량")
            .setRequired(false)
            .setMinValue(0),
        )
        .addIntegerOption((option) =>
          option
            .setName("tier3")
            .setNameLocalizations({
              ko: "상위재료",
            })
            .setDescription("빠른 계산용 상위 재료 수량")
            .setRequired(false)
            .setMinValue(0),
        ),
    ),
  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand !== "calc") {
      await interaction.reply({
        content: "지원하지 않는 아비도스 계산 방식입니다.",
        ephemeral: true,
      });
      return;
    }

    const quickInput = getQuickInputValues(interaction);

    if (quickInput.hasAnyQuickOption && !quickInput.hasCompleteQuickOption) {
      await interaction.reply({
        content:
          "빠른 계산을 쓰려면 `profession`, `base`, `rare`, `abidos`를 함께 입력해 주세요. 버튼 패널만 쓰려면 옵션을 비워두면 됩니다.",
        ephemeral: true,
      });
      return;
    }

    if (quickInput.hasCompleteQuickOption && quickInput.professionCode) {
      await replyWithPanel(
        interaction,
        createQuickResultSession(interaction.user.id, {
          professionCode: quickInput.professionCode,
          productTier: quickInput.productTier,
          inventory: quickInput.inventory,
        }),
      );
      return;
    }

    await replyWithPanel(interaction, createSession(interaction.user.id));
  },
};
