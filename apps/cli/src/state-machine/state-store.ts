import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod/v4';
import { version as applicationVersion } from '../../package.json';
import {
  DurableDataCompatibilityReader,
  CompatibilityValidationError,
  type CompatibilityDiagnostic,
  type DurableDataSource,
  type JsonValue,
} from '../durable-data';
import type { MachinePayloadCompatibility } from './definition';

import { effectOutcomeIngressId } from './outcome-event';
import type {
  AcceptedEventResult,
  ClaimedEffect,
  CommittedEffect,
  EffectDeclaration,
  EffectOutcome,
  EffectSettlement,
  MachineIdentity,
  MachineSnapshot,
  MachineState,
  SettledEffect,
} from './types';

const STORE_SCHEMA_VERSION = 3;

const jsonValueSchema = z.json();

const persistedAcceptedEventSchema = z.object({
  ingressId: z.string().min(1),
  revision: z.number().int().positive(),
  state: jsonValueSchema,
  context: jsonValueSchema,
  effects: z.array(jsonValueSchema),
});

const persistedEffectSchema = z.object({
  effectId: z.string().min(1),
  revision: z.number().int().positive(),
  effect: jsonValueSchema,
  execution: z
    .discriminatedUnion('status', [
      z.object({ status: z.literal('committed') }),
      z.object({ status: z.literal('claimed') }),
      z.object({
        status: z.literal('settled'),
        settlement: z.object({
          status: z.enum(['succeeded', 'failed', 'cancelled', 'uncertain']),
          outcome: jsonValueSchema,
        }),
      }),
    ])
    .default({ status: 'committed' }),
});

const persistedTransitionHistorySchema = z.object({
  sequence: z.number().int().positive(),
  ingressId: z.string().min(1),
  eventType: z.string().min(1).nullable(),
  priorRevision: z.number().int().nonnegative(),
  revision: z.number().int().nonnegative(),
  priorState: jsonValueSchema.nullable(),
  nextState: jsonValueSchema.nullable(),
  disposition: z.discriminatedUnion('status', [
    z.object({
      status: z.literal('committed'),
      effectIds: z.array(z.string().min(1)),
    }),
    z.object({
      status: z.literal('no_transition'),
      reason: z.string().min(1),
    }),
  ]),
  evidence: z.enum(['complete', 'legacy_partial']),
});

const persistedInstanceV2Schema = z.object({
  identity: z.object({
    machineType: z.string().min(1),
    instanceId: z.string().min(1),
  }),
  revision: z.number().int().positive(),
  state: jsonValueSchema,
  context: jsonValueSchema,
  acceptedIngress: z.array(persistedAcceptedEventSchema),
  effects: z.array(persistedEffectSchema),
  payloadSchemaVersion: z.number().int().positive(),
});

const persistedInstanceSchema = persistedInstanceV2Schema.extend({
  transitionHistory: z.array(persistedTransitionHistorySchema),
});

const persistedMachinePayloadSchema = z.object({
  state: jsonValueSchema,
  context: jsonValueSchema,
  acceptedIngress: z.array(persistedAcceptedEventSchema),
  effects: z.array(persistedEffectSchema),
  transitionHistory: z.array(persistedTransitionHistorySchema),
});

const persistedStoreSchema = z.object({
  schemaVersion: z.literal(STORE_SCHEMA_VERSION),
  writerApplicationVersion: z.string().min(1),
  instances: z.array(persistedInstanceSchema),
});

const persistedStoreV2Schema = z.object({
  schemaVersion: z.literal(2),
  writerApplicationVersion: z.string().min(1),
  instances: z.array(persistedInstanceV2Schema),
});

const legacyPersistedInstanceSchema = persistedInstanceV2Schema.omit({
  payloadSchemaVersion: true,
});
const legacyPersistedStoreSchema = z.object({
  stateVersion: z.literal(1),
  instances: z.array(legacyPersistedInstanceSchema),
});

type PersistedStore = z.infer<typeof persistedStoreSchema>;
type PersistedInstance = z.infer<typeof persistedInstanceSchema>;
type PersistedAcceptedEvent = z.infer<typeof persistedAcceptedEventSchema>;
type PersistedTransitionHistory = z.infer<typeof persistedTransitionHistorySchema>;

export interface MachineStateStoreCodec<
  TMachineType extends string,
  TState extends MachineState,
  TContext extends object,
  TEffect extends EffectDeclaration,
  TOutcome extends EffectOutcome,
