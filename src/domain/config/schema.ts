/**
 * Tenant configuration — workflow, copy, permissions and business rules are
 * tenant data, never code branches. See docs/TACTICAL-DESIGN.md §10.
 */

import { DEFAULT_ROLE_PERMISSIONS, type Permission, type Role } from "../rbac/permissions";
import { STEP_KEYS, type StepKey } from "../fsm/steps";
import type { InputResolution } from "../fsm/types";

export interface InputOption {
  value: string;
  labelKey: string;
}

export interface InputSchema {
  schemaKey: string;
  promptKey: string;
  options: InputOption[];
  freeText: boolean;
  resolution: {
    onAccept: InputResolution;
    onDecline: InputResolution;
  };
  expiresAfterSeconds?: number;
}

export interface StepPresentation {
  titleKey: string;
  detailKey: string;
  icon: string;
}

export interface TenantConfig {
  tenantId: string;
  version: number;
  branding: {
    displayName: string;
    primaryColor: string;
    logoUrl?: string;
  };
  defaultLocale: string;
  i18n: Record<string, Record<string, string>>;
  stepPresentations: Record<StepKey, StepPresentation>;
  /** Seconds per step; drives the ETA. See §15. */
  stepDurations: Record<StepKey, number>;
  /** Structured customer decisions; drives §6. */
  inputSchemas: Record<string, InputSchema>;
  rolePermissions: Record<string, Permission[]>;
  businessRules: {
    allowAdvanceWhileAwaitingInput: boolean;
    requirePaymentSettledToComplete: boolean;
  };
}

const stepPresentations: Record<StepKey, StepPresentation> = {
  orderPlaced: {
    titleKey: "step.orderPlaced.title",
    detailKey: "step.orderPlaced.detail",
    icon: "receipt",
  },
  orderInProgress_Stage1: {
    titleKey: "step.stage1.title",
    detailKey: "step.stage1.detail",
    icon: "rollingPin",
  },
  orderInProgress_Stage2: {
    titleKey: "step.stage2.title",
    detailKey: "step.stage2.detail",
    icon: "flame",
  },
  orderInProgress_Stage3: {
    titleKey: "step.stage3.title",
    detailKey: "step.stage3.detail",
    icon: "scooter",
  },
  orderComplete: {
    titleKey: "step.complete.title",
    detailKey: "step.complete.detail",
    icon: "check",
  },
};

const inputSchemas: Record<string, InputSchema> = {
  ingredient_substitution: {
    schemaKey: "ingredient_substitution",
    promptKey: "input.substitution.prompt",
    options: [
      { value: "accept_substitute", labelKey: "input.substitution.accept" },
      { value: "remove_topping", labelKey: "input.substitution.remove" },
      { value: "cancel_order", labelKey: "input.substitution.cancel" },
    ],
    freeText: false,
    // Refusing a substitution sends the ticket back for re-work.
    resolution: { onAccept: "advance", onDecline: "loopback" },
    expiresAfterSeconds: 600,
  },
  allergen_confirmation: {
    schemaKey: "allergen_confirmation",
    promptKey: "input.allergen.prompt",
    options: [
      { value: "confirmed", labelKey: "input.allergen.confirmed" },
      { value: "change_order", labelKey: "input.allergen.change" },
    ],
    freeText: true,
    resolution: { onAccept: "advance", onDecline: "loopback" },
    expiresAfterSeconds: 900,
  },
  remake_consent: {
    schemaKey: "remake_consent",
    promptKey: "input.remake.prompt",
    options: [
      { value: "remake", labelKey: "input.remake.accept" },
      { value: "send_as_is", labelKey: "input.remake.decline" },
    ],
    freeText: false,
    resolution: { onAccept: "restart", onDecline: "advance" },
    expiresAfterSeconds: 900,
  },
  confirm_home: {
    schemaKey: "confirm_home",
    promptKey: "input.confirmHome.prompt",
    options: [
      { value: "home", labelKey: "input.confirmHome.yes" },
      { value: "leave_at_door", labelKey: "input.confirmHome.leave" },
    ],
    freeText: true,
    resolution: { onAccept: "advance", onDecline: "none" },
    expiresAfterSeconds: 600,
  },
};

