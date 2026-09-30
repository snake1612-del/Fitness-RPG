import type {
  Entry,
  Exercise,
  LoadType,
  Program,
  Targets,
  Template,
} from "@/domain/training/planning";

// Every operation is scoped to the authenticated owner of this transaction.
export interface PlanningTransaction {
  listExercises(): Promise<Exercise[]>;
  findExercise(id: string): Promise<Exercise | undefined>;
  createExercise(name: string, loadType: LoadType): Promise<Exercise>;
  changeExercise(
    id: string,
    change: { name?: string; archived?: boolean },
  ): Promise<Exercise>;
  listPrograms(): Promise<Program[]>;
  findProgram(id: string): Promise<Program | undefined>;
  createProgram(name: string, isActive: boolean): Promise<Program>;
  renameProgram(id: string, name: string): Promise<Program>;
  activateProgram(id: string): Promise<void>;
  listTemplates(programId: string): Promise<Template[]>;
  findTemplate(id: string): Promise<Template | undefined>;
  createTemplate(
    programId: string,
    name: string,
    position: number,
  ): Promise<Template>;
  renameTemplate(id: string, name: string): Promise<Template>;
  reorderTemplates(programId: string, ids: string[]): Promise<void>;
  listEntries(templateId: string): Promise<Entry[]>;
  findEntry(id: string): Promise<Entry | undefined>;
  createEntry(
    templateId: string,
    exerciseId: string,
    position: number,
    targets: Targets,
  ): Promise<Entry>;
  changeEntry(id: string, targets: Targets): Promise<Entry>;
  reorderEntries(templateId: string, ids: string[]): Promise<void>;
}
export interface PlanningRepository {
  forUser<T>(
    userId: string,
    work: (tx: PlanningTransaction) => Promise<T>,
  ): Promise<T>;
}