> {
  readonly decodeMachineType: (value: string) => TMachineType;
  readonly decodeState: (value: JsonValue) => TState;
  readonly decodeContext: (value: JsonValue) => TContext;
  readonly decodeEffect: (value: JsonValue) => TEffect;
  readonly decodeOutcome: (value: JsonValue) => TOutcome;
  readonly isCompletedState?: (value: JsonValue) => boolean;
  readonly payloadCompatibility?: (machineType: string) => MachinePayloadCompatibility;
}

export interface StoredMachineInstance<
  TMachineType extends string,
  TState extends MachineState,
  TContext extends object,
  TEffect extends EffectDeclaration,
  TOutcome extends EffectOutcome,
> {
  readonly snapshot: MachineSnapshot<TMachineType, TState, TContext>;
  readonly acceptedIngress: ReadonlyMap<
    string,
    AcceptedEventResult<TMachineType, TState, TContext, TEffect>
  >;
  readonly effects: readonly CommittedEffect<TEffect, TOutcome>[];
  readonly transitionHistory: readonly StoredTransitionHistoryEntry<TState>[];
}

interface StoredTransitionHistoryEntry<TState extends MachineState> {
  readonly sequence: number;
  readonly ingressId: string;
  readonly eventType: string | null;
  readonly priorRevision: number;
  readonly revision: number;
  readonly priorState: TState | null;
  readonly nextState: TState | null;
  readonly disposition:
    | { readonly status: 'committed'; readonly effectIds: readonly string[] }
    | { readonly status: 'no_transition'; readonly reason: string };
  readonly evidence: 'complete' | 'legacy_partial';
}

export interface CommitMachineEvent<
  TMachineType extends string,
  TState extends MachineState,
  TContext extends object,
  TEffect extends EffectDeclaration,
> {
  readonly expectedRevision: number | null;
  readonly eventType: string;
  readonly priorRevision: number;
  readonly priorState: TState;
  readonly result: AcceptedEventResult<TMachineType, TState, TContext, TEffect>;
}

export interface RecordMachineNoTransition<
  TMachineType extends string,
  TState extends MachineState,
  TContext extends object,
> {
  readonly expectedRevision: number;
  readonly identity: MachineIdentity<TMachineType>;
  readonly ingressId: string;
  readonly eventType: string;
  readonly snapshot: MachineSnapshot<TMachineType, TState, TContext>;
  readonly reason: string;
}

export interface MachineStateStoreOptions {
  readonly randomId?: () => string;
  readonly readerApplicationVersion?: string;
  readonly onCompatibilityDiagnostic?: (diagnostic: CompatibilityDiagnostic) => void;
}

export interface MachineStateStoreRecoveryResult<
  TMachineType extends string,
  TState extends MachineState,
  TContext extends object,
  TEffect extends EffectDeclaration,
  TOutcome extends EffectOutcome,
> {
  readonly instances: readonly StoredMachineInstance<
    TMachineType,
    TState,
    TContext,
    TEffect,
    TOutcome
  >[];
}

export class MachineStateStoreCompatibilityError extends Error {
  public constructor(readonly diagnostic: CompatibilityDiagnostic) {
    super(
      `Machine state store compatibility failed (${diagnostic.reason}); source schema ${String(diagnostic.sourceSchemaVersion)}, current schema ${String(diagnostic.currentSchemaVersion)}, writer ${diagnostic.writerApplicationVersion ?? 'unknown'}, reader ${diagnostic.readerApplicationVersion}.`,
    );
    this.name = 'MachineStateStoreCompatibilityError';
  }
}

class StateStoreCorruptionError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'StateStoreCorruptionError';
  }
}

class StateStoreConflictError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'StateStoreConflictError';
  }
}

const emptyStore = (writerApplicationVersion: string): PersistedStore => ({
  schemaVersion: STORE_SCHEMA_VERSION,
  writerApplicationVersion,
  instances: [],
});

const isNodeError = (error: object): error is NodeJS.ErrnoException => 'code' in error;

const legacyTransitionHistory = (
  instance: z.infer<typeof persistedInstanceV2Schema>,
): PersistedTransitionHistory[] =>
  instance.acceptedIngress.map((accepted, index) => ({
    sequence: index + 1,
    ingressId: accepted.ingressId,
    eventType: null,
    priorRevision: Math.max(0, accepted.revision - 1),
    revision: accepted.revision,
    priorState: index === 0 ? null : (instance.acceptedIngress.at(index - 1)?.state ?? null),
    nextState: accepted.state,
    disposition: {
      status: 'committed' as const,
      effectIds: instance.effects
        .filter(({ revision }) => revision === accepted.revision)
        .map(({ effectId }) => effectId),
    },
    evidence: 'legacy_partial' as const,
  }));