const en: Record<string, string> = {
  "step.orderPlaced.title": "Order received",
  "step.orderPlaced.detail": "We have your ticket",
  "step.stage1.title": "Prepping your pizza",
  "step.stage1.detail": "Dough stretched, toppings on",
  "step.stage2.title": "In the oven",
  "step.stage2.detail": "Baking at 500°",
  "step.stage3.title": "Out for delivery",
  "step.stage3.detail": "Hot bag, on the road",
  "step.complete.title": "Delivered — enjoy!",
  "step.complete.detail": "Your pie has landed",
  "input.substitution.prompt": "We are out of an ingredient you picked. How should we proceed?",
  "input.substitution.accept": "Substitute it",
  "input.substitution.remove": "Leave it out",
  "input.substitution.cancel": "Cancel my order",
  "input.allergen.prompt": "Please confirm the allergy note on your order.",
  "input.allergen.confirmed": "Confirmed",
  "input.allergen.change": "I need to change it",
  "input.remake.prompt": "This pie did not pass our quality check. Remake it?",
  "input.remake.accept": "Remake it",
  "input.remake.decline": "Send it as is",
  "input.confirmHome.prompt": "The driver is close. Are you home?",
  "input.confirmHome.yes": "I'm home",
  "input.confirmHome.leave": "Leave it at the door",
};

const es: Record<string, string> = {
  "step.orderPlaced.title": "Pedido recibido",
  "step.orderPlaced.detail": "Ya tenemos tu pedido",
  "step.stage1.title": "Preparando tu pizza",
  "step.stage1.detail": "Masa estirada, ingredientes listos",
  "step.stage2.title": "En el horno",
  "step.stage2.detail": "Horneando a 500°",
  "step.stage3.title": "En camino",
  "step.stage3.detail": "En ruta hacia ti",
  "step.complete.title": "¡Entregado, disfruta!",
  "step.complete.detail": "Tu pizza ha llegado",
  "input.substitution.prompt": "No tenemos un ingrediente que elegiste. ¿Cómo seguimos?",
  "input.substitution.accept": "Sustitúyelo",
  "input.substitution.remove": "Quítalo",
  "input.substitution.cancel": "Cancela mi pedido",
  "input.allergen.prompt": "Confirma la nota de alergias de tu pedido.",
  "input.allergen.confirmed": "Confirmado",
  "input.allergen.change": "Necesito cambiarlo",
  "input.remake.prompt": "Esta pizza no pasó el control de calidad. ¿La repetimos?",
  "input.remake.accept": "Repítela",
  "input.remake.decline": "Envíala así",
  "input.confirmHome.prompt": "El repartidor está cerca. ¿Estás en casa?",
  "input.confirmHome.yes": "Estoy en casa",
  "input.confirmHome.leave": "Déjala en la puerta",
};

const stepDurations = Object.fromEntries(
  STEP_KEYS.map((step) => [step, step === "orderComplete" ? 0 : 300]),
) as Record<StepKey, number>;

stepDurations.orderPlaced = 60;
stepDurations.orderInProgress_Stage1 = 240;
stepDurations.orderInProgress_Stage2 = 480;
stepDurations.orderInProgress_Stage3 = 420;

/** Tenant 'acme' — the local dev / seed tenant used by every test and page. */
export const DEFAULT_TENANT_CONFIG: TenantConfig = {
  tenantId: "acme",
  version: 1,
  branding: {
    displayName: "Acme Pizza Co.",
    primaryColor: "#c2410c",
  },
  defaultLocale: "en",
  i18n: { en, es },
  stepPresentations,
  stepDurations,
  inputSchemas,
  rolePermissions: {
    customer: DEFAULT_ROLE_PERMISSIONS.customer,
    kitchen_staff: DEFAULT_ROLE_PERMISSIONS.kitchen_staff,
    delivery_driver: DEFAULT_ROLE_PERMISSIONS.delivery_driver,
    store_manager: DEFAULT_ROLE_PERMISSIONS.store_manager,
  } as Record<string, Permission[]>,
  businessRules: {
    allowAdvanceWhileAwaitingInput: false,
    requirePaymentSettledToComplete: true,
  },
};

/** Shallow clone with nested overrides, so a test can tweak one rule safely. */
export function withConfig(overrides: Partial<TenantConfig>): TenantConfig {
  return {
    ...DEFAULT_TENANT_CONFIG,
    ...overrides,
    branding: { ...DEFAULT_TENANT_CONFIG.branding, ...overrides.branding },
    businessRules: {
      ...DEFAULT_TENANT_CONFIG.businessRules,
      ...overrides.businessRules,
    },
  };
}

export function permissionsFor(config: TenantConfig, role: Role): readonly string[] {
  return config.rolePermissions[role] ?? [];
}

export function translate(config: TenantConfig, locale: string, key: string): string {
  return config.i18n[locale]?.[key] ?? config.i18n[config.defaultLocale]?.[key] ?? key;
}

