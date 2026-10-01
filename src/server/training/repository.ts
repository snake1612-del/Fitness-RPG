import "server-only";
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type {
  PlanningRepository,
  PlanningTransaction,
} from "@/application/training/ports";
import { notFound } from "@/domain/training/planning";
import {
  exercise,
  templateExercise,
  workoutProgram,
  workoutTemplate,
} from "../db/schema";

export function createPlanningRepository(
  database: NodePgDatabase,
): PlanningRepository {
  return {
    forUser(userId, work) {
      return database.transaction(async (tx) => {
        // Transaction-scoped: works across instances and releases on commit/rollback.
        // Also serializes reads with writes so nested plans have a consistent order.
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${userId}, 0))`,
        );
        const ownProgramIds = tx
          .select({ id: workoutProgram.id })
          .from(workoutProgram)
          .where(eq(workoutProgram.userId, userId));
        const ownTemplateIds = tx
          .select({ id: workoutTemplate.id })
          .from(workoutTemplate)
          .where(inArray(workoutTemplate.programId, ownProgramIds));
        const visibleExercise = or(
          isNull(exercise.ownerUserId),
          eq(exercise.ownerUserId, userId),
        );
        const scoped: PlanningTransaction = {
          listExercises: () =>
            tx
              .select()
              .from(exercise)
              .where(and(visibleExercise, eq(exercise.archived, false)))
              .orderBy(asc(exercise.name), asc(exercise.id)),
          async findExercise(value) {
            return (
              await tx
                .select()
                .from(exercise)
                .where(and(eq(exercise.id, value), visibleExercise))
            )[0];
          },
          async createExercise(name, loadType) {
            return (
              await tx
                .insert(exercise)
                .values({ ownerUserId: userId, name, loadType })
                .returning()
            )[0];
          },
          async changeExercise(value, change) {
            return (
              (
                await tx
                  .update(exercise)
                  .set({ ...change, updatedAt: new Date() })
                  .where(
                    and(
                      eq(exercise.id, value),
                      eq(exercise.ownerUserId, userId),
                    ),
                  )
                  .returning()
              )[0] ?? notFound()
            );
          },
          listPrograms: () =>
            tx
              .select()
              .from(workoutProgram)
              .where(eq(workoutProgram.userId, userId))
              .orderBy(asc(workoutProgram.createdAt), asc(workoutProgram.id)),
          async findProgram(value) {
            return (
              await tx
                .select()
                .from(workoutProgram)
                .where(
                  and(
                    eq(workoutProgram.id, value),
                    eq(workoutProgram.userId, userId),
                  ),
                )
            )[0];
          },
          async createProgram(name, isActive) {
            return (
              await tx
                .insert(workoutProgram)
                .values({ userId, name, isActive })
                .returning()
            )[0];
          },
          async renameProgram(value, name) {
            return (
              (
                await tx
                  .update(workoutProgram)
                  .set({ name, updatedAt: new Date() })
                  .where(
                    and(
                      eq(workoutProgram.id, value),
                      eq(workoutProgram.userId, userId),
                    ),
                  )
                  .returning()
              )[0] ?? notFound()
            );
          },
          async activateProgram(value) {
            const selected = await scoped.findProgram(value);
            if (!selected) return notFound();
            await tx
              .update(workoutProgram)
              .set({ isActive: false, updatedAt: new Date() })
              .where(
                and(
                  eq(workoutProgram.userId, userId),
                  eq(workoutProgram.isActive, true),
                ),
              );
            await tx
              .update(workoutProgram)
              .set({ isActive: true, updatedAt: new Date() })
              .where(
                and(
                  eq(workoutProgram.id, value),
                  eq(workoutProgram.userId, userId),
                ),
              );
          },
          listTemplates: (programId) =>
            tx
              .select()
              .from(workoutTemplate)
              .where(
                and(
                  eq(workoutTemplate.programId, programId),
                  inArray(workoutTemplate.programId, ownProgramIds),
                ),
              )
              .orderBy(asc(workoutTemplate.position)),
          async findTemplate(value) {
            return (
              await tx
                .select()
                .from(workoutTemplate)
                .where(
                  and(
                    eq(workoutTemplate.id, value),
                    inArray(workoutTemplate.programId, ownProgramIds),
                  ),
                )
            )[0];
          },
          async createTemplate(programId, name, position) {
            if (!(await scoped.findProgram(programId))) return notFound();
            return (
              await tx
                .insert(workoutTemplate)
                .values({ programId, name, position })
                .returning()
            )[0];
          },
          async renameTemplate(value, name) {
            return (
              (
                await tx
                  .update(workoutTemplate)
                  .set({ name, updatedAt: new Date() })
                  .where(
                    and(
                      eq(workoutTemplate.id, value),
                      inArray(workoutTemplate.programId, ownProgramIds),
                    ),
                  )
                  .returning()
              )[0] ?? notFound()
            );
          },
          async reorderTemplates(programId, ids) {
            const current = await scoped.listTemplates(programId);
            const offset =
              Math.max(-1, ...current.map((item) => item.position)) + 1;
            await tx
              .update(workoutTemplate)
              .set({
                position: sql`${workoutTemplate.position} + ${offset}`,
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(workoutTemplate.programId, programId),
                  inArray(workoutTemplate.programId, ownProgramIds),
                ),
              );
            for (const [position, value] of ids.entries())
              await tx
                .update(workoutTemplate)
                .set({ position })
                .where(
                  and(
                    eq(workoutTemplate.id, value),
                    eq(workoutTemplate.programId, programId),
                    inArray(workoutTemplate.programId, ownProgramIds),
                  ),
                );
          },
          listEntries: (templateId) =>
            tx
              .select()
              .from(templateExercise)
              .where(
                and(
                  eq(templateExercise.templateId, templateId),
                  inArray(templateExercise.templateId, ownTemplateIds),
                ),
              )
              .orderBy(asc(templateExercise.position)),
          async findEntry(value) {
            return (
              await tx
                .select()
                .from(templateExercise)
                .where(
                  and(
                    eq(templateExercise.id, value),
                    inArray(templateExercise.templateId, ownTemplateIds),
                  ),
                )
            )[0];
          },
          async createEntry(templateId, exerciseId, position, targets) {
            if (!(await scoped.findTemplate(templateId))) return notFound();
            const definition = await scoped.findExercise(exerciseId);
            if (!definition || definition.archived) return notFound();
            return (
              await tx
                .insert(templateExercise)
                .values({ templateId, exerciseId, position, ...targets })
                .returning()
            )[0];
          },
          async changeEntry(value, targets) {
            return (
              (
                await tx
                  .update(templateExercise)
                  .set({ ...targets, updatedAt: new Date() })
                  .where(
                    and(
                      eq(templateExercise.id, value),
                      inArray(templateExercise.templateId, ownTemplateIds),
                    ),
                  )
                  .returning()
              )[0] ?? notFound()
            );
          },
          async reorderEntries(templateId, ids) {
            const current = await scoped.listEntries(templateId);
            const offset =
              Math.max(-1, ...current.map((item) => item.position)) + 1;
            await tx
              .update(templateExercise)
              .set({
                position: sql`${templateExercise.position} + ${offset}`,
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(templateExercise.templateId, templateId),
                  inArray(templateExercise.templateId, ownTemplateIds),
                ),
              );
            for (const [position, value] of ids.entries())
              await tx
                .update(templateExercise)
                .set({ position })
                .where(
                  and(
                    eq(templateExercise.id, value),
                    eq(templateExercise.templateId, templateId),
                    inArray(templateExercise.templateId, ownTemplateIds),
                  ),
                );
          },
        };
        return work(scoped);
      });
    },
  };
}