/** Owns the atomic durable representation of all local machine instances. */
export class MachineStateStore<
  TMachineType extends string,
  TState extends MachineState,
  TContext extends object,
  TEffect extends EffectDeclaration,
  TOutcome extends EffectOutcome,
> {
  private readonly filePath: string;
  private readonly codec: MachineStateStoreCodec<TMachineType, TState, TContext, TEffect, TOutcome>;
  private readonly randomId: () => string;
  private readonly readerApplicationVersion: string;
  private readonly reportCompatibility: (diagnostic: CompatibilityDiagnostic) => void;
  private readonly compatibilityReader: DurableDataCompatibilityReader;
  private readonly compatibleInstances = new Set<string>();
  private readonly incompatibleInstances = new Map<string, MachineStateStoreCompatibilityError>();
  private mutationTail: Promise<void> = Promise.resolve();

  public constructor(
    filePath: string,
    codec: MachineStateStoreCodec<TMachineType, TState, TContext, TEffect, TOutcome>,
    options: MachineStateStoreOptions = {},
  ) {
    this.filePath = filePath;
    this.codec = codec;
    this.randomId = options.randomId ?? (() => crypto.randomUUID());
    this.readerApplicationVersion = options.readerApplicationVersion ?? applicationVersion;
    this.reportCompatibility = options.onCompatibilityDiagnostic ?? (() => undefined);
    this.compatibilityReader = new DurableDataCompatibilityReader(
      this.readerApplicationVersion,
      this.reportCompatibility,
    );
  }

  public async findByInstanceId(
    instanceId: string,
  ): Promise<StoredMachineInstance<TMachineType, TState, TContext, TEffect, TOutcome> | null> {
    return this.runExclusive(async () => {
      const store = await this.readStore();
      const persisted = store.instances.find(
        (instance) => instance.identity.instanceId === instanceId,
      );
      if (!persisted) return null;
      await this.prepareInstance(store, persisted);
      return this.decodeInstance(persisted);
    });
  }

  public async listInstances(): Promise<
    readonly StoredMachineInstance<TMachineType, TState, TContext, TEffect, TOutcome>[]
  > {
    return this.runExclusive(async () => {
      const store = await this.readStore();
      for (const instance of store.instances) await this.prepareInstance(store, instance);
      return store.instances.map((instance) => this.decodeInstance(instance));
    });
  }

  /** Loads the complete store or fails closed without changing its source bytes. */
  public async recoverInstances(): Promise<
    MachineStateStoreRecoveryResult<TMachineType, TState, TContext, TEffect, TOutcome>
  > {
    return this.runExclusive(async () => {
      const store = await this.readStore();
      const candidates = store.instances.filter((instance) => this.requiresRecovery(instance));
      for (const instance of candidates) await this.prepareInstance(store, instance);
      return {
        instances: candidates.map((instance) => this.decodeInstance(instance)),
      };
    });
  }

  public async commit(
    command: CommitMachineEvent<TMachineType, TState, TContext, TEffect>,
  ): Promise<void> {
    await this.runExclusive(async () => {
      const store = await this.readStore();
      const instanceIndex = store.instances.findIndex(
        (instance) => instance.identity.instanceId === command.result.snapshot.identity.instanceId,
      );
      const existing = instanceIndex === -1 ? null : (store.instances.at(instanceIndex) ?? null);
      if (existing) await this.prepareInstance(store, existing);

      if (existing?.identity.machineType !== undefined) {
        if (existing.identity.machineType !== command.result.snapshot.identity.machineType) {
          throw new StateStoreConflictError(
            `Machine instance ${command.result.snapshot.identity.instanceId} belongs to ${existing.identity.machineType}, not ${command.result.snapshot.identity.machineType}.`,
          );
        }
        if (existing.revision !== command.expectedRevision) {
          throw new StateStoreConflictError(
            `Machine instance ${command.result.snapshot.identity.instanceId} changed from revision ${String(command.expectedRevision)} to ${String(existing.revision)}.`,
          );
        }
        if (
          existing.transitionHistory.some(({ ingressId }) => ingressId === command.result.ingressId)
        ) {
          throw new StateStoreConflictError(
            `Ingress ${command.result.ingressId} was already evaluated for machine instance ${command.result.snapshot.identity.instanceId}.`,
          );
        }
      } else if (command.expectedRevision !== null) {
        throw new StateStoreConflictError(
          `Machine instance ${command.result.snapshot.identity.instanceId} no longer exists.`,
        );
      }

      const persistedResult = this.encodeAcceptedEvent(command.result);
      const committedEffects = command.result.effects.map((effect) => ({
        effectId: this.randomId(),
        revision: command.result.snapshot.revision,
        effect: this.encodeJson(effect, 'effect declaration'),
        execution: { status: 'committed' as const },
      }));
      const transition: PersistedTransitionHistory = {
        sequence: (existing?.transitionHistory.length ?? 0) + 1,
        ingressId: command.result.ingressId,
        eventType: command.eventType,
        priorRevision: command.priorRevision,
        revision: command.result.snapshot.revision,
        priorState: this.encodeJson(command.priorState, 'prior snapshot state'),
        nextState: this.encodeJson(command.result.snapshot.state, 'next snapshot state'),
        disposition: {
          status: 'committed',
          effectIds: committedEffects.map(({ effectId }) => effectId),
        },
        evidence: 'complete',
      };
      const nextInstance: PersistedInstance = {
        identity: command.result.snapshot.identity,
        revision: command.result.snapshot.revision,
        state: this.encodeJson(command.result.snapshot.state, 'snapshot state'),
        context: this.encodeJson(command.result.snapshot.context, 'snapshot context'),
        acceptedIngress: [...(existing?.acceptedIngress ?? []), persistedResult],
        effects: [...(existing?.effects ?? []), ...committedEffects],
        transitionHistory: [...(existing?.transitionHistory ?? []), transition],
        payloadSchemaVersion: this.payloadCompatibility(
          command.result.snapshot.identity.machineType,
        ).currentSchemaVersion,
      };

      const nextInstances = [...store.instances];
      if (instanceIndex === -1) {
        nextInstances.push(nextInstance);
      } else {
        nextInstances[instanceIndex] = nextInstance;
      }

      await this.writeStore({
        schemaVersion: STORE_SCHEMA_VERSION,
        writerApplicationVersion: this.readerApplicationVersion,
        instances: nextInstances,
      });
    });
  }

  public async recordNoTransition(
    command: RecordMachineNoTransition<TMachineType, TState, TContext>,
  ): Promise<void> {
    await this.runExclusive(async () => {
      const store = await this.readStore();
      const instance = store.instances.find(
        (candidate) => candidate.identity.instanceId === command.identity.instanceId,
      );
      if (!instance) {
        throw new StateStoreConflictError(
          `Machine instance ${command.identity.instanceId} does not exist.`,
        );
      }
      await this.prepareInstance(store, instance);
      if (instance.identity.machineType !== command.identity.machineType) {
        throw new StateStoreConflictError(
          `Machine instance ${command.identity.instanceId} belongs to ${instance.identity.machineType}, not ${command.identity.machineType}.`,
        );
      }
      if (instance.revision !== command.expectedRevision) {
        throw new StateStoreConflictError(
          `Machine instance ${command.identity.instanceId} changed from revision ${String(command.expectedRevision)} to ${String(instance.revision)}.`,
        );
      }
      if (instance.transitionHistory.some(({ ingressId }) => ingressId === command.ingressId)) {
        throw new StateStoreConflictError(
          `Ingress ${command.ingressId} was already evaluated for machine instance ${command.identity.instanceId}.`,
        );
      }

      instance.transitionHistory.push({
        sequence: instance.transitionHistory.length + 1,
        ingressId: command.ingressId,
        eventType: command.eventType,
        priorRevision: command.snapshot.revision,
        revision: command.snapshot.revision,
        priorState: this.encodeJson(command.snapshot.state, 'no-transition prior state'),
        nextState: null,
        disposition: { status: 'no_transition', reason: command.reason },
        evidence: 'complete',
      });
      await this.writeStore(store);
    });
  }

  public async claimNextCommittedEffect(
    canClaim: () => boolean = () => true,
  ): Promise<ClaimedEffect<TMachineType, TEffect> | null> {
    return this.runExclusive(async () => {
      if (!canClaim()) return null;
      const store = await this.readStore();
      if (!canClaim()) return null;
      for (const instance of store.instances) {
        const effect = instance.effects.find(({ execution }) => execution.status === 'committed');
        if (!effect) continue;

        const machineType = this.codec.decodeMachineType(instance.identity.machineType);
        const decodedEffect = this.codec.decodeEffect(effect.effect);
        effect.execution = { status: 'claimed' };
        await this.writeStore(store);
        return {
          identity: {
            machineType,
            instanceId: instance.identity.instanceId,
          },
          effectId: effect.effectId,
          revision: effect.revision,
          effect: decodedEffect,
          status: 'claimed',
        };
      }
      return null;
    });
  }

  public async claimEffect(
    instanceId: string,
    effectId: string,
    canClaim: () => boolean = () => true,
  ): Promise<ClaimedEffect<TMachineType, TEffect> | null> {
    return this.runExclusive(async () => {
      if (!canClaim()) return null;
      const store = await this.readStore();
      if (!canClaim()) return null;
      const instance = store.instances.find(
        (candidate) => candidate.identity.instanceId === instanceId,
      );
      if (!instance) {
        throw new StateStoreConflictError(`Machine instance ${instanceId} does not exist.`);
      }
      const effect = instance.effects.find((candidate) => candidate.effectId === effectId);
      if (!effect) {
        throw new StateStoreConflictError(
          `Effect ${effectId} does not exist for machine instance ${instanceId}.`,
        );
      }
      if (effect.execution.status !== 'committed') {
        throw new StateStoreConflictError(
          `Effect ${effectId} cannot be claimed from ${effect.execution.status}.`,
        );
      }

      const machineType = this.codec.decodeMachineType(instance.identity.machineType);
      const decodedEffect = this.codec.decodeEffect(effect.effect);
      effect.execution = { status: 'claimed' };
      await this.writeStore(store);
      return {
        identity: { machineType, instanceId },
        effectId,
        revision: effect.revision,
        effect: decodedEffect,
        status: 'claimed',
      };
    });
  }

  public async findNextSettledEffectAwaitingOutcomeAdmission(): Promise<SettledEffect<
    TMachineType,
    TEffect,
    TOutcome
  > | null> {
    await this.mutationTail;
    const store = await this.readStore();
    for (const instance of store.instances) {
      const effect = instance.effects.find(
        (candidate) =>
          candidate.execution.status === 'settled' &&
          !instance.acceptedIngress.some(
            ({ ingressId }) => ingressId === effectOutcomeIngressId(candidate.effectId),
          ),
      );
      if (effect?.execution.status !== 'settled') continue;

      return {
        identity: {
          machineType: this.codec.decodeMachineType(instance.identity.machineType),
          instanceId: instance.identity.instanceId,
        },
        effectId: effect.effectId,
        revision: effect.revision,
        effect: this.codec.decodeEffect(effect.effect),
        status: 'settled',
        settlement: {
          status: effect.execution.settlement.status,
          outcome: this.codec.decodeOutcome(effect.execution.settlement.outcome),
        },
      };
    }
    return null;
  }

  public async settleEffect(
    effectId: string,
    settlement: EffectSettlement<TOutcome>,
  ): Promise<SettledEffect<TMachineType, TEffect, TOutcome>> {
    return this.runExclusive(async () => {
      const store = await this.readStore();
      for (const instance of store.instances) {
        const effect = instance.effects.find((candidate) => candidate.effectId === effectId);
        if (!effect) continue;
        if (effect.execution.status !== 'claimed') {
          throw new StateStoreConflictError(
            `Effect ${effectId} cannot settle from ${effect.execution.status}.`,
          );
        }

        const persistedSettlement = {
          status: settlement.status,
          outcome: this.encodeJson(settlement.outcome, 'effect outcome'),
        };
        const machineType = this.codec.decodeMachineType(instance.identity.machineType);
        const decodedEffect = this.codec.decodeEffect(effect.effect);
        const decodedOutcome = this.codec.decodeOutcome(persistedSettlement.outcome);
        effect.execution = { status: 'settled', settlement: persistedSettlement };
        await this.writeStore(store);
        return {
          identity: {
            machineType,
            instanceId: instance.identity.instanceId,
          },
          effectId: effect.effectId,
          revision: effect.revision,
          effect: decodedEffect,
          status: 'settled',
          settlement: {
            status: persistedSettlement.status,
            outcome: decodedOutcome,
          },
        };
      }
      throw new StateStoreConflictError(`Effect ${effectId} does not exist.`);
    });
  }

  private async runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.mutationTail;
    let release = (): void => undefined;
    this.mutationTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  private async readStore(): Promise<PersistedStore> {
    let bytes: Uint8Array;
    try {
      bytes = await fs.readFile(this.filePath);
    } catch (error) {
      if (error instanceof Error && isNodeError(error) && error.code === 'ENOENT') {
        return emptyStore(this.readerApplicationVersion);
      }
      throw error;
    }

    const source: DurableDataSource = {
      paths: [this.filePath],
      bytesByPath: new Map([[this.filePath, bytes]]),
    };
    const opened = await this.compatibilityReader.open({
      familyId: 'machine-snapshot-store',
      currentSchemaVersion: STORE_SCHEMA_VERSION,
      readSource: async () => source,
      decodeSource: (candidate) => {
        const raw = jsonValueSchema.parse(
          JSON.parse(new TextDecoder().decode(candidate.bytesByPath.get(this.filePath))),
        );
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
          throw new Error('Machine state store root must be an object.');
        }
        const record = raw as Record<string, JsonValue>;
        const legacyVersion = record['stateVersion'];
        const schemaVersion = record['schemaVersion'];
        const sourceSchemaVersion =
          typeof schemaVersion === 'number'
            ? schemaVersion
            : typeof legacyVersion === 'number'
              ? legacyVersion
              : 0;
        return {
          source: candidate,
          sourceSchemaVersion,
          writerApplicationVersion:
            typeof record['writerApplicationVersion'] === 'string'
              ? record['writerApplicationVersion']
              : null,
          payload: raw,
        };
      },
      migrations: new Map([
        [
          1,
          (payload: JsonValue): JsonValue => {
            const legacy = legacyPersistedStoreSchema.parse(payload);
            return {
              schemaVersion: 2,
              writerApplicationVersion: this.readerApplicationVersion,
              instances: legacy.instances.map((instance) => ({
                ...instance,
                payloadSchemaVersion: 1,
              })),
            };
          },
        ],
        [
          2,
          (payload: JsonValue): JsonValue => {
            const legacy = persistedStoreV2Schema.parse(payload);
            return {
              schemaVersion: STORE_SCHEMA_VERSION,
              writerApplicationVersion: this.readerApplicationVersion,
              instances: legacy.instances.map((instance) => ({
                ...instance,
                transitionHistory: legacyTransitionHistory(instance),
              })),
            };
          },
        ],
      ]),
      validateCurrent: (payload) => this.validateStore(payload),
      promoteAtomically: async ({ value }) => this.writeStore(value),
    });
    if (opened.status === 'incompatible') {
      throw new MachineStateStoreCompatibilityError(opened.diagnostic);
    }
    if (opened.status === 'absent') {
      return emptyStore(this.readerApplicationVersion);
    }
    return opened.value;
  }

  private validateStore(payload: JsonValue): PersistedStore {
    const store = persistedStoreSchema.parse(payload);
    this.validateInvariants(store);
    return store;
  }

  private requiresRecovery(instance: PersistedInstance): boolean {
    if (!this.codec.isCompletedState?.(instance.state)) return true;
    return instance.effects.some(
      (effect) =>
        effect.execution.status !== 'settled' ||
        !instance.acceptedIngress.some(
          ({ ingressId }) => ingressId === effectOutcomeIngressId(effect.effectId),
        ),
    );
  }

  private async prepareInstance(store: PersistedStore, instance: PersistedInstance): Promise<void> {
    const instanceId = instance.identity.instanceId;
    const incompatible = this.incompatibleInstances.get(instanceId);
    if (incompatible) throw incompatible;
    if (this.compatibleInstances.has(instanceId)) return;
    const sourcePayloadSchemaVersion = instance.payloadSchemaVersion;
    let currentSchemaVersion = sourcePayloadSchemaVersion;
    let promotionAttempted = false;
    try {
      const compatibility = this.payloadCompatibility(instance.identity.machineType);
      currentSchemaVersion = compatibility.currentSchemaVersion;
      if (instance.payloadSchemaVersion > compatibility.currentSchemaVersion) {
        throw new CompatibilityValidationError(
          'unsupported_newer_schema',
          `Machine ${instance.identity.machineType}/${instanceId} uses unsupported payload schema ${String(instance.payloadSchemaVersion)}; reader supports ${String(compatibility.currentSchemaVersion)}.`,
        );
      }
      let version = instance.payloadSchemaVersion;
      let payload: JsonValue = {
        state: instance.state,
        context: instance.context,
        acceptedIngress: instance.acceptedIngress,
        effects: instance.effects,
        transitionHistory: instance.transitionHistory,
      };
      while (version < compatibility.currentSchemaVersion) {
        const migrate = compatibility.migrations.get(version);
        if (!migrate) {
          throw new CompatibilityValidationError(
            'missing_migration',
            `Machine ${instance.identity.machineType} has no payload migration from schema ${String(version)}.`,
          );
        }
        try {
          payload = migrate(payload);
        } catch (error) {
          throw new CompatibilityValidationError(
            'migration_failed',
            `Machine ${instance.identity.machineType} payload migration from schema ${String(version)} failed.`,
            error instanceof Error ? { cause: error } : undefined,
          );
        }
        version += 1;
      }
      const migrated = persistedMachinePayloadSchema.parse(payload);
      const candidate: PersistedInstance = {
        ...instance,
        ...migrated,
        payloadSchemaVersion: compatibility.currentSchemaVersion,
      };
      this.decodeInstance(candidate);
      if (version !== sourcePayloadSchemaVersion) {
        promotionAttempted = true;
        await this.writeStore({
          ...store,
          writerApplicationVersion: this.readerApplicationVersion,
          instances: store.instances.map((retained) =>
            retained === instance ? candidate : retained,
          ),
        });
        store.writerApplicationVersion = this.readerApplicationVersion;
      }
      Object.assign(instance, candidate);
      this.compatibleInstances.add(instanceId);
    } catch (error) {
      const reason = promotionAttempted
        ? 'promotion_failed'
        : error instanceof CompatibilityValidationError
          ? error.reason
          : 'production_codec_rejected';
      const diagnostic: CompatibilityDiagnostic = {
        familyId: `machine:${instance.identity.machineType}:${instanceId}`,
        sourcePaths: [this.filePath],
        reason,
        readerApplicationVersion: this.readerApplicationVersion,
        writerApplicationVersion: store.writerApplicationVersion,
        sourceSchemaVersion: sourcePayloadSchemaVersion,
        currentSchemaVersion,
        errorMessage: error instanceof Error ? error.message : String(error),
      };
      this.reportCompatibility(diagnostic);
      const compatibilityError = new MachineStateStoreCompatibilityError(diagnostic);
      this.incompatibleInstances.set(instanceId, compatibilityError);
      throw compatibilityError;
    }
  }

  private payloadCompatibility(machineType: string): MachinePayloadCompatibility {
    return (
      this.codec.payloadCompatibility?.(machineType) ?? {
        currentSchemaVersion: 1,
        migrations: new Map(),
      }
    );
  }

  private validateInvariants(store: PersistedStore): void {
    const instanceIds = new Set<string>();
    const effectIds = new Set<string>();
    for (const instance of store.instances) {
      if (instanceIds.has(instance.identity.instanceId)) {
        throw new Error(`Duplicate machine instance ${instance.identity.instanceId}.`);
      }
      instanceIds.add(instance.identity.instanceId);

      const ingressIds = new Set<string>();
      for (const accepted of instance.acceptedIngress) {
        if (ingressIds.has(accepted.ingressId)) {
          throw new Error(`Duplicate accepted ingress ${accepted.ingressId}.`);
        }
        if (accepted.revision > instance.revision) {
          throw new Error(`Accepted ingress ${accepted.ingressId} has a future revision.`);
        }
        ingressIds.add(accepted.ingressId);
      }

      const historyIngressIds = new Set<string>();
      for (const [index, transition] of instance.transitionHistory.entries()) {
        if (transition.sequence !== index + 1) {
          throw new Error(
            `Machine instance ${instance.identity.instanceId} has non-contiguous transition history.`,
          );
        }
        if (historyIngressIds.has(transition.ingressId)) {
          throw new Error(`Duplicate transition ingress ${transition.ingressId}.`);
        }
        if (transition.revision > instance.revision) {
          throw new Error(`Transition ingress ${transition.ingressId} has a future revision.`);
        }
        if (
          transition.disposition.status === 'committed' &&
          transition.revision !== transition.priorRevision + 1
        ) {
          throw new Error(
            `Committed transition ${transition.ingressId} must advance one revision.`,
          );
        }
        if (
          transition.disposition.status === 'no_transition' &&
          transition.revision !== transition.priorRevision
        ) {
          throw new Error(
            `No-transition evidence ${transition.ingressId} cannot advance revision.`,
          );
        }
        if (transition.disposition.status === 'committed' && transition.nextState === null) {
          throw new Error(`Committed transition ${transition.ingressId} has no next state.`);
        }
        if (transition.disposition.status === 'no_transition' && transition.nextState !== null) {
          throw new Error(`No-transition evidence ${transition.ingressId} has a next state.`);
        }
        if (transition.evidence === 'complete' && transition.priorState === null) {
          throw new Error(
            `Complete transition evidence ${transition.ingressId} has no prior state.`,
          );
        }
        historyIngressIds.add(transition.ingressId);
      }

      for (const accepted of instance.acceptedIngress) {
        const transition = instance.transitionHistory.find(
          ({ ingressId }) => ingressId === accepted.ingressId,
        );
        if (
          transition?.disposition.status !== 'committed' ||
          transition.revision !== accepted.revision
        ) {
          throw new Error(`Accepted ingress ${accepted.ingressId} has no committed transition.`);
        }
      }

      for (const effect of instance.effects) {
        if (effectIds.has(effect.effectId)) {
          throw new Error(`Duplicate committed effect ${effect.effectId}.`);
        }
        if (effect.revision > instance.revision) {
          throw new Error(`Machine instance ${instance.identity.instanceId} has a future effect.`);
        }
        effectIds.add(effect.effectId);
      }
      for (const transition of instance.transitionHistory) {
        if (transition.disposition.status !== 'committed') continue;
        for (const effectId of transition.disposition.effectIds) {
          const effect = instance.effects.find((candidate) => candidate.effectId === effectId);
          if (effect?.revision !== transition.revision) {
            throw new Error(
              `Committed transition ${transition.ingressId} references invalid effect ${effectId}.`,
            );
          }
        }
      }
    }
  }

  private async writeStore(store: PersistedStore): Promise<void> {
    this.validateInvariants(store);
    const directoryPath = path.dirname(this.filePath);
    await fs.mkdir(directoryPath, { recursive: true, mode: 0o700 });
    const tempPath = `${this.filePath}.tmp-${crypto.randomUUID()}`;
    try {
      const tempFile = await fs.open(tempPath, 'wx', 0o600);
      try {
        await tempFile.writeFile(JSON.stringify(store, null, 2), 'utf8');
        await tempFile.sync();
      } finally {
        await tempFile.close();
      }
      await fs.rename(tempPath, this.filePath);

      // POSIX requires syncing the parent directory for the rename itself to
      // survive a crash. Windows does not support opening directories this way.
      if (process.platform !== 'win32') {
        const directory = await fs.open(directoryPath, 'r');
        try {
          await directory.sync();
        } finally {
          await directory.close();
        }
      }
    } finally {
      await fs.rm(tempPath, { force: true }).catch(() => undefined);
    }
  }

  private encodeAcceptedEvent(
    result: AcceptedEventResult<TMachineType, TState, TContext, TEffect>,
  ): PersistedAcceptedEvent {
    return {
      ingressId: result.ingressId,
      revision: result.snapshot.revision,
      state: this.encodeJson(result.snapshot.state, 'accepted snapshot state'),
      context: this.encodeJson(result.snapshot.context, 'accepted snapshot context'),
      effects: result.effects.map((effect) => this.encodeJson(effect, 'accepted effect')),
    };
  }

  private encodeJson(value: object | MachineState, label: string): JsonValue {
    const result = jsonValueSchema.safeParse(value);
    if (!result.success) {
      throw new StateStoreCorruptionError(`Cannot persist non-JSON ${label}.`, {
        cause: result.error,
      });
    }
    return result.data;
  }

  private decodeInstance(
    instance: PersistedInstance,
  ): StoredMachineInstance<TMachineType, TState, TContext, TEffect, TOutcome> {
    const identity: MachineIdentity<TMachineType> = {
      machineType: this.codec.decodeMachineType(instance.identity.machineType),
      instanceId: instance.identity.instanceId,
    };
    const acceptedIngress = new Map<
      string,
      AcceptedEventResult<TMachineType, TState, TContext, TEffect>
    >();
    for (const accepted of instance.acceptedIngress) {
      acceptedIngress.set(accepted.ingressId, {
        status: 'accepted',
        ingressId: accepted.ingressId,
        snapshot: {
          identity,
          revision: accepted.revision,
          state: this.codec.decodeState(accepted.state),
          context: this.codec.decodeContext(accepted.context),
        },
        effects: accepted.effects.map(this.codec.decodeEffect),
      });
    }

    return {
      snapshot: {
        identity,
        revision: instance.revision,
        state: this.codec.decodeState(instance.state),
        context: this.codec.decodeContext(instance.context),
      },
      acceptedIngress,
      effects: instance.effects.map(({ effectId, revision, effect, execution }) => {
        const base = { effectId, revision, effect: this.codec.decodeEffect(effect) };
        if (execution.status !== 'settled') return { ...base, status: execution.status };
        return {
          ...base,
          status: 'settled' as const,
          settlement: {
            status: execution.settlement.status,
            outcome: this.codec.decodeOutcome(execution.settlement.outcome),
          },
        };
      }),
      transitionHistory: instance.transitionHistory.map((transition) => ({
        ...transition,
        priorState:
          transition.priorState === null ? null : this.codec.decodeState(transition.priorState),
        nextState:
          transition.nextState === null ? null : this.codec.decodeState(transition.nextState),
      })),
    };
  }
}
