import {
  id,
  invalid,
  loadType,
  name,
  notFound,
  object,
  reorder,
  targetKeys,
  targets,
  type Exercise,
  type Program,
  type ProgramPlan,
} from "@/domain/training/planning";
import type { PlanningRepository, PlanningTransaction } from "./ports";

async function exercise(
  tx: PlanningTransaction,
  exerciseId: string,
  available = false,
): Promise<Exercise> {
  const value = await tx.findExercise(exerciseId);
  if (!value || (available && value.archived)) return notFound();
  return value;
}
async function program(
  tx: PlanningTransaction,
  programId: string,
): Promise<Program> {
  return (await tx.findProgram(programId)) ?? notFound();
}
async function plan(
  tx: PlanningTransaction,
  value: Program,
): Promise<ProgramPlan> {
  const templates = await tx.listTemplates(value.id);
  const result: ProgramPlan = { ...value, templates: [] };
  for (const template of templates) {
    const entries = await tx.listEntries(template.id);
    const exercises = [];
    for (const entry of entries) {
      const definition = await exercise(tx, entry.exerciseId);
      exercises.push({
        ...entry,
        exercise: {
          id: definition.id,
          name: definition.name,
          loadType: definition.loadType,
          archived: definition.archived,
        },
      });
    }
    result.templates.push({ ...template, exercises });
  }
  return result;
}
async function addEntry(
  tx: PlanningTransaction,
  templateId: string,
  input: unknown,
) {
  const value = object(input, ["exerciseId", ...targetKeys]);
  const definition = await exercise(tx, id(value.exerciseId), true);
  const target = targets(value, definition.loadType);
  const entries = await tx.listEntries(templateId);
  return tx.createEntry(templateId, definition.id, entries.length, target);
}
async function addTemplate(
  tx: PlanningTransaction,
  programId: string,
  input: unknown,
) {
  const value = object(input, ["name", "exercises"]);
  const templateName = name(value.name);
  if (value.exercises !== undefined && !Array.isArray(value.exercises))
    return invalid();
  const templates = await tx.listTemplates(programId);
  const template = await tx.createTemplate(
    programId,
    templateName,
    templates.length,
  );
  for (const entry of (value.exercises ?? []) as unknown[])
    await addEntry(tx, template.id, entry);
  return template;
}
export function createPlanningApplication(repository: PlanningRepository) {
  return {
    listExercises(userId: string) {
      return repository.forUser(userId, (tx) => tx.listExercises());
    },
    readExercise(userId: string, exerciseId: string) {
      return repository.forUser(userId, (tx) =>
        exercise(tx, id(exerciseId), true),
      );
    },
    createExercise(userId: string, input: unknown) {
      const value = object(input, ["name", "loadType"]);
      const exerciseName = name(value.name);
      const type = loadType(value.loadType);
      return repository.forUser(userId, (tx) =>
        tx.createExercise(exerciseName, type),
      );
    },
    changeExercise(userId: string, exerciseId: string, input: unknown) {
      const value = object(input, ["name", "archived"]);
      if (
        !Object.keys(value).length ||
        (value.archived !== undefined && value.archived !== true)
      )
        return invalid();
      const change = {
        ...(value.name !== undefined ? { name: name(value.name) } : {}),
        ...(value.archived === true ? { archived: true } : {}),
      };
      return repository.forUser(userId, async (tx) => {
        const current = await exercise(tx, id(exerciseId));
        if (current.ownerUserId !== userId) return notFound();
        return tx.changeExercise(current.id, change);
      });
    },
    listPrograms(userId: string) {
      return repository.forUser(userId, (tx) => tx.listPrograms());
    },
    readProgram(userId: string, programId: string) {
      return repository.forUser(userId, async (tx) =>
        plan(tx, await program(tx, id(programId))),
      );
    },
    activeProgram(userId: string) {
      return repository.forUser(userId, async (tx) => {
        const value = (await tx.listPrograms()).find((item) => item.isActive);
        return value ? plan(tx, value) : null;
      });
    },
    createProgram(userId: string, input: unknown) {
      const value = object(input, ["name", "initialTemplate"]);
      const programName = name(value.name);
      object(value.initialTemplate, ["name", "exercises"]);
      return repository.forUser(userId, async (tx) => {
        const first = (await tx.listPrograms()).length === 0;
        const created = await tx.createProgram(programName, first);
        await addTemplate(tx, created.id, value.initialTemplate);
        return plan(tx, created);
      });
    },
    renameProgram(userId: string, programId: string, input: unknown) {
      const value = object(input, ["name"]);
      const programName = name(value.name);
      return repository.forUser(userId, async (tx) => {
        const current = await program(tx, id(programId));
        return tx.renameProgram(current.id, programName);
      });
    },
    activateProgram(userId: string, programId: string) {
      return repository.forUser(userId, async (tx) => {
        const selected = await program(tx, id(programId));
        await tx.activateProgram(selected.id);
        return plan(tx, { ...selected, isActive: true });
      });
    },
    createTemplate(userId: string, programId: string, input: unknown) {
      return repository.forUser(userId, async (tx) => {
        const current = await program(tx, id(programId));
        return addTemplate(tx, current.id, input);
      });
    },
    renameTemplate(userId: string, templateId: string, input: unknown) {
      const value = object(input, ["name"]);
      const templateName = name(value.name);
      return repository.forUser(userId, async (tx) => {
        const current = (await tx.findTemplate(id(templateId))) ?? notFound();
        return tx.renameTemplate(current.id, templateName);
      });
    },
    reorderTemplates(userId: string, programId: string, input: unknown) {
      return repository.forUser(userId, async (tx) => {
        const current = await program(tx, id(programId));
        const orderedIds = reorder(
          input,
          (await tx.listTemplates(current.id)).map((item) => item.id),
        );
        await tx.reorderTemplates(current.id, orderedIds);
        return tx.listTemplates(current.id);
      });
    },
    createEntry(userId: string, templateId: string, input: unknown) {
      return repository.forUser(userId, async (tx) => {
        const current = (await tx.findTemplate(id(templateId))) ?? notFound();
        return addEntry(tx, current.id, input);
      });
    },
    changeEntry(userId: string, entryId: string, input: unknown) {
      const value = object(input, targetKeys);
      if (!Object.keys(value).length) return invalid();
      return repository.forUser(userId, async (tx) => {
        const current = (await tx.findEntry(id(entryId))) ?? notFound();
        const definition = await exercise(tx, current.exerciseId);
        return tx.changeEntry(
          current.id,
          targets({ ...current, ...value }, definition.loadType),
        );
      });
    },
    reorderEntries(userId: string, templateId: string, input: unknown) {
      return repository.forUser(userId, async (tx) => {
        const current = (await tx.findTemplate(id(templateId))) ?? notFound();
        const orderedIds = reorder(
          input,
          (await tx.listEntries(current.id)).map((item) => item.id),
        );
        await tx.reorderEntries(current.id, orderedIds);
        return tx.listEntries(current.id);
      });
    },
  };
}
export type PlanningApplication = ReturnType<typeof createPlanningApplication>;
